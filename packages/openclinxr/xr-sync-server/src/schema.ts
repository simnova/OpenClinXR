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
  },
  "LearnerState",
);

export const EncounterState = schema(
  {
    serverTick: t.number(),
    phase: t.string(),
    actors: t.map(ActorState),
    learners: t.map(LearnerState),
  },
  "EncounterState",
);

export type ActorStateInstance = SchemaType<typeof ActorState>;
export type LearnerStateInstance = SchemaType<typeof LearnerState>;
export type EncounterStateInstance = SchemaType<typeof EncounterState>;
