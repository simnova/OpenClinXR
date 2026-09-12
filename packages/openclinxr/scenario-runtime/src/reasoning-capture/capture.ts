/**
 * Learner hypothesis + note-time synthesis capture (internal).
 * Not on the package entrypoint. Events are immutable: a change appends
 * `learner.hypothesis.changed` and never rewrites a prior payload.
 */

import type { TraceEvent } from "@openclinxr/shared-schemas";
import type { SessionRecord } from "../runtime-types.js";
import {
  assertObservedFormTime,
  durableEventRef,
  replayablePhaseTransitionEvent,
  traceEvent,
  withDurableEventRef,
} from "../trace.js";

export const LEARNER_HYPOTHESIS_EVENT_TYPE = "learner.hypothesis";
export const LEARNER_HYPOTHESIS_CHANGED_EVENT_TYPE = "learner.hypothesis.changed";
export const NOTE_SUBMITTED_EVENT_TYPE = "note.submitted";

export const REASONING_CAPTURE_CLAIM_SCOPE = "learner_reasoning_capture_not_score_use" as const;

export const REASONING_CAPTURE_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "autonomous_score",
  "diagnosis_correctness",
  "generative_summary_without_review",
] as const;

const HYPOTHESIS_EVENT_TYPES = new Set([
  LEARNER_HYPOTHESIS_EVENT_TYPE,
  LEARNER_HYPOTHESIS_CHANGED_EVENT_TYPE,
]);

export type LedgerLikeEvent = {
  eventType: string;
  sequence: number;
  payload?: Record<string, unknown>;
};

export type ResolveLearnerEventRecordingInput = {
  eventType: string;
  payload?: Record<string, unknown>;
  stationRunId: string;
  sequence: number;
};

export type LearnerEventRecording = {
  eventType: string;
  payload: Record<string, unknown>;
};

type NoteAppendLedger = {
  append: (event: TraceEvent) => void;
  replay: (stationRunId: string) => TraceEvent[];
};

export function resolveLearnerEventRecording(
  input: ResolveLearnerEventRecordingInput,
  ledger: readonly LedgerLikeEvent[],
): LearnerEventRecording {
  const mintedId = mintedEventId(input);
  rejectDuplicateEventId(mintedId, ledger);

  if (!HYPOTHESIS_EVENT_TYPES.has(input.eventType)) {
    return {
      eventType: input.eventType,
      payload: stampIdentity(input.payload ?? {}, input.stationRunId, input.sequence, mintedId),
    };
  }

  const hypothesis = payloadString(input.payload, "hypothesis");
  if (hypothesis.length === 0) {
    throw new Error("learner hypothesis requires a statement");
  }

  const citedEventIds = citedEventIdsFromPayload(input.payload);
  rejectUnknownCitations(citedEventIds, ledger);

  const previous = lastHypothesis(ledger);
  const isChange = input.eventType === LEARNER_HYPOTHESIS_CHANGED_EVENT_TYPE
    || (previous !== undefined && payloadString(previous.payload, "hypothesis") !== hypothesis);

  if (isChange && !previous) {
    throw new Error("hypothesis change requires a prior hypothesis event");
  }

  const previousId = previous ? recordedEventId(previous) : undefined;
  const eventType = isChange ? LEARNER_HYPOTHESIS_CHANGED_EVENT_TYPE : LEARNER_HYPOTHESIS_EVENT_TYPE;
  const payload: Record<string, unknown> = stampIdentity(
    {
      ...(input.payload ?? {}),
      hypothesis,
      citedEventIds: uniquePreserve(citedEventIds),
      claimScope: REASONING_CAPTURE_CLAIM_SCOPE,
      notEvidenceFor: [...REASONING_CAPTURE_NOT_EVIDENCE_FOR],
    },
    input.stationRunId,
    input.sequence,
    mintedId,
  );
  if (isChange && previousId) {
    payload["previousHypothesisEventId"] = previousId;
  }
  return { eventType, payload: Object.freeze(payload) };
}

export function appendNoteSubmittedReasoningEvent(
  session: SessionRecord,
  ledger: NoteAppendLedger,
  input: { atSecond: number; text: string },
): void {
  const stationRunId = session.run.stationRunId;
  const sequence = session.nextSequence;
  const reasoning = noteSubmittedReasoningPayload({
    stationRunId,
    sequence,
    noteText: input.text,
    ledger: ledger.replay(stationRunId),
  });
  const assembled = session.assembledStation;
  if (assembled) {
    const window = assembled.formTiming.note;
    assertObservedFormTime(window, input.atSecond, NOTE_SUBMITTED_EVENT_TYPE);
    const doorwayStart = assembled.formTiming.doorway?.startsAtSecond ?? 0;
    const event = replayablePhaseTransitionEvent({
      stationRunId,
      sequence,
      eventType: NOTE_SUBMITTED_EVENT_TYPE,
      atSecond: Math.max(0, input.atSecond - doorwayStart),
      scenarioId: assembled.scenarioId,
      examRunId: assembled.examRunId,
      stationOrder: assembled.stationOrder,
      phase: "note",
      formAtSecond: input.atSecond,
    });
    ledger.append({
      ...event,
      payload: Object.freeze({ ...event.payload, ...reasoning }),
    });
  } else {
    ledger.append(traceEvent({
      stationRunId,
      sequence,
      eventType: NOTE_SUBMITTED_EVENT_TYPE,
      atSecond: input.atSecond,
      source: "learner",
      tag: "patient_note_submitted",
      payload: Object.freeze(reasoning),
    }));
  }
  session.nextSequence += 1;
}

export function noteSubmittedReasoningPayload(input: {
  stationRunId: string;
  sequence: number;
  noteText: string;
  ledger: readonly LedgerLikeEvent[];
}): Record<string, unknown> {
  const hypotheses = input.ledger.filter((event) => HYPOTHESIS_EVENT_TYPES.has(event.eventType));
  const citedHypothesisEventIds: string[] = [];
  const synthesisHypotheses: Array<{ eventId: string; hypothesis: string }> = [];
  for (const event of hypotheses) {
    const eventId = recordedEventId(event);
    if (!eventId) {
      continue;
    }
    citedHypothesisEventIds.push(eventId);
    synthesisHypotheses.push({
      eventId,
      hypothesis: payloadString(event.payload, "hypothesis"),
    });
  }
  const uniqueHypothesisIds = uniquePreserve(citedHypothesisEventIds);
  const mintedId = durableEventRef(input.stationRunId, input.sequence);
  return stampIdentity(
    {
      noteSummary: input.noteText,
      citedEventIds: uniqueHypothesisIds,
      synthesis: {
        noteText: input.noteText,
        citedHypothesisEventIds: uniqueHypothesisIds,
        hypotheses: synthesisHypotheses,
      },
      claimScope: REASONING_CAPTURE_CLAIM_SCOPE,
      notEvidenceFor: [...REASONING_CAPTURE_NOT_EVIDENCE_FOR],
    },
    input.stationRunId,
    input.sequence,
    mintedId,
  );
}

function mintedEventId(input: ResolveLearnerEventRecordingInput): string {
  const requested = payloadString(input.payload, "eventId");
  if (requested.length > 0) {
    return requested;
  }
  return durableEventRef(input.stationRunId, input.sequence);
}

function stampIdentity(
  payload: Record<string, unknown>,
  stationRunId: string,
  sequence: number,
  eventId: string,
): Record<string, unknown> {
  return withDurableEventRef(
    {
      ...payload,
      eventId,
    },
    stationRunId,
    sequence,
  );
}

function lastHypothesis(ledger: readonly LedgerLikeEvent[]): LedgerLikeEvent | undefined {
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    const event = ledger[index];
    if (event && HYPOTHESIS_EVENT_TYPES.has(event.eventType)) {
      return event;
    }
  }
  return undefined;
}

function recordedEventId(event: LedgerLikeEvent): string | undefined {
  const fromPayload = payloadString(event.payload, "eventId")
    || payloadString(event.payload, "durableEventRef");
  return fromPayload.length > 0 ? fromPayload : undefined;
}

function citedEventIdsFromPayload(payload: Record<string, unknown> | undefined): string[] {
  const ids: string[] = [];
  const relatedHypothesisEventId = payloadString(payload, "relatedHypothesisEventId");
  if (relatedHypothesisEventId.length > 0) {
    ids.push(relatedHypothesisEventId);
  }
  const cited = payload?.["citedEventIds"];
  if (!Array.isArray(cited)) {
    return uniquePreserve(ids);
  }
  for (const value of cited) {
    if (typeof value === "string" && value.trim().length > 0) {
      ids.push(value.trim());
    }
  }
  return uniquePreserve(ids);
}

function rejectUnknownCitations(citedEventIds: readonly string[], ledger: readonly LedgerLikeEvent[]): void {
  const known = new Set<string>();
  for (const event of ledger) {
    const eventId = recordedEventId(event);
    if (eventId) {
      known.add(eventId);
    }
  }
  for (const eventId of citedEventIds) {
    if (!known.has(eventId)) {
      throw new Error(`hypothesis cites unknown event ${eventId}`);
    }
  }
}

function rejectDuplicateEventId(eventId: string, ledger: readonly LedgerLikeEvent[]): void {
  for (const event of ledger) {
    if (recordedEventId(event) === eventId) {
      throw new Error("hypothesis event id already recorded");
    }
  }
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function uniquePreserve(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const eventId of ids) {
    if (seen.has(eventId)) {
      continue;
    }
    seen.add(eventId);
    out.push(eventId);
  }
  return out;
}
