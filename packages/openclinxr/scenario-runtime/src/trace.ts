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
