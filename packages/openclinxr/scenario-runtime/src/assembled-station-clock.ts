/**
 * Deterministic assembled-station timing authority.
 *
 * Encounter/note deadlines are start.formAtSecond + authored window duration.
 * Catch-up generated note.started is the note-submission anchor. No wall-clock reads.
 */
import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  type AssembledExamPhaseTransitionType,
} from "@openclinxr/review-workflow";
import type { AssembledStationFormTiming, AssembledStationFormWindow } from "./runtime-types.js";

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

const PHASE_RANK = new Map<string, number>(
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.map((eventType, index) => [eventType, index]),
);

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

function authoredDuration(window: AssembledStationFormWindow, fieldName: string): number {
  requireIntegerSecond(window.startsAtSecond, `${fieldName}.startsAtSecond`);
  requireIntegerSecond(window.endsAtSecond, `${fieldName}.endsAtSecond`);
  const duration = window.endsAtSecond - window.startsAtSecond;
  if (!Number.isInteger(duration) || duration < 0) {
    throw new Error(`assembled station clock requires non-negative ${fieldName} duration`);
  }
  return duration;
}

function findAdmitted(
  events: readonly AssembledStationClockAdmittedEvent[],
  eventType: AssembledExamPhaseTransitionType,
): AssembledStationClockAdmittedEvent | undefined {
  return events.find((event) => event.eventType === eventType);
}

function validateAdmittedEvents(events: readonly AssembledStationClockAdmittedEvent[]): void {
  const seen = new Set<string>();
  let previousRank = -1;
  let previousAt = 0;
  for (const event of events) {
    if (!PHASE_RANK.has(event.eventType)) {
      throw new Error(`assembled station clock rejects noncanonical event type ${String(event.eventType)}`);
    }
    requireIntegerSecond(event.formAtSecond, `${event.eventType}.formAtSecond`);
    if (seen.has(event.eventType)) {
      throw new Error(`assembled station clock rejects duplicated ${event.eventType}`);
    }
    const rank = PHASE_RANK.get(event.eventType) ?? -1;
    if (rank !== previousRank + 1) {
      throw new Error(`assembled station clock rejects out-of-order ${event.eventType}`);
    }
    if (event.formAtSecond < previousAt) {
      throw new Error(`assembled station clock rejects decreasing ${event.eventType} timestamp`);
    }
    seen.add(event.eventType);
    previousRank = rank;
    previousAt = event.formAtSecond;
  }
}

function nextLegalManualEvent(
  present: ReadonlySet<AssembledExamPhaseTransitionType>,
): (typeof TIMEOUT_CHAIN)[number] | null {
  if (!present.has("encounter.started")) {
    return null;
  }
  for (const eventType of TIMEOUT_CHAIN) {
    if (!present.has(eventType)) {
      return eventType;
    }
  }
  return null;
}

function requireLegalManualCompletion(
  present: ReadonlySet<AssembledExamPhaseTransitionType>,
  manual: AssembledStationClockManualCompletion,
  nowFormSecond: number,
): void {
  requireIntegerSecond(manual.formAtSecond, "manualCompletion.formAtSecond");
  if (manual.formAtSecond !== nowFormSecond) {
    throw new Error("assembled station clock manual completion must occur at nowFormSecond");
  }
  const next = nextLegalManualEvent(present);
  if (next === null || manual.eventType !== next) {
    throw new Error(
      `assembled station clock rejects foreign manual completion ${String(manual.eventType)}`,
    );
  }
}

function timeoutAdvanceReason(isLastStation: boolean): string {
  return isLastStation ? LAST_STATION_TIMEOUT_ADVANCE_REASON : STATION_TIMEOUT_ADVANCE_REASON;
}

function dueTransitions(
  input: ObserveAssembledStationClockInput,
  encounterDuration: number,
  noteDuration: number,
): AssembledStationTimeoutTransition[] {
  const present = admittedTypes(input.admittedEvents);
  const started = findAdmitted(input.admittedEvents, "encounter.started");
  if (!started) {
    return [];
  }

  const manual = input.manualCompletion;
  const due: AssembledStationTimeoutTransition[] = [];
  const isLastStation = input.isLastStation === true;
  let encounterEndedAt = findAdmitted(input.admittedEvents, "encounter.ended")?.formAtSecond;
  let noteStartedAt = findAdmitted(input.admittedEvents, "note.started")?.formAtSecond;
  const encounterDeadline = started.formAtSecond + encounterDuration;

  for (const eventType of TIMEOUT_CHAIN) {
    if (present.has(eventType)) {
      continue;
    }
    let dueAt: number;
    if (eventType === "encounter.ended") {
      dueAt = encounterDeadline;
    } else if (eventType === "note.started") {
      dueAt = Math.max(input.formTiming.note.startsAtSecond, encounterEndedAt ?? encounterDeadline);
    } else {
      const noteAnchor = noteStartedAt;
      if (noteAnchor === undefined) {
        break;
      }
      dueAt = noteAnchor + noteDuration;
    }
    const manualHits = manual !== undefined && manual.eventType === eventType;
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
    if (eventType === "encounter.ended") {
      encounterEndedAt = transition.formAtSecond;
    }
    if (eventType === "note.started") {
      noteStartedAt = transition.formAtSecond;
    }
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
  const encounterDuration = authoredDuration(input.formTiming.encounter, "encounter");
  const noteDuration = authoredDuration(input.formTiming.note, "note");
  if (input.formTiming.doorway) {
    authoredDuration(input.formTiming.doorway, "doorway");
  }
  validateAdmittedEvents(input.admittedEvents);
  const historyFloor = maxAdmittedFormSecond(input.admittedEvents);
  const lastObservedFloor = input.lastObservedFormSecond ?? historyFloor;
  if (nowFormSecond < lastObservedFloor) {
    throw new Error(
      `clock rollback: nowFormSecond ${nowFormSecond} < lastObservedFormSecond ${lastObservedFloor}`,
    );
  }
  const present = admittedTypes(input.admittedEvents);
  if (input.manualCompletion) {
    requireLegalManualCompletion(present, input.manualCompletion, nowFormSecond);
  }

  const dueTimeoutTransitions = dueTransitions(input, encounterDuration, noteDuration);
  for (const transition of dueTimeoutTransitions) {
    present.add(transition.eventType);
  }

  const started = findAdmitted(input.admittedEvents, "encounter.started");
  const encounterDeadlineFormSecond = started ? started.formAtSecond + encounterDuration : 0;
  const generatedNoteStart = dueTimeoutTransitions.find((transition) => transition.eventType === "note.started");
  const noteAnchor = findAdmitted(input.admittedEvents, "note.started")?.formAtSecond
    ?? generatedNoteStart?.formAtSecond;
  const noteDeadlineFormSecond = noteAnchor !== undefined ? noteAnchor + noteDuration : 0;
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
