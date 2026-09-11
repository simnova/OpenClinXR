import type {
  AssembledExamPhaseTransitionType,
  AssembledExamReviewTraceInput,
} from "../assembled-exam-review-packet.js";
import {
  ASSEMBLED_EXAM_PHASE_BY_TYPE,
  type AssembledExamPhaseTransitionRecord,
} from "../assembled-exam-review-packet.js";

export function rejectDuplicateSequences(
  stations: readonly { stationRunId: string; traceEvents: readonly AssembledExamReviewTraceInput[]; phaseTransitions: readonly AssembledExamReviewTraceInput[] }[],
): void {
  for (const station of stations) {
    const sequences = [...station.traceEvents, ...station.phaseTransitions]
      .map((event) => event.sequence)
      .filter((sequence): sequence is number => typeof sequence === "number");
    if (new Set(sequences).size !== sequences.length) {
      fail("rejects duplicate-sequence evidence");
    }
  }
}

export function rejectOutOfOrderTraceEvents(
  stations: readonly { stationRunId: string; traceEvents: readonly AssembledExamReviewTraceInput[] }[],
): void {
  for (const station of stations) {
    const sequenced = station.traceEvents.filter(
      (event): event is AssembledExamReviewTraceInput & { sequence: number } =>
        typeof event.sequence === "number",
    );
    const ordered = [...sequenced].sort((left, right) => left.sequence - right.sequence);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (!previous || !current) {
        fail("rejects out-of-order evidence");
      }
      if (current.sequence <= previous.sequence || current.atSecond < previous.atSecond) {
        fail("rejects out-of-order evidence");
      }
    }
  }
}

export function toPhaseTransitionRecord(
  event: AssembledExamReviewTraceInput,
): AssembledExamPhaseTransitionRecord {
  const eventType = event.eventType as AssembledExamPhaseTransitionType;
  return {
    eventType,
    sequence: event.sequence as number,
    atSecond: event.atSecond,
    formAtSecond: payloadValue(event.payload, "formAtSecond") as number,
    phase: ASSEMBLED_EXAM_PHASE_BY_TYPE[eventType],
    advanceReason: payloadString(event.payload, "advanceReason"),
    durableEventRef: payloadString(event.payload, "durableEventRef") ?? "",
  };
}

function payloadValue(payload: Record<string, unknown> | undefined, key: string): unknown {
  return payload?.[key];
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payloadValue(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function fail(suffix: string): never {
  throw new Error(`Assembled exam review packet ${suffix}`);
}
