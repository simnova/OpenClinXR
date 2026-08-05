import {
  ModelProviderAuditSchema,
  ProviderAuditRecordSchema,
  ProviderHealthSchema,
  TraceEventSchema,
  VoiceProviderAuditSchema,
} from "@cellix/provider-contracts";
/** Generic provider/trace contracts now live in the cellix seedwork tier; re-exported for back-compat. */
export {
  ModelProviderAuditSchema,
  ProviderAuditRecordSchema,
  ProviderHealthSchema,
  TraceEventSchema,
  VoiceProviderAuditSchema,
} from "@cellix/provider-contracts";
import { type Static, Type } from "@sinclair/typebox";
import {
  ReviewGateStateSchema,
  ScenarioStatusSchema,
  ActorRoleSchema,
  CommunicationProfileSchema,
  ComplianceRegionSchema,
  InteractionEmotionSchema,
  EmotionEventKindSchema,
  EmotionTransitionRuleSchema,
  CaseEmotionPolicySchema,
  TouchResponseSchema,
  BodyMechanicsSchema,
  ActorCardSchema,
  EventScheduleEntrySchema,
  ExamBlueprintTimingSchema,
  ExamStationSlotSchema,
  ExamBlueprintSchema,
  ReviewRubricItemSchema,
  ScoreUseLabelSchema,
  ValidationStageSchema,
  HiddenFactPolicySchema,
  ScenarioGovernanceSchema,
  EnvironmentSchema,
  AssetKindSchema,
  AssetNeedSchema,
  EnvironmentManifestSchema,
  AssetManifestSchema,
  ScenarioSchema,
} from "./schemas.js";

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




