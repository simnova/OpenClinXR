import type {
  ExamBlueprint,
  ExamBlueprintTiming,
  ExamBreakWindow,
  ExamFormBreakPhaseTransition,
  ExamFormBreakPhaseTransitionType,
  ExamFormRunActivePhase,
  ExamFormRunClock,
  ExamFormRunState,
  ExamFormTimingOptions,
  ExamStationRunQueue,
  ExamStationTimingWindow,
  ExamTimingPlan,
  ExamTimingWindow,
} from "./types.js";
import { examFormRunNotEvidenceFor } from "./types.js";

export function buildExamTimingPlan(
  blueprint: ExamBlueprint,
  options: ExamFormTimingOptions = {},
): ExamTimingPlan {
  const sortedSlots = [...blueprint.stationSlots].sort(
    (left, right) => left.order - right.order || left.slotId.localeCompare(right.slotId),
  );
  const breakOrders = uniqueSortedPositiveIntegers(blueprint.timing.breakAfterStationOrders);
  const stationDuration = stationDurationSeconds(blueprint.timing);
  const stationWindows: ExamStationTimingWindow[] = [];
  const breakWindows: ExamBreakWindow[] = [];
  let cursor = 0;

  for (const slot of sortedSlots) {
    const doorway = timingWindow(cursor, blueprint.timing.doorwaySeconds);
    const encounter = timingWindow(doorway.endsAtSecond, blueprint.timing.encounterSeconds);
    const note = timingWindow(encounter.endsAtSecond, blueprint.timing.noteSeconds);
    stationWindows.push({
      stationOrder: slot.order,
      slotId: slot.slotId,
      label: slot.label,
      doorway,
      encounter,
      note,
    });
    cursor = note.endsAtSecond;

    if (!breakOrders.includes(slot.order)) {
      continue;
    }

    const durationSeconds = breakDurationFor(slot.order, options);
    const window: ExamBreakWindow = {
      afterStationOrder: slot.order,
      startsAtSecond: cursor,
      endsAtSecond: cursor + durationSeconds,
      durationSeconds,
      phase: "break",
    };
    breakWindows.push(window);
    cursor = window.endsAtSecond;
  }

  const totalStationTimeSeconds = stationWindows.length * stationDuration;
  const totalBreakTimeSeconds = breakWindows.reduce((sum, window) => sum + window.durationSeconds, 0);

  return {
    blueprintId: blueprint.blueprintId,
    stationWindows,
    breakCheckpoints: breakWindows.map((window) => ({
      afterStationOrder: window.afterStationOrder,
      atSecond: window.startsAtSecond,
    })),
    breakWindows,
    totalStationTimeSeconds,
    totalBreakTimeSeconds,
    totalFormTimeSeconds: totalStationTimeSeconds + totalBreakTimeSeconds,
  };
}

export function occupiedBreakAfterStation(
  windows: readonly ExamBreakWindow[],
  afterStationOrder: number,
): ExamBreakWindow | null {
  return windows.find((window) => window.afterStationOrder === afterStationOrder && window.durationSeconds > 0) ?? null;
}

/** True only when form time is finite and at/after the occupied window end. */
export function canCompleteOccupiedBreak(window: ExamBreakWindow, formSecond: number): boolean {
  return Number.isFinite(formSecond) && formSecond >= window.endsAtSecond;
}

export function accountExamFormElapsed(
  queue: Pick<ExamStationRunQueue, "stationQueue" | "breakWindows">,
  formElapsedSecond: number,
): { stationElapsedSecond: number; breakElapsedSecond: number } {
  const elapsed = finiteNonNegative(formElapsedSecond);
  const breakElapsedSecond = queue.breakWindows.reduce(
    (sum, window) => sum + overlapSeconds(0, elapsed, window.startsAtSecond, window.endsAtSecond),
    0,
  );
  const stationElapsedSecond = queue.stationQueue.reduce((sum, station) => {
    return sum + overlapSeconds(0, elapsed, station.timing.doorway.startsAtSecond, station.timing.note.endsAtSecond);
  }, 0);
  return { stationElapsedSecond, breakElapsedSecond };
}

export function createExamFormRunClockFromQueue(
  queue: Pick<ExamStationRunQueue, "stationQueue" | "breakWindows" | "totalStationTimeSeconds" | "totalBreakTimeSeconds" | "totalFormTimeSeconds">,
  formElapsedSecond: number,
): ExamFormRunClock {
  const elapsed = finiteNonNegative(formElapsedSecond);
  const totalStationTimeSeconds = finiteNonNegative(queue.totalStationTimeSeconds);
  const totalBreakTimeSeconds = finiteNonNegative(queue.totalBreakTimeSeconds);
  const totalFormTimeSeconds = finiteNonNegative(queue.totalFormTimeSeconds);
  const accounted = accountExamFormElapsed(queue, elapsed);
  return {
    formElapsedSecond: elapsed,
    totalStationTimeSeconds,
    formRemainingSecond: Math.max(0, totalFormTimeSeconds - elapsed),
    stationElapsedSecond: accounted.stationElapsedSecond,
    breakElapsedSecond: accounted.breakElapsedSecond,
    totalBreakTimeSeconds,
    totalFormTimeSeconds,
  };
}

export function hasBreakPhaseTransition(
  transitions: readonly ExamFormBreakPhaseTransition[],
  afterStationOrder: number,
  eventType: ExamFormBreakPhaseTransitionType,
): boolean {
  return transitions.some(
    (transition) => transition.afterStationOrder === afterStationOrder && transition.eventType === eventType,
  );
}

export function appendBreakPhaseTransition(
  run: ExamFormRunState,
  input: {
    eventType: ExamFormBreakPhaseTransitionType;
    afterStationOrder: number;
    formAtSecond: number;
    durationSeconds: number;
    recordedAtIso?: string | undefined;
  },
): ExamFormBreakPhaseTransition[] {
  if (hasBreakPhaseTransition(run.breakPhaseTransitions, input.afterStationOrder, input.eventType)) {
    return run.breakPhaseTransitions;
  }

  const next: ExamFormBreakPhaseTransition = {
    eventType: input.eventType,
    afterStationOrder: input.afterStationOrder,
    formAtSecond: input.formAtSecond,
    durationSeconds: input.durationSeconds,
    phase: "break",
    examRunId: run.examRunId,
    sequence: run.breakPhaseTransitions.length + 1,
    recordedAtIso: input.recordedAtIso ?? new Date().toISOString(),
  };
  return [...run.breakPhaseTransitions, next];
}

export function defaultExamFormRunPhase(): ExamFormRunActivePhase {
  return { kind: "station" };
}

export function serializeExamFormRunState(run: ExamFormRunState): string {
  return JSON.stringify(run);
}

export function parseExamFormRunState(serialized: string): ExamFormRunState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("OpenClinXR exam form run: serialized state is not JSON");
  }
  if (!isPlainRecord(parsed)) {
    throw new Error("OpenClinXR exam form run: serialized state must be an object");
  }
  if (typeof parsed["examRunId"] !== "string" || parsed["examRunId"].length === 0) {
    throw new Error("OpenClinXR exam form run: examRunId is required");
  }
  if (parsed["examEquivalenceGate"] !== false) {
    throw new Error("OpenClinXR exam form run: examEquivalenceGate must be false");
  }
  if (!Array.isArray(parsed["notEvidenceFor"])) {
    throw new Error("OpenClinXR exam form run: notEvidenceFor is required");
  }
  for (const flag of examFormRunNotEvidenceFor) {
    if (!parsed["notEvidenceFor"].includes(flag)) {
      throw new Error(`OpenClinXR exam form run: notEvidenceFor missing ${flag}`);
    }
  }
  if (!isPlainRecord(parsed["queue"])) {
    throw new Error("OpenClinXR exam form run: queue is required");
  }
  const queue = parsed["queue"] as ExamStationRunQueue;
  if (!Array.isArray(queue.breakWindows)) {
    queue.breakWindows = [];
  }
  if (!Array.isArray(queue.breakCheckpoints)) {
    throw new Error("OpenClinXR exam form run: queue.breakCheckpoints is required");
  }
  queue.totalBreakTimeSeconds = finiteNonNegative(queue.totalBreakTimeSeconds);
  queue.totalFormTimeSeconds = finiteNonNegative(queue.totalFormTimeSeconds ?? queue.totalStationTimeSeconds);
  const currentPhase = parseCurrentPhase(parsed["currentPhase"]);
  const breakPhaseTransitions = Array.isArray(parsed["breakPhaseTransitions"])
    ? parsed["breakPhaseTransitions"].filter(isBreakPhaseTransition)
    : [];

  const run = parsed as unknown as ExamFormRunState;
  return {
    ...run,
    queue,
    currentPhase,
    breakPhaseTransitions,
    clock: createExamFormRunClockFromQueue(queue, Number(run.clock?.formElapsedSecond ?? 0)),
    examEquivalenceGate: false,
    notEvidenceFor: examFormRunNotEvidenceFor,
  };
}

function parseCurrentPhase(value: unknown): ExamFormRunActivePhase {
  if (!isPlainRecord(value)) {
    return defaultExamFormRunPhase();
  }
  if (value["kind"] === "break" && typeof value["afterStationOrder"] === "number" && value["afterStationOrder"] >= 1) {
    return { kind: "break", afterStationOrder: value["afterStationOrder"] };
  }
  return defaultExamFormRunPhase();
}

function isBreakPhaseTransition(value: unknown): value is ExamFormBreakPhaseTransition {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (value["eventType"] === "break.started" || value["eventType"] === "break.ended")
    && value["phase"] === "break"
    && typeof value["afterStationOrder"] === "number"
    && typeof value["formAtSecond"] === "number"
    && typeof value["examRunId"] === "string";
}

function breakDurationFor(afterStationOrder: number, options: ExamFormTimingOptions): number {
  const mapped = options.breakDurationsByAfterStationOrder?.[afterStationOrder];
  if (typeof mapped === "number") {
    return finiteNonNegative(mapped);
  }
  return finiteNonNegative(options.breakDurationSeconds ?? 0);
}

function uniqueSortedPositiveIntegers(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 1))].sort((left, right) => left - right);
}

function stationDurationSeconds(timing: ExamBlueprintTiming): number {
  return timing.doorwaySeconds + timing.encounterSeconds + timing.noteSeconds;
}

function timingWindow(startsAtSecond: number, durationSeconds: number): ExamTimingWindow {
  return {
    startsAtSecond,
    endsAtSecond: startsAtSecond + durationSeconds,
    durationSeconds,
  };
}

function overlapSeconds(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
