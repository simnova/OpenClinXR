import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RuntimeVisualEvidenceAttachmentActionId = "attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs";
type RuntimeVisualEvidenceAttachmentInputKind = "runtime_realism_signal_input" | "visual_qa_review_input";

export type UiXrRuntimeVisualEvidenceAttachment = {
  actionId: RuntimeVisualEvidenceAttachmentActionId;
  inputId: string;
  inputKind: RuntimeVisualEvidenceAttachmentInputKind;
  evidenceRef: string;
  localArtifactPath: string;
  reviewerId: "ui_xr_manual_runtime_evidence_capture_scaffold";
  attachmentStatus: "attached_metadata_only";
  comments: string;
  attachedAt: string;
};

export type UiXrRuntimeVisualEvidenceSubmitInput = {
  scenarioId: string;
  attachments: UiXrRuntimeVisualEvidenceAttachment[];
};

export type UiXrRuntimeVisualEvidenceCaptureScaffold = {
  schemaVersion: "openclinxr.ui-xr-runtime-visual-evidence-capture-scaffold.v1";
  source: "ui_xr_manual_performance_evidence_payload";
  scenarioId: string;
  runtimeAssetBundleId: string | null;
  status: "metadata_only_attachment_candidates_not_submitted";
  runtimeEvidenceCandidateCount: number;
  visualQaEvidenceCandidateCount: number;
  submitRuntimeVisualEvidenceAttachmentInput: UiXrRuntimeVisualEvidenceSubmitInput;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "ui_xr_capture_scaffold_not_runtime_visual_evidence";
  notEvidenceFor: string[];
};

export type UiXrManualPerformanceEvidencePayload = {
  runtimeAssetBundleId?: string | null;
  runtimeVisualEvidenceCaptureScaffold?: UiXrRuntimeVisualEvidenceCaptureScaffold | null;
};

export type UiXrRuntimeEvidenceConsumerArtifact = {
  schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer.v1";
  generatedAt: string;
  source: "ui_xr_manual_performance_evidence_payload";
  scenarioId: string;
  runtimeAssetBundleId: string | null;
  status: "metadata_only_attachment_submit_input_ready";
  runtimeEvidenceCandidateCount: number;
  visualQaEvidenceCandidateCount: number;
  preflightReport: UiXrRuntimeEvidenceConsumerPreflightReport;
  submitRuntimeVisualEvidenceAttachmentInput: UiXrRuntimeVisualEvidenceSubmitInput;
  adminAttachmentRouteHandoff: {
    route: "/runtime/visual-evidence-attachments";
    method: "POST";
    bodyRef: "submitRuntimeVisualEvidenceAttachmentInput";
    rawPayloadDisplayed: false;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    claimBoundary: "ui_xr_consumer_handoff_uses_existing_metadata_attachment_route";
  };
  operatorSubmissionWorkflow: {
    status: "ready_for_guarded_attachment_route";
    sourceArtifactRef: "ui_xr_runtime_evidence_consumer_artifact";
    routeHandoffRef: "adminAttachmentRouteHandoff";
    submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput";
    reviewerAction: "submit_metadata_only_runtime_visual_evidence_refs";
    preflightChecks: [
      "scenario_id_matches_payload_and_expected_scenario",
      "attachments_non_empty",
      "raw_payload_hidden",
      "all_execution_and_readiness_gates_false",
    ];
    nextActions: string[];
    rawPayloadDisplayed: false;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    claimBoundary: "ui_xr_operator_workflow_uses_existing_guarded_attachment_route";
  };
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  blockers: string[];
  recommendedNextActions: string[];
  claimBoundary: "ui_xr_runtime_evidence_consumer_metadata_only_not_readiness";
  notEvidenceFor: string[];
};

export type UiXrRuntimeEvidenceConsumerPreflightReport = {
  schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-preflight.v1";
  source: "ui_xr_manual_performance_evidence_payload";
  status: "consumer_ready_metadata_only" | "consumer_blocked";
  scenarioId: string | null;
  runtimeAssetBundleId: string | null;
  attachmentCount: number;
  runtimeEvidenceCandidateCount: number;
  visualQaEvidenceCandidateCount: number;
  targetRoute: "/runtime/visual-evidence-attachments";
  submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput";
  submitPreview: {
    route: "/runtime/visual-evidence-attachments";
    bodyRef: "submitRuntimeVisualEvidenceAttachmentInput";
    attachmentCount: number;
    operatorSelectableAttachmentCount: number;
    operatorSelectionEnabled: boolean;
    operatorSelectionSupport: 'subset-via-count';
    actionIds: RuntimeVisualEvidenceAttachmentActionId[];
    inputIds: string[];
    localArtifactPaths: string[];
    rawPayloadDisplayed: false;
    operatorSelectable: true;
    operatorSelectionSupport: 'subset-via-count';
    claimBoundary: "ui_xr_consumer_preflight_submit_preview_metadata_only";
  };
  operatorSelectionEnabled: true;
  operatorSelectableAttachmentCount: number;
  operatorSelectionSupport: 'subset-via-count';
  blockerIds: string[];
  envWorldAsset?: {
    roomType: string;
    gltfAssetUrl: string | null;
    attachableViaConsumer: true;
    operatorSelectable: true;
    source: string;
    producedGltfManifest?: any;
    producedBy?: string;
  } | null;
  nextActions: string[];
  rawPayloadDisplayed: false;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  operatorSelectionEnabled: true;
  operatorSelectableAttachmentCount: number;
  claimBoundary: "ui_xr_consumer_preflight_metadata_only_not_runtime_visual_evidence";
  notEvidenceFor: string[];
};

const NOT_EVIDENCE_FOR = [
  "provider_availability",
  "runtime_readiness",
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
  "learner_launch_readiness",
];

export function buildUiXrRuntimeEvidenceConsumerArtifact(input: {
  payload: UiXrManualPerformanceEvidencePayload;
  expectedScenarioId?: string | undefined;
  generatedAt?: string | undefined;
}): UiXrRuntimeEvidenceConsumerArtifact {
  const scaffold = input.payload.runtimeVisualEvidenceCaptureScaffold;
  if (!scaffold) {
    throw new Error("UI-XR manual performance payload does not include runtimeVisualEvidenceCaptureScaffold");
  }
  const validation = validateUiXrRuntimeVisualEvidenceCaptureScaffold(scaffold, input.expectedScenarioId);
  if (!validation.ok) {
    throw new Error(`UI-XR runtime visual evidence scaffold is not consumable:\n${validation.errors.join("\n")}`);
  }
  const preflightReport = buildUiXrRuntimeEvidenceConsumerPreflightReport({
    payload: input.payload,
    expectedScenarioId: input.expectedScenarioId,
  });

  return {
    schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "ui_xr_manual_performance_evidence_payload",
    scenarioId: scaffold.scenarioId,
    runtimeAssetBundleId: scaffold.runtimeAssetBundleId ?? input.payload.runtimeAssetBundleId ?? null,
    status: "metadata_only_attachment_submit_input_ready",
    runtimeEvidenceCandidateCount: scaffold.runtimeEvidenceCandidateCount,
    visualQaEvidenceCandidateCount: scaffold.visualQaEvidenceCandidateCount,
    preflightReport,
    submitRuntimeVisualEvidenceAttachmentInput: scaffold.submitRuntimeVisualEvidenceAttachmentInput,
    adminAttachmentRouteHandoff: {
      route: "/runtime/visual-evidence-attachments",
      method: "POST",
      bodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
      rawPayloadDisplayed: false,
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "ui_xr_consumer_handoff_uses_existing_metadata_attachment_route",
    },
    operatorSubmissionWorkflow: {
      status: "ready_for_guarded_attachment_route",
      sourceArtifactRef: "ui_xr_runtime_evidence_consumer_artifact",
      routeHandoffRef: "adminAttachmentRouteHandoff",
      submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
      reviewerAction: "submit_metadata_only_runtime_visual_evidence_refs",
      preflightChecks: [
        "scenario_id_matches_payload_and_expected_scenario",
        "attachments_non_empty",
        "raw_payload_hidden",
        "all_execution_and_readiness_gates_false",
      ],
      operatorSelectable: true,
      nextActions: [
        `operator-select and submit up to ${scaffold.submitRuntimeVisualEvidenceAttachmentInput.attachments.length} metadata-only UI-XR refs via guarded route (use operatorSelectableAttachmentCount)`,
        "confirm Admin replay projection shows raw payload hidden and all readiness gates false",
        "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until real runtime and visual-QA evidence clears review",
      ],
      rawPayloadDisplayed: false,
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "ui_xr_operator_workflow_uses_existing_guarded_attachment_route",
    },
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    operatorSelectionEnabled: true,
    operatorSelectableAttachmentCount: typeof preflightReport?.operatorSelectableAttachmentCount === 'number' ? preflightReport.operatorSelectableAttachmentCount : 0,
    operatorSelectionSupport: 'subset-via-count',
    blockers: [
      "ui_xr_metadata_refs_require_admin_attachment_review",
      "ui_xr_payload_not_runtime_readiness",
      "ui_xr_payload_not_quest_readiness",
    ],
    recommendedNextActions: [
      "submit metadata-only UI-XR runtime visual evidence refs through the reviewed attachment route",
      "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until reviewed runtime and visual-QA evidence clears",
    ],
    claimBoundary: "ui_xr_runtime_evidence_consumer_metadata_only_not_readiness",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function buildUiXrRuntimeEvidenceConsumerPreflightReport(input: {
  payload: UiXrManualPerformanceEvidencePayload;
  expectedScenarioId?: string | undefined;
}): UiXrRuntimeEvidenceConsumerPreflightReport {
  const scaffold = input.payload.runtimeVisualEvidenceCaptureScaffold;
  const validation = validateUiXrRuntimeVisualEvidenceCaptureScaffold(scaffold, input.expectedScenarioId);
  const blockerIds = preflightBlockerIds(scaffold, validation.errors);
  const attachments = readSubmitAttachments(scaffold);
  const attachmentCount = attachments.length;
  return {
    schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-preflight.v1",
    source: "ui_xr_manual_performance_evidence_payload",
    status: blockerIds.length === 0 ? "consumer_ready_metadata_only" : "consumer_blocked",
    scenarioId: scaffold?.scenarioId ?? null,
    runtimeAssetBundleId: scaffold?.runtimeAssetBundleId ?? input.payload.runtimeAssetBundleId ?? null,
    attachmentCount,
    runtimeEvidenceCandidateCount: typeof scaffold?.runtimeEvidenceCandidateCount === "number" ? scaffold.runtimeEvidenceCandidateCount : 0,
    visualQaEvidenceCandidateCount: typeof scaffold?.visualQaEvidenceCandidateCount === "number" ? scaffold.visualQaEvidenceCandidateCount : 0,
    targetRoute: "/runtime/visual-evidence-attachments",
    submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
    submitPreview: {
      route: "/runtime/visual-evidence-attachments",
      bodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
      attachmentCount,
      actionIds: attachments
        .map((attachment) => attachment.actionId)
        .filter((actionId): actionId is RuntimeVisualEvidenceAttachmentActionId => actionId === "attach_runtime_realism_evidence_refs" || actionId === "attach_visual_qa_evidence_refs"),
      inputIds: attachments
        .map((attachment) => attachment.inputId)
        .filter((inputId): inputId is string => typeof inputId === "string" && inputId.length > 0),
      localArtifactPaths: attachments
        .map((attachment) => attachment.localArtifactPath)
        .filter((localArtifactPath): localArtifactPath is string => typeof localArtifactPath === "string" && localArtifactPath.length > 0),
      rawPayloadDisplayed: false,
      operatorSelectable: true,
      operatorSelectableAttachmentCount: attachmentCount,
      operatorSelectionEnabled: true,
      operatorSelectionSupport: 'subset-via-count',
      claimBoundary: "ui_xr_consumer_preflight_submit_preview_metadata_only",
    },
    blockerIds,
    envWorldAsset: scaffold?.caseDerivedVirtualEnvironment ? {
      roomType: scaffold.caseDerivedVirtualEnvironment.roomType,
      gltfAssetUrl: (scaffold as any).gltfAssetUrlForEnv ?? null,
      attachableViaConsumer: true,
      operatorSelectable: true,
      source: "caseDerivedVirtualEnvironment_from_launched_player_world",
      producedGltfManifest: (scaffold as any).caseDerivedVirtualEnvironment?.envGltfManifest ?? null,
      producedBy: "factory materialization from case envGltfManifest + authoringVet (wired to consumer for attach of the produced asset for the launched world)",
    } : null,
    nextActions: blockerIds.length === 0
      ? [
        `operator-select and submit up to ${attachmentCount} metadata-only UI-XR refs via guarded route (use operatorSelectableAttachmentCount)`,
        "confirm Admin replay projection shows raw payload hidden and all readiness gates false",
        "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until real runtime and visual-QA evidence clears review",
        scaffold?.caseDerivedVirtualEnvironment ? `operator-select the launched virtual env world (${scaffold.caseDerivedVirtualEnvironment.roomType} + gltf) for guarded attach via consumer (review-safe metadata for the real scene validated in running player)` : undefined,
      ].filter(Boolean) as string[]
      : [
        "repair the copied UI-XR manual performance payload before attachment submission",
        "rerun UI-XR runtime evidence consumer preflight before writing a consumer artifact",
        "keep raw payload display and all readiness/execution gates blocked",
      ],
    rawPayloadDisplayed: false,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    operatorSelectionEnabled: true,
    operatorSelectableAttachmentCount: attachmentCount,
    claimBoundary: "ui_xr_consumer_preflight_metadata_only_not_runtime_visual_evidence",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateUiXrRuntimeEvidenceConsumerArtifact(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.ui-xr-runtime-evidence-consumer.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "ui_xr_manual_performance_evidence_payload", "/source", errors);
  requireString(value.scenarioId, "/scenarioId", errors);
  requireNumber(value.runtimeEvidenceCandidateCount, "/runtimeEvidenceCandidateCount", errors);
  requireNumber(value.visualQaEvidenceCandidateCount, "/visualQaEvidenceCandidateCount", errors);
  validateArtifactPreflightReport(value, errors);
  validateSubmitInput(value.submitRuntimeVisualEvidenceAttachmentInput, value.scenarioId, errors);
  validateAdminAttachmentRouteHandoff(value.adminAttachmentRouteHandoff, errors);
  validateOperatorSubmissionWorkflow(value.operatorSubmissionWorkflow, errors);
  validateFalseGates(value, "", errors);
  requireLiteral(value.claimBoundary, "ui_xr_runtime_evidence_consumer_metadata_only_not_readiness", "/claimBoundary", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  return { ok: errors.length === 0, errors };
}

function validateArtifactPreflightReport(value: Record<string, unknown>, errors: string[]): void {
  const preflightValidation = validateUiXrRuntimeEvidenceConsumerPreflightReport(value.preflightReport);
  for (const error of preflightValidation.errors) {
    errors.push(`/preflightReport${error}`);
  }
  if (!isRecord(value.preflightReport)) return;
  requireLiteral(value.preflightReport.status, "consumer_ready_metadata_only", "/preflightReport/status", errors);
  requireLiteral(value.preflightReport.scenarioId, value.scenarioId, "/preflightReport/scenarioId", errors);
  requireLiteral(value.preflightReport.attachmentCount, readSubmitAttachmentsFromSubmitInput(value.submitRuntimeVisualEvidenceAttachmentInput).length, "/preflightReport/attachmentCount", errors);
  requireLiteral(value.preflightReport.runtimeEvidenceCandidateCount, value.runtimeEvidenceCandidateCount, "/preflightReport/runtimeEvidenceCandidateCount", errors);
  requireLiteral(value.preflightReport.visualQaEvidenceCandidateCount, value.visualQaEvidenceCandidateCount, "/preflightReport/visualQaEvidenceCandidateCount", errors);
}

export function validateUiXrRuntimeEvidenceConsumerPreflightReport(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.ui-xr-runtime-evidence-consumer-preflight.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "ui_xr_manual_performance_evidence_payload", "/source", errors);
  if (value.status !== "consumer_ready_metadata_only" && value.status !== "consumer_blocked") {
    errors.push("/status must be consumer_ready_metadata_only or consumer_blocked");
  }
  if (value.scenarioId !== null) requireString(value.scenarioId, "/scenarioId", errors);
  if (value.runtimeAssetBundleId !== null) requireString(value.runtimeAssetBundleId, "/runtimeAssetBundleId", errors);
  requireNumber(value.attachmentCount, "/attachmentCount", errors);
  requireNumber(value.runtimeEvidenceCandidateCount, "/runtimeEvidenceCandidateCount", errors);
  requireNumber(value.visualQaEvidenceCandidateCount, "/visualQaEvidenceCandidateCount", errors);
  requireLiteral(value.targetRoute, "/runtime/visual-evidence-attachments", "/targetRoute", errors);
  requireLiteral(value.submitBodyRef, "submitRuntimeVisualEvidenceAttachmentInput", "/submitBodyRef", errors);
  validatePreflightSubmitPreview(value.submitPreview, value.attachmentCount, errors);
  requireArray(value.blockerIds, "/blockerIds", errors);
  requireArray(value.nextActions, "/nextActions", errors);
  if (Array.isArray(value.nextActions) && value.nextActions.length === 0) {
    errors.push("/nextActions must not be empty");
  }
  if (value.status === "consumer_ready_metadata_only" && Array.isArray(value.blockerIds) && value.blockerIds.length > 0) {
    errors.push("/blockerIds must be empty when status is consumer_ready_metadata_only");
  }
  if (value.status === "consumer_blocked" && Array.isArray(value.blockerIds) && value.blockerIds.length === 0) {
    errors.push("/blockerIds must not be empty when status is consumer_blocked");
  }
  requireLiteral(value.rawPayloadDisplayed, false, "/rawPayloadDisplayed", errors);
  validateFalseGates(value, "", errors);
  requireLiteral(value.claimBoundary, "ui_xr_consumer_preflight_metadata_only_not_runtime_visual_evidence", "/claimBoundary", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  return { ok: errors.length === 0, errors };
}

function validatePreflightSubmitPreview(value: unknown, attachmentCount: unknown, errors: string[]): void {
  requireRecord(value, "/submitPreview", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.route, "/runtime/visual-evidence-attachments", "/submitPreview/route", errors);
  requireLiteral(value.bodyRef, "submitRuntimeVisualEvidenceAttachmentInput", "/submitPreview/bodyRef", errors);
  requireLiteral(value.attachmentCount, attachmentCount, "/submitPreview/attachmentCount", errors);
  requireArray(value.actionIds, "/submitPreview/actionIds", errors);
  requireArray(value.inputIds, "/submitPreview/inputIds", errors);
  requireArray(value.localArtifactPaths, "/submitPreview/localArtifactPaths", errors);
  if (typeof attachmentCount === "number") {
    if (Array.isArray(value.actionIds) && value.actionIds.length !== attachmentCount) {
      errors.push(`/submitPreview/actionIds must contain ${attachmentCount} entries`);
    }
    if (Array.isArray(value.inputIds) && value.inputIds.length !== attachmentCount) {
      errors.push(`/submitPreview/inputIds must contain ${attachmentCount} entries`);
    }
    if (Array.isArray(value.localArtifactPaths) && value.localArtifactPaths.length !== attachmentCount) {
      errors.push(`/submitPreview/localArtifactPaths must contain ${attachmentCount} entries`);
    }
  }
  requireLiteral(value.rawPayloadDisplayed, false, "/submitPreview/rawPayloadDisplayed", errors);
  requireLiteral(value.claimBoundary, "ui_xr_consumer_preflight_submit_preview_metadata_only", "/submitPreview/claimBoundary", errors);
}

function validateUiXrRuntimeVisualEvidenceCaptureScaffold(
  value: unknown,
  expectedScenarioId: string | undefined,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/runtimeVisualEvidenceCaptureScaffold must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.ui-xr-runtime-visual-evidence-capture-scaffold.v1", "/runtimeVisualEvidenceCaptureScaffold/schemaVersion", errors);
  requireLiteral(value.source, "ui_xr_manual_performance_evidence_payload", "/runtimeVisualEvidenceCaptureScaffold/source", errors);
  requireString(value.scenarioId, "/runtimeVisualEvidenceCaptureScaffold/scenarioId", errors);
  if (expectedScenarioId && value.scenarioId !== expectedScenarioId) {
    errors.push(`/runtimeVisualEvidenceCaptureScaffold/scenarioId must match expected scenario ${expectedScenarioId}`);
  }
  requireLiteral(value.status, "metadata_only_attachment_candidates_not_submitted", "/runtimeVisualEvidenceCaptureScaffold/status", errors);
  requireNumber(value.runtimeEvidenceCandidateCount, "/runtimeVisualEvidenceCaptureScaffold/runtimeEvidenceCandidateCount", errors);
  requireNumber(value.visualQaEvidenceCandidateCount, "/runtimeVisualEvidenceCaptureScaffold/visualQaEvidenceCandidateCount", errors);
  validateSubmitInput(value.submitRuntimeVisualEvidenceAttachmentInput, value.scenarioId, errors);
  validateFalseGates(value, "/runtimeVisualEvidenceCaptureScaffold", errors);
  requireLiteral(value.claimBoundary, "ui_xr_capture_scaffold_not_runtime_visual_evidence", "/runtimeVisualEvidenceCaptureScaffold/claimBoundary", errors);
  requireArray(value.notEvidenceFor, "/runtimeVisualEvidenceCaptureScaffold/notEvidenceFor", errors);
  return { ok: errors.length === 0, errors };
}

function validateAdminAttachmentRouteHandoff(value: unknown, errors: string[]): void {
  requireRecord(value, "/adminAttachmentRouteHandoff", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.route, "/runtime/visual-evidence-attachments", "/adminAttachmentRouteHandoff/route", errors);
  requireLiteral(value.method, "POST", "/adminAttachmentRouteHandoff/method", errors);
  requireLiteral(value.bodyRef, "submitRuntimeVisualEvidenceAttachmentInput", "/adminAttachmentRouteHandoff/bodyRef", errors);
  requireLiteral(value.rawPayloadDisplayed, false, "/adminAttachmentRouteHandoff/rawPayloadDisplayed", errors);
  validateFalseGates(value, "/adminAttachmentRouteHandoff", errors);
  requireLiteral(value.claimBoundary, "ui_xr_consumer_handoff_uses_existing_metadata_attachment_route", "/adminAttachmentRouteHandoff/claimBoundary", errors);
}

function validateOperatorSubmissionWorkflow(value: unknown, errors: string[]): void {
  requireRecord(value, "/operatorSubmissionWorkflow", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.status, "ready_for_guarded_attachment_route", "/operatorSubmissionWorkflow/status", errors);
  requireLiteral(value.sourceArtifactRef, "ui_xr_runtime_evidence_consumer_artifact", "/operatorSubmissionWorkflow/sourceArtifactRef", errors);
  requireLiteral(value.routeHandoffRef, "adminAttachmentRouteHandoff", "/operatorSubmissionWorkflow/routeHandoffRef", errors);
  requireLiteral(value.submitBodyRef, "submitRuntimeVisualEvidenceAttachmentInput", "/operatorSubmissionWorkflow/submitBodyRef", errors);
  requireLiteral(value.reviewerAction, "submit_metadata_only_runtime_visual_evidence_refs", "/operatorSubmissionWorkflow/reviewerAction", errors);
  const expectedPreflightChecks = [
    "scenario_id_matches_payload_and_expected_scenario",
    "attachments_non_empty",
    "raw_payload_hidden",
    "all_execution_and_readiness_gates_false",
  ];
  requireArray(value.preflightChecks, "/operatorSubmissionWorkflow/preflightChecks", errors);
  if (Array.isArray(value.preflightChecks)) {
    expectedPreflightChecks.forEach((check, index) => {
      requireLiteral(value.preflightChecks[index], check, `/operatorSubmissionWorkflow/preflightChecks/${index}`, errors);
    });
    if (value.preflightChecks.length !== expectedPreflightChecks.length) {
      errors.push(`/operatorSubmissionWorkflow/preflightChecks must contain ${expectedPreflightChecks.length} checks`);
    }
  }
  requireArray(value.nextActions, "/operatorSubmissionWorkflow/nextActions", errors);
  if (Array.isArray(value.nextActions) && value.nextActions.length === 0) {
    errors.push("/operatorSubmissionWorkflow/nextActions must not be empty");
  }
  requireLiteral(value.rawPayloadDisplayed, false, "/operatorSubmissionWorkflow/rawPayloadDisplayed", errors);
  validateFalseGates(value, "/operatorSubmissionWorkflow", errors);
  requireLiteral(
    value.claimBoundary,
    "ui_xr_operator_workflow_uses_existing_guarded_attachment_route",
    "/operatorSubmissionWorkflow/claimBoundary",
    errors,
  );
}

function preflightBlockerIds(
  scaffold: UiXrRuntimeVisualEvidenceCaptureScaffold | null | undefined,
  validationErrors: string[],
): string[] {
  const blockerIds = new Set<string>();
  if (!scaffold) {
    blockerIds.add("runtime_visual_evidence_capture_scaffold_missing");
  }
  if (scaffold && readSubmitAttachments(scaffold).length === 0) {
    blockerIds.add("attachments_empty");
  }
  for (const error of validationErrors) {
    if (error.includes("must match expected scenario")) {
      blockerIds.add("scenario_id_mismatch");
    } else if (error.includes("must be false")) {
      blockerIds.add("readiness_gate_true");
    } else if (error.includes("/attachments must not be empty")) {
      blockerIds.add("attachments_empty");
    } else if (error.includes("runtimeVisualEvidenceCaptureScaffold must be object")) {
      blockerIds.add("runtime_visual_evidence_capture_scaffold_missing");
    } else {
      blockerIds.add(`validation_error:${error}`);
    }
  }
  return [...blockerIds];
}

function readSubmitAttachments(scaffold: UiXrRuntimeVisualEvidenceCaptureScaffold | null | undefined): Array<Record<string, unknown>> {
  if (!isRecord(scaffold)) return [];
  const submitInput = scaffold.submitRuntimeVisualEvidenceAttachmentInput;
  return readSubmitAttachmentsFromSubmitInput(submitInput);
}

function readSubmitAttachmentsFromSubmitInput(submitInput: unknown): Array<Record<string, unknown>> {
  if (!isRecord(submitInput) || !Array.isArray(submitInput.attachments)) return [];
  return submitInput.attachments.filter(isRecord);
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePreflightPath) {
    const validation = validateUiXrRuntimeEvidenceConsumerPreflightReport(JSON.parse(await readFile(options.validatePreflightPath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`UI-XR runtime evidence consumer preflight validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated preflight ${options.validatePreflightPath}`);
    return;
  }
  if (options.validatePath) {
    const validation = validateUiXrRuntimeEvidenceConsumerArtifact(JSON.parse(await readFile(options.validatePath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`UI-XR runtime evidence consumer artifact validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const payload = JSON.parse(await readFile(options.inputPath, "utf8")) as UiXrManualPerformanceEvidencePayload;
  if (options.preflight) {
    const preflight = buildUiXrRuntimeEvidenceConsumerPreflightReport({
      payload,
      expectedScenarioId: options.scenarioId ?? undefined,
    });
    const preflightJson = `${JSON.stringify(preflight, null, 2)}\n`;
    if (options.preflightOutputPath) {
      await writeFile(options.preflightOutputPath, preflightJson, "utf8");
      console.log(`Wrote preflight ${options.preflightOutputPath}`);
    } else {
      console.log(preflightJson.trimEnd());
    }
    if (preflight.status === "consumer_blocked") process.exitCode = 1;
    return;
  }
  const artifact = buildUiXrRuntimeEvidenceConsumerArtifact({
    payload,
    expectedScenarioId: options.scenarioId ?? undefined,
  });
  await writeFile(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function validateSubmitInput(value: unknown, scenarioId: unknown, errors: string[]): void {
  requireRecord(value, "/submitRuntimeVisualEvidenceAttachmentInput", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.scenarioId, scenarioId, "/submitRuntimeVisualEvidenceAttachmentInput/scenarioId", errors);
  requireArray(value.attachments, "/submitRuntimeVisualEvidenceAttachmentInput/attachments", errors);
  if (!Array.isArray(value.attachments)) return;
  if (value.attachments.length === 0) errors.push("/submitRuntimeVisualEvidenceAttachmentInput/attachments must not be empty");
  value.attachments.forEach((entry, index) => {
    validateAttachment(entry, `/submitRuntimeVisualEvidenceAttachmentInput/attachments/${index}`, errors);
  });
}

function validateAttachment(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
    return;
  }
  if (value.actionId !== "attach_runtime_realism_evidence_refs" && value.actionId !== "attach_visual_qa_evidence_refs") {
    errors.push(`${pathName}/actionId must be a runtime visual evidence attachment action`);
  }
  if (value.inputKind !== "runtime_realism_signal_input" && value.inputKind !== "visual_qa_review_input") {
    errors.push(`${pathName}/inputKind must be runtime_realism_signal_input or visual_qa_review_input`);
  }
  if (value.actionId === "attach_runtime_realism_evidence_refs") requireLiteral(value.inputKind, "runtime_realism_signal_input", `${pathName}/inputKind`, errors);
  if (value.actionId === "attach_visual_qa_evidence_refs") requireLiteral(value.inputKind, "visual_qa_review_input", `${pathName}/inputKind`, errors);
  requireString(value.inputId, `${pathName}/inputId`, errors);
  requireString(value.evidenceRef, `${pathName}/evidenceRef`, errors);
  requireString(value.localArtifactPath, `${pathName}/localArtifactPath`, errors);
  requireLiteral(value.reviewerId, "ui_xr_manual_runtime_evidence_capture_scaffold", `${pathName}/reviewerId`, errors);
  requireLiteral(value.attachmentStatus, "attached_metadata_only", `${pathName}/attachmentStatus`, errors);
  requireString(value.comments, `${pathName}/comments`, errors);
  requireString(value.attachedAt, `${pathName}/attachedAt`, errors);
}

function validateFalseGates(value: Record<string, unknown>, pathName: string, errors: string[]): void {
  for (const key of [
    "providerExecutionAllowed",
    "runtimeExecutionAllowed",
    "learnerLaunchAllowed",
    "questEvidenceRefreshAllowed",
    "productionAssetReadinessClaimed",
    "clinicalValidityClaimed",
    "scoringValidityClaimed",
  ]) {
    requireLiteral(value[key], false, `${pathName}/${key}`, errors);
  }
}

function parseCliOptions(args: string[]): {
  inputPath: string;
  outputPath: string;
  scenarioId: string | null;
  validatePath: string | null;
  validatePreflightPath: string | null;
  preflightOutputPath: string | null;
  preflight: boolean;
} {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let inputPath = "docs/openclinxr/ui-xr-manual-performance-evidence-2026-05-28.json";
  let outputPath = path.join("docs/openclinxr", "ui-xr-runtime-evidence-consumer-2026-05-28.json");
  let scenarioId: string | null = null;
  let validatePath: string | null = null;
  let validatePreflightPath: string | null = null;
  let preflightOutputPath: string | null = null;
  let preflight = false;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if ((arg === "--input" || arg === "--payload") && next) {
      inputPath = next;
      index += 1;
    } else if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
    } else if (arg === "--scenario-id" && next) {
      scenarioId = next;
      index += 1;
    } else if (arg === "--validate" && next) {
      validatePath = next;
      index += 1;
    } else if (arg === "--validate-preflight" && next) {
      validatePreflightPath = next;
      index += 1;
    } else if (arg === "--preflight-output" && next) {
      preflightOutputPath = next;
      index += 1;
    } else if (arg === "--preflight") {
      preflight = true;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }
  return { inputPath, outputPath, scenarioId, validatePath, validatePreflightPath, preflightOutputPath, preflight };
}

function requireLiteral<T>(value: unknown, expected: T, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pathName} must be non-empty string`);
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${pathName} must be finite number`);
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${pathName} must be array`);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${pathName} must be object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
