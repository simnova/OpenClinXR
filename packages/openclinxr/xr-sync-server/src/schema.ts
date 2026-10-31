import { schema, t, type SchemaType } from "@colyseus/schema";

// C1 HOST-ONLY schema, defined with schema() + t.* builders (the supported
// API). Reflection decode on schema()-defined state works across distinct
// @colyseus/schema copies, which is what lets the single-dependency lean
// client observe patches without importing a schema. The deprecated
// defineTypes() path decodes nested maps as root-shaped nodes once client
// and server resolve different copies of the package, so it must not be used.

export const ActorState = schema(
  {
    id: t.string(),
    speaking: t.boolean(),
    emotion: t.string(),
    replyId: t.string(),
    cueId: t.string(),
    /** C17 learner-visible caption of the current reply ("" when silent or off a cast station). */
    caption: t.string(),
  },
  "ActorState",
);

export const LearnerState = schema(
  {
    sessionId: t.string(),
    headX: t.number(),
    headY: t.number(),
    headZ: t.number(),
    lastSeq: t.number(),
    speaking: t.boolean(),
  },
  "LearnerState",
);

export const LobbyStationState = schema(
  {
    stationId: t.string(),
    stationIndex: t.number(),
    turnCount: t.number(),
    notePresent: t.boolean(),
    noteChars: t.number(),
  },
  "LobbyStationState",
);

/** C13 one lobby score badge: a station with a faculty score file on disk. */
export const LobbyScoreState = schema(
  {
    stationId: t.string(),
    checkedCount: t.number(),
  },
  "LobbyScoreState",
);

export const EncounterState = schema(
  {
    serverTick: t.number(),
    phase: t.string(),
    phaseRemainingS: t.number(),
    turnId: t.number(),
    turnOwner: t.string(),
    actors: t.map(ActorState),
    learners: t.map(LearnerState),
    observerCount: t.number(),
    /** C7 station id ("" when no stations configured: C6 behaviour). */
    stationId: t.string(),
    /** C7 station index (0 when no stations). */
    stationIndex: t.number(),
    /** C7 station count (0 when no stations). */
    stationCount: t.number(),
    /** C10 replay mode ("replay" in replay rooms; "" in live rooms: C1..C9 behaviour). */
    mode: t.string(),
    /** C10 last recorded turn end ("completed" | "interrupted" | "closed-by-phase"; "" before the first end). */
    lastTurnEnd: t.string(),
    /** C10 true after the last recorded event has played into state. */
    replayDone: t.boolean(),
    /** C11 patient-note status ("none" before the first accepted note, "submitted" after). */
    noteStatus: t.string(),
    /** C11 length of the held note (0 when none). */
    noteChars: t.number(),
    /** C12 true when the recorded session ran to completion (lobby rooms only). */
    sessionComplete: t.boolean(),
    /** C12 one entry per index station, in index order (lobby rooms only). */
    lobbyStations: t.array(LobbyStationState),
    /** C13 checked rubric count for the replayed station (replay rooms only). */
    scoreChecked: t.number(),
    /** C13 one badge per scored index station, in index order (lobby rooms only). */
    lobbyScores: t.array(LobbyScoreState),
    /** C14 true once the reviewer signed off (the packet exists in scoreDir; lobby rooms only). */
    reviewFinalized: t.boolean(),
    /** C15 factory blueprint id ("" without a blueprint). */
    blueprintId: t.string(),
    /** C15 current slot label ("" without a blueprint). */
    stationLabel: t.string(),
    /** C16 scenario id of the current station ("" without scenarios). */
    scenarioId: t.string(),
    /** C16 scenario title of the current station ("" without scenarios). */
    scenarioTitle: t.string(),
  },
  "EncounterState",
);

export type ActorStateInstance = SchemaType<typeof ActorState>;
export type LearnerStateInstance = SchemaType<typeof LearnerState>;
export type EncounterStateInstance = SchemaType<typeof EncounterState>;
export type LobbyStationStateInstance = SchemaType<typeof LobbyStationState>;
export type LobbyScoreStateInstance = SchemaType<typeof LobbyScoreState>;

/** Plain-object view of authoritative state, for tests and operators. */
export interface EncounterSnapshot {
  serverTick: number;
  phase: string;
  /** C6 integer seconds left in the current phase (0 when closed; 0 when no timing). */
  phaseRemainingS: number;
  turnId: number;
  turnOwner: string;
  actors: Record<string, { id: string; speaking: boolean; emotion: string; replyId: string; cueId: string; caption: string }>;
  learners: Record<
    string,
    { sessionId: string; headX: number; headY: number; headZ: number; lastSeq: number; speaking: boolean }
  >;
  /** C5 connected faculty observers (read-only, no learners[] entry). */
  observerCount: number;
  /** C7 station id ("" when no stations: C6 behaviour, no rotation). */
  stationId: string;
  /** C7 station index (0 when no stations). */
  stationIndex: number;
  /** C7 station count (0 when no stations). */
  stationCount: number;
  /** C10 replay mode ("replay" in replay rooms; "" in live rooms). */
  mode: string;
  /** C10 last recorded turn end ("" before the first end). */
  lastTurnEnd: string;
  /** C10 true after the last recorded event has played into state. */
  replayDone: boolean;
  /** C11 patient-note status ("none" before the first accepted note, "submitted" after). */
  noteStatus: string;
  /** C11 length of the held note (0 when none). */
  noteChars: number;
  /** C12 true when the recorded session ran to completion (lobby rooms only). */
  sessionComplete: boolean;
  /** C12 one entry per index station, in index order (lobby rooms only). */
  lobbyStations: { stationId: string; stationIndex: number; turnCount: number; notePresent: boolean; noteChars: number }[];
  /** C13 checked rubric count for the replayed station (replay rooms only). */
  scoreChecked: number;
  /** C13 one badge per scored index station, in index order (lobby rooms only). */
  lobbyScores: { stationId: string; checkedCount: number }[];
  /** C14 true once the reviewer signed off (the packet exists in scoreDir; lobby rooms only). */
  reviewFinalized: boolean;
  /** C15 factory blueprint id ("" without a blueprint). */
  blueprintId: string;
  /** C15 current slot label ("" without a blueprint). */
  stationLabel: string;
  /** C16 scenario id of the current station ("" without scenarios). */
  scenarioId: string;
  /** C16 scenario title of the current station ("" without scenarios). */
  scenarioTitle: string;
}

export function snapshotState(state: EncounterStateInstance): EncounterSnapshot {
  const actors: EncounterSnapshot["actors"] = {};
  for (const [id, actor] of state.actors) {
    actors[id] = { id: actor.id, speaking: actor.speaking, emotion: actor.emotion, replyId: actor.replyId, cueId: actor.cueId, caption: actor.caption };
  }
  const learners: EncounterSnapshot["learners"] = {};
  for (const [sessionId, learner] of state.learners) {
    learners[sessionId] = {
      sessionId: learner.sessionId,
      headX: learner.headX,
      headY: learner.headY,
      headZ: learner.headZ,
      lastSeq: learner.lastSeq,
      speaking: learner.speaking,
    };
  }
  return { serverTick: state.serverTick, phase: state.phase, phaseRemainingS: state.phaseRemainingS, turnId: state.turnId, turnOwner: state.turnOwner, actors, learners, observerCount: state.observerCount, stationId: state.stationId, stationIndex: state.stationIndex, stationCount: state.stationCount, mode: state.mode, lastTurnEnd: state.lastTurnEnd, replayDone: state.replayDone, noteStatus: state.noteStatus, noteChars: state.noteChars, sessionComplete: state.sessionComplete, lobbyStations: [...state.lobbyStations].map((entry) => ({ stationId: entry.stationId, stationIndex: entry.stationIndex, turnCount: entry.turnCount, notePresent: entry.notePresent, noteChars: entry.noteChars })), scoreChecked: state.scoreChecked, lobbyScores: [...state.lobbyScores].map((entry) => ({ stationId: entry.stationId, checkedCount: entry.checkedCount })), reviewFinalized: state.reviewFinalized, blueprintId: state.blueprintId, stationLabel: state.stationLabel, scenarioId: state.scenarioId, scenarioTitle: state.scenarioTitle };
}
