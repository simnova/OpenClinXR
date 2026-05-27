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
  Type.Literal("consultant"),
  Type.Literal("interpreter"),
  Type.Literal("medical_assistant"),
  Type.Literal("respiratory_therapist"),
  Type.Literal("system"),
]);

export const CommunicationProfileSchema = Type.Object({
  styleFamily: Type.Union([
    Type.Literal("satir"),
    Type.Literal("custom"),
  ]),
  style: Type.Union([
    Type.Literal("congruent"),
    Type.Literal("accuser"),
    Type.Literal("rationalizer"),
    Type.Literal("appeaser"),
    Type.Literal("distractor"),
    Type.Literal("withdrawn_guarded"),
    Type.Literal("angry_family_member"),
    Type.Literal("custom"),
  ]),
  intensity: Type.Number({ minimum: 0, maximum: 1 }),
  baselineMood: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  communicativeness: Type.String({ minLength: 1 }),
  topicsToAvoid: Type.Array(Type.String({ minLength: 1 })),
  adverseResponse: Type.String({ minLength: 1 }),
  deescalationTriggers: Type.Array(Type.String({ minLength: 1 })),
  escalationTriggers: Type.Array(Type.String({ minLength: 1 })),
  culturalLanguageNotes: Type.Array(Type.String({ minLength: 1 })),
});

export const ActorCardSchema = Type.Object({
  actorId: Type.String({ minLength: 1 }),
  role: ActorRoleSchema,
  displayName: Type.String({ minLength: 1 }),
  demeanor: Type.Optional(Type.String()),
  hiddenFacts: Type.Optional(Type.Array(Type.String())),
  communicationProfile: Type.Optional(CommunicationProfileSchema),
});

export const EventScheduleEntrySchema = Type.Object({
  eventId: Type.String({ minLength: 1 }),
  atSecond: Type.Integer({ minimum: 0 }),
  actorId: Type.String({ minLength: 1 }),
  tag: Type.String({ minLength: 1 }),
});

export const ExamBlueprintTimingSchema = Type.Object({
  doorwaySeconds: Type.Integer({ minimum: 0 }),
  encounterSeconds: Type.Integer({ minimum: 0 }),
  noteSeconds: Type.Integer({ minimum: 0 }),
  breakAfterStationOrders: Type.Array(Type.Integer({ minimum: 1 })),
});

export const ExamStationSlotSchema = Type.Object({
  slotId: Type.String({ minLength: 1 }),
  order: Type.Integer({ minimum: 1 }),
  label: Type.String({ minLength: 1 }),
  requiredEnvironmentIds: Type.Array(Type.String({ minLength: 1 })),
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
});

export const ExamBlueprintSchema = Type.Object({
  blueprintId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  stationSlots: Type.Array(ExamStationSlotSchema, { minItems: 1 }),
  timing: ExamBlueprintTimingSchema,
  requiredTraceTags: Type.Array(Type.String({ minLength: 1 })),
  requiredSafetyCriticalTraceTags: Type.Array(Type.String({ minLength: 1 })),
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

export const AssetKindSchema = Type.Union([
  Type.Literal("character"),
  Type.Literal("environment"),
  Type.Literal("equipment"),
  Type.Literal("prop"),
  Type.Literal("texture"),
  Type.Literal("audio"),
]);

export const AssetNeedSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
  assetType: AssetKindSchema,
  description: Type.String({ minLength: 1 }),
  licenseStatus: Type.String({ minLength: 1 }),
});

export const EnvironmentManifestSchema = Type.Object({
  environment: EnvironmentSchema,
  equipment: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  assetNeeds: Type.Array(AssetNeedSchema, { minItems: 1 }),
});

export const AssetManifestSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
  scenarioId: Type.String({ minLength: 1 }),
  kind: AssetKindSchema,
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  requiredForScenario: Type.Boolean(),
  targetRuntime: Type.Union([
    Type.Literal("quest3_webxr"),
    Type.Literal("desktop_webxr"),
  ]),
  provenance: Type.Object({
    generationMethod: Type.Union([
      Type.Literal("procedural_placeholder"),
      Type.Literal("makehuman2"),
      Type.Literal("anny"),
      Type.Literal("stablegen"),
      Type.Literal("smplitex"),
      Type.Literal("manual_modeling"),
    ]),
    sourceRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    licenseStatus: Type.Union([
      Type.Literal("approved"),
      Type.Literal("permissive_review_required"),
      Type.Literal("copyleft_blocked"),
      Type.Literal("unknown"),
    ]),
  }),
  generationEvidence: Type.Optional(Type.Object({
    generatedHumanRiggingReportId: Type.Optional(Type.String({ minLength: 1 })),
    skinClothingProvenanceId: Type.Optional(Type.String({ minLength: 1 })),
    medicalEquipmentLibraryRecordId: Type.Optional(Type.String({ minLength: 1 })),
    animationRetargetingReportId: Type.Optional(Type.String({ minLength: 1 })),
  })),
  optimizationEvidence: Type.Optional(Type.Object({
    lodTiers: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    textureCompressionFormat: Type.Optional(Type.String({ minLength: 1 })),
    textureBudgetReportId: Type.Optional(Type.String({ minLength: 1 })),
    colliderSimplificationReportId: Type.Optional(Type.String({ minLength: 1 })),
  })),
  questQaStatus: Type.Object({
    status: Type.Union([
      Type.Literal("not_reviewed"),
      Type.Literal("placeholder_dev_ready"),
      Type.Literal("sim_qa_ready"),
      Type.Literal("failed"),
    ]),
    reviewedAt: Type.String({ format: "date-time" }),
    limitations: Type.Array(Type.String({ minLength: 1 })),
  }),
  geometryBudget: Type.Object({
    maxTriangles: Type.Integer({ minimum: 1 }),
    maxTextureMegabytes: Type.Number({ minimum: 0 }),
    maxDrawCalls: Type.Integer({ minimum: 1 }),
  }),
  pipelineStages: Type.Array(Type.Object({
    stage: Type.Union([
      Type.Literal("requested"),
      Type.Literal("source_reviewed"),
      Type.Literal("mesh_generated"),
      Type.Literal("rigged"),
      Type.Literal("optimized"),
      Type.Literal("qa_ready"),
    ]),
    completedAt: Type.String({ format: "date-time" }),
    notes: Type.String({ minLength: 1 }),
  }), { minItems: 1 }),
  tags: Type.Array(Type.String({ minLength: 1 })),
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

export const SharedAssetLibraryRefsSchema = Type.Object({
  blobPrefix: Type.String({ minLength: 1 }),
  mongooseCollectionName: Type.Literal("shared_encounter_asset_library"),
});

export const SharedAssetLibraryLruCacheSchema = Type.Object({
  enabled: Type.Literal(true),
  maxEntries: Type.Integer({ minimum: 1 }),
  evictionPolicy: Type.Literal("least_recently_used"),
  reuseRequiresEvidenceGateCompatibility: Type.Literal(true),
  updateRecencyOnHit: Type.Literal(true),
});

export const SharedAssetLibraryReuseSchema = Type.Object({
  lookupKey: Type.String({ minLength: 1 }),
  lookupKeySource: Type.Literal("encounter_definition_semantic_requirements"),
  cacheDisposition: Type.Literal("lookup_before_generate"),
  sharedLibraryRefs: SharedAssetLibraryRefsSchema,
  lruCache: SharedAssetLibraryLruCacheSchema,
});

export const DynamicEncounterFactoryScenarioSchema = Type.Object({
  factoryPlanningOrder: Type.Integer({ minimum: 1 }),
  scenarioId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  status: ScenarioStatusSchema,
  validationStage: ValidationStageSchema,
  actorRoles: Type.Array(Type.String({ minLength: 1 })),
  actorCount: Type.Integer({ minimum: 1 }),
  multiActorReady: Type.Boolean(),
  dialogueSeedCount: Type.Integer({ minimum: 0 }),
  dialogueSeedReady: Type.Boolean(),
  traceabilityReady: Type.Boolean(),
  requiredTraceTagCount: Type.Integer({ minimum: 0 }),
  safetyCriticalTraceTagCount: Type.Integer({ minimum: 0 }),
  eventScheduleCount: Type.Integer({ minimum: 0 }),
  rubricCount: Type.Integer({ minimum: 0 }),
  requiredReviewerRoleCount: Type.Integer({ minimum: 0 }),
  environmentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  equipmentCount: Type.Integer({ minimum: 0 }),
  assetNeedTypes: Type.Array(Type.String({ minLength: 1 })),
  factoryPlanningMetadataComplete: Type.Boolean(),
  factoryPlanningMetadataBlockers: Type.Array(Type.String({ minLength: 1 })),
  encounterFactoryInputSummary: Type.Object({
    source: Type.Literal("scenario_definition_and_dialogue_seed_bank"),
    scenarioBankOrder: Type.Integer({ minimum: 1 }),
    factorySelectionRole: Type.Union([
      Type.Literal("anchor"),
      Type.Literal("next_factory_planning_scenario"),
      Type.Literal("candidate"),
    ]),
    factorySelectionMode: Type.Union([
      Type.Literal("approved_encounter_variant"),
      Type.Literal("next_scenario_fallback"),
      Type.Literal("anchor_not_found"),
    ]),
    factorySelectionClaimBoundary: Type.Literal("review_gated_factory_metadata_only"),
    actorAssetWorkOrderCount: Type.Integer({ minimum: 0 }),
    environmentAssetWorkOrderCount: Type.Integer({ minimum: 0 }),
    equipmentAssetWorkOrderCount: Type.Integer({ minimum: 0 }),
    sharedAssetLookupKeys: Type.Array(Type.String({ minLength: 1 })),
    requiredTraceTags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    dynamicBehaviorTraceTags: Type.Array(Type.String({ minLength: 1 })),
  }),
  activationEligible: Type.Boolean(),
  learnerUseBoundary: Type.Union([
    Type.Literal("activation_ready"),
    Type.Literal("draft_review_required"),
    Type.Literal("governance_review_required"),
    Type.Literal("dialogue_seed_replay_required"),
  ]),
  reviewBlockers: Type.Array(Type.String({ minLength: 1 })),
  recommendedNextAction: Type.Union([
    Type.Literal("ready_for_local_formative_queue_assembly"),
    Type.Literal("complete_required_review_gates"),
    Type.Literal("repair_dialogue_seed_replay"),
    Type.Literal("repair_traceability_contract"),
    Type.Literal("complete_governance_review"),
  ]),
  sharedAssetLibraryReuse: Type.Optional(SharedAssetLibraryReuseSchema),
});

export const DynamicEncounterFactoryPlanningProjectionSchema = Type.Object({
  source: Type.Literal("scenario_bank_dynamic_encounter_factory_planning"),
  claimBoundary: Type.Literal("review_gated_factory_metadata_only"),
  anchorScenarioId: Type.String({ minLength: 1 }),
  nextFactoryPlanningScenarioId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  nextFactoryPlanningScenarioSelectionMode: Type.Union([
    Type.Literal("approved_encounter_variant"),
    Type.Literal("next_scenario_fallback"),
    Type.Literal("anchor_not_found"),
  ]),
  learnerUseBoundary: Type.Literal("activation_ready_only"),
  scenarios: Type.Array(DynamicEncounterFactoryScenarioSchema),
});

export const DynamicEncounterFactoryProjectionArtifactSchema = Type.Object({
  schemaVersion: Type.Literal("openclinxr.dynamic-encounter-factory-projection-artifact.v1"),
  source: Type.Literal("scenario_bank_dynamic_encounter_factory_projection_artifact"),
  claimBoundary: Type.Literal("review_gated_factory_metadata_only"),
  anchorScenarioId: Type.String({ minLength: 1 }),
  nextFactoryPlanningScenarioId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  nextFactoryPlanningScenarioSelectionMode: Type.Union([
    Type.Literal("approved_encounter_variant"),
    Type.Literal("next_scenario_fallback"),
    Type.Literal("anchor_not_found"),
  ]),
  learnerUseBoundary: Type.Literal("activation_ready_only"),
  scenarioBankSlice: Type.Array(ScenarioSchema),
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

export const StationPhaseSchema = Type.Union([
  Type.Literal("doorway"),
  Type.Literal("encounter"),
  Type.Literal("note"),
  Type.Literal("review"),
]);

export const StationRunSchema = Type.Object({
  stationRunId: Type.String({ minLength: 1 }),
  scenarioId: Type.String({ minLength: 1 }),
  learnerId: Type.String({ minLength: 1 }),
  phase: StationPhaseSchema,
  startedAtSecond: Type.Integer({ minimum: 0 }),
  encounterStartedAtSecond: Type.Optional(Type.Integer({ minimum: 0 })),
  encounterEndedAtSecond: Type.Optional(Type.Integer({ minimum: 0 })),
  note: Type.Optional(PatientNoteSchema),
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
  voiceAudioEventCount: Type.Integer({ minimum: 0 }),
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
  blockers: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  evidence: Type.Optional(Type.Object({
    evidenceId: Type.String({ minLength: 1 }),
    sourceFile: Type.String({ minLength: 1 }),
    generatedAt: Type.String({ format: "date-time" }),
    summary: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
  })),
});

export const ProviderAuditRecordSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  providerId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  modelVersion: Type.String({ minLength: 1 }),
  modelRuntimeName: Type.String({ minLength: 1 }),
  requestPolicyId: Type.String({ minLength: 1 }),
  safetyPolicyVersion: Type.String({ minLength: 1 }),
  latencyMs: Type.Number({ minimum: 0 }),
  costEstimateUsd: Type.Number({ minimum: 0 }),
  safetyStatus: Type.Union([
    Type.Literal("not_exercised"),
    Type.Literal("pass"),
    Type.Literal("blocked"),
  ]),
});

export const ModelProviderAuditSchema = ProviderAuditRecordSchema;
export const VoiceProviderAuditSchema = ProviderAuditRecordSchema;

export type ActorCard = Static<typeof ActorCardSchema>;
export type CommunicationProfile = Static<typeof CommunicationProfileSchema>;
export type ExamBlueprintTiming = Static<typeof ExamBlueprintTimingSchema>;
export type ExamStationSlot = Static<typeof ExamStationSlotSchema>;
export type ExamBlueprint = Static<typeof ExamBlueprintSchema>;
export type ScenarioGovernance = Static<typeof ScenarioGovernanceSchema>;
export type AssetKind = Static<typeof AssetKindSchema>;
export type EnvironmentManifest = Static<typeof EnvironmentManifestSchema>;
export type AssetManifest = Static<typeof AssetManifestSchema>;
export type Scenario = Static<typeof ScenarioSchema>;
export type SharedAssetLibraryRefs = Static<typeof SharedAssetLibraryRefsSchema>;
export type SharedAssetLibraryLruCache = Static<typeof SharedAssetLibraryLruCacheSchema>;
export type SharedAssetLibraryReuse = Static<typeof SharedAssetLibraryReuseSchema>;
export type DynamicEncounterFactoryScenario = Static<typeof DynamicEncounterFactoryScenarioSchema>;
export type DynamicEncounterFactoryPlanningProjection = Static<typeof DynamicEncounterFactoryPlanningProjectionSchema>;
export type DynamicEncounterFactoryProjectionArtifact = Static<typeof DynamicEncounterFactoryProjectionArtifactSchema>;
export type TraceEvent = Static<typeof TraceEventSchema>;
export type PatientNote = Static<typeof PatientNoteSchema>;
export type StationPhase = Static<typeof StationPhaseSchema>;
export type StationRun = Static<typeof StationRunSchema>;
export type ReviewPacket = Static<typeof ReviewPacketSchema>;
export type ProviderHealth = Static<typeof ProviderHealthSchema>;
export type ProviderAuditRecord = Static<typeof ProviderAuditRecordSchema>;
export type ModelProviderAudit = Static<typeof ModelProviderAuditSchema>;
export type VoiceProviderAudit = Static<typeof VoiceProviderAuditSchema>;
