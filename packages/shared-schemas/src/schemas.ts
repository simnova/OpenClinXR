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

export const ScoreUseLabelSchema = Type.Union([
  Type.Literal("formative_local_only"),
  Type.Literal("pilot_research_only"),
  Type.Literal("validated_summative"),
]);

export const ValidationStageSchema = Type.Union([
  Type.Literal("stage_0_synthetic_draft"),
  Type.Literal("stage_1_expert_reviewed"),
  Type.Literal("stage_2_pilot_ready"),
  Type.Literal("stage_3_validated"),
]);

export const HiddenFactPolicySchema = Type.Object({
  learnerView: Type.Literal("redact_hidden_facts"),
  disclosureRequiresTrigger: Type.Boolean(),
});

export const ScenarioGovernanceSchema = Type.Object({
  scoreUseLabel: ScoreUseLabelSchema,
  syntheticCaseDisclosure: Type.String({ minLength: 1 }),
  validationStage: ValidationStageSchema,
  validationLimitations: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  requiredReviewerRoles: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  sourceIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  safetyCriticalTraceTags: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  hiddenFactPolicy: HiddenFactPolicySchema,
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
  governance: ScenarioGovernanceSchema,
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

export const ReviewTimelineEntrySchema = Type.Object({
  sequence: Type.Integer({ minimum: 0 }),
  atSecond: Type.Integer({ minimum: 0 }),
  eventType: Type.String({ minLength: 1 }),
  source: Type.String({ minLength: 1 }),
  actorId: Type.Optional(Type.String({ minLength: 1 })),
  tag: Type.Optional(Type.String({ minLength: 1 })),
  summary: Type.String({ minLength: 1 }),
});

export const ReviewTraceQualitySchema = Type.Object({
  eventCount: Type.Integer({ minimum: 0 }),
  modelGeneratedEventCount: Type.Integer({ minimum: 0 }),
  modelFailedEventCount: Type.Integer({ minimum: 0 }),
  blockedGuardrailCount: Type.Integer({ minimum: 0 }),
  unsafeEventCount: Type.Integer({ minimum: 0 }),
  missingRequiredTraceTagCount: Type.Integer({ minimum: 0 }),
  hasPatientNote: Type.Boolean(),
  hasModelProvenance: Type.Boolean(),
});

export const ReviewPacketSchema = Type.Object({
  stationRunId: Type.String({ minLength: 1 }),
  scenarioId: Type.String({ minLength: 1 }),
  observedTraceTags: Type.Array(Type.String({ minLength: 1 })),
  missingRequiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
  lateTraceTags: Type.Array(Type.String({ minLength: 1 })),
  unsafeEvents: Type.Array(Type.String({ minLength: 1 })),
  timeline: Type.Array(ReviewTimelineEntrySchema),
  traceQuality: ReviewTraceQualitySchema,
  patientNote: Type.Optional(PatientNoteSchema),
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
export type ScenarioGovernance = Static<typeof ScenarioGovernanceSchema>;
export type Scenario = Static<typeof ScenarioSchema>;
export type TraceEvent = Static<typeof TraceEventSchema>;
export type PatientNote = Static<typeof PatientNoteSchema>;
export type ReviewPacket = Static<typeof ReviewPacketSchema>;
export type ProviderHealth = Static<typeof ProviderHealthSchema>;
