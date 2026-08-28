import { buildScenarioSceneGenerationPipelineWorkOrderQueue, createEdChestPainLocalLearnerRuntimeAssetBundle, type RuntimeAssetReviewDecision } from "@openclinxr/asset-registry";
import { type AuthIdentity, DEFAULT_DEV_AUTH_IDENTITY, DEFAULT_DEV_AUTH_SECRET } from "@openclinxr/auth";
import { AssetGenerationCapabilityFacade } from "@openclinxr/capability-gateway";
import { type ExamForm, type ExamStationRunQueue } from "@openclinxr/exam-assembly";
import { FACULTY_SCORE_DRAFT_CLAIM_SCOPE, type FacultyScoreDraft, type ReviewDecisionDraft } from "@openclinxr/review-workflow";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import { type ScenarioRuntime, type ScenarioRuntimeActorTurn } from "@openclinxr/scenario-runtime";
import { type Scenario } from "@openclinxr/shared-schemas";
import { type TelemetryRecorder } from "@openclinxr/telemetry";
import { type RealtimeVoiceGatewayPostureInput } from "@openclinxr/voice-gateway";
import { type OpenClinXrApiProtocolPosture } from "./protocol-support.js";



export type RuntimeTraceEvents = ReturnType<ScenarioRuntime["traceEvents"]>;

export type RuntimeReviewPacket = ReturnType<ScenarioRuntime["reviewPacket"]>;


export type ApiClinicalEventReviewProjection = {
  clinicalEventId: string;
  stationRunId: string;
  actorId?: string;
  atSecond: number;
  eventKind: string;
  traceTag?: string;
  label: string;
  status?: string;
  payload: Record<string, unknown>;
  provenanceRefs: string[];
  privatePayloadRedacted: boolean;
  durableStore: string;
};


export type ApiStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
};


export type ApiScenarioReviewerRole = "clinical" | "psychometric" | "legal" | "simulationQa";


export type ApiScenarioReviewDecisionRecord = {
  scenarioId: string;
  version: number;
  reviewerRole: ApiScenarioReviewerRole;
  reviewerId: string;
  decision: "approved" | "changes_requested";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

/**
 * Durable faculty score-draft record (review-workflow FacultyScoreDraft + session keys).
 * scoringValidityClaimed always false; notEvidenceFor fixed; no board/external writes.
 */

/**
 * Durable faculty score-draft record (review-workflow FacultyScoreDraft + session keys).
 * scoringValidityClaimed always false; notEvidenceFor fixed; no board/external writes.
 */
export type ApiFacultyScoreDraftRecord = {
  stationRunId: string;
  scenarioId: string;
  draftId: string;
  savedAt: string;
  facultyScoreDraft: FacultyScoreDraft;
  scoringValidityClaimed: false;
  notEvidenceFor: readonly string[];
  claimScope: typeof FACULTY_SCORE_DRAFT_CLAIM_SCOPE;
};

/**
 * Local faculty review-decision record (promote/hold demo surface).
 * All promotion gates stay false — notEvidenceFor production/quest/scoring/clinical.
 */

/**
 * Local faculty review-decision record (promote/hold demo surface).
 * All promotion gates stay false — notEvidenceFor production/quest/scoring/clinical.
 */
export type ApiFacultyReviewDecisionRecord = {
  stationRunId: string;
  scenarioId: string;
  decisionId: string;
  savedAt: string;
  localDecision: "hold" | "local_promote_candidate";
  decisionDraft: ReviewDecisionDraft;
  facultyScoreDraft: FacultyScoreDraft;
  runtimePromotionAllowed: false;
  productionManifestPromotionAllowed: false;
  scoringValidityClaimed: false;
  notEvidenceFor: readonly string[];
  claimScope: "faculty_local_review_decision_gated_not_score_use";
};

/**
 * Local faculty compile-lock record (persisted under .openclinxr/compile-locks/).
 * Review metadata only: a lock never promotes or publishes a packet.
 */
export type ApiFacultyCompileLockRecord = {
  scenarioId: string;
  updatedAt: string;
  claimBoundary: "faculty_compile_lock_review_metadata_only";
  notEvidenceFor: readonly string[];
  locks: Array<{
    nodeId: string;
    locked: boolean;
    overridePath?: string;
  }>;
};


export type ApiPersistenceSink = {
  saveExamForm?: (form: ExamForm) => Promise<void> | void;
  saveStationRunQueueSnapshot?: (snapshot: ApiStationRunQueueSnapshot) => Promise<void> | void;
  listStationRunQueueSnapshots?: (blueprintId: string) => Promise<ApiStationRunQueueSnapshot[]> | ApiStationRunQueueSnapshot[];
  saveScenarioReviewDecision?: (record: ApiScenarioReviewDecisionRecord) => Promise<void> | void;
  listScenarioReviewDecisions?: () => Promise<ApiScenarioReviewDecisionRecord[]> | ApiScenarioReviewDecisionRecord[];
  saveTraceEvents?: (stationRunId: string, events: RuntimeTraceEvents) => Promise<void> | void;
  saveReviewPacket?: (stationRunId: string, packet: RuntimeReviewPacket) => Promise<void> | void;
  /**
   * Optional durable actor-turn sink. Wired into ScenarioRuntime via
   * `createScenarioRuntimeDurableStoreFromApiPersistence` so generateActorResponse
   * hooks persist turns without a separate API call.
   */
  saveActorTurn?: (stationRunId: string, turn: ScenarioRuntimeActorTurn) => Promise<void> | void;
  listClinicalEventReviewProjections?: (stationRunId: string) => Promise<ApiClinicalEventReviewProjection[]> | ApiClinicalEventReviewProjection[];
  getLearnerRuntimeAssetBundle?: (
    bundleId: string,
  ) =>
    | Promise<ReturnType<typeof createEdChestPainLocalLearnerRuntimeAssetBundle> | undefined>
    | ReturnType<typeof createEdChestPainLocalLearnerRuntimeAssetBundle>
    | undefined;
  listLearnerRuntimeAssetBundles?: () =>
    | Promise<Array<ReturnType<typeof createEdChestPainLocalLearnerRuntimeAssetBundle>>>
    | Array<ReturnType<typeof createEdChestPainLocalLearnerRuntimeAssetBundle>>;
  saveAuthoredScenario?: (scenario: Scenario) => Promise<void> | void;
  listAuthoredScenarios?: () => Promise<Scenario[]> | Scenario[];
  getAuthoredScenario?: (scenarioId: string) => Promise<Scenario | undefined> | Scenario | undefined;
  /** Faculty Q4 score-draft persistence (gated FacultyScoreDraft; not score-use). */
  saveFacultyScoreDraft?: (record: ApiFacultyScoreDraftRecord) => Promise<void> | void;
  listFacultyScoreDrafts?: (stationRunId: string) => Promise<ApiFacultyScoreDraftRecord[]> | ApiFacultyScoreDraftRecord[];
  /** Faculty Q4 local review-decision persistence (gates stay false). */
  saveFacultyReviewDecision?: (record: ApiFacultyReviewDecisionRecord) => Promise<void> | void;
  listFacultyReviewDecisions?: (stationRunId: string) => Promise<ApiFacultyReviewDecisionRecord[]> | ApiFacultyReviewDecisionRecord[];
};


export type ApiScenarioSceneGenerationRequestRecord = {
  requestId: string;
  scenarioId: string;
  createdAt: string;
  status: "accepted";
  accepted: true;
  reviewStatus: "pending_runtime_asset_review" | "runtime_asset_review_attached";
  nextAction: "attach_runtime_asset_review_decisions" | "run_generated_bundle_publisher";
  runtimeAssetReviewDecisionCount: number;
  runtimeAssetReviewDecisions: RuntimeAssetReviewDecision[];
  materializationInputReviewDecisions: ApiMaterializationInputReviewDecision[];
  materializationInputReviewDecisionRecord?: ApiMaterializationInputReviewDecisionRecord;
  scenarioReviewGate: ApiScenarioReviewGateSummary;
  humanReviewActions: ApiHumanReviewActionSummary[];
  productionAssetReadinessClaimed: false;
  claimBoundary: "scene_generation_request_not_asset_production";
  factoryPlanningContext: {
    scenarioId: string;
    workOrderId: string;
    isFeaturedFactoryPlanningTarget: boolean;
    factoryPlanningClaimBoundary: "review_gated_factory_metadata_only";
    generationApprovalInferred: false;
  };
  workOrder: ReturnType<typeof buildScenarioSceneGenerationPipelineWorkOrderQueue>["workOrders"][number];
};


export type ApiMaterializationInputReviewDecision = {
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


export type ApiMaterializationInputReviewDecisionRecord = {
  schemaVersion: "openclinxr.encounter-materialization-input-review-decision-record.v1";
  source: "admin_materialization_input_review_decisions";
  requestId: string;
  scenarioId: string;
  decisionCount: number;
  reviewedDecisionCount: number;
  heldDecisionCount: number;
  decisions: ApiMaterializationInputReviewDecision[];
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  claimBoundary: "metadata_only_materialization_input_review_decisions";
  notEvidenceFor: string[];
};


export type ApiRuntimeRealismEvidenceInputReviewDecision = {
  inputId: string;
  inputKind: "runtime_realism_signal_input" | "visual_qa_review_input";
  reviewerId: string;
  decision: "reviewed_metadata_only" | "held_metadata_only";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};


export type ApiRuntimeRealismEvidenceInputReviewDecisionRecord = {
  schemaVersion: "openclinxr.runtime-realism-evidence-input-review-decision-record.v1";
  source: "admin_runtime_realism_evidence_input_review_decisions";
  scenarioId: string;
  decisionCount: number;
  reviewedDecisionCount: number;
  heldDecisionCount: number;
  decisions: ApiRuntimeRealismEvidenceInputReviewDecision[];
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "metadata_only_runtime_realism_evidence_input_review_decisions";
  notEvidenceFor: string[];
};


export type ApiRuntimeVisualEvidenceAttachment = {
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


export type ApiRuntimeVisualEvidenceAttachmentRecord = {
  schemaVersion: "openclinxr.runtime-visual-evidence-attachment-record.v1";
  source: "admin_runtime_visual_evidence_attachment_refs";
  scenarioId: string;
  attachmentCount: number;
  runtimeEvidenceAttachmentCount: number;
  visualQaEvidenceAttachmentCount: number;
  attachments: ApiRuntimeVisualEvidenceAttachment[];
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence";
  notEvidenceFor: string[];
};


export type ApiRuntimeRealismEvidenceAttachmentSummary = {
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
  notEvidenceFor: string[];
};


export type ApiRuntimeVisualEvidenceAttachmentActionPacket = {
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
  notEvidenceFor: string[];
};


export type ApiRuntimeVisualEvidenceReplayProjection = {
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
  nextActions: string[];
  uiXrConsumerOperatorWorkflowSummary?: ApiUiXrRuntimeEvidenceConsumerWorkflowSummary;
  claimBoundary: "summary_only_runtime_visual_evidence_replay_projection_not_raw_payload_or_readiness";
  notEvidenceFor: string[];
};


export type ApiUiXrRuntimeEvidenceConsumerWorkflowSummary = {
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
    operatorSelectableAttachmentCount?: number;
    operatorSelectionEnabled?: boolean;
    operatorSelectionSupport?: 'subset-via-count';
    actionIds: Array<"attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs">;
    inputIds: string[];
    localArtifactPaths: string[];
    rawPayloadDisplayed: false;
    claimBoundary: "ui_xr_consumer_workflow_submit_preview_metadata_only";
  };
  reviewerAction: "submit_metadata_only_runtime_visual_evidence_refs";
  preflightChecks: string[];
  nextActions: string[];
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
  notEvidenceFor: string[];
};


export type ApiAssetReleaseLadderReplayProjection = {
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
  notEvidenceFor: string[];
};


export type ApiRuntimeEvidenceCaptureScaffold = {
  schemaVersion: "openclinxr.encounter-runtime-evidence-capture-scaffold.v1";
  source: "encounter_runtime_realism_evidence_input_draft";
  selectedScenarioId: string;
  status: "metadata_only_attachment_candidates_not_submitted";
  runtimeEvidenceCandidateCount: number;
  visualQaEvidenceCandidateCount: number;
  attachmentCandidates: Array<ApiRuntimeVisualEvidenceAttachment & {
    sourceEvidenceRef: string;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    claimBoundary: "metadata_only_runtime_evidence_capture_candidate_not_submitted";
    notEvidenceFor: string[];
  }>;
  submitRuntimeVisualEvidenceAttachmentInput: {
    scenarioId: string;
    attachments: ApiRuntimeVisualEvidenceAttachment[];
  };
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
  notEvidenceFor: string[];
};


export type ApiScenarioReviewGateSummary = {
  scenarioStatus: (typeof scenarioBank)[number]["status"] | "unknown";
  approvalBoundary: "approved_scenario_factory_planning_only" | "draft_no_learner_use_without_human_approval";
  learnerUseBlocked: boolean;
  blockerIds: string[];
  claimBoundary: "scenario_status_gate_not_clinical_or_production_readiness";
};


export type ApiHumanReviewActionSummary = {
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


export type ApiAuthOptions = {
  /**
   * When true (default), missing Authorization attaches DEFAULT_DEV_AUTH_IDENTITY so existing
   * single-user tests / memory-sink paths keep working. Invalid Bearer always 401.
   */
  allowDevDefaultIdentity?: boolean;
  /** HMAC secret for local JWT verify (default: DEFAULT_DEV_AUTH_SECRET). */
  secret?: string;
  /** Override default identity used when Authorization is absent and allowDevDefaultIdentity. */
  defaultIdentity?: AuthIdentity;
};


export type ApiAppOptions = {
  telemetry?: TelemetryRecorder;
  assetGenerationFacade?: AssetGenerationCapabilityFacade;
  realtimeVoiceGatewayPosture?: RealtimeVoiceGatewayPostureInput;
  apiProtocolPosture?: OpenClinXrApiProtocolPosture;
  auth?: ApiAuthOptions;
};


export type ApiAppVariables = {
  identity: AuthIdentity;
};

