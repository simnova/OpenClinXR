import type {
  ExamStationRunQueueItem,
  ExamRunStationOutcome,
  ExamFormRunState,
  CreateExamFormRunInput,
  AdvanceExamFormRunStationInput,
  AdvanceExamFormRunBreakInput,
  ExamStationRunQueueSnapshot,
  ExamAssemblyPersistenceSink,
  CreateExamStationRunQueueSnapshotInput,
} from "./types.js";
import { examFormRunNotEvidenceFor } from "./types.js";
import {
  createExamStationRunQueue,
  assembleExamForm,
} from "./assembly.js";
import {
  appendBreakPhaseTransition,
  canCompleteOccupiedBreak,
  createExamFormRunClockFromQueue,
  defaultExamFormRunPhase,
  occupiedBreakAfterStation,
  parseExamFormRunState,
} from "./exam-form-breaks.js";

export function createExamFormRun(input: CreateExamFormRunInput): ExamFormRunState {
  const form = assembleExamForm({
    examFormId: input.examFormId,
    blueprint: input.blueprint,
    scenarios: input.scenarios,
  });
  const queue = createExamStationRunQueue(input.blueprint, input.scenarios, {
    ...(input.breakDurationSeconds !== undefined ? { breakDurationSeconds: input.breakDurationSeconds } : {}),
    ...(input.breakDurationsByAfterStationOrder !== undefined
      ? { breakDurationsByAfterStationOrder: input.breakDurationsByAfterStationOrder }
      : {}),
  });
  const clock = createExamFormRunClockFromQueue(queue, 0);
  const blocked = !queue.canStartLearnerExam || queue.stationQueue.length === 0;

  return {
    examRunId: input.examRunId,
    examFormId: form.examFormId,
    blueprintId: form.blueprintId,
    form,
    queue,
    status: blocked ? "blocked" : "not_started",
    currentStationIndex: 0,
    currentPhase: defaultExamFormRunPhase(),
    clock,
    stationOutcomes: [],
    breakPhaseTransitions: [],
    claimBoundary: "learner_multi_station_runtime_skeleton_not_exam_equivalence",
    notEvidenceFor: examFormRunNotEvidenceFor,
    examEquivalenceGate: false,
  };
}

export function startExamFormRun(run: ExamFormRunState, atFormSecond = 0): ExamFormRunState {
  if (run.status === "blocked") {
    return run;
  }
  if (run.queue.stationQueue.length === 0) {
    return { ...run, status: "blocked", examEquivalenceGate: false };
  }
  return {
    ...run,
    status: "in_progress",
    currentStationIndex: 0,
    currentPhase: defaultExamFormRunPhase(),
    clock: createExamFormRunClockFromQueue(run.queue, atFormSecond),
    examEquivalenceGate: false,
  };
}

export function tickExamFormRunClock(run: ExamFormRunState, formElapsedSecond: number): ExamFormRunState {
  const clamped = Number.isFinite(formElapsedSecond) ? Math.max(0, formElapsedSecond) : 0;
  return {
    ...run,
    clock: createExamFormRunClockFromQueue(run.queue, clamped),
    examEquivalenceGate: false,
  };
}

export function currentExamFormRunPhase(run: ExamFormRunState): ExamFormRunState["currentPhase"] {
  return run.currentPhase;
}

export function currentExamFormRunStation(run: ExamFormRunState): ExamStationRunQueueItem | null {
  if (run.currentPhase.kind === "break") {
    return null;
  }
  return run.queue.stationQueue[run.currentStationIndex] ?? null;
}

export function nextExamFormRunStation(run: ExamFormRunState): ExamStationRunQueueItem | null {
  return run.queue.stationQueue[run.currentStationIndex + 1] ?? null;
}

/**
 * Record per-station outcome and advance the form run pointer to the next station
 * (or into a configured occupied break, or mark complete when no stations remain).
 * Break positions come from queue.breakWindows — never hardcoded 3/6/9.
 */
export function advanceExamFormRunStation(
  run: ExamFormRunState,
  input: AdvanceExamFormRunStationInput,
): ExamFormRunState {
  if (run.status === "blocked" || run.status === "complete") {
    return run;
  }
  if (run.currentPhase.kind === "break") {
    return run;
  }

  const station = currentExamFormRunStation(run);
  if (!station) {
    return { ...run, status: "complete", examEquivalenceGate: false };
  }

  const endedAtFormSecond = input.endedAtFormSecond ?? run.clock.formElapsedSecond;
  const startedAtFormSecond = station.timing.doorway.startsAtSecond;
  const outcome: ExamRunStationOutcome = {
    stationOrder: station.stationOrder,
    slotId: station.slotId,
    scenarioId: station.scenarioId,
    scenarioVersion: station.scenarioVersion,
    phase: input.phase,
    noteSubmitted: input.noteSubmitted,
    startedAtFormSecond,
    endedAtFormSecond,
    advanceReason: input.advanceReason,
    recordedAtIso: input.recordedAtIso ?? new Date().toISOString(),
  };

  const stationOutcomes = [
    ...run.stationOutcomes.filter((existing) => existing.stationOrder !== outcome.stationOrder),
    outcome,
  ].sort((left, right) => left.stationOrder - right.stationOrder);

  const nextIndex = run.currentStationIndex + 1;
  const hasNext = nextIndex < run.queue.stationQueue.length;
  const pendingBreak = hasNext
    ? occupiedBreakAfterStation(run.queue.breakWindows, station.stationOrder)
    : null;
  if (pendingBreak) {
    return {
      ...run,
      status: "in_progress",
      currentStationIndex: run.currentStationIndex,
      currentPhase: { kind: "break", afterStationOrder: pendingBreak.afterStationOrder },
      stationOutcomes,
      breakPhaseTransitions: appendBreakPhaseTransition(run, {
        eventType: "break.started",
        afterStationOrder: pendingBreak.afterStationOrder,
        formAtSecond: endedAtFormSecond,
        durationSeconds: pendingBreak.durationSeconds,
        ...(input.recordedAtIso !== undefined ? { recordedAtIso: input.recordedAtIso } : {}),
      }),
      clock: createExamFormRunClockFromQueue(run.queue, endedAtFormSecond),
      examEquivalenceGate: false,
    };
  }

  return {
    ...run,
    status: hasNext ? "in_progress" : "complete",
    currentStationIndex: hasNext ? nextIndex : run.currentStationIndex,
    currentPhase: defaultExamFormRunPhase(),
    stationOutcomes,
    clock: createExamFormRunClockFromQueue(run.queue, endedAtFormSecond),
    examEquivalenceGate: false,
  };
}

/**
 * End the current occupied break exactly once and resume the next station (or complete the form).
 */
export function advanceExamFormRunBreak(
  run: ExamFormRunState,
  input: AdvanceExamFormRunBreakInput = {},
): ExamFormRunState {
  if (run.status === "blocked" || run.status === "complete") {
    return run;
  }
  if (run.currentPhase.kind !== "break") {
    return run;
  }

  const afterStationOrder = run.currentPhase.afterStationOrder;
  const pendingBreak = occupiedBreakAfterStation(run.queue.breakWindows, afterStationOrder);
  if (!pendingBreak) {
    return run;
  }

  const endedAtFormSecond = input.endedAtFormSecond ?? run.clock.formElapsedSecond;
  if (!canCompleteOccupiedBreak(pendingBreak, endedAtFormSecond)) {
    return run;
  }
  const breakPhaseTransitions = appendBreakPhaseTransition(run, {
    eventType: "break.ended",
    afterStationOrder,
    formAtSecond: endedAtFormSecond,
    durationSeconds: pendingBreak.durationSeconds,
    ...(input.recordedAtIso !== undefined ? { recordedAtIso: input.recordedAtIso } : {}),
  });

  const nextIndex = run.currentStationIndex + 1;
  const hasNext = nextIndex < run.queue.stationQueue.length;

  return {
    ...run,
    status: hasNext ? "in_progress" : "complete",
    currentStationIndex: hasNext ? nextIndex : run.currentStationIndex,
    currentPhase: defaultExamFormRunPhase(),
    breakPhaseTransitions,
    clock: createExamFormRunClockFromQueue(run.queue, endedAtFormSecond),
    examEquivalenceGate: false,
  };
}

export function resumeExamFormRun(serialized: string, atFormSecond?: number): ExamFormRunState {
  const run = parseExamFormRunState(serialized);
  if (atFormSecond === undefined) {
    return run;
  }
  return tickExamFormRunClock(run, atFormSecond);
}

export function createExamStationRunQueueSnapshot(
  input: CreateExamStationRunQueueSnapshotInput,
): ExamStationRunQueueSnapshot {
  return {
    snapshotId: input.snapshotId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.reviewerId !== undefined ? { reviewerId: input.reviewerId } : {}),
    queue: input.queue,
    ...(input.scenarioSource !== undefined ? { scenarioSource: input.scenarioSource } : {}),
    ...(input.fallbackActive !== undefined ? { fallbackActive: input.fallbackActive } : {}),
    ...(input.fallbackReason !== undefined ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.stationBodySources !== undefined ? { stationBodySources: input.stationBodySources } : {}),
  };
}

/**
 * Persist a station-run-queue snapshot through an injected sink (ApiPersistenceSink-compatible).
 * Does not open mongo or touch apps/api — caller injects the sink.
 */
export async function persistExamStationRunQueueSnapshot(
  sink: ExamAssemblyPersistenceSink,
  snapshot: ExamStationRunQueueSnapshot,
): Promise<ExamStationRunQueueSnapshot> {
  await sink.saveStationRunQueueSnapshot?.(snapshot);
  return snapshot;
}

