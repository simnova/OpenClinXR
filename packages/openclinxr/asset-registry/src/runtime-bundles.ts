import type { RuntimeActorAudioEvidence } from "./runtime-actor-audio-evidence.js";
import { resolveScenarioActorCast } from "./actor-casting.js";
import { resolveRuntimeBundleCast } from "./runtime-bundle-cast.js";
import {
  resolveRuntimeAssetBlobUrl,
  resolveRuntimeAssetStoreConfig,
} from "./runtime-bundle-asset-urls.js";
import {
  generatedActorLabel,
  generatedActorPlacement,
  generatedEquipmentPlacement,
  safeRuntimeManifestKey,
} from "./actor-placement.js";
import {
  buildEquipmentPlacementReport,
  buildRealizedEquipmentPlacements,
  type EquipmentPlacementReport,
} from "./realized-equipment-placements.js";

export {
  resolveScenarioActorCast } from "./actor-casting.js";

import { bedsideClinicianPlacement } from "./bedside-target.js";
import { buildLocalEncounterActors } from "./bundle-actors.js";
import { type AuthoredPosture, authoredCasePlacements, type CaseScenarioSource, caseScenarioDocument, postureForSupportSurface } from "./case-actor-placements-mod.js";
import { placementsWithPersistedCaseIntent, type SupportedPlacementAcceptance } from "./case-intent-placements.js";
import { caseRealGlbEquipmentFixtures, caseRealGlbEquipmentPlacements } from "./case-runtime-equipment-mod.js";
import { resolveBundleCastActorIds } from "./cast-actor-ids.js";
import { defaultRuntimeAssetContainerName, missingRuntimeStrings, uniqueRuntimeStrings } from "./runtime-bundle-strings.js";
import { roomPropsForEnvironment } from "./runtime-room-props.js";

export type RuntimeAssetKind = "humanoid_model" | "environment_model" | "equipment_model" | "animation_clip" | "audio_clip" | "texture" | "ui_schema" | "phoneme_map";

export type RuntimeAssetStoreKind = "app_public_fixture" | "azurite_blob" | "azure_blob";

export type RuntimeAssetReviewStatus = "fixture_approved_for_local_runtime" | "approved_for_local_runtime" | "blocked";

export type EncounterRuntimeEvidenceGateId =
  | "runtime_realism_evidence"
  | "visual_qa_evidence"
  | "quest_runtime_evidence"
  | "asset_production_review";

export type RuntimeAssetBlobRef = {
  storeKind: RuntimeAssetStoreKind;
  containerName: string;
  blobName: string;
  contentHash?: string | undefined;
  contentType?: string | undefined;
  url: string;
};

export type RuntimeAssetStoreConfig = {
  storeKind: RuntimeAssetStoreKind;
  containerName: string;
  accountName?: string | undefined;
  baseUrl?: string | undefined;
};

export type EncounterRuntimeAsset = {
  assetId: string;
  version: string;
  kind: RuntimeAssetKind;
  displayName: string;
  scenarioAssetId: string;
  blob: RuntimeAssetBlobRef;
  reviewStatus: RuntimeAssetReviewStatus;
  provenanceRefs: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterRuntimeActorAsset = {
  actorId: string;
  embodiment: "humanoid" | "virtual_device" | "voice_only";
  role:
    | "patient"
    | "nurse"
    | "spouse"
    | "family"
    | "family_member"
    | "parent"
    | "consultant"
    | "physician"
    | "interpreter"
    | "respiratory_therapist"
    | "nurse_observer"
    | "other";
  model: EncounterRuntimeAsset;
  animationClips: EncounterRuntimeAsset[];
  phonemeMap?: EncounterRuntimeAsset | undefined;
  gazeProfile: {
    defaultTarget: "learner_camera" | "speaking_partner";
    supportsActorTargets: boolean;
  };
};

export type EncounterRuntimeEquipmentAsset = {
  equipmentId: string;
  model: EncounterRuntimeAsset;
};

export type EncounterRuntimeUiSurfaceAsset = {
  surfaceId: string;
  renderer: "schema_panel" | "static_panel";
  schema?: EncounterRuntimeAsset | undefined;
  data?: EncounterRuntimeAsset | undefined;
};

export type EncounterRuntimeRoomProp = {
  propId: string;
  label: string;
  semanticRole: "scenario_context" | "objective_cue" | "communication_cue" | "review_cue" | "environmental_detail";
  evidenceCue: string;
  /** CSS hex `#rrggbb` or bare `rrggbb` — parse via parseRuntimeRoomPropColorHex. */
  colorHex: string;
  /** CSS hex `#rrggbb` or bare `rrggbb` — parse via parseRuntimeRoomPropColorHex. */
  accentColorHex: string;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  affordanceCueIds: string[];
  interactionTags: string[];
  generatedBy: "scene_manifest";
};

export type EncounterRuntimeStationContext = {
  title: string;
  subtitle: string;
  chiefConcern: string;
  chiefConcernAuthorship?: "unauthored" | "authored_patient_voice" | "legacy_hardcoded_unreviewed" | "authored_reviewed"; // #127
  initialVitals: string;
  initialVitalsAuthorship?: "unauthored" | "legacy_hardcoded_unreviewed" | "authored_reviewed"; // #115
  interruption: string;
  interruptionAuthorship?: "unauthored" | "authored_patient_voice" | "legacy_hardcoded_unreviewed" | "authored_reviewed"; // #127
  stageAriaLabel: string;
  canvasAriaLabel: string;
  initialDialogueText: string;
};
export type EncounterRuntimeDialogueTurn = {
  actorAudio?: RuntimeActorAudioEvidence;
  traceTag: string;
  actorId: string;
  text: string;
  gazeTargetKind: "learner_camera" | "actor";
  gazeTargetActorId: string | null;
  affectTimeline?: {
    emotion: "neutral" | "anxious" | "concerned" | "reassured" | "pain";
    intensity: number;
    onsetMs: number;
    transitionMs: number;
    decayMs: number;
    evidenceCueIds: string[];
    notEvidenceFor: Array<"clinical_validity" | "scoring_validity" | "production_asset_readiness">;
  };
  caseDefinitionRuntimeSignals?: {
    source: "scenario_definition_and_dialogue_seed_bank";
    expressionRequired: boolean;
    gazeRequired: boolean;
    lipSyncRequired: boolean;
    actorRuntimeRealismRequirement?: {
      actorId: string;
      role: string;
      baselineMood: string[];
      locomotionRequired: boolean;
      expressionRequired: boolean;
      gazeRequired: boolean;
      lipSyncRequired: boolean;
      interactionRequired: boolean;
      requiredCueIds: string[];
    };
    requiredSignalIds: string[];
    claimBoundary: "case_definition_humanoid_runtime_metadata_only";
  };
};

export type EncounterRuntimeActorPlacement = {
  /** #123: additional_cast is the fourth staged humanoid (team-adjacent secondary). */
  slotKind: "primary_patient" | "clinical_team" | "family_or_observer" | "additional_cast";
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  verticalOffsetMeters: number;
  labelPrefix: string;
  /** Standing default; telehealth primary_patient is seated (#81). */
  posture?: "standing" | "seated" | "supine";
  /** Yaw about +Y applied to the OUTER actor slot Group, never the loaded humanoid child (the loader zeroes that child at xr-asset-loading/src/generated-loaders.ts:112). RADIANS, matching every existing heading writer. Absent means no authored facing; 0 is a real heading and is NOT the same as absent. */
  headingRadians?: number;
  /** Authored intent or resolved default; see PlacementProvenance in xr-runtime-state. Absent means the resolver did not say, which is not the same as a default it did say. */
  placementProvenance?: "authored_intent" | "resolved_default";
  /** The EXACT support instance a supported posture depends on, `<environmentId>:<fixtureSlotId>`. A kind is not an instance; see case-intent-placements.ts. Absent on standing, which rests on the floor frame. */
  supportInstanceId?: string;
  /** The case's authored plant offset in world metres, carried on the PERSISTED manifest so the runtime need not ask the scenarioBank about a case it has never seen. See case-intent-placements.ts. */
  plantOffsetMeters?: { x: number; y: number; z: number };
  /** The runtime's verdict on this placement's support, and the observation it hands the acceptance owner. Absent means nobody observed, which is not `not_required`. */
  supportAcceptance?: SupportedPlacementAcceptance;
};
export type EncounterRuntimeEquipmentPlacement = {
  equipmentId?: string | undefined;
  position: { x: number; y: number; z: number };
  label: string;
  interactionCueIds: string[];
};

export type EncounterRuntimeSceneManifest = {
  schemaVersion: "openclinxr.runtime-scene-manifest.v1";
  manifestId: string;
  source: "generated_scene_pipeline";
  scenarioId: string;
  stationId: string;
  /** The room the case selected. main.ts used to look the scenario up in the scenarioBank and fall back to the ED bay, so every authored encounter mounted the ED stretcher — the wrong-instance substitution A04 forbids. */
  environmentId?: string;
  stationContext: EncounterRuntimeStationContext;
  dialogueTurns: EncounterRuntimeDialogueTurn[];
  actorPlacements: Record<string, EncounterRuntimeActorPlacement>;
  equipmentPlacements: Record<string, EncounterRuntimeEquipmentPlacement>;
  roomProps: EncounterRuntimeRoomProp[];
  /**
   * Case-owned orders for actors walking OUTSIDE the frozen-plan approach, by ROLE (not
   * actorId). `targetOffsetMeters` is relative to that role's own placement -- not absolute --
   * since this manifest is reused across cases with different placements. main.ts only forwards.
   */
  locomotionOrders?: ReadonlyArray<{
    actorRole: string;
    targetOffsetMeters: { x: number; z: number };
    facing?: { x: number; z: number } | undefined;
    ageYears?: number | undefined;
    buildKey?: string | undefined;
  }>;
  productionReadinessClaimed: false;
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterRuntimeEvidenceGateRef = {
  gateId: EncounterRuntimeEvidenceGateId;
  status: "pending" | "attached" | "blocked";
  evidenceRefs: string[];
  requiredSignalIds: string[];
  blockers: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type PedsHumanoidMaterializationHandoffAsset = {
  actorRole: "patient" | "anxious_parent" | "nurse";
  assetPath: string;
  runtimeAssetPath: string;
  provenanceManifestPath: string;
  generatorMode: "anny_compatible_stub_plus_blender_procedural";
  sourceKind: "case_driven_generated_humanoid_candidate";
  realAnnyWeightsUsed: false;
  textureMode?: string;
  animationMode?: string;
  realismGrade: "B";
  promotionStatus?: string;
  notEvidenceFor: string[];
};
export type PedsHumanoidMaterializationHandoff = {
  schemaVersion: "openclinxr.peds-humanoid-materialization-handoff.v1";
  source: "worker_role_specific_humanoid_glb_materialization_metadata";
  scenarioId: "peds_asthma_parent_anxiety_v1";
  targetKind?: string;
  generatedAssetsMaterialized: boolean;
  localCandidateAssetsSelected: boolean;
  reviewPacketPath?: string;
  assets: PedsHumanoidMaterializationHandoffAsset[];
  productionReadinessClaimed: false;
  questReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: string;
};
export type EncounterRuntimeAssetBundle = {
  bundleId: string;
  tenantId: string;
  userId: string;
  examRunId: string;
  encounterId: string;
  stationId: string;
  scenarioId: string;
  assetStoreKind: RuntimeAssetStoreKind;
  environment: EncounterRuntimeAsset;
  actors: EncounterRuntimeActorAsset[];
  equipment: EncounterRuntimeEquipmentAsset[];
  uiSurfaces: EncounterRuntimeUiSurfaceAsset[];
  sceneManifest: EncounterRuntimeSceneManifest;
  evidenceGateRefs: EncounterRuntimeEvidenceGateRef[];
  assemblyAuditMetadata: EncounterRuntimeBundleAssemblyAuditMetadata;
  remediationPlanRefs?: EncounterRuntimeRemediationPlanAuditRef[] | undefined;
  generatedAt: string;
  expiresAt: string | null;
  frozenForEncounter: boolean;
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
  pedsHumanoidMaterializationHandoff?: PedsHumanoidMaterializationHandoff;
};
export type EncounterRuntimeLearnerUseGate = {
  canUseGeneratedBundleForLearnerRuntime: boolean;
  blockers: string[];
  pendingGateIds: EncounterRuntimeEvidenceGateId[];
  attachedGateIds: EncounterRuntimeEvidenceGateId[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterRuntimeGeneratedAssetAuditRef = {
  assetId: string;
  scenarioAssetId: string;
  kind: RuntimeAssetKind;
  version: string;
  reviewStatus: RuntimeAssetReviewStatus;
  blobRef: Pick<RuntimeAssetBlobRef, "storeKind" | "containerName" | "blobName" | "contentHash">;
  provenanceRefs: string[];
};

export type EncounterRuntimeHumanoidAuditMetadataRef = {
  actorId: string;
  actorRole: EncounterRuntimeActorAsset["role"];
  embodiment: EncounterRuntimeActorAsset["embodiment"];
  modelAssetId: string;
  animationClipAssetIds: string[];
  phonemeMapAssetId: string | null;
  metadataRefIds: string[];
  requiredSignalIds: string[];
  claimScope: "metadata_only_not_visual_quality_evidence";
};

export type EncounterRuntimeRemediationPlanAuditRef = {
  planRefId: string;
  dimension: "gaze" | "mouth_viseme" | "pose" | "posture_collision" | "clothing" | "shared_asset_reuse";
  sourceWorkOrderRef: string;
  executionStatus: "metadata_only_not_executed";
  providerRoutesRequireExplicitApproval: true;
  learnerUseBlockedUntilEvidenceGatesAttach: true;
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterRuntimeBundleAssemblyAuditMetadata = {
  schemaVersion: "openclinxr.runtime-bundle-assembly-audit.v1";
  claimBoundary: "asset_reference_audit_metadata_not_materialized_assets";
  sourceDefinitionRefs: string[];
  workOrderRefs: string[];
  factoryRequestRefs: string[];
  generatedAssetRefs: EncounterRuntimeGeneratedAssetAuditRef[];
  humanoidMetadataRefs: EncounterRuntimeHumanoidAuditMetadataRef[];
  remediationPlanRefs: EncounterRuntimeRemediationPlanAuditRef[];
  evidenceGateIds: EncounterRuntimeEvidenceGateId[];
  fallbackPosture: {
    usesLocalFixtureFallbackAssets: boolean;
    fallbackAssetIds: string[];
    learnerUseBlockedUntilEvidenceGatesAttach: true;
  };
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterDynamicBehaviorCoverageSummary = {
  schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1";
  claimBoundary: "metadata_only_not_runtime_behavior_evidence";
  dialogueTurnCoverage: {
    actorRolesWithDialogueTurns: string[];
    missingActorRoles: string[];
    dialogueTurnCount: number;
  };
  gazeTargetCoverage: {
    actorRolesWithGazeTargets: string[];
    actorRolesWithActorTargetSupport: string[];
    missingActorRoles: string[];
  };
  actorRolePlacementCoverage: {
    actorRolesWithPlacements: string[];
    missingActorRoles: string[];
  };
  affectTimelineCoverage: {
    actorRolesWithAffectTimelines: string[];
    missingActorRoles: string[];
    affectTimelineCount: number;
    claimBoundary: "metadata_only_not_runtime_facial_animation_evidence";
  };
  blockerIds: string[];
  warningIds: string[];
};

export type EncounterFactoryDryRunSummary = {
  planId: string;
  status: "review_plan_created_not_asset_generation" | "blocked_pending_runtime_bundle";
  sourceRequestId: string;
  sourceScenarioId: string;
  actorRoles: string[];
  stageIds: string[];
  reviewGateIds: string[];
  blockerIds: string[];
  warningIds: string[];
  recommendedNextAction: "review_factory_plan_before_generation_or_publication" | "resolve_bundle_blockers_before_factory_plan_review" | "attach_runtime_asset_review_decisions";
  dynamicBehaviorCoverage: EncounterDynamicBehaviorCoverageSummary;
  claimBoundary: "encounter_factory_dry_run_not_asset_generation";
  evidenceBoundaries: {
    metadataOnlyPlan: true;
    generatedAssetsMaterialized: false;
    runtimeBundlePublished: false;
    learnerRuntimeEnabled: false;
    questReadinessClaimed: false;
    productionReadinessClaimed: false;
  };
};

export type EncounterFactoryInputSummary = {
  source: "scenario_definition_and_dialogue_seed_bank";
  scenarioBankOrder?: number;
  factorySelectionRole?: "anchor" | "next_factory_planning_scenario" | "candidate";
  factorySelectionMode?: "approved_encounter_variant" | "next_scenario_fallback" | "anchor_not_found";
  factorySelectionClaimBoundary?: "review_gated_factory_metadata_only";
  actorAssetWorkOrderCount: number;
  environmentAssetWorkOrderCount: number;
  equipmentAssetWorkOrderCount: number;
  sharedAssetLookupKeys: string[];
  dynamicBehaviorTraceTags: string[];
};

export type EncounterFactoryInputPlanningSummary = {
  schemaVersion: "openclinxr.encounter-factory-input-planning-summary.v1";
  claimBoundary: "metadata_only_not_asset_generation";
  source: "scenario_definition_and_dialogue_seed_bank";
  scenarioId: string;
  assetWorkOrderIntent: {
    actor: number;
    environment: number;
    equipment: number;
    total: number;
  };
  sharedAssetLibraryReuse: {
    cacheDisposition: "lookup_before_generate";
    lookupKeyCount: number;
    lookupKeys: string[];
    requiresEvidenceGateCompatibility: true;
  };
  dynamicBehaviorTraceTags: string[];
  factorySelectionMetadata?: {
    scenarioBankOrder: number | null;
    factorySelectionRole: "anchor" | "next_factory_planning_scenario" | "candidate" | "unspecified";
    factorySelectionMode: "approved_encounter_variant" | "next_scenario_fallback" | "anchor_not_found" | "unspecified";
    factorySelectionClaimBoundary: "review_gated_factory_metadata_only";
  } | undefined;
  blockerIds: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterFactorySummaryContracts = {
  dynamicBehaviorCoverage: EncounterDynamicBehaviorCoverageSummary;
  encounterFactoryDryRunSummary: EncounterFactoryDryRunSummary;
  inputPlanningSummary?: EncounterFactoryInputPlanningSummary | undefined;
};

export type BuildEncounterDynamicBehaviorCoverageSummaryInput = {
  learnerRuntimeBundle?: Pick<LearnerRuntimeAssetBundle, "actors" | "sceneManifest" | "scenarioId"> | null | undefined;
  requiredActorRoles?: readonly string[] | undefined;
  scenarioId?: string | undefined;
};

export type BuildEncounterFactoryDryRunSummaryInput = {
  requestId: string;
  scenarioId: string;
  encounterFactoryInputSummary?: EncounterFactoryInputSummary | undefined;
  learnerRuntimeBundle?: Pick<LearnerRuntimeAssetBundle, "actors" | "sceneManifest" | "scenarioId"> | null | undefined;
  dynamicBehaviorCoverage?: EncounterDynamicBehaviorCoverageSummary | undefined;
  requiredActorRoles?: readonly string[] | undefined;
  actorRoles?: readonly string[] | undefined;
  stageIds?: readonly string[] | undefined;
  reviewGateIds?: readonly string[] | undefined;
  blockerIds?: readonly string[] | undefined;
  warningIds?: readonly string[] | undefined;
  reviewAttached?: boolean | undefined;
  blockedPendingRuntimeBundle?: boolean | undefined;
};

export type EncounterRuntimeBundlePublicationMetadata = {
  bundleId: string;
  scenarioId: string;
  stationId: string;
  status: "publication_prepared_not_learner_use" | "blocked";
  assetStoreKind: RuntimeAssetStoreKind;
  generatedAssetCount: number;
  humanoidActorCount: number;
  equipmentCount: number;
  pendingEvidenceGateIds: EncounterRuntimeEvidenceGateId[];
  attachedEvidenceGateIds: EncounterRuntimeEvidenceGateId[];
  learnerRuntimeUseBlocked: true;
  learnerRuntimeUseBlockers: string[];
  publicationReviewEvidenceRefs: string[];
  blockers: string[];
  publicationArtifactRefs: {
    sceneManifest: string;
    learnerRuntimeBundle: string;
  };
  assemblyAuditMetadata: EncounterRuntimeBundleAssemblyAuditMetadata;
  humanoidRealismProfileSummary?: {
    profileCount: number;
    actorRoles: string[];
    requiredSignalIds: string[];
    claimScope: "metadata_only_not_visual_quality_evidence";
  } | undefined;
  claimBoundary: "local_publication_metadata_not_runtime_readiness";
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type LearnerRuntimeAssetBundle = Omit<EncounterRuntimeAssetBundle, "tenantId" | "userId" | "examRunId" | "encounterId"> & {
  identityScope: "learner_runtime_opaque_bundle";
};

export type GuardedRuntimeSelectorCandidateBundle = Pick<
  LearnerRuntimeAssetBundle,
  "bundleId" | "scenarioId" | "stationId" | "assetStoreKind" | "evidenceGateRefs" | "notEvidenceFor"
>;

export type BuildGuardedRuntimeSelectorDisabledDecisionInput = {
  selectedRuntimeAssetBundleId: string;
  selectedScenarioId: string;
  selectedStationId: string;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  candidateBundles?: readonly GuardedRuntimeSelectorCandidateBundle[] | undefined;
  blockerIds?: readonly string[] | undefined;
};

export type GuardedRuntimeSelectorDisabledDecision = {
  schemaVersion: "openclinxr.guarded-runtime-selector-disabled-decision.v1";
  selectionStatus: "disabled_guard_not_runtime_execution" | "blocked_intent_bundle_missing" | "blocked_intent_bundle_mismatch";
  claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution";
  selectedScenarioId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  selectedBundleId: null;
  selectedBundleIdForFutureRuntime: string | null;
  matchedBundleSummary: {
    bundleId: string;
    scenarioId: string;
    stationId: string;
    assetStoreKind: RuntimeAssetStoreKind;
    pendingEvidenceGateIds: EncounterRuntimeEvidenceGateId[];
    attachedEvidenceGateIds: EncounterRuntimeEvidenceGateId[];
  } | null;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  providerExecutionPerformed: false;
  uiLaunchPerformed: false;
  questEvidenceRefreshed: false;
  blockers: string[];
  nextAllowedStep: "wire_runtime_selector_behind_disabled_guard";
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type ResolveEncounterRuntimeAssetBundleInput = {
  tenantId?: string | undefined;
  userId?: string | undefined;
  examRunId?: string | undefined;
  encounterId?: string | undefined;
  stationId?: string | undefined;
  scenarioId?: string | undefined;
  assetStoreKind?: RuntimeAssetStoreKind | undefined;
  assetStore?: RuntimeAssetStoreConfig | undefined;
  nowIso?: string | undefined;
  /** A PERSISTED authored case, already resolved by the caller. Absent = today's bank behaviour. */
  scenario?: CaseScenarioSource | undefined;
};

export type RegisterGeneratedRuntimeAssetReferenceInput = {
  assetId: string;
  version: string;
  kind: RuntimeAssetKind;
  displayName: string;
  scenarioAssetId: string;
  blobName: string;
  contentType?: string | undefined;
  contentHash?: string | undefined;
  assetStore: RuntimeAssetStoreConfig;
  reviewStatus: RuntimeAssetReviewStatus;
  provenanceRefs: string[];
};

export type BuildEncounterRuntimeAssetBundleInput = {
  bundleId: string;
  tenantId: string;
  userId: string;
  examRunId: string;
  encounterId: string;
  stationId: string;
  scenarioId: string;
  assetStore: RuntimeAssetStoreConfig;
  environment: EncounterRuntimeAsset;
  actors: EncounterRuntimeActorAsset[];
  equipment?: EncounterRuntimeEquipmentAsset[] | undefined;
  uiSurfaces?: EncounterRuntimeUiSurfaceAsset[] | undefined;
  sceneManifest?: EncounterRuntimeSceneManifest | undefined;
  evidenceGateRefs?: EncounterRuntimeEvidenceGateRef[] | undefined;
  assemblyAuditMetadata?: EncounterRuntimeBundleAssemblyAuditMetadata | undefined;
  remediationPlanRefs?: EncounterRuntimeRemediationPlanAuditRef[] | undefined;
  generatedAt?: string | undefined;
  expiresAt?: string | null | undefined;
};

// Only the two TYPES are published: they are the shape of `equipmentPlacements` and
// `equipmentPlacementReport` on the bundle, so a consumer cannot read those fields without them.
// The five value helpers that produced them stay internal to this package — republishing a builder
// nothing outside calls is how an entrypoint ceiling gets spent on surface no one uses.

const LOCAL_RUNTIME_NOT_EVIDENCE_FOR = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export const ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS = [
  "animated_humanoid_runtime_playback",
  "authored_clinical_idle_pose_runtime_cue",
  "visible_mouth_eye_expression_cues",
  "dialogue_viseme_and_gaze_mapping",
  "dialogue_eye_micro_saccade_blink_cue",
  "generated_eyelid_blink_control_cue",
  "emotion_aligned_expression_transition_cue",
] as const;

export const ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS = [
  "runtime_realism_evidence",
  "visual_qa_evidence",
  "quest_runtime_evidence",
] as const satisfies readonly EncounterRuntimeEvidenceGateId[];

function localFixtureAsset(input: {
  assetId: string;
  scenarioAssetId: string;
  kind: RuntimeAssetKind;
  displayName: string;
  blobName: string;
  contentType: string;
  assetStore: RuntimeAssetStoreConfig;
}): EncounterRuntimeAsset {
  return {
    assetId: input.assetId,
    version: "local-fixture-2026-05-22",
    kind: input.kind,
    displayName: input.displayName,
    scenarioAssetId: input.scenarioAssetId,
    blob: {
      storeKind: input.assetStore.storeKind,
      containerName: input.assetStore.containerName,
      blobName: input.blobName,
      contentType: input.contentType,
      url: resolveRuntimeAssetBlobUrl(input.assetStore, input.blobName),
    },
    reviewStatus: "fixture_approved_for_local_runtime",
    provenanceRefs: ["openclinxr-local-generated-asset-fixture", `${input.assetId}_provenance`],
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function registerGeneratedRuntimeAssetReference(
  input: RegisterGeneratedRuntimeAssetReferenceInput,
): EncounterRuntimeAsset {
  const assetStore = resolveRuntimeAssetStoreConfig(input.assetStore);
  return {
    assetId: input.assetId,
    version: input.version,
    kind: input.kind,
    displayName: input.displayName,
    scenarioAssetId: input.scenarioAssetId,
    blob: {
      storeKind: assetStore.storeKind,
      containerName: assetStore.containerName,
      blobName: input.blobName.replace(/^\/+/u, ""),
      ...(input.contentHash ? { contentHash: input.contentHash } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
      url: resolveRuntimeAssetBlobUrl(assetStore, input.blobName),
    },
    reviewStatus: input.reviewStatus,
    provenanceRefs: [...input.provenanceRefs],
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function buildEncounterRuntimeAssetBundle(
  input: BuildEncounterRuntimeAssetBundleInput,
): EncounterRuntimeAssetBundle & { equipmentPlacementReport: EquipmentPlacementReport } {
  const assetStore = resolveRuntimeAssetStoreConfig(input.assetStore);
  const sceneManifest = input.sceneManifest ?? createGeneratedRuntimeSceneManifest({
    scenarioId: input.scenarioId,
    stationId: input.stationId,
    actors: input.actors,
    equipment: input.equipment ?? [],
  });
  const equipmentPlacementReport = buildEquipmentPlacementReport(input.equipment ?? []);
  return {
    bundleId: input.bundleId,
    tenantId: input.tenantId,
    userId: input.userId,
    examRunId: input.examRunId,
    encounterId: input.encounterId,
    stationId: input.stationId,
    scenarioId: input.scenarioId,
    assetStoreKind: assetStore.storeKind,
    environment: input.environment,
    actors: input.actors.map((actor) => ({
      ...actor,
      animationClips: [...actor.animationClips],
    })),
    equipment: [...(input.equipment ?? [])],
    uiSurfaces: [...(input.uiSurfaces ?? [])],
    sceneManifest,
    evidenceGateRefs: input.evidenceGateRefs?.map((gateRef) => ({
      ...gateRef,
      evidenceRefs: [...gateRef.evidenceRefs],
      requiredSignalIds: [...gateRef.requiredSignalIds],
      blockers: [...gateRef.blockers],
      notEvidenceFor: [...gateRef.notEvidenceFor],
    })) ?? [],
    generatedAt: input.generatedAt ?? "2026-05-22T00:00:00.000Z",
    expiresAt: input.expiresAt ?? null,
    frozenForEncounter: true,
    assemblyAuditMetadata: input.assemblyAuditMetadata ?? deriveEncounterRuntimeBundleAssemblyAuditMetadata({
      bundleId: input.bundleId,
      scenarioId: input.scenarioId,
      stationId: input.stationId,
      assetStoreKind: assetStore.storeKind,
      environment: input.environment,
      actors: input.actors,
      equipment: input.equipment ?? [],
      uiSurfaces: input.uiSurfaces ?? [],
      sceneManifest,
      evidenceGateRefs: input.evidenceGateRefs ?? [],
      remediationPlanRefs: input.remediationPlanRefs ?? [],
      frozenForEncounter: true,
      notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
    }),
    equipmentPlacementReport,
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function createEdChestPainLocalEncounterRuntimeAssetBundle(
  input: ResolveEncounterRuntimeAssetBundleInput = {},
): EncounterRuntimeAssetBundle {
  const generatedAt = input.nowIso ?? "2026-05-22T00:00:00.000Z";
  const assetStore = resolveRuntimeAssetStoreConfig(input.assetStore ?? {
    storeKind: input.assetStoreKind ?? "app_public_fixture",
    containerName: defaultRuntimeAssetContainerName(input.assetStoreKind ?? "app_public_fixture"),
  });
  // #85/#96: role-distinct ED wardrobe (gown/scrubs/street); casting table is blob-path SSOT.
  const castTable = resolveRuntimeBundleCast(input.scenarioId, input.scenario);
  const edModel = (
    assetId: string, scenarioAssetId: string, displayName: string, castRole: string, fallbackGlb: string,
  ): EncounterRuntimeAsset => {
    const cast = castTable.find((a) => a.role === castRole || (castRole === "family" && a.role === "family_member"));
    const path = cast?.assetPath ?? `apps/ui-xr/public/generated-humanoids/${fallbackGlb}`;
    const m = localFixtureAsset({
      assetId, scenarioAssetId, kind: "humanoid_model", displayName,
      blobName: path.replace(/^apps\/ui-xr\/public\//u, ""), contentType: "model/gltf-binary", assetStore,
    });
    m.provenanceRefs = [
      ...m.provenanceRefs,
      cast?.provenanceManifestPath ?? path.replace(/\.glb$/u, ".provenance.json"),
      `casting:${cast?.runtimeAssetPath ?? `/generated-humanoids/${fallbackGlb}`}`,
      ...(castRole === "patient" ? [`cast_table:${castTable.map((a) => a.actorId).join(",")}`] : []),
    ];
    return m;
  };
  const { patientActorId, clinicalActorId, familyActorId, additionalActorId } = resolveBundleCastActorIds(castTable);
  // The fourth slot's role comes from the cast, narrowed to the roles the bundle publishes. A cast
  // role outside that set becomes "other" rather than widening the union for one scenario.
  const additionalCastRole = castTable.find((entry) => entry.actorId === additionalActorId)?.role;
  const additionalRole = additionalCastRole === "physician" ? "physician" as const : "other" as const;
  const additionalModel = additionalActorId
    ? edModel("ed_chest_pain_adult_cast_additional_glb", "additional_cast_character", "Additional cast adult humanoid GLB", additionalRole, "ed_chest_pain_nurse_adult.glb")
    : null;
  const patientModel = edModel("ed_chest_pain_adult_cast_glb", "patient_robert_hayes_character", "ED patient adult humanoid GLB (hospital gown)", "patient", "ed_chest_pain_adult_cast.glb");
  const nurseModel = edModel("ed_chest_pain_adult_cast_nurse_glb", "nurse_maria_alvarez_character", "ED nurse adult humanoid GLB (scrubs)", "nurse", "ed_chest_pain_nurse_adult.glb");
  const spouseModel = edModel("ed_chest_pain_adult_cast_spouse_glb", "spouse_anna_hayes_character", "ED spouse adult humanoid GLB (street clothes)", "family", "ed_chest_pain_spouse_adult.glb");

  return buildEncounterRuntimeAssetBundle({
    bundleId: `${input.examRunId ?? "local_exam_run"}:${input.encounterId ?? "ed_chest_pain_local_encounter"}:runtime-assets`,
    tenantId: input.tenantId ?? "local-dev-tenant",
    userId: input.userId ?? "quest3_local_learner",
    examRunId: input.examRunId ?? "local_exam_run",
    encounterId: input.encounterId ?? "ed_chest_pain_local_encounter",
    stationId: input.stationId ?? "ed_chest_pain_station_v1",
    scenarioId: input.scenarioId ?? "ed_chest_pain_priority_v1",
    assetStore,
    evidenceGateRefs: [
      runtimeEvidenceGateRef({
        gateId: "runtime_realism_evidence",
        status: "pending",
        requiredSignalIds: [
          "animated_humanoid_runtime_playback",
          "authored_clinical_idle_pose_runtime_cue",
          "visible_mouth_eye_expression_cues",
          "dialogue_viseme_and_gaze_mapping",
          "emotion_aligned_expression_transition_cue",
        ],
        blockers: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
      }),
      runtimeEvidenceGateRef({
        gateId: "visual_qa_evidence",
        status: "pending",
        requiredSignalIds: [
          "humanoid_realism_visual_qa_review",
          "no_rejected_visual_regression_cues",
          "emotion_expression_transition_readability",
        ],
        blockers: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
      }),
      runtimeEvidenceGateRef({
        gateId: "quest_runtime_evidence",
        status: "pending",
        requiredSignalIds: ["worn_headset_or_documented_quest_webxr_evidence"],
        blockers: ["quest_runtime_evidence_not_attached_to_encounter_bundle"],
      }),
    ],
    environment: localFixtureAsset({
      assetId: "ed_exam_bay_environment_shell_glb",
      scenarioAssetId: "ed_exam_bay_environment",
      kind: "environment_model",
      displayName: "ED exam bay shell GLB fixture",
      blobName: "xr-assets/environment/ed-exam-bay-shell.glb",
      contentType: "model/gltf-binary",
      assetStore,
    }),
    actors: buildLocalEncounterActors({
      patientActorId, clinicalActorId, familyActorId, additionalActorId, additionalRole,
      patientModel, nurseModel, spouseModel, additionalModel,
    }),
    // The ED pair is the default and stays exactly that; a case that authors neither catalogue id
    // realizes neither. See case-runtime-equipment.ts for the reviewed alias and its precedence.
    equipment: caseRealGlbEquipmentFixtures(input.scenario).map((fixture) => ({
      equipmentId: fixture.equipmentId,
      model: localFixtureAsset({
        assetId: fixture.assetId,
        scenarioAssetId: fixture.scenarioAssetId,
        kind: "equipment_model",
        displayName: fixture.displayName,
        blobName: fixture.blobName,
        contentType: "model/gltf-binary",
        assetStore,
      }),
    })),
    uiSurfaces: [],
    sceneManifest: createEdChestPainRuntimeSceneManifest({
      scenarioId: input.scenarioId ?? "ed_chest_pain_priority_v1",
      stationId: input.stationId ?? "ed_chest_pain_station_v1",
      scenario: input.scenario,
    }),
    generatedAt,
    expiresAt: null,
  });
}

function runtimeEvidenceGateRef(input: {
  gateId: EncounterRuntimeEvidenceGateId;
  status: "pending" | "attached" | "blocked";
  evidenceRefs?: string[] | undefined;
  requiredSignalIds?: string[] | undefined;
  blockers?: string[] | undefined;
}): EncounterRuntimeEvidenceGateRef {
  return {
    gateId: input.gateId,
    status: input.status,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    requiredSignalIds: [...(input.requiredSignalIds ?? [])],
    blockers: [...(input.blockers ?? [])],
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function createEdChestPainLocalLearnerRuntimeAssetBundle(
  input: ResolveEncounterRuntimeAssetBundleInput = {},
): LearnerRuntimeAssetBundle {
  return toLearnerRuntimeAssetBundle(createEdChestPainLocalEncounterRuntimeAssetBundle(input));
}

export function toLearnerRuntimeAssetBundle(bundle: EncounterRuntimeAssetBundle): LearnerRuntimeAssetBundle {
  return {
    bundleId: bundle.bundleId,
    stationId: bundle.stationId,
    scenarioId: bundle.scenarioId,
    assetStoreKind: bundle.assetStoreKind,
    environment: bundle.environment,
    actors: bundle.actors,
    equipment: bundle.equipment,
    uiSurfaces: bundle.uiSurfaces,
    sceneManifest: bundle.sceneManifest,
    evidenceGateRefs: bundle.evidenceGateRefs.map((gateRef) => ({
      ...gateRef,
      evidenceRefs: [...gateRef.evidenceRefs],
      requiredSignalIds: [...gateRef.requiredSignalIds],
      blockers: [...gateRef.blockers],
      notEvidenceFor: [...gateRef.notEvidenceFor],
    })),
    generatedAt: bundle.generatedAt,
    expiresAt: bundle.expiresAt,
    frozenForEncounter: bundle.frozenForEncounter,
    assemblyAuditMetadata: cloneEncounterRuntimeBundleAssemblyAuditMetadata(bundle.assemblyAuditMetadata),
    notEvidenceFor: bundle.notEvidenceFor,
    ...(bundle.pedsHumanoidMaterializationHandoff ? { pedsHumanoidMaterializationHandoff: bundle.pedsHumanoidMaterializationHandoff } : {}),
    identityScope: "learner_runtime_opaque_bundle",
  };
}

export function deriveEncounterRuntimeBundleAssemblyAuditMetadata(
  bundle: Pick<
    EncounterRuntimeAssetBundle,
    | "bundleId"
    | "scenarioId"
    | "stationId"
    | "assetStoreKind"
    | "environment"
    | "actors"
    | "equipment"
    | "uiSurfaces"
    | "sceneManifest"
    | "evidenceGateRefs"
    | "remediationPlanRefs"
    | "frozenForEncounter"
    | "notEvidenceFor"
  >,
): EncounterRuntimeBundleAssemblyAuditMetadata {
  const generatedAssetRefs = runtimeBundleAssetAuditRefs(bundle);
  const fixtureFallbackAssetIds = generatedAssetRefs
    .filter((asset) => asset.reviewStatus === "fixture_approved_for_local_runtime" || asset.blobRef.storeKind === "app_public_fixture")
    .map((asset) => asset.assetId);

  return {
    schemaVersion: "openclinxr.runtime-bundle-assembly-audit.v1",
    claimBoundary: "asset_reference_audit_metadata_not_materialized_assets",
    sourceDefinitionRefs: uniqueRuntimeStrings([
      `scenario_definition:${bundle.scenarioId}`,
      `station_definition:${bundle.stationId}`,
      `runtime_scene_manifest:${bundle.sceneManifest.manifestId}`,
    ]),
    workOrderRefs: uniqueRuntimeStrings([
      `scene_generation_work_order:${bundle.scenarioId}`,
      `runtime_bundle_binding:${bundle.bundleId}`,
    ]),
    factoryRequestRefs: uniqueRuntimeStrings([
      `runtime_bundle:${bundle.bundleId}`,
      `asset_store:${bundle.assetStoreKind}`,
    ]),
    generatedAssetRefs,
    humanoidMetadataRefs: bundle.actors
      .filter((actor) => actor.embodiment === "humanoid")
      .map((actor) => ({
        actorId: actor.actorId,
        actorRole: actor.role,
        embodiment: actor.embodiment,
        modelAssetId: actor.model.assetId,
        animationClipAssetIds: actor.animationClips.map((clip) => clip.assetId),
        phonemeMapAssetId: actor.phonemeMap?.assetId ?? null,
        metadataRefIds: uniqueRuntimeStrings([
          actor.model.scenarioAssetId,
          ...actor.model.provenanceRefs,
          ...actor.animationClips.flatMap((clip) => clip.provenanceRefs),
          ...(actor.phonemeMap?.provenanceRefs ?? []),
        ]),
        requiredSignalIds: [...ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS],
        claimScope: "metadata_only_not_visual_quality_evidence",
      })),
    remediationPlanRefs: bundle.remediationPlanRefs?.map(cloneEncounterRuntimeRemediationPlanAuditRef) ?? [],
    evidenceGateIds: uniqueRuntimeStrings(bundle.evidenceGateRefs.map((gateRef) => gateRef.gateId)) as EncounterRuntimeEvidenceGateId[],
    fallbackPosture: {
      usesLocalFixtureFallbackAssets: fixtureFallbackAssetIds.length > 0,
      fallbackAssetIds: fixtureFallbackAssetIds,
      learnerUseBlockedUntilEvidenceGatesAttach: true,
    },
    notEvidenceFor: [...bundle.notEvidenceFor],
  };
}

function runtimeBundleAssetAuditRefs(
  bundle: Pick<EncounterRuntimeAssetBundle, "environment" | "actors" | "equipment" | "uiSurfaces">,
): EncounterRuntimeGeneratedAssetAuditRef[] {
  const assets = [
    bundle.environment,
    ...bundle.actors.map((actor) => actor.model),
    ...bundle.actors.flatMap((actor) => actor.animationClips),
    ...bundle.actors.map((actor) => actor.phonemeMap).filter((asset): asset is EncounterRuntimeAsset => Boolean(asset)),
    ...bundle.equipment.map((equipment) => equipment.model),
    ...bundle.uiSurfaces.flatMap((surface) => [surface.schema, surface.data].filter((asset): asset is EncounterRuntimeAsset => Boolean(asset))),
  ];
  const dedupedByAssetId = new Map<string, EncounterRuntimeAsset>();
  for (const asset of assets) {
    dedupedByAssetId.set(asset.assetId, asset);
  }
  return Array.from(dedupedByAssetId.values()).map((asset) => ({
    assetId: asset.assetId,
    scenarioAssetId: asset.scenarioAssetId,
    kind: asset.kind,
    version: asset.version,
    reviewStatus: asset.reviewStatus,
    blobRef: {
      storeKind: asset.blob.storeKind,
      containerName: asset.blob.containerName,
      blobName: asset.blob.blobName,
      ...(asset.blob.contentHash ? { contentHash: asset.blob.contentHash } : {}),
    },
    provenanceRefs: [...asset.provenanceRefs],
  }));
}

function cloneEncounterRuntimeBundleAssemblyAuditMetadata(
  metadata: EncounterRuntimeBundleAssemblyAuditMetadata,
): EncounterRuntimeBundleAssemblyAuditMetadata {
  return {
    ...metadata,
    sourceDefinitionRefs: [...metadata.sourceDefinitionRefs],
    workOrderRefs: [...metadata.workOrderRefs],
    factoryRequestRefs: [...metadata.factoryRequestRefs],
    generatedAssetRefs: metadata.generatedAssetRefs.map((assetRef) => ({
      ...assetRef,
      blobRef: { ...assetRef.blobRef },
      provenanceRefs: [...assetRef.provenanceRefs],
    })),
    humanoidMetadataRefs: metadata.humanoidMetadataRefs.map((metadataRef) => ({
      ...metadataRef,
      animationClipAssetIds: [...metadataRef.animationClipAssetIds],
      metadataRefIds: [...metadataRef.metadataRefIds],
      requiredSignalIds: [...metadataRef.requiredSignalIds],
    })),
    remediationPlanRefs: metadata.remediationPlanRefs.map(cloneEncounterRuntimeRemediationPlanAuditRef),
    evidenceGateIds: [...metadata.evidenceGateIds],
    fallbackPosture: {
      ...metadata.fallbackPosture,
      fallbackAssetIds: [...metadata.fallbackPosture.fallbackAssetIds],
    },
    notEvidenceFor: [...metadata.notEvidenceFor],
  };
}

function cloneEncounterRuntimeRemediationPlanAuditRef(
  remediationPlanRef: EncounterRuntimeRemediationPlanAuditRef,
): EncounterRuntimeRemediationPlanAuditRef {
  return {
    ...remediationPlanRef,
    notEvidenceFor: [...remediationPlanRef.notEvidenceFor],
  };
}

export function evaluateEncounterRuntimeLearnerUseGate(
  bundle: { evidenceGateRefs?: EncounterRuntimeAssetBundle["evidenceGateRefs"] | undefined },
): EncounterRuntimeLearnerUseGate {
  const evidenceGateRefs = Array.isArray(bundle.evidenceGateRefs) ? bundle.evidenceGateRefs : [];
  const presentGateIds = new Set(evidenceGateRefs.map((gateRef) => gateRef.gateId));
  const missingRequiredGateIds = ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS.filter((gateId) => !presentGateIds.has(gateId));
  const pendingGateIds = uniqueRuntimeStrings([
    ...evidenceGateRefs
    .filter((gateRef) => gateRef.status !== "attached")
      .map((gateRef) => gateRef.gateId),
    ...missingRequiredGateIds,
  ]) as EncounterRuntimeEvidenceGateId[];
  const attachedGateIds = evidenceGateRefs
    .filter((gateRef) => gateRef.status === "attached")
    .map((gateRef) => gateRef.gateId);
  const blockers = Array.from(new Set([
    ...evidenceGateRefs.flatMap((gateRef) => gateRef.blockers),
    ...pendingGateIds.map((gateId) => `${gateId}_not_attached_to_encounter_bundle`),
  ]));

  return {
    canUseGeneratedBundleForLearnerRuntime: blockers.length === 0,
    blockers,
    pendingGateIds,
    attachedGateIds,
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function buildGuardedRuntimeSelectorDisabledDecision(
  input: BuildGuardedRuntimeSelectorDisabledDecisionInput,
): GuardedRuntimeSelectorDisabledDecision {
  const bundleIdMatches = (input.candidateBundles ?? [])
    .filter((bundle) => bundle.bundleId === input.selectedRuntimeAssetBundleId);
  const matchedBundle = bundleIdMatches.find((bundle) => (
    bundle.scenarioId === input.selectedScenarioId && bundle.stationId === input.selectedStationId
  ));
  const selectionStatus: GuardedRuntimeSelectorDisabledDecision["selectionStatus"] = matchedBundle
    ? "disabled_guard_not_runtime_execution"
    : bundleIdMatches.length > 0
      ? "blocked_intent_bundle_mismatch"
      : "blocked_intent_bundle_missing";
  const learnerUseGate = matchedBundle ? evaluateEncounterRuntimeLearnerUseGate(matchedBundle) : null;

  return {
    schemaVersion: "openclinxr.guarded-runtime-selector-disabled-decision.v1",
    selectionStatus,
    claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
    selectedScenarioId: input.selectedScenarioId,
    selectedStationId: input.selectedStationId,
    selectedRuntimeAssetBundleId: input.selectedRuntimeAssetBundleId,
    selectedBundleId: null,
    selectedBundleIdForFutureRuntime: matchedBundle?.bundleId ?? null,
    matchedBundleSummary: matchedBundle && learnerUseGate ? {
      bundleId: matchedBundle.bundleId,
      scenarioId: matchedBundle.scenarioId,
      stationId: matchedBundle.stationId,
      assetStoreKind: matchedBundle.assetStoreKind,
      pendingEvidenceGateIds: learnerUseGate.pendingGateIds,
      attachedEvidenceGateIds: learnerUseGate.attachedGateIds,
    } : null,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    providerExecutionPerformed: false,
    uiLaunchPerformed: false,
    questEvidenceRefreshed: false,
    blockers: uniqueRuntimeStrings([
      "runtime_selector_disabled_guard_not_wired",
      "provider_execution_disabled_by_policy",
      "learner_launch_disabled_until_evidence_gates_clear",
      ...(selectionStatus === "blocked_intent_bundle_missing" ? ["guarded_runtime_intent_bundle_missing"] : []),
      ...(selectionStatus === "blocked_intent_bundle_mismatch" ? ["guarded_runtime_intent_bundle_scenario_station_mismatch"] : []),
      ...(learnerUseGate?.blockers ?? []),
      ...(input.blockerIds ?? []),
    ]),
    nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function buildEncounterDynamicBehaviorCoverageSummary(
  input: BuildEncounterDynamicBehaviorCoverageSummaryInput,
): EncounterDynamicBehaviorCoverageSummary {
  const bundle = input.learnerRuntimeBundle;
  if (!bundle) {
    return {
      schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1",
      claimBoundary: "metadata_only_not_runtime_behavior_evidence",
      dialogueTurnCoverage: { actorRolesWithDialogueTurns: [], missingActorRoles: [], dialogueTurnCount: 0 },
      gazeTargetCoverage: { actorRolesWithGazeTargets: [], actorRolesWithActorTargetSupport: [], missingActorRoles: [] },
      actorRolePlacementCoverage: { actorRolesWithPlacements: [], missingActorRoles: [] },
      affectTimelineCoverage: { actorRolesWithAffectTimelines: [], missingActorRoles: [], affectTimelineCount: 0, claimBoundary: "metadata_only_not_runtime_facial_animation_evidence" },
      blockerIds: [`runtime_bundle_missing_for_behavior_coverage:${input.scenarioId ?? "unknown_scenario"}`],
      warningIds: [],
    };
  }

  const humanoidActors = bundle.actors.filter((actor) => actor.embodiment !== "virtual_device" && actor.embodiment !== "voice_only");
  const requiredRoles = uniqueRuntimeStrings([
    ...(input.requiredActorRoles ?? []),
    ...humanoidActors.map((actor) => actor.role),
  ]);
  const actorsById = new Map(humanoidActors.map((actor) => [actor.actorId, actor]));
  const actorRoleForId = (actorId: string): string | undefined => actorsById.get(actorId)?.role;
  const rolesWithDialogueTurns = uniqueRuntimeStrings(
    (bundle.sceneManifest.dialogueTurns ?? [])
      .map((turn) => actorRoleForId(turn.actorId))
      .filter((role): role is string => Boolean(role)),
  );
  const rolesWithGazeTargets = uniqueRuntimeStrings(
    humanoidActors
      .filter((actor) => actor.gazeProfile.defaultTarget.length > 0)
      .map((actor) => actor.role),
  );
  const rolesWithActorTargetSupport = uniqueRuntimeStrings(
    humanoidActors
      .filter((actor) => actor.gazeProfile.supportsActorTargets)
      .map((actor) => actor.role),
  );
  const rolesWithPlacements = uniqueRuntimeStrings(
    Object.keys(bundle.sceneManifest.actorPlacements ?? {})
      .map(actorRoleForId)
      .filter((role): role is string => Boolean(role)),
  );
  const affectTimelineTurns = (bundle.sceneManifest.dialogueTurns ?? [])
    .filter((turn) => turn.affectTimeline?.evidenceCueIds.includes("emotion_aligned_expression_transition_cue"));
  const rolesWithAffectTimelines = uniqueRuntimeStrings(
    affectTimelineTurns
      .map((turn) => actorRoleForId(turn.actorId))
      .filter((role): role is string => Boolean(role)),
  );
  const missingDialogueRoles = missingRuntimeStrings(requiredRoles, rolesWithDialogueTurns);
  const missingGazeRoles = missingRuntimeStrings(requiredRoles, rolesWithGazeTargets);
  const missingPlacementRoles = missingRuntimeStrings(requiredRoles, rolesWithPlacements);
  const missingAffectTimelineRoles = missingRuntimeStrings(requiredRoles, rolesWithAffectTimelines);

  return {
    schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1",
    claimBoundary: "metadata_only_not_runtime_behavior_evidence",
    dialogueTurnCoverage: {
      actorRolesWithDialogueTurns: rolesWithDialogueTurns,
      missingActorRoles: missingDialogueRoles,
      dialogueTurnCount: (bundle.sceneManifest.dialogueTurns ?? []).length,
    },
    gazeTargetCoverage: {
      actorRolesWithGazeTargets: rolesWithGazeTargets,
      actorRolesWithActorTargetSupport: rolesWithActorTargetSupport,
      missingActorRoles: missingGazeRoles,
    },
    actorRolePlacementCoverage: {
      actorRolesWithPlacements: rolesWithPlacements,
      missingActorRoles: missingPlacementRoles,
    },
    affectTimelineCoverage: {
      actorRolesWithAffectTimelines: rolesWithAffectTimelines,
      missingActorRoles: missingAffectTimelineRoles,
      affectTimelineCount: affectTimelineTurns.length,
      claimBoundary: "metadata_only_not_runtime_facial_animation_evidence",
    },
    blockerIds: [
      ...missingDialogueRoles.map((role) => `dialogue_turn_missing:${role}`),
      ...missingGazeRoles.map((role) => `gaze_target_missing:${role}`),
      ...missingPlacementRoles.map((role) => `actor_placement_missing:${role}`),
      ...missingAffectTimelineRoles.map((role) => `affect_timeline_missing:${role}`),
    ],
    warningIds: [],
  };
}

export function buildEncounterFactoryDryRunSummary(
  input: BuildEncounterFactoryDryRunSummaryInput & {
    dynamicBehaviorCoverage?: EncounterDynamicBehaviorCoverageSummary | undefined;
  },
): EncounterFactoryDryRunSummary {
  const dynamicBehaviorCoverage = input.dynamicBehaviorCoverage ?? buildEncounterDynamicBehaviorCoverageSummary({
    learnerRuntimeBundle: input.learnerRuntimeBundle,
    requiredActorRoles: input.requiredActorRoles ?? input.actorRoles,
    scenarioId: input.scenarioId,
  });
  const blockedPendingRuntimeBundle = input.blockedPendingRuntimeBundle ?? !input.learnerRuntimeBundle;
  const reviewAttached = input.reviewAttached ?? true;
  const actorRoles = uniqueRuntimeStrings([
    ...(input.actorRoles ?? []),
    ...(input.requiredActorRoles ?? []),
    ...(input.learnerRuntimeBundle?.actors
      .filter((actor) => actor.embodiment !== "virtual_device" && actor.embodiment !== "voice_only")
      .map((actor) => actor.role) ?? []),
  ]);
  const coverageWarningIds = [
    ...dynamicBehaviorCoverage.dialogueTurnCoverage.missingActorRoles.map((actorRole) => `dialogue_turn_missing:${actorRole}`),
    ...dynamicBehaviorCoverage.gazeTargetCoverage.missingActorRoles.map((actorRole) => `gaze_target_missing:${actorRole}`),
    ...dynamicBehaviorCoverage.actorRolePlacementCoverage.missingActorRoles.map((actorRole) => `actor_placement_missing:${actorRole}`),
    ...dynamicBehaviorCoverage.affectTimelineCoverage.missingActorRoles.map((actorRole) => `affect_timeline_missing:${actorRole}`),
  ];

  return {
    planId: `${input.requestId}:dry-run-plan:v1`,
    status: blockedPendingRuntimeBundle ? "blocked_pending_runtime_bundle" : "review_plan_created_not_asset_generation",
    sourceRequestId: input.requestId,
    sourceScenarioId: input.scenarioId,
    actorRoles,
    stageIds: [...(input.stageIds ?? defaultEncounterFactoryDryRunStageIds)],
    reviewGateIds: [...(input.reviewGateIds ?? defaultEncounterFactoryDryRunReviewGateIds)],
    blockerIds: uniqueRuntimeStrings([
      ...(blockedPendingRuntimeBundle ? [`runtime_bundle_missing_for_behavior_coverage:${input.scenarioId}`] : []),
      ...(!reviewAttached ? ["runtime_asset_review_decisions_missing"] : []),
      ...(input.blockerIds ?? []),
    ]),
    warningIds: uniqueRuntimeStrings([
      ...coverageWarningIds,
      ...(input.warningIds ?? []),
    ]),
    recommendedNextAction: blockedPendingRuntimeBundle
      ? "resolve_bundle_blockers_before_factory_plan_review"
      : reviewAttached
        ? "review_factory_plan_before_generation_or_publication"
        : "attach_runtime_asset_review_decisions",
    dynamicBehaviorCoverage,
    claimBoundary: "encounter_factory_dry_run_not_asset_generation",
    evidenceBoundaries: encounterFactoryDryRunEvidenceBoundaries(),
  };
}

export function buildEncounterFactoryInputPlanningSummary(input: {
  scenarioId: string;
  encounterFactoryInputSummary?: EncounterFactoryInputSummary | undefined;
}): EncounterFactoryInputPlanningSummary {
  const summary = input.encounterFactoryInputSummary;
  const actor = summary?.actorAssetWorkOrderCount ?? 0;
  const environment = summary?.environmentAssetWorkOrderCount ?? 0;
  const equipment = summary?.equipmentAssetWorkOrderCount ?? 0;
  const lookupKeys = uniqueRuntimeStrings(summary?.sharedAssetLookupKeys ?? []);
  const dynamicBehaviorTraceTags = uniqueRuntimeStrings(summary?.dynamicBehaviorTraceTags ?? []);
  const total = actor + environment + equipment;

  return {
    schemaVersion: "openclinxr.encounter-factory-input-planning-summary.v1",
    claimBoundary: "metadata_only_not_asset_generation",
    source: "scenario_definition_and_dialogue_seed_bank",
    scenarioId: input.scenarioId,
    assetWorkOrderIntent: {
      actor,
      environment,
      equipment,
      total,
    },
    sharedAssetLibraryReuse: {
      cacheDisposition: "lookup_before_generate",
      lookupKeyCount: lookupKeys.length,
      lookupKeys,
      requiresEvidenceGateCompatibility: true,
    },
    dynamicBehaviorTraceTags,
    ...(summary ? {
      factorySelectionMetadata: {
        scenarioBankOrder: summary.scenarioBankOrder ?? null,
        factorySelectionRole: summary.factorySelectionRole ?? "unspecified",
        factorySelectionMode: summary.factorySelectionMode ?? "unspecified",
        factorySelectionClaimBoundary: summary.factorySelectionClaimBoundary ?? "review_gated_factory_metadata_only",
      },
    } : {}),
    blockerIds: [
      ...(summary ? [] : ["encounter_factory_input_summary_missing"]),
      ...(total > 0 ? [] : ["encounter_factory_asset_work_order_intent_empty"]),
      ...(lookupKeys.length > 0 ? [] : ["shared_asset_lookup_keys_missing"]),
      ...(dynamicBehaviorTraceTags.length > 0 ? [] : ["dynamic_behavior_trace_tags_missing"]),
    ],
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function buildEncounterFactorySummaryContracts(
  input: BuildEncounterFactoryDryRunSummaryInput & {
    dynamicBehaviorCoverage?: EncounterDynamicBehaviorCoverageSummary | undefined;
  },
): EncounterFactorySummaryContracts {
  const dynamicBehaviorCoverage = input.dynamicBehaviorCoverage ?? buildEncounterDynamicBehaviorCoverageSummary({
    learnerRuntimeBundle: input.learnerRuntimeBundle,
    requiredActorRoles: input.requiredActorRoles ?? input.actorRoles,
    scenarioId: input.scenarioId,
  });

  return {
    dynamicBehaviorCoverage,
    ...(input.encounterFactoryInputSummary
      ? {
          inputPlanningSummary: buildEncounterFactoryInputPlanningSummary({
            scenarioId: input.scenarioId,
            encounterFactoryInputSummary: input.encounterFactoryInputSummary,
          }),
        }
      : {}),
    encounterFactoryDryRunSummary: buildEncounterFactoryDryRunSummary({
      ...input,
      dynamicBehaviorCoverage,
    }),
  };
}

export function buildEncounterRuntimeBundlePublicationMetadata(
  bundle: EncounterRuntimeAssetBundle | LearnerRuntimeAssetBundle,
  input?: {
    publicationReviewEvidenceRefs?: string[] | undefined;
    humanoidRealismProfiles?: Array<{
      actorRole?: string | undefined;
      requiredRealismEvidenceIds: string[];
      claimScope: "metadata_only_not_visual_quality_evidence";
    }> | undefined;
  },
): EncounterRuntimeBundlePublicationMetadata {
  const learnerUseGate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  const assetCount = [
    bundle.environment,
    ...bundle.actors.map((actor) => actor.model),
    ...bundle.actors.flatMap((actor) => actor.animationClips),
    ...bundle.equipment.map((equipment) => equipment.model),
    ...bundle.uiSurfaces.flatMap((surface) => [surface.schema, surface.data].filter((asset): asset is EncounterRuntimeAsset => Boolean(asset))),
  ].length;
  const publicationReviewEvidenceRefs = [...(input?.publicationReviewEvidenceRefs ?? [])];
  const publicationBlockers = [
    ...(publicationReviewEvidenceRefs.length > 0 ? [] : ["approved_runtime_asset_review_evidence_missing"]),
    ...(bundle.frozenForEncounter ? [] : ["runtime_bundle_not_frozen_for_encounter"]),
    ...(bundle.notEvidenceFor.includes("quest_readiness") ? [] : ["runtime_bundle_missing_quest_readiness_boundary"]),
  ];
  const humanoidRealismProfileSummary = input?.humanoidRealismProfiles ? {
    profileCount: input.humanoidRealismProfiles.length,
    actorRoles: Array.from(new Set(
      input.humanoidRealismProfiles
        .map((profile) => profile.actorRole?.trim())
        .filter((actorRole): actorRole is string => Boolean(actorRole)),
    )),
    requiredSignalIds: Array.from(new Set(
      input.humanoidRealismProfiles.flatMap((profile) => profile.requiredRealismEvidenceIds),
    )),
    claimScope: "metadata_only_not_visual_quality_evidence" as const,
  } : undefined;

  return {
    bundleId: bundle.bundleId,
    scenarioId: bundle.scenarioId,
    stationId: bundle.stationId,
    status: publicationBlockers.length === 0 ? "publication_prepared_not_learner_use" : "blocked",
    assetStoreKind: bundle.assetStoreKind,
    generatedAssetCount: assetCount,
    humanoidActorCount: bundle.actors.filter((actor) => actor.embodiment === "humanoid").length,
    equipmentCount: bundle.equipment.length,
    pendingEvidenceGateIds: learnerUseGate.pendingGateIds,
    attachedEvidenceGateIds: learnerUseGate.attachedGateIds,
    learnerRuntimeUseBlocked: true,
    learnerRuntimeUseBlockers: learnerUseGate.blockers,
    publicationReviewEvidenceRefs,
    blockers: publicationBlockers.length > 0 ? publicationBlockers : ["learner_runtime_use_requires_explicit_operator_gate_after_publication"],
    publicationArtifactRefs: {
      sceneManifest: `${bundle.bundleId}:scene-manifest.v1.json`,
      learnerRuntimeBundle: `${bundle.bundleId}:learner-runtime-bundle.v1.json`,
    },
    assemblyAuditMetadata: cloneEncounterRuntimeBundleAssemblyAuditMetadata(bundle.assemblyAuditMetadata),
    ...(humanoidRealismProfileSummary ? { humanoidRealismProfileSummary } : {}),
    claimBoundary: "local_publication_metadata_not_runtime_readiness",
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

function createGeneratedRuntimeSceneManifest(input: {
  scenarioId: string;
  stationId: string;
  actors: readonly EncounterRuntimeActorAsset[];
  equipment: readonly EncounterRuntimeEquipmentAsset[];
}): EncounterRuntimeSceneManifest {
  return {
    schemaVersion: "openclinxr.runtime-scene-manifest.v1",
    manifestId: `generated_runtime_scene_manifest:${safeRuntimeManifestKey(input.scenarioId)}:${safeRuntimeManifestKey(input.stationId)}`,
    source: "generated_scene_pipeline",
    scenarioId: input.scenarioId,
    stationId: input.stationId,
    stationContext: {
      title: `Runtime scene for ${input.stationId}`,
      subtitle: `Generated fallback manifest for ${input.scenarioId}; provide an explicit sceneManifest for case-authored clinical context.`,
      chiefConcern: "Not charted — obtain chief concern during the encounter",
      initialVitals: "Not charted — obtain vitals during the encounter",
      initialVitalsAuthorship: "unauthored",
      interruption: "Not charted — observe interruptions during the encounter",
      stageAriaLabel: `Runtime station scene for ${input.stationId}`,
      canvasAriaLabel: `3D runtime preview for ${input.stationId}`,
      initialDialogueText: "Explicit dialogue not provided for this generated fallback manifest.",
    },
    dialogueTurns: input.actors
      .filter((actor) => actor.embodiment !== "virtual_device")
      .map((actor) => ({
        traceTag: `generated_fallback_dialogue:${actor.actorId}`,
        actorId: actor.actorId,
        text: `${generatedActorLabel(actor)}: Explicit dialogue not provided for this generated fallback manifest.`,
        gazeTargetKind: "learner_camera" as const,
        gazeTargetActorId: null,
      })),
    actorPlacements: Object.fromEntries(
      input.actors
        .filter((actor) => actor.embodiment === "humanoid")
        .map((actor, index) => [
          actor.actorId,
          generatedActorPlacement(actor, index, { scenarioId: input.scenarioId }),
        ]),
    ),
    equipmentPlacements: buildRealizedEquipmentPlacements(
      input.equipment,
      (equipment, index) => generatedEquipmentPlacement(equipment, index),
    ),
    roomProps: [],
    productionReadinessClaimed: false,
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

export function createEdChestPainRuntimeSceneManifest(input: {
  scenarioId?: string | undefined;
  stationId?: string | undefined;
  scenario?: CaseScenarioSource | undefined;
  /** The room the case selected. Defaults to the ED bay, which is the ED case's own room. */
  environmentId?: string | undefined;
} = {}): EncounterRuntimeSceneManifest {
  // Placements follow the CASE's cast and its authored support surface. They used to be keyed by
  // ED literal ids with hardcoded postures, so a non-ED case matched no entry and every actor
  // resolved as standing — which routed the patient past the seated/supine composition entirely.
  const manifestScenarioId = input.scenarioId ?? "ed_chest_pain_priority_v1";
  const ids = resolveBundleCastActorIds(resolveScenarioActorCast(manifestScenarioId, input.scenario));
  const authored = authoredCasePlacements(manifestScenarioId, input.scenario);
  const posture = (actorId: string, fallback: AuthoredPosture): AuthoredPosture =>
    authored[actorId] ? postureForSupportSurface(authored[actorId]?.supportSurface) : fallback;
  // SC-03: the case's own room, support and plant offset ride the manifest (case-intent-placements.ts).
  // The room resolves through the SAME document lookup the placements use, so an injected case and the bank copy of that case agree; reading `input.scenario` alone made injection carry the room while the bank fallback did not, and SC-01's "injecting a resolved case changes nothing" counterweight caught it.
  const caseDocument = caseScenarioDocument(manifestScenarioId, input.scenario);
  const environmentId = input.environmentId ?? caseDocument?.environment?.environmentId ?? caseDocument?.environmentId ?? "ed_exam_bay_v1";
  const stationTitle = caseDocument?.title ?? "ED Chest Pain";
  const stationSubtitle = caseDocument?.environment?.description
    ?? "Patient, spouse, and nurse in a time-boxed emergency department encounter.";
  const stationEnvironmentName = caseDocument?.environment?.name ?? "Emergency department";
  return {
    schemaVersion: "openclinxr.runtime-scene-manifest.v1",
    manifestId: "ed_chest_pain_runtime_scene_manifest_v1",
    source: "generated_scene_pipeline",
    scenarioId: input.scenarioId ?? "ed_chest_pain_priority_v1",
    stationId: input.stationId ?? "ed_chest_pain_station_v1", environmentId,
    stationContext: {
      title: stationTitle,
      subtitle: stationSubtitle,
      chiefConcern: "It feels heavy, like someone is sitting on my chest.",
      initialVitals: "BP 152/92, HR 104, RR 20, SpO2 96%",
      initialVitalsAuthorship: "legacy_hardcoded_unreviewed",
      interruption: "Not charted — observe interruptions during the encounter",
      stageAriaLabel: `${stationEnvironmentName} station scene`,
      canvasAriaLabel: `3D ${stationEnvironmentName} preview`,
      initialDialogueText: "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
    },
    dialogueTurns: [
      { traceTag: "history_opqrst", actorId: "patient_robert_hayes_v1", text: "Robert Hayes: It started about half an hour ago while I was walking upstairs.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: runtimeDialogueAffectTimeline("pain", 0.82) },
      { traceTag: "vitals_review", actorId: "nurse_maria_alvarez_v1", text: "Nurse Alvarez: His pressure is dropping and he looks more diaphoretic.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: runtimeDialogueAffectTimeline("concerned", 0.58) },
      { traceTag: "ecg_request", actorId: "nurse_maria_alvarez_v1", text: "Nurse Alvarez: I will get the ECG now and call it out as soon as it prints.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: runtimeDialogueAffectTimeline("concerned", 0.5) },
      { traceTag: "urgent_escalation", actorId: "spouse_anna_hayes_v1", text: "Spouse: Are you saying this could be his heart?", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: runtimeDialogueAffectTimeline("anxious", 0.68) },
      { traceTag: "team_communication", actorId: "nurse_maria_alvarez_v1", text: "Nurse Alvarez: Clear plan. ECG, IV access, and senior physician notified.", gazeTargetKind: "actor", gazeTargetActorId: "nurse_maria_alvarez_v1", affectTimeline: runtimeDialogueAffectTimeline("reassured", 0.32) },
      { traceTag: "patient_note_submitted", actorId: "patient_robert_hayes_v1", text: "System: Patient note saved for faculty review.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: runtimeDialogueAffectTimeline("neutral", 0.2) },
    ],
    actorPlacements: placementsWithPersistedCaseIntent({
      [ids.patientActorId]: { slotKind: "primary_patient", position: { x: -0.9, y: 0, z: -0.1 }, scale: { x: 1.06, y: 1.06, z: 1.06 }, verticalOffsetMeters: 0, labelPrefix: "Patient", posture: posture(ids.patientActorId, "supine") }, /* #150 supine on stretcher */
      // Unmoved (reverted 2026-09-26, room-obstacles): a prior round moved this shared literal to
      // (1.7, 0.7) to dodge a curtain/strip conflict discovered for the ED case specifically, but
      // this literal also stages any OTHER case whose clinical-team actor authors no override --
      // the closure nurse is unaffected only because her own case document already overrides it.
      // ED's real conflict is fixed at the actor level instead (see `nurse_maria_alvarez_v1`'s own
      // `placement` in ed-chest-pain-mod.ts, which now overrides this literal for her specifically),
      // so this shared value stays at its original position rather than drifting per-case.
      [ids.clinicalActorId]: { slotKind: "clinical_team", position: { x: 1.78, y: 0.95, z: 0.42 }, scale: { x: 0.98, y: 0.98, z: 0.98 }, verticalOffsetMeters: -0.95, labelPrefix: "Team", posture: posture(ids.clinicalActorId, "standing"), headingRadians: -0.26 },
      [ids.familyActorId]: { slotKind: "family_or_observer", position: { x: -2.05, y: 0.93, z: 0.36 }, scale: { x: 0.94, y: 0.94, z: 0.94 }, verticalOffsetMeters: -0.95, labelPrefix: "Family", posture: posture(ids.familyActorId, "standing") },
      // The fourth slot stands at a BEDSIDE TARGET computed from the patient's own position and
      // faces her, rather than at a room constant. Every other heading in this scene is a
      // hardcoded literal; this one moves when the case moves the patient.
      ...(ids.additionalActorId
        ? { [ids.additionalActorId]: bedsideClinicianPlacement(posture(ids.additionalActorId, "standing")) }
        : {}),
    }, { environmentId, authored }),
    equipmentPlacements: caseRealGlbEquipmentPlacements(input.scenario),
    roomProps: roomPropsForEnvironment(environmentId),
    // `locomotionOrders` (main.ts reads this list and forwards it -- it does not decide which
    // actor walks where) is not authored on any shipped case yet: the order-driven walker can
    // walk through an unmapped fixture (measured on scene_closure's nurse -- she cut through the
    // white shelving unit on her ordered route; the coming grid-A*-routed executor is what fixes
    // that). No case authors an entry here until the routed executor lands; the capability, the
    // idle-sway skip and the settling-turn fix stay live and are proved by
    // order-driven-walker-video-capture.ts's own capture-only injection flag instead.
    productionReadinessClaimed: false,
    notEvidenceFor: [...LOCAL_RUNTIME_NOT_EVIDENCE_FOR],
  };
}

function runtimeDialogueAffectTimeline(
  emotion: NonNullable<EncounterRuntimeDialogueTurn["affectTimeline"]>["emotion"],
  intensity: number,
): NonNullable<EncounterRuntimeDialogueTurn["affectTimeline"]> {
  return {
    emotion,
    intensity,
    onsetMs: 120,
    transitionMs: emotion === "pain" || emotion === "anxious" ? 650 : 950,
    decayMs: 900,
    evidenceCueIds: [
      "emotion_aligned_expression_transition_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "dialogue_viseme_and_gaze_mapping",
    ],
    notEvidenceFor: ["clinical_validity", "scoring_validity", "production_asset_readiness"],
  };
}

// Moved to runtime-bundle-asset-urls.ts (2026-09-26) to make room without cramming; re-exported
// here (and imported below for this file's own callers) so runtime-bundles-entry.ts's public
// subpath is unaffected.
export {
  resolveRuntimeAssetBlobUrl,
  resolveRuntimeAssetStoreConfig,
  resolveRuntimeAssetUrl,
} from "./runtime-bundle-asset-urls.js";

const defaultEncounterFactoryDryRunStageIds = [
  "scenario_definition_to_asset_requirements",
  "humanoid_roles_to_realism_profiles",
  "runtime_bundle_binding_plan",
  "publication_and_evidence_gate_plan",
] as const;

const defaultEncounterFactoryDryRunReviewGateIds = [
  "scenario_configuration_review",
  "humanoid_profile_review",
  "dialogue_viseme_gaze_review",
  "runtime_asset_review",
  "learner_runtime_boundary_review",
  "asset_pipeline",
  "clinical_simulation",
  "xr_performance",
  "security_privacy",
] as const;

function encounterFactoryDryRunEvidenceBoundaries(): EncounterFactoryDryRunSummary["evidenceBoundaries"] {
  return {
    metadataOnlyPlan: true,
    generatedAssetsMaterialized: false,
    runtimeBundlePublished: false,
    learnerRuntimeEnabled: false,
    questReadinessClaimed: false,
    productionReadinessClaimed: false,
  };
}
