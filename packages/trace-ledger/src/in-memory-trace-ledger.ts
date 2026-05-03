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

    events.push(event);
    this.eventsByRun.set(event.stationRunId, events);
    return event;
  }

  replay(stationRunId: string): TraceEvent[] {
    return [...(this.eventsByRun.get(stationRunId) ?? [])].sort((a, b) => a.sequence - b.sequence);
  }
}

