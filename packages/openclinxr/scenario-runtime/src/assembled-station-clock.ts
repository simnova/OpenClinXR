/**
 * Deterministic assembled-station timing authority.
 *
 * Deadlines come from form windows plus persisted canonical start events.
 * Remaining time is reconstructed from those timestamps and an injected
 * form-second clock. No wall-clock reads.
 */
import type { AssembledExamPhaseTransitionType } from "@openclinxr/review-workflow";
import type { AssembledStationFormTiming } from "./runtime-types.js";

export const assembledStationClockClaimBoundary =
  "assembled_station_clock_not_exam_equivalence" as const;

export const assembledStationClockNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
  "production_deployment",
] as const;

export const STATION_TIMEOUT_ADVANCE_REASON = "station_timeout_advancing" as const;
export const LAST_STATION_TIMEOUT_ADVANCE_REASON = "last_station_timeout_exam_complete" as const;

const TIMEOUT_CHAIN = [
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const satisfies readonly AssembledExamPhaseTransitionType[];

export type AssembledStationClockAdmittedEvent = {
  eventType: AssembledExamPhaseTransitionType;
  formAtSecond: number;
  advanceReason?: string;
};

export type AssembledStationClockManualCompletion = {
  eventType: AssembledExamPhaseTransitionType;
  formAtSecond: number;
  advanceReason?: string;
};

export type AssembledStationTimeoutTransition = {
  eventType: (typeof TIMEOUT_CHAIN)[number];
  formAtSecond: number;
  source: "timeout" | "manual";
  advanceReason?: string;
};

export type ObserveAssembledStationClockInput = {
  formTiming: AssembledStationFormTiming;
  admittedEvents: readonly AssembledStationClockAdmittedEvent[];
  nowFormSecond: number;
  lastObservedFormSecond?: number;
  isLastStation?: boolean;
  manualCompletion?: AssembledStationClockManualCompletion;
};

export type AssembledStationClockSnapshot = {
  nowFormSecond: number;
  lastObservedFormSecond: number;
  encounterDeadlineFormSecond: number;
  noteDeadlineFormSecond: number;
  remainingEncounterSeconds: number;
  remainingNoteSeconds: number;
  dueTimeoutTransitions: AssembledStationTimeoutTransition[];
  claimBoundary: typeof assembledStationClockClaimBoundary;
  notEvidenceFor: typeof assembledStationClockNotEvidenceFor;
};

function requireIntegerSecond(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`assembled station clock requires non-negative integer ${fieldName}`);
  }
  return value;
}

function admittedTypes(events: readonly AssembledStationClockAdmittedEvent[]): Set<AssembledExamPhaseTransitionType> {
  return new Set(events.map((event) => event.eventType));
}

function maxAdmittedFormSecond(events: readonly AssembledStationClockAdmittedEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.formAtSecond), 0);
}

function deadlineFor(
  eventType: (typeof TIMEOUT_CHAIN)[number],
  formTiming: AssembledStationFormTiming,
): number {
  if (eventType === "encounter.ended") {
    return formTiming.encounter.endsAtSecond;
  }
  if (eventType === "note.started") {
    return formTiming.note.startsAtSecond;
  }
  return formTiming.note.endsAtSecond;
}

function timeoutAdvanceReason(isLastStation: boolean): string {
  return isLastStation ? LAST_STATION_TIMEOUT_ADVANCE_REASON : STATION_TIMEOUT_ADVANCE_REASON;
}

function dueTransitions(input: ObserveAssembledStationClockInput): AssembledStationTimeoutTransition[] {
  const present = admittedTypes(input.admittedEvents);
  if (!present.has("encounter.started")) {
    return [];
  }

  const manual = input.manualCompletion;
  const due: AssembledStationTimeoutTransition[] = [];
  const isLastStation = input.isLastStation === true;

  for (const eventType of TIMEOUT_CHAIN) {
    if (present.has(eventType)) {
      continue;
    }
    const dueAt = deadlineFor(eventType, input.formTiming);
    const manualHits = manual !== undefined
      && manual.eventType === eventType
      && manual.formAtSecond === input.nowFormSecond;
    const timeoutHits = input.nowFormSecond >= dueAt;
    if (!manualHits && !timeoutHits) {
      break;
    }

    const transition: AssembledStationTimeoutTransition = {
      eventType,
      formAtSecond: manualHits ? manual.formAtSecond : dueAt,
      source: manualHits ? "manual" : "timeout",
    };
    if (eventType === "station.advanced") {
      transition.advanceReason = manual?.advanceReason ?? timeoutAdvanceReason(isLastStation);
    }
    due.push(transition);
    present.add(eventType);
  }

  return due;
}

/**
 * Reconstruct remaining encounter/note time and the exactly-once timeout
 * (or raced manual) transitions due at the injected form second.
 */
export function observeAssembledStationClock(input: ObserveAssembledStationClockInput): AssembledStationClockSnapshot {
  const nowFormSecond = requireIntegerSecond(input.nowFormSecond, "nowFormSecond");
  if (input.lastObservedFormSecond !== undefined) {
    requireIntegerSecond(input.lastObservedFormSecond, "lastObservedFormSecond");
  }
  const historyFloor = maxAdmittedFormSecond(input.admittedEvents);
  const lastObservedFloor = input.lastObservedFormSecond ?? historyFloor;
  if (nowFormSecond < lastObservedFloor) {
    throw new Error(
      `clock rollback: nowFormSecond ${nowFormSecond} < lastObservedFormSecond ${lastObservedFloor}`,
    );
  }
  if (input.manualCompletion) {
    requireIntegerSecond(input.manualCompletion.formAtSecond, "manualCompletion.formAtSecond");
    if (input.manualCompletion.formAtSecond !== nowFormSecond) {
      throw new Error("assembled station clock manual completion must occur at nowFormSecond");
    }
  }

  const dueTimeoutTransitions = dueTransitions(input);
  const present = admittedTypes(input.admittedEvents);
  for (const transition of dueTimeoutTransitions) {
    present.add(transition.eventType);
  }

  const encounterDeadlineFormSecond = input.formTiming.encounter.endsAtSecond;
  const noteDeadlineFormSecond = input.formTiming.note.endsAtSecond;
  const remainingEncounterSeconds = present.has("encounter.started") && !present.has("encounter.ended")
    ? Math.max(0, encounterDeadlineFormSecond - nowFormSecond)
    : 0;
  const remainingNoteSeconds = present.has("note.started") && !present.has("note.submitted")
    ? Math.max(0, noteDeadlineFormSecond - nowFormSecond)
    : 0;

  return {
    nowFormSecond,
    lastObservedFormSecond: nowFormSecond,
    encounterDeadlineFormSecond,
    noteDeadlineFormSecond,
    remainingEncounterSeconds,
    remainingNoteSeconds,
    dueTimeoutTransitions,
    claimBoundary: assembledStationClockClaimBoundary,
    notEvidenceFor: assembledStationClockNotEvidenceFor,
  };
}
