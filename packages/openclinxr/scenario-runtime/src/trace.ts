import type { TraceEvent } from "@openclinxr/shared-schemas";

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
