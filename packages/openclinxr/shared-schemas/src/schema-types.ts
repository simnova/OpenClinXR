import { type Static, Type } from "@sinclair/typebox";
import {
  ReviewGateStateSchema,
  ScenarioStatusSchema,
  ActorRoleSchema,
  type CommunicationProfileSchema,
  type ComplianceRegionSchema,
  type InteractionEmotionSchema,
  type EmotionEventKindSchema,
  type EmotionTransitionRuleSchema,
  type CaseEmotionPolicySchema,
  type TouchResponseSchema,
  type BodyMechanicsSchema,
  type ActorCardSchema,
  type ActorPhenotypeSchema,
  EventScheduleEntrySchema,
  type ExamBlueprintTimingSchema,
  type ExamStationSlotSchema,
  type ExamBlueprintSchema,
  ReviewRubricItemSchema,
  ScoreUseLabelSchema,
  ValidationStageSchema,
  HiddenFactPolicySchema,
  type ScenarioGovernanceSchema,
  EnvironmentSchema,
  type AssetKindSchema,
  AssetNeedSchema,
  type EnvironmentManifestSchema,
  type AssetManifestSchema,
  type ScenarioSchema,
} from "./schemas.js";
import {
  type SharedAssetLibraryRefsSchema,
  type SharedAssetLibraryLruCacheSchema,
  type SharedAssetLibraryReuseSchema,
  type DynamicEncounterFactoryScenarioSchema,
  type DynamicEncounterFactoryPlanningProjectionSchema,
  type DynamicEncounterFactoryProjectionArtifactSchema,
  type TraceEventSchema,
  type PatientNoteSchema,
  type StationPhaseSchema,
  type StationRunSchema,
  FacultyScoreDraftSchema,
  ReviewTimelineEntrySchema,
  ReviewTraceQualitySchema,
  type ReviewPacketSchema,
  type ProviderHealthSchema,
  type ProviderAuditRecordSchema,
  type ModelProviderAuditSchema,
  type VoiceProviderAuditSchema,
} from "./runtime-schemas.js";

export type ActorCard = Static<typeof ActorCardSchema>;
export type ActorPhenotype = Static<typeof ActorPhenotypeSchema>;
export type CommunicationProfile = Static<typeof CommunicationProfileSchema>;
export type ComplianceRegion = Static<typeof ComplianceRegionSchema>;
export type InteractionEmotion = Static<typeof InteractionEmotionSchema>;
export type EmotionEventKind = Static<typeof EmotionEventKindSchema>;
export type EmotionTransitionRule = Static<typeof EmotionTransitionRuleSchema>;
export type CaseEmotionPolicy = Static<typeof CaseEmotionPolicySchema>;
export type TouchResponse = Static<typeof TouchResponseSchema>;
export type BodyMechanics = Static<typeof BodyMechanicsSchema>;
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

