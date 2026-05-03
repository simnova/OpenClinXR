import type { PatientNote } from "@openclinxr/shared-schemas";

export type StationPhase = "doorway" | "encounter" | "note" | "review";

export type StationRun = {
  stationRunId: string;
  scenarioId: string;
  learnerId: string;
  phase: StationPhase;
  startedAtSecond: number;
  encounterStartedAtSecond?: number;
  encounterEndedAtSecond?: number;
  note?: PatientNote;
};

export type StationCommand =
  | { type: "START_ENCOUNTER"; atSecond: number }
  | { type: "END_ENCOUNTER"; atSecond: number }
  | { type: "SUBMIT_NOTE"; atSecond: number; noteText: string };

export type ScheduledEvent = {
  eventId: string;
  atSecond: number;
  actorId: string;
  tag: string;
};

export type TaggedTrace = {
  tag?: string;
  atSecond: number;
};

export function createStationRun(scenarioId: string, learnerId: string): StationRun {
  return {
    stationRunId: `run_${scenarioId}_${learnerId}`,
    scenarioId,
    learnerId,
    phase: "doorway",
    startedAtSecond: 0,
  };
}

export function transitionStation(run: StationRun, command: StationCommand): StationRun {
  if (command.type === "START_ENCOUNTER") {
    if (run.phase !== "doorway") {
      throw new Error(`Cannot start encounter during ${run.phase}`);
    }
    return { ...run, phase: "encounter", encounterStartedAtSecond: command.atSecond };
  }

  if (command.type === "END_ENCOUNTER") {
    if (run.phase !== "encounter") {
      throw new Error(`Cannot end encounter during ${run.phase}`);
    }
    return { ...run, phase: "note", encounterEndedAtSecond: command.atSecond };
  }

  if (run.phase !== "note") {
    throw new Error(`Cannot submit note during ${run.phase}`);
  }

  return {
    ...run,
    phase: "review",
    note: {
      stationRunId: run.stationRunId,
      submittedAtSecond: command.atSecond,
      text: command.noteText,
    },
  };
}

export function getScheduledEventsDue(
  scenario: { eventSchedule: ScheduledEvent[] },
  atSecond: number,
  emittedEventIds: ReadonlySet<string>,
): ScheduledEvent[] {
  return scenario.eventSchedule.filter((event) => event.atSecond <= atSecond && !emittedEventIds.has(event.eventId));
}

export function evaluateRequiredTraceTags(
  requiredTraceTags: readonly string[],
  traceEvents: readonly TaggedTrace[],
): { observed: string[]; missing: string[] } {
  const observedSet = new Set(traceEvents.map((event) => event.tag).filter((tag): tag is string => Boolean(tag)));
  return {
    observed: requiredTraceTags.filter((tag) => observedSet.has(tag)),
    missing: requiredTraceTags.filter((tag) => !observedSet.has(tag)),
  };
}

