import { Type, type Static } from "@sinclair/typebox";

export const ReviewGateStateSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("in_review"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
]);

export const ScenarioStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("approved"),
  Type.Literal("retired"),
]);

export const ActorRoleSchema = Type.Union([
  Type.Literal("patient"),
  Type.Literal("family"),
  Type.Literal("nurse"),
  Type.Literal("physician"),
  Type.Literal("system"),
]);

export const ActorCardSchema = Type.Object({
  actorId: Type.String({ minLength: 1 }),
  role: ActorRoleSchema,
  displayName: Type.String({ minLength: 1 }),
  demeanor: Type.Optional(Type.String()),
  hiddenFacts: Type.Optional(Type.Array(Type.String())),
});

export const EventScheduleEntrySchema = Type.Object({
  eventId: Type.String({ minLength: 1 }),
  atSecond: Type.Integer({ minimum: 0 }),
  actorId: Type.String({ minLength: 1 }),
  tag: Type.String({ minLength: 1 }),
});

export const ReviewRubricItemSchema = Type.Object({
  rubricId: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
});

export const EnvironmentSchema = Type.Object({
  environmentId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
});

export const AssetNeedSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
  assetType: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  licenseStatus: Type.String({ minLength: 1 }),
});

export const ScenarioSchema = Type.Object({
  scenarioId: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1 }),
  status: ScenarioStatusSchema,
  review: Type.Object({
    clinical: ReviewGateStateSchema,
    psychometric: ReviewGateStateSchema,
    legal: ReviewGateStateSchema,
    simulationQa: ReviewGateStateSchema,
  }),
  clinicalObjectives: Type.Array(Type.String({ minLength: 1 })),
  actors: Type.Array(ActorCardSchema),
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
  eventSchedule: Type.Array(EventScheduleEntrySchema),
  reviewRubric: Type.Array(ReviewRubricItemSchema),
  environment: Type.Optional(EnvironmentSchema),
  equipment: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  assetNeeds: Type.Optional(Type.Array(AssetNeedSchema)),
});

export const TraceEventSchema = Type.Object({
  stationRunId: Type.String({ minLength: 1 }),
  sequence: Type.Integer({ minimum: 0 }),
  eventType: Type.String({ minLength: 1 }),
  occurredAt: Type.String({ format: "date-time" }),
  atSecond: Type.Integer({ minimum: 0 }),
  source: Type.String({ minLength: 1 }),
  actorId: Type.Optional(Type.String({ minLength: 1 })),
  tag: Type.Optional(Type.String({ minLength: 1 })),
  payload: Type.Record(Type.String(), Type.Unknown()),
});

export const PatientNoteSchema = Type.Object({
  stationRunId: Type.String({ minLength: 1 }),
  submittedAtSecond: Type.Integer({ minimum: 0 }),
  text: Type.String({ minLength: 1 }),
});

export const FacultyScoreDraftSchema = Type.Object({
  reviewerId: Type.String({ minLength: 1 }),
  status: Type.Literal("draft"),
  comments: Type.String(),
});

export const ReviewPacketSchema = Type.Object({
  stationRunId: Type.String({ minLength: 1 }),
  scenarioId: Type.String({ minLength: 1 }),
  observedTraceTags: Type.Array(Type.String({ minLength: 1 })),
  missingRequiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
  lateTraceTags: Type.Array(Type.String({ minLength: 1 })),
  unsafeEvents: Type.Array(Type.String({ minLength: 1 })),
  facultyScoreDraft: FacultyScoreDraftSchema,
});

export const ProviderHealthSchema = Type.Object({
  providerId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal("ready"),
    Type.Literal("not_configured"),
    Type.Literal("blocked"),
  ]),
});

export type ActorCard = Static<typeof ActorCardSchema>;
export type Scenario = Static<typeof ScenarioSchema>;
export type TraceEvent = Static<typeof TraceEventSchema>;
export type PatientNote = Static<typeof PatientNoteSchema>;
export type ReviewPacket = Static<typeof ReviewPacketSchema>;
export type ProviderHealth = Static<typeof ProviderHealthSchema>;

