import { validateTraceEvent, type TraceEvent } from "@openclinxr/shared-schemas";

export class InMemoryTraceLedger {
  private readonly eventsByRun = new Map<string, TraceEvent[]>();

  append(event: TraceEvent): TraceEvent {
    const validation = validateTraceEvent(event);
    if (!validation.ok) {
      throw new Error(`Invalid trace event: ${validation.errors.join("; ")}`);
    }

    const events = this.eventsByRun.get(event.stationRunId) ?? [];
    const expectedSequence = events.length;
    if (event.sequence !== expectedSequence) {
      throw new Error(`Expected sequence ${expectedSequence} for ${event.stationRunId}, received ${event.sequence}`);
    }

    const storedEvent = cloneTraceEvent(event);
    events.push(storedEvent);
    this.eventsByRun.set(event.stationRunId, events);
    return cloneTraceEvent(storedEvent);
  }

  replay(stationRunId: string): TraceEvent[] {
    return [...(this.eventsByRun.get(stationRunId) ?? [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((event) => cloneTraceEvent(event));
  }
}

function cloneTraceEvent(event: TraceEvent): TraceEvent {
  return {
    ...event,
    payload: cloneValue(event.payload) as Record<string, unknown>,
  };
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
