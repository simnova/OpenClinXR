import type { TraceEvent } from "@openclinxr/shared-schemas";
import type { AssembledStationContext, AssembledStationFormWindow } from "./runtime-types.js";

/**
 * Deterministic trace-event construction for the scenario runtime.
 * Pure — no wall-clock (occurredAt is derived from atSecond against a fixed epoch).
 */

export type TraceEventInput = {
  stationRunId: string;
  sequence: number;
  eventType: string;
  atSecond: number;
  source: string;
  tag?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
};

function occurredAt(atSecond: number): string {
  return new Date(Date.parse("2026-05-03T15:38:58.000Z") + atSecond * 1000).toISOString();
}

export function traceEvent(input: TraceEventInput): TraceEvent {
  const event: TraceEvent = {
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    eventType: input.eventType,
    occurredAt: occurredAt(input.atSecond),
    atSecond: input.atSecond,
    source: input.source,
    payload: input.payload ?? {},
  };

  if (input.tag) {
    event.tag = input.tag;
  }
  if (input.actorId) {
    event.actorId = input.actorId;
  }

  return event;
}

export function durableEventRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

export function withDurableEventRef<T extends Record<string, unknown>>(
  payload: T,
  stationRunId: string,
  sequence: number,
): T & { durableEventRef: string } {
  return {
    ...payload,
    durableEventRef: durableEventRef(stationRunId, sequence),
  };
}

/** Ordered encounter→note→advance events returned for assembled-exam review/replay. */
export const REPLAYABLE_PHASE_TRANSITION_TYPES = [
  "encounter.started",
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const;

export type ReplayablePhaseTransitionType = (typeof REPLAYABLE_PHASE_TRANSITION_TYPES)[number];

export type ReplayablePhaseTransitionInput = {
  stationRunId: string;
  sequence: number;
  eventType: ReplayablePhaseTransitionType;
  atSecond: number;
  scenarioId: string;
  examRunId: string;
  stationOrder: number;
  phase: "encounter" | "note" | "complete";
  formAtSecond: number;
  advanceReason?: string;
};

export function replayablePhaseTransitionEvent(input: ReplayablePhaseTransitionInput): TraceEvent {
  const payload = withDurableEventRef(
    {
      scenarioId: input.scenarioId,
      examRunId: input.examRunId,
      stationOrder: input.stationOrder,
      phase: input.phase,
      formAtSecond: input.formAtSecond,
      ...(input.advanceReason ? { advanceReason: input.advanceReason } : {}),
    },
    input.stationRunId,
    input.sequence,
  );

  return traceEvent({
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    eventType: input.eventType,
    atSecond: input.atSecond,
    source: "system",
    payload,
  });
}

export function orderReplayablePhaseTransitions(events: readonly TraceEvent[]): TraceEvent[] {
  const rank = new Map<string, number>(
    REPLAYABLE_PHASE_TRANSITION_TYPES.map((eventType, index) => [eventType, index]),
  );
  return [...events].sort((left, right) => {
    const leftRank = rank.get(left.eventType);
    const rightRank = rank.get(right.eventType);
    if (leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (leftRank !== undefined && rightRank === undefined) {
      return -1;
    }
    if (leftRank === undefined && rightRank !== undefined) {
      return 1;
    }
    return left.sequence - right.sequence || left.atSecond - right.atSecond;
  });
}

/**
 * Re-number a phase-ordered transition list so sequence (and matching durable refs)
 * are strictly increasing. Runtime ledger events are left untouched; this is the
 * review/replay identity a consumer sorts by sequence.
 */
export function assignMonotonicReplayablePhaseTransitions(
  events: readonly TraceEvent[],
  startSequence: number,
): TraceEvent[] {
  return orderReplayablePhaseTransitions(events).map((event, index) => {
    const sequence = startSequence + index;
    const payload = event.payload;
    const advanceReason = payload["advanceReason"];
    return replayablePhaseTransitionEvent({
      stationRunId: event.stationRunId,
      sequence,
      eventType: event.eventType as ReplayablePhaseTransitionType,
      atSecond: event.atSecond,
      scenarioId: String(payload["scenarioId"] ?? ""),
      examRunId: String(payload["examRunId"] ?? ""),
      stationOrder: Number(payload["stationOrder"] ?? 0),
      phase: payload["phase"] as ReplayablePhaseTransitionInput["phase"],
      formAtSecond: Number(payload["formAtSecond"] ?? event.atSecond),
      ...(typeof advanceReason === "string" ? { advanceReason } : {}),
    });
  });
}

export function validateAssembledStationContext(
  value: AssembledStationContext,
  runtimeScenarioId: string,
): AssembledStationContext {
  const examRunId = value.examRunId.trim();
  const scenarioId = value.scenarioId.trim();
  const timing = value.formTiming;
  if (
    examRunId.length === 0
    || scenarioId.length === 0
    || !timing
    || !isFormWindow(timing.encounter)
    || !isFormWindow(timing.note)
    || (timing.doorway !== undefined && !isFormWindow(timing.doorway))
  ) {
    throw new Error("incomplete assembled-station context");
  }
  if (!Number.isInteger(value.stationOrder) || value.stationOrder < 1) {
    throw new Error("assembled-station order must be a positive integer");
  }
  if (scenarioId !== runtimeScenarioId) {
    throw new Error(`assembled-station scenario mismatch: expected ${runtimeScenarioId} got ${scenarioId}`);
  }
  const assembled: AssembledStationContext = {
    examRunId,
    scenarioId,
    stationOrder: value.stationOrder,
    formTiming: {
      encounter: timing.encounter,
      note: timing.note,
    },
  };
  if (timing.doorway) {
    assembled.formTiming.doorway = timing.doorway;
  }
  return assembled;
}

export function assertObservedFormTime(window: AssembledStationFormWindow, observed: number, eventType: string): void {
  if (!Number.isInteger(observed) || observed < window.startsAtSecond || observed > window.endsAtSecond) {
    throw new Error(
      `Cannot record assembled ${eventType} at form second ${observed} outside window ${window.startsAtSecond}-${window.endsAtSecond}`,
    );
  }
}

function isFormWindow(value: unknown): value is AssembledStationFormWindow {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { startsAtSecond?: unknown; endsAtSecond?: unknown };
  return Number.isInteger(record.startsAtSecond)
    && Number.isInteger(record.endsAtSecond)
    && (record.startsAtSecond as number) >= 0
    && (record.endsAtSecond as number) >= (record.startsAtSecond as number);
}
