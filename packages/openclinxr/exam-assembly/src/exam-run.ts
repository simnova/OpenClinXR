import { edChestPainScenario, scenarioBank, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import type {
  Scenario,
  ExamBlueprint as SharedExamBlueprint,
  ExamBlueprintTiming as SharedExamBlueprintTiming,
  ExamStationSlot as SharedExamStationSlot,
} from "@openclinxr/shared-schemas";
import type {
  ExamBlueprint,
  ExamBlueprintTiming,
  ExamStationSlot,
  ExamStationRef,
  ExamCoverage,
  ExamFormStatus,
  ExamForm,
  AssembleExamFormInput,
  ScenarioVersionDrift,
  BlueprintScenarioReadiness,
  ExamTimingWindow,
  ExamStationTimingWindow,
  ExamTimingPlan,
  ExamStationRunQueueStatus,
  ExamStationRunQueueItem,
  ExamStationRunQueue,
  ExamRunStationPhase,
  ExamRunStationOutcome,
  ExamFormRunClock,
  ExamFormRunStatus,
  ExamFormRunState,
  CreateExamFormRunInput,
  AdvanceExamFormRunStationInput,
  ExamStationRunQueueSnapshot,
  ExamAssemblyPersistenceSink,
  CreateExamStationRunQueueSnapshotInput,
} from "./types.js";
import { examFormRunNotEvidenceFor } from "./types.js";
import {
  createDefaultClinicalSkillsBlueprint,
  createStep2CsStyleSeedBlueprint,
  evaluateBlueprintScenarioReadiness,
  createExamTimingPlan,
  createExamStationRunQueue,
  assembleExamForm,
  evaluateScenarioVersionDrift,
} from "./assembly.js";

export function createExamFormRun(input: CreateExamFormRunInput): ExamFormRunState {
  const form = assembleExamForm({
    examFormId: input.examFormId,
    blueprint: input.blueprint,
    scenarios: input.scenarios,
  });
  const queue = createExamStationRunQueue(input.blueprint, input.scenarios);
  const clock = createExamFormRunClock(queue.totalStationTimeSeconds, 0);
  const blocked = !queue.canStartLearnerExam || queue.stationQueue.length === 0;

  return {
    examRunId: input.examRunId,
    examFormId: form.examFormId,
    blueprintId: form.blueprintId,
    form,
    queue,
    status: blocked ? "blocked" : "not_started",
    currentStationIndex: 0,
    clock,
    stationOutcomes: [],
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
    clock: createExamFormRunClock(run.queue.totalStationTimeSeconds, atFormSecond),
    examEquivalenceGate: false,
  };
}

export function tickExamFormRunClock(run: ExamFormRunState, formElapsedSecond: number): ExamFormRunState {
  const clamped = Number.isFinite(formElapsedSecond) ? Math.max(0, formElapsedSecond) : 0;
  return {
    ...run,
    clock: createExamFormRunClock(run.queue.totalStationTimeSeconds, clamped),
    examEquivalenceGate: false,
  };
}

export function currentExamFormRunStation(run: ExamFormRunState): ExamStationRunQueueItem | null {
  return run.queue.stationQueue[run.currentStationIndex] ?? null;
}

export function nextExamFormRunStation(run: ExamFormRunState): ExamStationRunQueueItem | null {
  return run.queue.stationQueue[run.currentStationIndex + 1] ?? null;
}

/**
 * Record per-station outcome and advance the form run pointer to the next station
 * (or mark complete when no further activation-ready stations remain in sequence).
 */
export function advanceExamFormRunStation(
  run: ExamFormRunState,
  input: AdvanceExamFormRunStationInput,
): ExamFormRunState {
  if (run.status === "blocked" || run.status === "complete") {
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

  return {
    ...run,
    status: hasNext ? "in_progress" : "complete",
    currentStationIndex: hasNext ? nextIndex : run.currentStationIndex,
    stationOutcomes,
    clock: createExamFormRunClock(run.queue.totalStationTimeSeconds, endedAtFormSecond),
    examEquivalenceGate: false,
  };
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

function createExamFormRunClock(totalStationTimeSeconds: number, formElapsedSecond: number): ExamFormRunClock {
  const elapsed = Number.isFinite(formElapsedSecond) ? Math.max(0, formElapsedSecond) : 0;
  const total = Number.isFinite(totalStationTimeSeconds) ? Math.max(0, totalStationTimeSeconds) : 0;
  return {
    formElapsedSecond: elapsed,
    totalStationTimeSeconds: total,
    formRemainingSecond: Math.max(0, total - elapsed),
  };
}

