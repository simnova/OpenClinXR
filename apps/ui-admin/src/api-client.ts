import type { ApolloClient } from "@apollo/client";
import type {
  EncounterDynamicBehaviorCoverageSummary,
  EncounterFactoryDryRunSummary,
  EncounterFactoryInputPlanningSummary,
  EnvironmentGenerationQueue,
  EnvironmentGenerationWorkOrderQueue,
  ScenarioAssetReadiness,
  ScenarioSceneGenerationPipelineWorkOrderQueue,
} from "@openclinxr/asset-registry";
import type { BlueprintScenarioReadiness, ExamBlueprint, ExamStationRunQueue, ExamTimingPlan } from "@openclinxr/exam-assembly";
import {
  CreateStationRunQueueSnapshotDocument,
  type CreateStationRunQueueSnapshotMutation,
  type CreateStationRunQueueSnapshotMutationVariables,
  ReviewPacketReplayDocument,
  type ReviewPacketReplayQuery,
  type ReviewPacketReplayQueryVariables,
  SaveFacultyScoreDraftDocument,
  type SaveFacultyScoreDraftMutation,
  type SaveFacultyScoreDraftMutationVariables,
  ScenarioBankDocument,
  type ScenarioBankQuery,
  type ScenarioBankQueryVariables,
  ScenarioDetailDocument,
  type ScenarioDetailQuery,
  type ScenarioDetailQueryVariables,
  ScenarioReviewDecisionsDocument,
  type ScenarioReviewDecisionsQuery,
  type ScenarioReviewDecisionsQueryVariables,
  type ScenarioStatus,
  StationRunQueueSnapshotsDocument,
  type StationRunQueueSnapshotsQuery,
  type StationRunQueueSnapshotsQueryVariables,
  SubmitScenarioReviewDocument,
  type SubmitScenarioReviewMutation,
  type SubmitScenarioReviewMutationVariables,
} from "@openclinxr/graphql/client";
import { buildSessionRoutePath, routeById } from "@openclinxr/rest";
import { print } from "graphql";

export type AdminApolloGraphqlClient = Pick<ApolloClient, "mutate" | "query">;

export type AdminNoReadinessEvidenceClaim =
  | "provider_availability"
  | "runtime_readiness"
  | "production_asset_readiness"
  | "quest_readiness"
  | "clinical_validity"
  | "scoring_validity"
  | "learner_launch_readiness";

export type {
  BlueprintScenarioReadiness,
  EnvironmentGenerationQueue,
  EnvironmentGenerationWorkOrderQueue,
  ExamBlueprint,
  ExamStationRunQueue,
  ExamTimingPlan,
  ScenarioAssetReadiness,
  ScenarioSceneGenerationPipelineWorkOrderQueue,
};

export type AdminControlPlaneClientOptions = {
  apolloClient?: AdminApolloGraphqlClient;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type AdminControlPlaneClient = {
  getStep2CsSeedBlueprint(): Promise<ExamBlueprint>;
  getStep2CsSeedBlueprintReadiness(): Promise<BlueprintScenarioReadiness>;
  getStep2CsSeedTimingPlan(): Promise<ExamTimingPlan>;
  getStep2CsSeedStationRunQueue(): Promise<ExamStationRunQueue>;
  getRuntimeProviderReadiness(): Promise<AdminRuntimeProviderReadiness>;
  getRuntimeSelectionReviewPacket(): Promise<AdminRuntimeSelectionReviewPacket>;
  getRuntimeProtocolPosture(): Promise<AdminRuntimeProtocolPosture>;
  getRealtimeVoicePosture(): Promise<AdminRealtimeVoicePosture>;
  createLocalReviewReplaySeed(input?: CreateLocalReviewReplaySeedInput): Promise<CreateLocalReviewReplaySeedResult>;
  listScenarios(input?: ListScenariosInput): Promise<AdminScenario[]>;
  getScenarioDetail(input: GetScenarioDetailInput): Promise<AdminScenarioDetail>;
  listScenarioReviewDecisions(input: ListScenarioReviewDecisionsInput): Promise<AdminScenarioReviewDecision[]>;
  getReviewPacketReplay(input: GetReviewPacketReplayInput): Promise<AdminReviewPacketReplay>;
  getReviewReplayReadinessSummary(input: GetReviewPacketReplayInput): Promise<AdminReviewReplayReadinessSummary>;
  submitScenarioReview(input: SubmitScenarioReviewInput): Promise<AdminScenarioReviewResult>;
  saveFacultyScoreDraft(input: SaveFacultyScoreDraftInput): Promise<AdminReviewPacket>;
  listStep2CsSeedStationRunQueueSnapshots(): Promise<AdminStationRunQueueSnapshot[]>;
  createStep2CsSeedStationRunQueueSnapshot(input: CreateStationRunQueueSnapshotInput): Promise<AdminStationRunQueueSnapshot>;
  getEdChestPainPublicationReadiness(input: GetScenarioPublicationReadinessInput): Promise<AdminScenarioPublicationReadiness>;
  getScenarioBankMaturity(): Promise<AdminScenarioBankMaturityReport>;
  getScenarioBankExamSequence(): Promise<AdminScenarioBankExamSequenceProjection>;
  getDynamicEncounterFactoryPlanning(): Promise<AdminDynamicEncounterFactoryPlanningProjection>;
  getScenarioBankAssetReadiness(): Promise<ScenarioAssetReadiness[]>;
  getScenarioBankEnvironmentGenerationQueue(): Promise<EnvironmentGenerationQueue>;
  getScenarioBankEnvironmentWorkOrderQueue(): Promise<EnvironmentGenerationWorkOrderQueue>;
  getScenarioBankSceneGenerationPipelineQueue(): Promise<ScenarioSceneGenerationPipelineWorkOrderQueue>;
  listScenarioSceneGenerationRequests(): Promise<ScenarioSceneGenerationRequestQueue>;
  createScenarioSceneGenerationRequest(input: CreateScenarioSceneGenerationRequestInput): Promise<CreateScenarioSceneGenerationRequestResult>;
  submitScenarioSceneGenerationRequestReview(input: SubmitScenarioSceneGenerationRequestReviewInput): Promise<CreateScenarioSceneGenerationRequestResult>;
  submitScenarioSceneGenerationMaterializationInputReview(input: SubmitScenarioSceneGenerationMaterializationInputReviewInput): Promise<EncounterMaterializationInputReviewDecisionRecord>;
  submitRuntimeRealismEvidenceInputReview(input: SubmitRuntimeRealismEvidenceInputReviewInput): Promise<RuntimeRealismEvidenceInputReviewDecisionRecord>;
  submitRuntimeVisualEvidenceAttachment(input: SubmitRuntimeVisualEvidenceAttachmentInput): Promise<RuntimeVisualEvidenceAttachmentRecord>;
  getScenarioSceneGenerationRequestPublicationReadiness(input: { requestId: string }): Promise<ScenarioSceneGenerationRequestPublicationReadiness>;
};

export type ListScenariosInput = {
  status?: ScenarioStatus;
};

export type GetScenarioDetailInput = {
  scenarioId: string;
  version: number;
};

export type ListScenarioReviewDecisionsInput = {
  scenarioId: string;
  version: number;
};

export type GetReviewPacketReplayInput = {
  stationRunId: string;
};

export type CreateLocalReviewReplaySeedInput = {
  learnerId?: string;
};

export type CreateLocalReviewReplaySeedResult = {
  stationRunId: string;
};

export type CreateStationRunQueueSnapshotInput = {
  snapshotId?: string;
  createdAt?: string;
  reviewerId?: string;
};

export type GetScenarioPublicationReadinessInput = {
  targetUse: "local_formative" | "pilot_research" | "summative";
  reviewerEvidence: Array<{
    reviewerRole: string;
    reviewerId: string;
    decision: "approved" | "changes_requested";
    comments: string;
    evidenceRefs: string[];
    reviewedAt: string;
  }>;
};

export type AdminScenarioPublicationReadiness = {
  scenarioId: string;
  targetUse: GetScenarioPublicationReadinessInput["targetUse"];
  releaseLabel: string;
  canPublishForLearnerUse: boolean;
  requiredReviewerRoles: string[];
  missingReviewerRoles: string[];
  gateResults: Array<{ gate: string; status: "pass" | "warn" | "block"; details: string[] }>;
  blockerVisibility: {
    claimBoundary: "publication_blocker_visibility_not_readiness_claim";
    humanReviewRequired: boolean;
    blockerIds: string[];
    warningIds: string[];
    recommendedNextAction: string;
  };
};

export type AdminDynamicEncounterFactoryPlanningProjection = {
  source: "scenario_bank_dynamic_encounter_factory_planning";
  claimBoundary: "review_gated_factory_metadata_only";
  anchorScenarioId: string;
  nextFactoryPlanningScenarioId: string | null;
  nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant" | "next_scenario_fallback" | "anchor_not_found";
  learnerUseBoundary: "activation_ready_only";
  scenarios: Array<{
    scenarioId: string;
    title: string;
    factoryPlanningOrder: number;
    encounterFactoryInputSummary: {
      factorySelectionClaimBoundary: "review_gated_factory_metadata_only";
      actorAssetWorkOrderCount: number;
      environmentAssetWorkOrderCount: number;
      equipmentAssetWorkOrderCount: number;
      sharedAssetLookupKeys: string[];
      dynamicBehaviorTraceTags: string[];
    };
    humanoidPerformanceContract?: {
      claimBoundary: "case_definition_humanoid_performance_metadata_only";
      actorCount: number;
      locomotionActorRoles: string[];
      expressionActorRoles: string[];
      gazeActorRoles: string[];
      lipSyncActorRoles: string[];
      interactiveActorRoles: string[];
      emotionStateCount: number;
      dialogueDrivenVisemeMappingRequired: boolean;
      gazeTargetingRequired: boolean;
      locomotionPlanningRequired: boolean;
      notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity">;
    };
  } & Record<string, unknown>>;
  routeContractBoundary?: {
    posture: "read_only_review_packet";
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
  };
};

export type CreateScenarioSceneGenerationRequestInput = {
  scenarioId: string;
};

export type CreateScenarioSceneGenerationRequestResult = {
  requestId: string;
  scenarioId: string;
  createdAt: string;
  status: "accepted";
  reviewStatus: "pending_runtime_asset_review" | "runtime_asset_review_attached";
  nextAction: "attach_runtime_asset_review_decisions" | "run_generated_bundle_publisher";
  runtimeAssetReviewDecisionCount: number;
  scenarioReviewGate?: ScenarioReviewGateSummary;
  humanReviewActions?: HumanReviewActionSummary[];
  accepted: boolean;
  productionAssetReadinessClaimed: false;
  claimBoundary: "scene_generation_request_not_asset_production";
  factoryPlanningContext?: {
    scenarioId: string;
    workOrderId: string;
    isFeaturedFactoryPlanningTarget: boolean;
    factoryPlanningClaimBoundary: "review_gated_factory_metadata_only";
    generationApprovalInferred: false;
  };
  workOrder: ScenarioSceneGenerationPipelineWorkOrderQueue["workOrders"][number];
};

export type ScenarioReviewApprovalBoundary =
  | "approved_scenario_factory_planning_only"
  | "draft_no_learner_use_without_human_approval"
  | "scenario_status_preserved_no_generation_approval_inferred";

export type ScenarioReviewGateSummary = {
  scenarioStatus: string;
  approvalBoundary: ScenarioReviewApprovalBoundary;
  learnerUseBlocked: boolean;
  blockerIds: string[];
  claimBoundary: "scenario_status_gate_not_clinical_or_production_readiness";
};

export type HumanReviewActionSummary = {
  actionId:
    | "attach_runtime_asset_review_decisions"
    | "review_humanoid_realism_metadata"
    | "review_runtime_bundle_assembly_audit"
    | "resolve_scenario_approval_boundary";
  status: "available" | "blocked" | "complete";
  label: string;
  blockerIds: string[];
  evidenceRefs: string[];
  claimBoundary: "human_review_action_not_automated_approval";
};

export type SubmitScenarioSceneGenerationRequestReviewInput = {
  requestId: string;
  decisions: Array<{
    assetId: string;
    reviewerRole: "asset_pipeline" | "clinical_simulation" | "xr_performance" | "security_privacy";
    reviewerId: string;
    decision: "approved_for_local_runtime" | "changes_requested";
    comments: string;
    evidenceRefs: string[];
    reviewedAt: string;
  }>;
};

export type SubmitScenarioSceneGenerationMaterializationInputReviewInput = {
  requestId: string;
  decisions: EncounterMaterializationInputReviewDecision[];
};

export type ScenarioSceneGenerationRequestQueue = {
  requestCount: number;
  claimBoundary: "scene_generation_request_queue_not_asset_production";
  requests: CreateScenarioSceneGenerationRequestResult[];
};

export type EncounterMaterializationInputManifestSummary = {
  schemaVersion: "openclinxr.encounter-materialization-input-manifest-summary.v1";
  source: "encounter_materialization_input_manifest";
  scenarioId: string | null;
  actorWorkOrderInputCount: number;
  equipmentWorkOrderInputCount: number;
  requiredActorCueIds: string[];
  requiredEquipmentCueIds: string[];
  blockerIds: string[];
  providerExecutionPerformed: false;
  paidApisUsed: false;
  externalNetworkUsed: false;
  claimBoundary: "metadata_only_provider_neutral_materialization_inputs";
};

export type EncounterMaterializationAttachmentPlanSummary = {
  schemaVersion: "openclinxr.encounter-materialization-attachment-plan-summary.v1";
  source: "encounter_materialization_attachment_plan";
  scenarioId: string | null;
  actorAttachmentSlotCount: number;
  equipmentAttachmentSlotCount: number;
  missingAttachmentCount: number;
  actorRequiredCueIds: string[];
  equipmentRequiredCueIds: string[];
  blockerIds: string[];
  providerExecutionPerformed: false;
  runtimeSelectionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  claimBoundary: "metadata_only_materialization_attachment_plan";
};

export type EncounterMaterializationEvidenceAttachmentSummary = {
  schemaVersion: "openclinxr.encounter-materialization-evidence-attachment-summary.v1";
  source: "encounter_materialization_evidence_attachments";
  scenarioId: string | null;
  totalRequiredSlotCount: number;
  attachedSlotCount: number;
  missingSlotCount: number;
  heldOrInvalidAttachmentCount: number;
  allRequiredSlotsSatisfied: boolean;
  blockerIds: string[];
  providerExecutionPerformed: false;
  runtimeSelectionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  claimBoundary: "metadata_only_materialization_evidence_attachment_summary";
};

export type EncounterMaterializationInputReviewActionPacket = {
  schemaVersion: "openclinxr.encounter-materialization-input-review-action-packet.v1";
  source: "materialization_input_manifest_summary";
  scenarioId: string | null;
  actionMode: "metadata_only_review_actions_not_provider_execution";
  availableActions: Array<{
    actionId:
      | "review_actor_materialization_inputs"
      | "hold_actor_materialization_inputs"
      | "review_equipment_materialization_inputs"
      | "hold_equipment_materialization_inputs";
    status: "available";
    inputCount: number;
    blockerCount: number;
    requiredCueIds: string[];
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    claimBoundary: "materialization_input_review_action_not_provider_execution";
  }>;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  claimBoundary: "metadata_only_materialization_input_review_actions";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type EncounterMaterializationInputReviewDecision = {
  actionId:
    | "review_actor_materialization_inputs"
    | "hold_actor_materialization_inputs"
    | "review_equipment_materialization_inputs"
    | "hold_equipment_materialization_inputs";
  reviewerId: string;
  decision: "reviewed_metadata_only" | "held_metadata_only";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

export type EncounterMaterializationInputReviewDecisionRecord = {
  schemaVersion: "openclinxr.encounter-materialization-input-review-decision-record.v1";
  source: "admin_materialization_input_review_decisions";
  requestId: string;
  scenarioId: string;
  decisionCount: number;
  reviewedDecisionCount: number;
  heldDecisionCount: number;
  decisions: EncounterMaterializationInputReviewDecision[];
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  claimBoundary: "metadata_only_materialization_input_review_decisions";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type RuntimeRealismEvidenceInputReviewDecision = {
  inputId: string;
  inputKind: "runtime_realism_signal_input" | "visual_qa_review_input";
  reviewerId: string;
  decision: "reviewed_metadata_only" | "held_metadata_only";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

export type SubmitRuntimeRealismEvidenceInputReviewInput = {
  scenarioId?: string;
  decisions: RuntimeRealismEvidenceInputReviewDecision[];
};

export type RuntimeRealismEvidenceInputReviewDecisionRecord = {
  schemaVersion: "openclinxr.runtime-realism-evidence-input-review-decision-record.v1";
  source: "admin_runtime_realism_evidence_input_review_decisions";
  scenarioId: string;
  decisionCount: number;
  reviewedDecisionCount: number;
  heldDecisionCount: number;
  decisions: RuntimeRealismEvidenceInputReviewDecision[];
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "metadata_only_runtime_realism_evidence_input_review_decisions";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type RuntimeVisualEvidenceAttachmentSummary = {
  schemaVersion: "openclinxr.runtime-realism-evidence-attachment-summary.v1";
  source: "runtime_realism_evidence_input_review_decisions";
  scenarioId: string;
  runtimeActorEvidenceInputCount: number;
  visualQaEvidenceInputCount: number;
  reviewedMetadataOnlyCount: number;
  heldMetadataOnlyCount: number;
  attachedRuntimeEvidenceCount: number;
  attachedVisualQaEvidenceCount: number;
  reviewedMetadataOnlyInputIds: string[];
  heldMetadataOnlyInputIds: string[];
  blockerIds: string[];
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "runtime_visual_evidence_attachment_summary_metadata_only_until_artifacts_attach";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type RuntimeVisualEvidenceAttachment = {
  actionId: "attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs";
  inputId: string;
  inputKind: "runtime_realism_signal_input" | "visual_qa_review_input";
  evidenceRef: string;
  localArtifactPath: string;
  reviewerId: string;
  attachmentStatus: "attached_metadata_only" | "held_metadata_only";
  comments: string;
  attachedAt: string;
};

export type SubmitRuntimeVisualEvidenceAttachmentInput = {
  scenarioId?: string;
  attachments: RuntimeVisualEvidenceAttachment[];
};

export type RuntimeVisualEvidenceAttachmentRecord = {
  schemaVersion: "openclinxr.runtime-visual-evidence-attachment-record.v1";
  source: "admin_runtime_visual_evidence_attachment_refs";
  scenarioId: string;
  attachmentCount: number;
  runtimeEvidenceAttachmentCount: number;
  visualQaEvidenceAttachmentCount: number;
  attachments: RuntimeVisualEvidenceAttachment[];
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type RuntimeVisualEvidenceAttachmentActionPacket = {
  schemaVersion: "openclinxr.runtime-visual-evidence-attachment-action-packet.v1";
  source: "runtime_visual_evidence_attachment_summary";
  scenarioId: string;
  actionMode: "metadata_only_attachment_actions_not_runtime_execution";
  availableActions: Array<{
    actionId: "attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs";
    status: "available";
    requiredInputCount: number;
    reviewedMetadataOnlyCount: number;
    heldMetadataOnlyCount: number;
    attachedEvidenceCount: number;
    blockerIds: string[];
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    claimBoundary: "runtime_visual_evidence_attachment_action_not_runtime_execution";
  }>;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "metadata_only_runtime_visual_evidence_attachment_actions";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type RuntimeEvidenceCaptureScaffold = {
  schemaVersion: "openclinxr.encounter-runtime-evidence-capture-scaffold.v1";
  source: "encounter_runtime_realism_evidence_input_draft";
  selectedScenarioId: string;
  status: "metadata_only_attachment_candidates_not_submitted";
  runtimeEvidenceCandidateCount: number;
  visualQaEvidenceCandidateCount: number;
  attachmentCandidates: Array<RuntimeVisualEvidenceAttachment & {
    sourceEvidenceRef: string;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    claimBoundary: "metadata_only_runtime_evidence_capture_candidate_not_submitted";
    notEvidenceFor: AdminNoReadinessEvidenceClaim[];
  }>;
  submitRuntimeVisualEvidenceAttachmentInput: SubmitRuntimeVisualEvidenceAttachmentInput & { scenarioId: string };
  gateBoundary: {
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    claimBoundary: "runtime_evidence_capture_scaffold_does_not_clear_launch_gates";
  };
  claimBoundary: "metadata_only_runtime_evidence_capture_scaffold_not_runtime_or_visual_evidence";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

type LegacyScenarioSceneGenerationDynamicBehaviorCoverageProjection = {
  dialogueActorRoles: string[];
  missingDialogueActorRoles: string[];
  gazeActorRoles: string[];
  missingGazeActorRoles: string[];
  placementActorRoles: string[];
  missingPlacementActorRoles: string[];
  affectActorRoles?: string[];
  missingAffectActorRoles?: string[];
  affectTimelineCount?: number;
  affectClaimBoundary?: "metadata_only_not_runtime_facial_animation_evidence";
  blockerIds: string[];
  warningIds: string[];
};

export type ScenarioSceneGenerationRequestPublicationReadiness = {
  requestId: string;
  scenarioId: string;
  canRunGeneratedBundlePublisher: boolean;
  canUseGeneratedBundleForLearnerRuntime?: boolean;
  blockers: string[];
  learnerRuntimeUseBlockers?: string[];
  nextAction: "attach_runtime_asset_review_decisions" | "run_generated_bundle_publisher";
  scenarioReviewGate?: ScenarioReviewGateSummary;
  runtimeBundleGateRefs?: Array<{
    gateId: "runtime_bundle_assembly_audit" | "human_runtime_asset_review" | "scenario_approval_boundary";
    status: "pending" | "attached" | "blocked";
    refId: string;
    blockerIds: string[];
    claimBoundary: "runtime_bundle_gate_ref_not_published_runtime";
  }>;
  humanoidMetadataBlockerIds?: string[];
  humanReviewActions?: HumanReviewActionSummary[];
  evidenceGateRefs?: Array<{
    gateId: "runtime_realism_evidence" | "visual_qa_evidence" | "quest_runtime_evidence" | "asset_production_review";
    status: "pending" | "attached" | "blocked";
    evidenceRefs: string[];
    requiredSignalIds: string[];
    blockers: string[];
    notEvidenceFor: AdminNoReadinessEvidenceClaim[];
  }>;
  publicationMetadata?: {
    bundleId: string;
    status: "publication_prepared_not_learner_use" | "blocked";
    assetStoreKind: string;
    generatedAssetCount: number;
    humanoidActorCount: number;
    equipmentCount: number;
    learnerRuntimeUseBlocked: true;
    publicationReviewEvidenceRefs?: string[];
    humanoidRealismProfileSummary?: {
      profileCount: number;
      actorRoles: string[];
      requiredSignalIds: string[];
      claimScope: "metadata_only_not_visual_quality_evidence";
    };
    assemblyAuditMetadata?: {
      claimBoundary: "asset_reference_audit_metadata_not_materialized_assets";
      sourceDefinitionRefs: string[];
      humanoidMetadataRefs: Array<{
        actorId: string;
        actorRole: string;
        claimScope: "metadata_only_not_visual_quality_evidence";
      }>;
      fallbackPosture: {
        learnerUseBlockedUntilEvidenceGatesAttach: boolean;
      };
    };
    claimBoundary: "local_publication_metadata_not_runtime_readiness";
    notEvidenceFor: AdminNoReadinessEvidenceClaim[];
  };
  dynamicBehaviorCoverage?: (EncounterDynamicBehaviorCoverageSummary & LegacyScenarioSceneGenerationDynamicBehaviorCoverageProjection);
  encounterFactoryDryRunSummary?: EncounterFactoryDryRunSummary;
  inputPlanningSummary?: EncounterFactoryInputPlanningSummary;
  materializationInputManifestSummary?: EncounterMaterializationInputManifestSummary;
  materializationEvidenceAttachmentSummary?: EncounterMaterializationEvidenceAttachmentSummary;
  materializationInputReviewActionPacket?: EncounterMaterializationInputReviewActionPacket;
  materializationInputReviewDecisionRecord?: EncounterMaterializationInputReviewDecisionRecord;
  runtimeRealismEvidenceInputReviewDecisionRecord?: RuntimeRealismEvidenceInputReviewDecisionRecord;
  runtimeVisualEvidenceAttachmentSummary?: RuntimeVisualEvidenceAttachmentSummary;
  runtimeVisualEvidenceAttachmentActionPacket?: RuntimeVisualEvidenceAttachmentActionPacket;
  runtimeVisualEvidenceAttachmentRecord?: RuntimeVisualEvidenceAttachmentRecord;
  assetReleaseLadderReplayProjection?: AdminAssetReleaseLadderReplayProjection;
  runtimeEvidenceCaptureScaffold?: RuntimeEvidenceCaptureScaffold;
  claimBoundary: "publication_readiness_not_learner_bundle_persistence";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type AdminRuntimeProviderPlaneReadiness = {
  readyCapabilityIds: string[];
  notConfiguredCapabilityIds: string[];
  plannedCapabilityIds: string[];
  blockedCapabilityIds: string[];
};

export type AdminRuntimeProviderReadinessSurface = {
  profile: string;
  providerProfile?: string;
  deterministicReplayReady: boolean;
  liveInteractiveProviderReady: boolean;
  interactiveRuntime: AdminRuntimeProviderPlaneReadiness;
  assetPipeline: AdminRuntimeProviderPlaneReadiness;
  persistence: AdminRuntimeProviderPlaneReadiness;
  providerGates?: Array<{
    gateId: string;
    domain: string;
    path: string;
    capabilityIds: string[];
    state: string;
    liveProviderReady: boolean;
    credentialEvidencePresent: boolean;
    runtimeEvidencePresent: boolean;
    blockers: string[];
    recommendedNextAction: string;
    claimBoundary: string;
  }>;
  recommendedNextAction?: string;
  warnings: string[];
};

export type AdminRuntimeProviderReadiness = {
  source: string;
  claimBoundary: string;
  surfaces: AdminRuntimeProviderReadinessSurface[];
};

export type AdminRuntimeSelectionReviewPacket = {
  schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1";
  source: string;
  reviewPacketMode: "read_only_guarded_runtime_handoff";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  handoffArtifactsInternallyPaired: boolean;
  runtimeCandidates: {
    model: string;
    voice: string;
  };
  guardedRuntimeSelectorDecision: {
    selectionStatus: string;
    claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution";
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    providerExecutionPerformed: false;
    uiLaunchPerformed: false;
    questEvidenceRefreshed: false;
    blockers: string[];
  };
  publicationPayloadLinkage?: {
    source: "encounter_publication_payloads";
    status: string;
    blockers: string[];
    localMaterializationHandoff: {
      requestId: string;
      scenarioId: string;
      rootPath: string;
      plannedOutputCount: number;
      materializedOutputCount: number;
      allOutputsPlannedMetadataOnly: boolean;
    };
    assetNeedsReadiness: {
      readyForDeterministicGeneration: boolean;
      missingRequiredAssetNeedIds: string[];
      blockers: string[];
      requiredHumanoidRoles: string[];
      animationRequirementCount: number;
      emotionRequirementCount: number;
      gazeRequirementCount: number;
      lipSyncRequirementCount: number;
      sharedAssetLibrarySemanticKeyCount: number;
    };
    realismEvidenceRefs?: {
      claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence" | "unavailable";
      refIds: string[];
      refs?: Array<{
        refId: string;
        evidenceRef: string;
        requiredBefore: "guarded_runtime_wiring";
        status: "required_not_attached";
        notEvidenceFor: string[];
      }>;
      runtimeRealismEvidenceHookCount?: number;
      visualQaEvidenceHookCount?: number;
      runtimeRealismEvidenceHooks?: Array<{
        actorId: string;
        actorRole: string;
        requiredSignalIds: string[];
        evidenceRef: string;
        status: "required_not_attached";
        claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness";
      }>;
      visualQaEvidenceHooks?: Array<{
        targetId: string;
        targetKind: string;
        requiredReviewFocus: string[];
        evidenceRef: string;
        status: "required_not_attached";
        claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence";
      }>;
      requiredBefore: "guarded_runtime_wiring" | "unavailable";
      runtimeExecutionAllowed: false;
      providerExecutionPerformed: false;
      questReadinessClaimed: false;
    };
    actorEquipmentMaterializationGate?: {
      runtimeSelectionBlockedUntilEvidenceAttached: boolean;
      actorBlockers: string[];
      equipmentBlockers: string[];
      caveats: string[];
      recommendedNextActions: string[];
      remainingRuntimeBlockerReasons?: {
        source: "materialization_attachment_summary_and_publication_runtime_gates";
        materializationEvidenceComplete: boolean;
        runtimeSelectionAllowed: false;
        learnerLaunchAllowed: false;
        questEvidenceRefreshAllowed: false;
        categories: Array<{
          category: string;
          blockerIds: string[];
          recommendedNextAction: string;
        }>;
        claimBoundary: "remaining_runtime_blockers_after_materialization_metadata_only";
      };
      claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness" | "unavailable";
    };
  };
  operatorReviewReadiness?: {
    status: "ready_for_operator_review" | "not_ready_for_operator_review";
    reviewedArtifactCount: number;
    blockingArtifactCount: number;
    blockerIds: string[];
    requiredOperatorActions: string[];
    materializationRequiredBeforeRuntime: boolean;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "operator_review_readiness_metadata_only";
  };
  runtimeRealismEvidenceDraftReview?: {
    status: "draft_required_not_attached";
    runtimeRealismEvidenceHookCount: number;
    visualQaEvidenceHookCount: number;
    runtimeHookDrafts: Array<{
      actorId: string;
      actorRole: string;
      requiredSignalCount: number;
      status: "required_not_attached";
      evidenceRef: string;
      claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness";
    }>;
    visualQaHookDrafts: Array<{
      targetId: string;
      targetKind: string;
      requiredReviewFocus: string[];
      status: "required_not_attached";
      evidenceRef: string;
      claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence";
    }>;
    blockerIds: string[];
    recommendedNextActions: string[];
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "runtime_realism_evidence_draft_review_metadata_only";
  };
  runtimeRealismEvidenceInputDraft?: {
    schemaVersion: "openclinxr.encounter-runtime-realism-evidence-input-draft.v1";
    source: "encounter_runtime_selection_review_packet";
    selectedScenarioId: string;
    status: "draft_inputs_required_not_attached";
    runtimeActorEvidenceInputs: Array<{
      inputKind: "runtime_realism_signal_input";
      evidenceInputId: string;
      actorId: string;
      actorRole: string;
      requiredSignalCount: number;
      sourceEvidenceRef: string;
      requiredEvidenceStatus: "required_not_attached";
      providerExecutionStatus: "metadata_only_not_executed";
      claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness";
    }>;
    visualQaEvidenceInputs: Array<{
      inputKind: "visual_qa_review_input";
      evidenceInputId: string;
      targetId: string;
      targetKind: string;
      requiredReviewFocus: string[];
      sourceEvidenceRef: string;
      requiredEvidenceStatus: "required_not_attached";
      providerExecutionStatus: "metadata_only_not_executed";
      claimBoundary: "visual_qa_evidence_input_metadata_only_not_visual_quality_evidence";
    }>;
    gateBoundary: {
      providerExecutionAllowed: false;
      providerExecutionPerformed: false;
      runtimeExecutionAllowed: false;
      learnerLaunchAllowed: false;
      questEvidenceRefreshAllowed: false;
      productionAssetReadinessClaimed: false;
      clinicalValidityClaimed: false;
      scoringValidityClaimed: false;
      claimBoundary: "runtime_realism_evidence_inputs_do_not_clear_launch_gates";
    };
    blockers: string[];
    recommendedNextActions: string[];
    notEvidenceFor: AdminNoReadinessEvidenceClaim[];
  };
  runtimeRealismEvidenceInputReviewDecisionRecord?: RuntimeRealismEvidenceInputReviewDecisionRecord;
  runtimeVisualEvidenceAttachmentSummary?: RuntimeVisualEvidenceAttachmentSummary;
  runtimeVisualEvidenceAttachmentActionPacket?: RuntimeVisualEvidenceAttachmentActionPacket;
  runtimeVisualEvidenceAttachmentRecord?: RuntimeVisualEvidenceAttachmentRecord;
  runtimeEvidenceCaptureScaffold?: RuntimeEvidenceCaptureScaffold;
  materializationInputManifestSummary?: EncounterMaterializationInputManifestSummary;
  materializationAttachmentPlanSummary?: EncounterMaterializationAttachmentPlanSummary;
  materializationEvidenceAttachmentSummary?: EncounterMaterializationEvidenceAttachmentSummary;
  materializationInputReviewDecisionRecord?: EncounterMaterializationInputReviewDecisionRecord;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  providerExecutionPerformed: false;
  uiLaunchPerformed: false;
  questEvidenceRefreshed: false;
  broadVerificationPerformed: false;
  reviewerChecklist: Array<{
    checkId: string;
    status: "required_before_runtime_wiring";
    blockerIds: string[];
  }>;
  blockers: string[];
  nextAllowedStep: "review_disabled_runtime_selector_before_guarded_wiring" | "review_publication_materialization_blockers_before_guarded_wiring";
  claimBoundary: "runtime_selection_review_packet_not_runtime_execution";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type AdminScenarioBankMaturityReport = {
  scenarioCount: number;
  targetScenarioCount: number;
  missingScenarioCount: number;
  activationEligibleScenarioIds: string[];
  blockedScenarioIds: Array<{ scenarioId: string; reason: string }>;
  statusCounts?: Record<"approved" | "draft" | "retired", number>;
  validationStageCounts?: Record<
    "stage_0_synthetic_draft" | "stage_1_expert_reviewed" | "stage_2_pilot_ready" | "stage_3_validated",
    number
  >;
  scenarioMaturityBreakdown?: Array<{
    scenarioId: string;
    status: string;
    validationStage: string;
    activationEligible: boolean;
    blockerIds: string[];
    dialogueSeedReady: boolean;
    traceabilityReady: boolean;
    requiredTraceTagCount: number;
    assetNeedTypes: string[];
    environmentId: string | null;
    recommendedNextAction: string;
  }>;
  clinicalSettings: string[];
  actorRoleCoverage?: string[];
  hiddenFactPolicy?: {
    redactsAll: boolean;
    requiresTriggerForAll: boolean;
  };
  fixtureCompleteness: { missingRequiredActorRoles: string[] };
  communicationProfileCoverage?: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; missingActorIds: string[] }>;
    actorCount: {
      total: number;
      withCommunicationProfile: number;
    };
  };
  pressureActorCoverage?: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; blockers: string[] }>;
    scenarioCountWithNonPatientActors: number;
    minimumNonPatientActorCount: number;
  };
  traceabilityCoverage?: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; blockers: string[] }>;
    requiredTraceTagsCoveredByRubric: boolean;
    eventTagsWithinRequiredTraceTags: boolean;
    safetyCriticalTagsWithinRequiredTraceTags: boolean;
  };
  dialogueSeedCoverage: {
    seededScenarioIds: string[];
    guardrailProbeScenarioIds: string[];
  };
  sharedAssetReuseMaturity?: {
    claimBoundary: "scenario_bank_shared_asset_reuse_metadata_only";
    lookupKeyCount: number;
    reusableLookupKeyCount: number;
    duplicateLookupKeyCount: number;
    scenarioCountWithLookupKeys: number;
    scenarioCountWithReusableKeys: number;
    topReusableLookupKeys: Array<{ lookupKey: string; scenarioCount: number }>;
    lruReuseCandidateScenarioIds: string[];
    notEvidenceFor: Array<"generated_asset_readiness" | "shared_asset_library_materialization" | "quest_readiness" | "runtime_readiness" | "production_asset_readiness">;
  };
};

export type AdminScenarioBankExamSequenceProjection = {
  source: string;
  targetStationCount: number;
  stationCount: number;
  missingStationCount: number;
  activationEligibleCount: number;
  learnerUseBoundary: string;
  stations: Array<{
    stationOrder: number;
    scenarioId: string;
    learnerUseBoundary: string;
    reviewBlockers: string[];
  }>;
};

export type AdminReviewReplayRuntimeEvidenceGateRef = {
  gateId: string;
  status: "pending" | "attached" | "blocked";
  evidenceRefs: string[];
  requiredSignalIds: string[];
  blockers: string[];
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
  claimBoundary: "runtime_evidence_gate_ref_not_learner_or_quest_readiness";
};

export type AdminReviewReplayGeneratedBundlePosture = {
  bundleId: string;
  scenarioId: string;
  stationId: string;
  status: "publication_prepared_not_learner_use" | "blocked";
  learnerRuntimeUseBlocked: true;
  learnerRuntimeUseBlockers: string[];
  pendingEvidenceGateIds: string[];
  attachedEvidenceGateIds: string[];
  publicationArtifactRefs: {
    sceneManifest: string;
    learnerRuntimeBundle: string;
  };
  claimBoundary: "generated_bundle_posture_blocks_learner_use_until_evidence_gates_attach";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type AdminReviewReplayEvidenceHandoff = {
  reviewPacketRef: string;
  traceEventRefs: string[];
  patientNoteRef: string | null;
  actorTurnRefs: string[];
  timelineEntryCount: number;
  patientNoteAttached: boolean;
  actorTurnCount: number;
  privatePayloadRedacted: true;
  xrTraceEvidenceSummary?: {
    stationRunId: string;
    source: string;
    evidenceRef: string;
    activeLocomotionSource: string | null;
    locomotionDistanceMeters: number | null;
    locomotionTurnRadians: number | null;
    interactionSignalRefs: string[];
    latestTraceTag: string | null;
    latestTraceLatencyMs: number | null;
    blockers: string[];
    claimBoundary: "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness";
  } | undefined;
  claimBoundary: "review_packet_handoff_summary_only_no_private_payloads";
};

export type AdminRuntimeVisualEvidenceReplayProjection = {
  schemaVersion: "openclinxr.runtime-visual-evidence-replay-projection.v1";
  source: "runtime_visual_evidence_attachment_record_summary";
  stationRunId: string;
  scenarioId: string;
  reviewedMetadataOnlyCount: number;
  heldMetadataOnlyCount: number;
  acceptedAttachmentRefCount: number;
  runtimeEvidenceRefCount: number;
  visualQaEvidenceRefCount: number;
  acceptedActionIds: Array<"attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs">;
  rawPayloadDisplayed: false;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  replayEvidenceReady: false;
  blockerIds: string[];
  nextActions?: string[];
  uiXrConsumerOperatorWorkflowSummary?: {
    schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-workflow-summary.v1";
    source: "ui_xr_runtime_evidence_consumer_operator_workflow";
    scenarioId: string;
    acceptedAttachmentRefCount: number;
    runtimeEvidenceRefCount: number;
    visualQaEvidenceRefCount: number;
    targetRoute: "/runtime/visual-evidence-attachments";
    method: "POST";
    submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput";
    submitPreview: {
      route: "/runtime/visual-evidence-attachments";
      bodyRef: "submitRuntimeVisualEvidenceAttachmentInput";
      attachmentCount: number;
      actionIds: Array<"attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs">;
      inputIds: string[];
      localArtifactPaths: string[];
      rawPayloadDisplayed: false;
      claimBoundary: "ui_xr_consumer_workflow_submit_preview_metadata_only";
    };
    reviewerAction: "submit_metadata_only_runtime_visual_evidence_refs";
    preflightChecks: string[];
    nextActions?: string[];
    rawPayloadDisplayed: false;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    blockerIds: string[];
    claimBoundary: "summary_only_ui_xr_consumer_workflow_not_raw_payload_or_readiness";
    notEvidenceFor: AdminNoReadinessEvidenceClaim[];
  };
  claimBoundary: "summary_only_runtime_visual_evidence_replay_projection_not_raw_payload_or_readiness";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type AdminAssetReleaseLadderReplayProjection = {
  schemaVersion: "openclinxr.asset-release-ladder-replay-projection.v1";
  source: "scenario_asset_production_readiness_ladder";
  scenarioId: string;
  productionReady: false;
  assetCount: number;
  productionReadyAssetCount: number;
  blockedAssetCount: number;
  missingRequiredAssetCount: number;
  stationBudgetStatus: "ready" | "blocked";
  blockerCount: number;
  blockerIds: string[];
  blockedAssets: Array<{
    assetId: string;
    blockerCount: number;
    firstBlockedStep: string | null;
    blockerIds: string[];
  }>;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "summary_only_asset_release_ladder_replay_projection_not_release_readiness";
  notEvidenceFor: AdminNoReadinessEvidenceClaim[];
};

export type AdminReviewReplayProviderDisabledRemediation = {
  providerId: string;
  status: "disabled" | "not_configured" | "blocked";
  remediationPlanRefs: string[];
  blockers: string[];
  claimBoundary: "provider_disabled_remediation_metadata_not_runtime_readiness";
};

export type AdminCaseDefinedHumanoidPerformanceContract = {
  claimBoundary: "case_definition_humanoid_performance_metadata_only";
  actorCount: number;
  locomotionActorRoles: string[];
  expressionActorRoles: string[];
  gazeActorRoles: string[];
  lipSyncActorRoles: string[];
  interactiveActorRoles: string[];
  emotionStateCount: number;
  dialogueDrivenVisemeMappingRequired: boolean;
  gazeTargetingRequired: boolean;
  locomotionPlanningRequired: boolean;
  notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity">;
};

export type AdminCaseDefinedHumanoidRuntimeHandoff = {
  claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only";
  actorRole: string;
  workOrderIds: string[];
  locomotionRequired: boolean;
  expressionRequired: boolean;
  gazeRequired: boolean;
  lipSyncRequired: boolean;
  interactiveRequired: boolean;
  requiredSignalIds: string[];
  blockers: string[];
  notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity" | "scoring_validity">;
};

export type AdminReviewReplayReadinessSummary = NonNullable<ReviewPacketReplayQuery["reviewReplayReadinessSummary"]> & {
  runtimeEvidenceGateRefs?: AdminReviewReplayRuntimeEvidenceGateRef[];
  generatedBundlePosture?: AdminReviewReplayGeneratedBundlePosture;
  reviewPacketEvidenceHandoff?: AdminReviewReplayEvidenceHandoff;
  runtimeVisualEvidenceReplayProjection?: AdminRuntimeVisualEvidenceReplayProjection;
  assetReleaseLadderReplayProjection?: AdminAssetReleaseLadderReplayProjection;
  xrTraceEvidenceSummary?: NonNullable<AdminReviewReplayEvidenceHandoff["xrTraceEvidenceSummary"]>;
  runtimeRemediationPlanRefs?: string[];
  providerDisabledRemediation?: AdminReviewReplayProviderDisabledRemediation[];
  caseDefinedHumanoidPerformanceContract?: AdminCaseDefinedHumanoidPerformanceContract;
  caseDefinedHumanoidRuntimeHandoff?: AdminCaseDefinedHumanoidRuntimeHandoff[];
};

export type AdminReviewPacketReplay = Omit<ReviewPacketReplayQuery, "reviewReplayReadinessSummary"> & {
  reviewReplayReadinessSummary: AdminReviewReplayReadinessSummary;
};

export type AdminRuntimeProtocolSupport = {
  protocolId: string;
  status: string;
  claimScope: string;
  runtimeTarget: string;
  role: string;
  clinicalMediaAllowed: boolean;
  path?: string;
  blockers: string[];
  notes: string;
};

export type AdminRuntimeProtocolPosture = {
  primaryRuntimeTarget: string;
  localFallbackRuntimeTarget: string;
  azureRuntimeTarget: string;
  protocols: AdminRuntimeProtocolSupport[];
};

export type AdminRealtimeVoicePosture = {
  policy: {
    cloudApisUsed: boolean;
    paidApisUsed: boolean;
    modelDownloadsPerformed: boolean;
    productionUseAllowed: boolean;
  };
  transports: {
    websocket: { status: string; path: string; codec: string };
    webTransport: { status: string; blockers: string[] };
  };
  gatewayRuntime: {
    target: string;
    localVerifiedFallback: string;
    blockers: string[];
  };
  backends: {
    pythonFastApi: {
      status: string;
      websocketPath: string;
      transportProxy: {
        status: string;
        backendUrlConfigured: boolean;
        readyForLiveDialog: boolean;
        blockers: string[];
      };
      blockers: string[];
    };
  };
  protocolLanes: Array<{
    id: string;
    protocol: string;
    role: string;
    status: string;
    mediaAllowed: boolean;
    blockers: string[];
    notes: string;
  }>;
  providerGates?: Array<{
    gateId: string;
    capability: string;
    providerPath: string;
    state: string;
    liveProviderReady: boolean;
    credentialEvidencePresent: boolean;
    runtimeEvidencePresent: boolean;
    blockers: string[];
    recommendedNextAction: string;
    claimBoundary: string;
  }>;
  recommendedProtocolSelection: {
    selectedLane?: {
      id: string;
      protocol: string;
      role: string;
      status: string;
      mediaAllowed: boolean;
      blockers: string[];
      notes: string;
    };
    rejectedLaneReasons: Array<{ id: string; reason: string; blockers: string[] }>;
  };
};

export type SubmitScenarioReviewInput = SubmitScenarioReviewMutationVariables["input"];
export type SaveFacultyScoreDraftInput = SaveFacultyScoreDraftMutationVariables["input"];

export type AdminScenario = ScenarioBankQuery["scenarios"][number];
export type AdminScenarioDetail = ScenarioDetailQuery;
export type AdminScenarioReviewDecision = ScenarioReviewDecisionsQuery["scenarioReviewDecisions"][number];
export type AdminScenarioReviewResult = SubmitScenarioReviewMutation["submitScenarioReview"];
export type AdminReviewPacket = SaveFacultyScoreDraftMutation["saveFacultyScoreDraft"];
export type AdminStationRunQueueSnapshot = StationRunQueueSnapshotsQuery["stationRunQueueSnapshots"][number];

export const defaultAdminApiBaseUrl = import.meta.env.VITE_OPENCLINXR_API_BASE_URL ?? "";

const stationRunQueueSnapshotsDocument = print(StationRunQueueSnapshotsDocument);
const createStationRunQueueSnapshotDocument = print(CreateStationRunQueueSnapshotDocument);
const scenarioBankDocument = print(ScenarioBankDocument);
const scenarioDetailDocument = print(ScenarioDetailDocument);
const scenarioReviewDecisionsDocument = print(ScenarioReviewDecisionsDocument);
const reviewPacketReplayDocument = print(ReviewPacketReplayDocument);
const submitScenarioReviewDocument = print(SubmitScenarioReviewDocument);
const saveFacultyScoreDraftDocument = print(SaveFacultyScoreDraftDocument);

export function buildAdminGraphqlEndpoint(baseUrl: string = defaultAdminApiBaseUrl): string {
  return `${normalizeBaseUrl(baseUrl)}${routeById("admin-graphql-execute").path}`;
}

export function createAdminControlPlaneClient(options: AdminControlPlaneClientOptions = {}): AdminControlPlaneClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultAdminApiBaseUrl);
  const fetcher = options.fetch ?? fetch;
  const apolloClient = options.apolloClient;

  return {
    getStep2CsSeedBlueprint: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint").path),
    getStep2CsSeedBlueprintReadiness: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-blueprint-readiness").path),
    getStep2CsSeedTimingPlan: () => get(fetcher, baseUrl, routeById("step2cs-seed-exam-timing-plan").path),
    getStep2CsSeedStationRunQueue: () => get(fetcher, baseUrl, routeById("step2cs-seed-station-run-queue").path),
    getRuntimeProviderReadiness: () => get(fetcher, baseUrl, routeById("runtime-provider-readiness").path),
    getRuntimeSelectionReviewPacket: () => get(fetcher, baseUrl, routeById("runtime-selection-review-packet").path),
    getRuntimeProtocolPosture: () => get(fetcher, baseUrl, routeById("runtime-protocols").path),
    getRealtimeVoicePosture: () => get(fetcher, baseUrl, routeById("realtime-voice-posture").path),
    createLocalReviewReplaySeed: async (input = {}) => {
      const session = await post<CreateLocalReviewReplaySeedResult>(
        fetcher,
        baseUrl,
        routeById("start-session").path,
        {
          learnerId: input.learnerId ?? "admin_review_seed",
          consentAccepted: true,
        },
      );
      const stationRunId = requireStringField(session, "stationRunId", `POST ${baseUrl}${routeById("start-session").path}`);
      await post(fetcher, baseUrl, buildSessionRoutePath("start-encounter", stationRunId), { atSecond: 60 });
      await post(fetcher, baseUrl, buildSessionRoutePath("append-trace-event", stationRunId), {
        eventType: "learner.action",
        atSecond: 83,
        tag: "ecg_request",
        actorId: "patient_robert_hayes_v1",
      });
      await post(fetcher, baseUrl, buildSessionRoutePath("append-trace-event", stationRunId), {
        eventType: "learner.action",
        atSecond: 140,
        tag: "urgent_escalation",
        actorId: "nurse_amelia_singh_v1",
      });
      await post(fetcher, baseUrl, buildSessionRoutePath("append-trace-event", stationRunId), {
        eventType: "learner.action",
        atSecond: 190,
        tag: "team_communication",
        actorId: "spouse_linda_hayes_v1",
      });
      await post(fetcher, baseUrl, buildSessionRoutePath("submit-note", stationRunId), {
        atSecond: 960,
        text: "Chest pain requires urgent ECG escalation and team communication follow-up.",
      });

      return { stationRunId };
    },
    listScenarios: async (input = {}) => {
      const variables: ScenarioBankQueryVariables = input.status ? { status: input.status } : {};
      if (apolloClient) {
        const { data } = await apolloClient.query<ScenarioBankQuery, ScenarioBankQueryVariables>({
          query: ScenarioBankDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ScenarioBank missing_data");
        }
        return data.scenarios;
      }

      const data = await graphql<ScenarioBankQuery>(
        fetcher,
        baseUrl,
        "ScenarioBank",
        scenarioBankDocument,
        variables,
      );
      return data.scenarios;
    },
    getScenarioDetail: async (input) => {
      const variables: ScenarioDetailQueryVariables = {
        scenarioId: input.scenarioId,
        version: input.version,
      };
      if (apolloClient) {
        const { data } = await apolloClient.query<ScenarioDetailQuery, ScenarioDetailQueryVariables>({
          query: ScenarioDetailDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ScenarioDetail missing_data");
        }
        return data;
      }

      return graphql<ScenarioDetailQuery>(
        fetcher,
        baseUrl,
        "ScenarioDetail",
        scenarioDetailDocument,
        variables,
      );
    },
    listScenarioReviewDecisions: async (input) => {
      const variables: ScenarioReviewDecisionsQueryVariables = {
        scenarioId: input.scenarioId,
        version: input.version,
      };
      if (apolloClient) {
        const { data } = await apolloClient.query<ScenarioReviewDecisionsQuery, ScenarioReviewDecisionsQueryVariables>({
          query: ScenarioReviewDecisionsDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ScenarioReviewDecisions missing_data");
        }
        return data.scenarioReviewDecisions;
      }

      const data = await graphql<ScenarioReviewDecisionsQuery>(
        fetcher,
        baseUrl,
        "ScenarioReviewDecisions",
        scenarioReviewDecisionsDocument,
        variables,
      );
      return data.scenarioReviewDecisions;
    },
    getReviewPacketReplay: async (input) => {
      const variables: ReviewPacketReplayQueryVariables = {
        stationRunId: input.stationRunId,
      };
      if (apolloClient) {
        const { data } = await apolloClient.query<ReviewPacketReplayQuery, ReviewPacketReplayQueryVariables>({
          query: ReviewPacketReplayDocument,
          variables,
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: ReviewPacketReplay missing_data");
        }
        return data;
      }

      return graphql<ReviewPacketReplayQuery>(
        fetcher,
        baseUrl,
        "ReviewPacketReplay",
        reviewPacketReplayDocument,
        variables,
      );
    },
    getReviewReplayReadinessSummary: (input) =>
      get(fetcher, baseUrl, buildSessionRoutePath("review-replay-readiness-summary", input.stationRunId)),
    submitScenarioReview: async (input) => {
      if (apolloClient) {
        const { data } = await apolloClient.mutate<SubmitScenarioReviewMutation, SubmitScenarioReviewMutationVariables>({
          mutation: SubmitScenarioReviewDocument,
          variables: { input },
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: SubmitScenarioReview missing_data");
        }
        return data.submitScenarioReview;
      }

      const data = await graphql<SubmitScenarioReviewMutation>(
        fetcher,
        baseUrl,
        "SubmitScenarioReview",
        submitScenarioReviewDocument,
        { input },
      );
      return data.submitScenarioReview;
    },
    saveFacultyScoreDraft: async (input) => {
      if (apolloClient) {
        const { data } = await apolloClient.mutate<SaveFacultyScoreDraftMutation, SaveFacultyScoreDraftMutationVariables>({
          mutation: SaveFacultyScoreDraftDocument,
          variables: { input },
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: SaveFacultyScoreDraft missing_data");
        }
        return data.saveFacultyScoreDraft;
      }

      const data = await graphql<SaveFacultyScoreDraftMutation>(
        fetcher,
        baseUrl,
        "SaveFacultyScoreDraft",
        saveFacultyScoreDraftDocument,
        { input },
      );
      return data.saveFacultyScoreDraft;
    },
    listStep2CsSeedStationRunQueueSnapshots: async () => {
      if (apolloClient) {
        const { data } = await apolloClient.query<StationRunQueueSnapshotsQuery, StationRunQueueSnapshotsQueryVariables>({
          query: StationRunQueueSnapshotsDocument,
          variables: { blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1" },
          fetchPolicy: "network-only",
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: StationRunQueueSnapshots missing_data");
        }
        return data.stationRunQueueSnapshots;
      }

      const data = await graphql<StationRunQueueSnapshotsQuery>(
        fetcher,
        baseUrl,
        "StationRunQueueSnapshots",
        stationRunQueueSnapshotsDocument,
        { blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1" },
      );
      return data.stationRunQueueSnapshots;
    },
    createStep2CsSeedStationRunQueueSnapshot: async (input) => {
      if (apolloClient) {
        const { data } = await apolloClient.mutate<CreateStationRunQueueSnapshotMutation, CreateStationRunQueueSnapshotMutationVariables>({
          mutation: CreateStationRunQueueSnapshotDocument,
          variables: { input },
        });
        if (!data) {
          throw new Error("OpenClinXR admin GraphQL request failed: CreateStationRunQueueSnapshot missing_data");
        }
        return data.createStationRunQueueSnapshot;
      }

      const data = await graphql<CreateStationRunQueueSnapshotMutation>(
        fetcher,
        baseUrl,
        "CreateStationRunQueueSnapshot",
        createStationRunQueueSnapshotDocument,
        { input },
      );
      return data.createStationRunQueueSnapshot;
    },
    getEdChestPainPublicationReadiness: (input) => post(fetcher, baseUrl, routeById("scenario-publication-readiness").path, input),
    getScenarioBankMaturity: () => get(fetcher, baseUrl, routeById("scenario-bank-maturity").path),
    getScenarioBankExamSequence: () => get(fetcher, baseUrl, routeById("scenario-bank-exam-sequence").path),
    getDynamicEncounterFactoryPlanning: () => get(fetcher, baseUrl, routeById("scenario-bank-dynamic-encounter-factory-planning").path),
    getScenarioBankAssetReadiness: () => get(fetcher, baseUrl, routeById("scenario-bank-asset-readiness").path),
    getScenarioBankEnvironmentGenerationQueue: () => get(fetcher, baseUrl, routeById("scenario-bank-environment-generation-queue").path),
    getScenarioBankEnvironmentWorkOrderQueue: () => get(fetcher, baseUrl, routeById("scenario-bank-environment-work-order-queue").path),
    getScenarioBankSceneGenerationPipelineQueue: () => get(fetcher, baseUrl, routeById("scenario-bank-scene-generation-pipeline").path),
    listScenarioSceneGenerationRequests: () => get(fetcher, baseUrl, routeById("list-scenario-scene-generation-requests").path),
    createScenarioSceneGenerationRequest: (input) => post(fetcher, baseUrl, routeById("create-scenario-scene-generation-request").path, { scenarioId: input.scenarioId }),
    submitScenarioSceneGenerationRequestReview: (input) => post(fetcher, baseUrl, routeById("submit-scenario-scene-generation-request-review").path.replace(":requestId", encodeURIComponent(input.requestId)), { decisions: input.decisions }),
    submitScenarioSceneGenerationMaterializationInputReview: (input) => post(fetcher, baseUrl, routeById("submit-scenario-scene-generation-materialization-input-review").path.replace(":requestId", encodeURIComponent(input.requestId)), { decisions: input.decisions }),
    submitRuntimeRealismEvidenceInputReview: (input) => post(fetcher, baseUrl, routeById("submit-runtime-realism-evidence-input-review").path, { scenarioId: input.scenarioId, decisions: input.decisions }),
    submitRuntimeVisualEvidenceAttachment: (input) => post(fetcher, baseUrl, routeById("submit-runtime-visual-evidence-attachment").path, { scenarioId: input.scenarioId, attachments: input.attachments }),
    getScenarioSceneGenerationRequestPublicationReadiness: (input) => get(fetcher, baseUrl, routeById("scenario-scene-generation-request-publication-readiness").path.replace(":requestId", encodeURIComponent(input.requestId))),
  };
}

async function get<TResponse>(fetcher: typeof fetch, baseUrl: string, path: string): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, { method: "GET", cache: "no-store" });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: GET ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

async function post<TResponse = unknown>(fetcher: typeof fetch, baseUrl: string, path: string, body: Record<string, unknown>): Promise<TResponse> {
  const url = `${baseUrl}${path}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<TResponse>;
}

async function graphql<TData>(
  fetcher: typeof fetch,
  baseUrl: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const url = buildAdminGraphqlEndpoint(baseUrl);
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, operationName, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = isRecord(errorBody) && typeof errorBody.error === "string" ? errorBody.error : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  const body = await response.json() as { data?: TData; errors?: Array<{ message?: string }> };
  if (body.errors?.length) {
    const message = body.errors.map((error) => error.message ?? "unknown_graphql_error").join("; ");
    throw new Error(`OpenClinXR admin GraphQL request failed: ${operationName} ${message}`);
  }
  if (!body.data) {
    throw new Error(`OpenClinXR admin GraphQL request failed: ${operationName} missing_data`);
  }

  return body.data;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringField(value: unknown, fieldName: string, context: string): string {
  if (isRecord(value) && typeof value[fieldName] === "string" && value[fieldName].trim().length > 0) {
    return value[fieldName];
  }

  throw new Error(`OpenClinXR admin API request failed: ${context} missing ${fieldName}`);
}
