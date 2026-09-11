import type { StationRun as SharedStationRun } from "@openclinxr/shared-schemas";

export type StationPhase = "doorway" | "encounter" | "note" | "review";

export type StationRun = SharedStationRun;

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

/**
 * Options a scenario may set on its station run.
 *
 * MADR 0035: `doorway` defaults to true so every existing scenario is unchanged, but a scenario can
 * now opt out. The doorway was a card taped to a door in a corridor; encoding it as a mandatory
 * phase turns corridor logistics into product grammar and pulls every case toward a 2004 test
 * centre. Briefing is real and worth keeping as a composable channel — a compulsory clocked gate
 * before every encounter is not.
 *
 * Optional rather than removed, deliberately: 34 files reference `doorway` today. This slice only
 * stops it being compulsory, so it is reversible; removal can follow once nothing depends on it.
 */
export type StationRunOptions = {
  /** Set false to begin directly in `encounter`. Defaults to true. */
  doorway?: boolean;
};

export function createStationRun(
  scenarioId: string,
  learnerId: string,
  options: StationRunOptions = {},
): StationRun {
  if (scenarioId.trim().length === 0) {
    throw new Error("scenarioId is required");
  }
  if (learnerId.trim().length === 0) {
    throw new Error("learnerId is required");
  }

  return {
    stationRunId: `run_${scenarioId}_${learnerId}`,
    scenarioId,
    learnerId,
    phase: options.doorway === false ? "encounter" : "doorway",
    startedAtSecond: 0,
  };
}

export function transitionStation(run: StationRun, command: StationCommand): StationRun {
  if (command.type === "START_ENCOUNTER") {
    if (run.phase !== "doorway") {
      throw new Error(`Cannot start encounter during ${run.phase}`);
    }
    if (command.atSecond < run.startedAtSecond) {
      throw new Error("Cannot start encounter before station start");
    }
    return { ...run, phase: "encounter", encounterStartedAtSecond: command.atSecond };
  }

  if (command.type === "END_ENCOUNTER") {
    if (run.phase !== "encounter") {
      throw new Error(`Cannot end encounter during ${run.phase}`);
    }
    if (run.encounterStartedAtSecond !== undefined && command.atSecond < run.encounterStartedAtSecond) {
      throw new Error("Cannot end encounter before it starts");
    }
    return { ...run, phase: "note", encounterEndedAtSecond: command.atSecond };
  }

  if (run.phase !== "note") {
    throw new Error(`Cannot submit note during ${run.phase}`);
  }
  if (run.encounterEndedAtSecond !== undefined && command.atSecond < run.encounterEndedAtSecond) {
    throw new Error("Cannot submit note before encounter ends");
  }
  if (command.noteText.trim().length === 0) {
    throw new Error("Cannot submit an empty patient note");
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
  return [...scenario.eventSchedule.filter((event) => event.atSecond <= atSecond && !emittedEventIds.has(event.eventId))]
    .sort((left, right) => left.atSecond - right.atSecond || left.eventId.localeCompare(right.eventId));
}

export function evaluateRequiredTraceTags(
  requiredTraceTags: readonly string[],
  traceEvents: readonly TaggedTrace[],
): { observed: string[]; missing: string[] } {
  const observedSet = new Set(traceEvents.map((event) => event.tag).filter((tag): tag is string => Boolean(tag)));
  const uniqueRequiredTraceTags = [...new Set(requiredTraceTags)];
  return {
    observed: uniqueRequiredTraceTags.filter((tag) => observedSet.has(tag)),
    missing: uniqueRequiredTraceTags.filter((tag) => !observedSet.has(tag)),
  };
}
