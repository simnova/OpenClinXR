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

export const EncounterState = schema(
  {
    serverTick: t.number(),
    phase: t.string(),
    turnId: t.number(),
    turnOwner: t.string(),
    actors: t.map(ActorState),
    learners: t.map(LearnerState),
    observerCount: t.number(),
  },
  "EncounterState",
);

export type ActorStateInstance = SchemaType<typeof ActorState>;
export type LearnerStateInstance = SchemaType<typeof LearnerState>;
export type EncounterStateInstance = SchemaType<typeof EncounterState>;

/** Plain-object view of authoritative state, for tests and operators. */
export interface EncounterSnapshot {
  serverTick: number;
  phase: string;
  turnId: number;
  turnOwner: string;
  actors: Record<string, { id: string; speaking: boolean; emotion: string; replyId: string; cueId: string }>;
  learners: Record<
    string,
    { sessionId: string; headX: number; headY: number; headZ: number; lastSeq: number; speaking: boolean }
  >;
  /** C5 connected faculty observers (read-only, no learners[] entry). */
  observerCount: number;
}

export function snapshotState(state: EncounterStateInstance): EncounterSnapshot {
  const actors: EncounterSnapshot["actors"] = {};
  for (const [id, actor] of state.actors) {
    actors[id] = { id: actor.id, speaking: actor.speaking, emotion: actor.emotion, replyId: actor.replyId, cueId: actor.cueId };
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
  return { serverTick: state.serverTick, phase: state.phase, turnId: state.turnId, turnOwner: state.turnOwner, actors, learners, observerCount: state.observerCount };
}
