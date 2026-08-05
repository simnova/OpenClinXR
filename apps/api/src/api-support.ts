import { type RealTelemetryRecorder, type TelemetryRecorder, type TelemetryRunCounters, type TelemetrySnapshot, type TelemetrySpanRecord, summarizeTelemetrySpans } from "@openclinxr/telemetry";
import type { RealtimeVoiceGatewayPostureInput } from "@openclinxr/voice-gateway";
import { existsSync, readFileSync } from "node:fs";
import { type RealtimeVoiceProtocolLaneId } from "@openclinxr/voice-gateway";
import type { ApiMaterializationInputReviewDecision, ApiMaterializationInputReviewDecisionRecord, ApiRuntimeRealismEvidenceInputReviewDecision, ApiRuntimeRealismEvidenceInputReviewDecisionRecord, ApiRuntimeVisualEvidenceAttachment, ApiRuntimeVisualEvidenceAttachmentRecord, ApiRuntimeRealismEvidenceAttachmentSummary, ApiRuntimeVisualEvidenceAttachmentActionPacket } from "./api-types.js";
import path from "node:path";


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readGeneratedJsonIfExists(relativePath: string): unknown | null {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (!existsSync(absolutePath)) return null;
  return JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
}


export function readRepoGeneratedJsonIfExists(relativePath: string): unknown | null {
  const direct = readGeneratedJsonIfExists(relativePath);
  if (direct) return direct;
  const repoRootPath = path.resolve(process.cwd(), "../..", relativePath);
  if (!existsSync(repoRootPath)) return null;
  return JSON.parse(readFileSync(repoRootPath, "utf8")) as unknown;
}


export function readMaterializationInputManifestSummaryForScenario(scenarioId: string): unknown | undefined {
  const workerReport = readRepoGeneratedJsonIfExists(
    "docs/openclinxr/encounter-asset-generation-worker-peds-asthma-parent-anxiety-2026-05-28.json",
  );
  if (!isRecord(workerReport)) return undefined;
  const summary = workerReport['materializationInputManifestSummary'];
  if (!isRecord(summary)) return undefined;
  const summaryScenarioId = summary['scenarioId'];
  if (typeof summaryScenarioId === "string" && summaryScenarioId !== scenarioId) return undefined;
  return summary;
}


export function readPedsHumanoidMaterializationHandoffForScenario(scenarioId: string): unknown | undefined {
  if (scenarioId !== "peds_asthma_parent_anxiety_v1") return undefined;
  const bundle = readRepoGeneratedJsonIfExists(
    "apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json",
  );
  if (!isRecord(bundle)) return undefined;
  return bundle["pedsHumanoidMaterializationHandoff"];
}


export function attachPedsHumanoidMaterializationHandoff(packet: unknown): unknown {
  if (!isRecord(packet)) return packet;
  if (packet["selectedScenarioId"] !== "peds_asthma_parent_anxiety_v1") return packet;
  if (!isRecord(packet["publicationPayloadLinkage"])) return packet;
  if (packet["publicationPayloadLinkage"]["pedsHumanoidMaterializationHandoff"] !== undefined) return packet;
  const handoff = readPedsHumanoidMaterializationHandoffForScenario(packet["selectedScenarioId"]);
  if (!handoff) return packet;
  return {
    ...packet,
    publicationPayloadLinkage: {
      ...packet["publicationPayloadLinkage"],
      pedsHumanoidMaterializationHandoff: handoff,
    },
  };
}


export function readMaterializationAttachmentPlanSummaryForScenario(scenarioId: string): unknown | undefined {
  const workerReport = readRepoGeneratedJsonIfExists(
    "docs/openclinxr/encounter-asset-generation-worker-peds-asthma-parent-anxiety-2026-05-28.json",
  );
  if (!isRecord(workerReport)) return undefined;
  const summary = workerReport['materializationAttachmentPlanSummary'];
  if (!isRecord(summary)) return undefined;
  const summaryScenarioId = summary['scenarioId'];
  if (typeof summaryScenarioId === "string" && summaryScenarioId !== scenarioId) return undefined;
  return summary;
}


export function readMaterializationEvidenceAttachmentSummaryForScenario(scenarioId: string): unknown | undefined {
  const workerReport = readRepoGeneratedJsonIfExists(
    "docs/openclinxr/encounter-asset-generation-worker-peds-asthma-parent-anxiety-2026-05-28.json",
  );
  if (!isRecord(workerReport)) return undefined;
  const summary = workerReport['materializationEvidenceAttachmentSummary'];
  if (!isRecord(summary)) return undefined;
  const summaryScenarioId = summary['scenarioId'];
  if (typeof summaryScenarioId === "string" && summaryScenarioId !== scenarioId) return undefined;
  return summary;
}


export function readRuntimeEvidenceCaptureScaffoldForScenario(scenarioId: string): unknown | undefined {
  const scaffold = readRepoGeneratedJsonIfExists(
    "docs/openclinxr/encounter-runtime-evidence-capture-scaffold-peds-asthma-parent-anxiety-2026-05-28.json",
  );
  if (!isRecord(scaffold)) return undefined;
  const scaffoldScenarioId = scaffold['selectedScenarioId'];
  if (typeof scaffoldScenarioId === "string" && scaffoldScenarioId !== scenarioId) return undefined;
  return scaffold;
}


export function readRuntimeRealismEvidenceInputDraftForScenario(scenarioId: string): unknown | undefined {
  const draft = readRepoGeneratedJsonIfExists(
    "docs/openclinxr/encounter-runtime-realism-evidence-input-peds-asthma-parent-anxiety-2026-05-28.json",
  );
  if (!isRecord(draft)) return undefined;
  const selectedScenarioId = draft['selectedScenarioId'];
  if (typeof selectedScenarioId === "string" && selectedScenarioId !== scenarioId) return undefined;
  return draft;
}


export function attachMaterializationInputManifestSummary(packet: unknown): unknown {
  if (!isRecord(packet)) return packet;
  if (packet['materializationInputManifestSummary']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId !== "string") return packet;
  const materializationInputManifestSummary = readMaterializationInputManifestSummaryForScenario(selectedScenarioId);
  return materializationInputManifestSummary ? { ...packet, materializationInputManifestSummary } : packet;
}


export function attachMaterializationAttachmentPlanSummary(packet: unknown): unknown {
  if (!isRecord(packet)) return packet;
  if (packet['materializationAttachmentPlanSummary']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId !== "string") return packet;
  const materializationAttachmentPlanSummary = readMaterializationAttachmentPlanSummaryForScenario(selectedScenarioId);
  return materializationAttachmentPlanSummary ? { ...packet, materializationAttachmentPlanSummary } : packet;
}


export function attachMaterializationEvidenceAttachmentSummary(packet: unknown): unknown {
  if (!isRecord(packet)) return packet;
  if (packet['materializationEvidenceAttachmentSummary']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId !== "string") return packet;
  const materializationEvidenceAttachmentSummary = readMaterializationEvidenceAttachmentSummaryForScenario(selectedScenarioId);
  return materializationEvidenceAttachmentSummary ? { ...packet, materializationEvidenceAttachmentSummary } : packet;
}


export function attachRuntimeRealismEvidenceInputDraft(packet: unknown): unknown {
  if (!isRecord(packet)) return packet;
  if (packet['runtimeRealismEvidenceInputDraft']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId !== "string") return packet;
  const runtimeRealismEvidenceInputDraft = readRuntimeRealismEvidenceInputDraftForScenario(selectedScenarioId);
  return runtimeRealismEvidenceInputDraft ? { ...packet, runtimeRealismEvidenceInputDraft } : packet;
}


export function attachRuntimeRealismEvidenceInputReviewDecisionRecord(
  packet: unknown,
  decisionRecord: ApiRuntimeRealismEvidenceInputReviewDecisionRecord | undefined,
): unknown {
  if (!decisionRecord || !isRecord(packet)) return packet;
  if (packet['runtimeRealismEvidenceInputReviewDecisionRecord']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId === "string" && selectedScenarioId !== decisionRecord['scenarioId']) return packet;
  return { ...packet, runtimeRealismEvidenceInputReviewDecisionRecord: decisionRecord };
}


export function attachRuntimeVisualEvidenceAttachmentSummary(
  packet: unknown,
  decisionRecord: ApiRuntimeRealismEvidenceInputReviewDecisionRecord | undefined,
  attachmentRecord?: ApiRuntimeVisualEvidenceAttachmentRecord,
): unknown {
  if (!decisionRecord || !isRecord(packet)) return packet;
  if (packet['runtimeVisualEvidenceAttachmentSummary']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId === "string" && selectedScenarioId !== decisionRecord['scenarioId']) return packet;
  const summary = buildRuntimeRealismEvidenceAttachmentSummary(decisionRecord, attachmentRecord);
  return summary ? { ...packet, runtimeVisualEvidenceAttachmentSummary: summary } : packet;
}


export function attachRuntimeVisualEvidenceAttachmentActionPacket(
  packet: unknown,
  decisionRecord: ApiRuntimeRealismEvidenceInputReviewDecisionRecord | undefined,
  attachmentRecord?: ApiRuntimeVisualEvidenceAttachmentRecord,
): unknown {
  if (!decisionRecord || !isRecord(packet)) return packet;
  if (packet['runtimeVisualEvidenceAttachmentActionPacket']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId === "string" && selectedScenarioId !== decisionRecord['scenarioId']) return packet;
  const summary = buildRuntimeRealismEvidenceAttachmentSummary(decisionRecord, attachmentRecord);
  const actionPacket = buildRuntimeVisualEvidenceAttachmentActionPacket(summary);
  return actionPacket ? { ...packet, runtimeVisualEvidenceAttachmentActionPacket: actionPacket } : packet;
}


export function attachRuntimeVisualEvidenceAttachmentRecord(
  packet: unknown,
  attachmentRecord: ApiRuntimeVisualEvidenceAttachmentRecord | undefined,
): unknown {
  if (!attachmentRecord || !isRecord(packet)) return packet;
  if (packet['runtimeVisualEvidenceAttachmentRecord']) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId === "string" && selectedScenarioId !== attachmentRecord['scenarioId']) return packet;
  return { ...packet, runtimeVisualEvidenceAttachmentRecord: attachmentRecord };
}


export function attachRuntimeEvidenceCaptureScaffold(packet: unknown): unknown {
  if (!isRecord(packet)) return packet;
  if (packet["runtimeEvidenceCaptureScaffold"]) return packet;
  const scenarioId = packet['selectedScenarioId'];
  if (typeof scenarioId !== "string") return packet;
  const scaffold = readRuntimeEvidenceCaptureScaffoldForScenario(scenarioId);
  return scaffold ? { ...packet, runtimeEvidenceCaptureScaffold: scaffold } : packet;
}


export function attachMaterializationInputReviewDecisionRecord(
  packet: unknown,
  decisionRecord: ApiMaterializationInputReviewDecisionRecord | undefined,
): unknown {
  if (!decisionRecord || !isRecord(packet)) return packet;
  if (packet["materializationInputReviewDecisionRecord"]) return packet;
  const selectedScenarioId = packet['selectedScenarioId'];
  if (typeof selectedScenarioId === "string" && selectedScenarioId !== decisionRecord['scenarioId']) return packet;
  return { ...packet, materializationInputReviewDecisionRecord: decisionRecord };
}


export function buildMaterializationInputReviewActionPacket(summary: unknown, notEvidenceFor: readonly string[]): unknown | undefined {
  if (!isRecord(summary)) return undefined;
  const actorWorkOrderInputCount = typeof summary["actorWorkOrderInputCount"] === "number" ? summary["actorWorkOrderInputCount"] : 0;
  const equipmentWorkOrderInputCount = typeof summary["equipmentWorkOrderInputCount"] === "number" ? summary["equipmentWorkOrderInputCount"] : 0;
  const blockerIds = parseStringArray(summary["blockerIds"]);
  const actorBlockerCount = blockerIds.filter((blocker) => blocker.includes("actor")).length;
  const equipmentBlockerCount = blockerIds.filter((blocker) => blocker.includes("equipment")).length;
  return {
    schemaVersion: "openclinxr.encounter-materialization-input-review-action-packet.v1",
    source: "materialization_input_manifest_summary",
    scenarioId: typeof summary['scenarioId'] === "string" ? summary['scenarioId'] : null,
    actionMode: "metadata_only_review_actions_not_provider_execution",
    availableActions: [
      {
        actionId: "review_actor_materialization_inputs",
        status: "available",
        inputCount: actorWorkOrderInputCount,
        blockerCount: actorBlockerCount,
        requiredCueIds: parseStringArray(summary["requiredActorCueIds"]),
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        claimBoundary: "materialization_input_review_action_not_provider_execution",
      },
      {
        actionId: "hold_actor_materialization_inputs",
        status: "available",
        inputCount: actorWorkOrderInputCount,
        blockerCount: actorBlockerCount,
        requiredCueIds: parseStringArray(summary["requiredActorCueIds"]),
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        claimBoundary: "materialization_input_review_action_not_provider_execution",
      },
      {
        actionId: "review_equipment_materialization_inputs",
        status: "available",
        inputCount: equipmentWorkOrderInputCount,
        blockerCount: equipmentBlockerCount,
        requiredCueIds: parseStringArray(summary["requiredEquipmentCueIds"]),
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        claimBoundary: "materialization_input_review_action_not_provider_execution",
      },
      {
        actionId: "hold_equipment_materialization_inputs",
        status: "available",
        inputCount: equipmentWorkOrderInputCount,
        blockerCount: equipmentBlockerCount,
        requiredCueIds: parseStringArray(summary["requiredEquipmentCueIds"]),
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        claimBoundary: "materialization_input_review_action_not_provider_execution",
      },
    ],
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "metadata_only_materialization_input_review_actions",
    notEvidenceFor,
  };
}


export function buildMaterializationInputReviewDecisionRecord(input: {
  requestId: string;
  scenarioId: string;
  decisions: ApiMaterializationInputReviewDecision[];
}): ApiMaterializationInputReviewDecisionRecord {
  return {
    schemaVersion: "openclinxr.encounter-materialization-input-review-decision-record.v1",
    source: "admin_materialization_input_review_decisions",
    requestId: input.requestId,
    scenarioId: input.scenarioId,
    decisionCount: input.decisions.length,
    reviewedDecisionCount: input.decisions.filter((decision) => decision.decision === "reviewed_metadata_only").length,
    heldDecisionCount: input.decisions.filter((decision) => decision.decision === "held_metadata_only").length,
    decisions: input.decisions,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "metadata_only_materialization_input_review_decisions",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}


export function buildRuntimeRealismEvidenceInputReviewDecisionRecord(input: {
  scenarioId: string;
  decisions: ApiRuntimeRealismEvidenceInputReviewDecision[];
}): ApiRuntimeRealismEvidenceInputReviewDecisionRecord {
  return {
    schemaVersion: "openclinxr.runtime-realism-evidence-input-review-decision-record.v1",
    source: "admin_runtime_realism_evidence_input_review_decisions",
    scenarioId: input.scenarioId,
    decisionCount: input.decisions.length,
    reviewedDecisionCount: input.decisions.filter((decision) => decision.decision === "reviewed_metadata_only").length,
    heldDecisionCount: input.decisions.filter((decision) => decision.decision === "held_metadata_only").length,
    decisions: input.decisions,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "metadata_only_runtime_realism_evidence_input_review_decisions",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}


export function buildRuntimeRealismEvidenceAttachmentSummary(
  decisionRecord: ApiRuntimeRealismEvidenceInputReviewDecisionRecord | undefined,
  attachmentRecord?: ApiRuntimeVisualEvidenceAttachmentRecord,
): ApiRuntimeRealismEvidenceAttachmentSummary | undefined {
  if (!decisionRecord) return undefined;
  const runtimeEvidenceAttachmentCount = attachmentRecord?.runtimeEvidenceAttachmentCount ?? 0;
  const visualQaEvidenceAttachmentCount = attachmentRecord?.visualQaEvidenceAttachmentCount ?? 0;
  return {
    schemaVersion: "openclinxr.runtime-realism-evidence-attachment-summary.v1",
    source: "runtime_realism_evidence_input_review_decisions",
    scenarioId: decisionRecord['scenarioId'],
    runtimeActorEvidenceInputCount: decisionRecord.decisions.filter((decision) => decision.inputKind === "runtime_realism_signal_input").length,
    visualQaEvidenceInputCount: decisionRecord.decisions.filter((decision) => decision.inputKind === "visual_qa_review_input").length,
    reviewedMetadataOnlyCount: decisionRecord.reviewedDecisionCount,
    heldMetadataOnlyCount: decisionRecord.heldDecisionCount,
    attachedRuntimeEvidenceCount: runtimeEvidenceAttachmentCount,
    attachedVisualQaEvidenceCount: visualQaEvidenceAttachmentCount,
    reviewedMetadataOnlyInputIds: decisionRecord.decisions
      .filter((decision) => decision.decision === "reviewed_metadata_only")
      .map((decision) => decision.inputId),
    heldMetadataOnlyInputIds: decisionRecord.decisions
      .filter((decision) => decision.decision === "held_metadata_only")
      .map((decision) => decision.inputId),
    blockerIds: [
      ...(runtimeEvidenceAttachmentCount > 0 ? [] : ["runtime_realism_evidence_not_attached_to_encounter_bundle"]),
      ...(visualQaEvidenceAttachmentCount > 0 ? [] : ["visual_qa_evidence_not_attached_to_encounter_bundle"]),
    ],
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "runtime_visual_evidence_attachment_summary_metadata_only_until_artifacts_attach",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}


export function buildRuntimeVisualEvidenceAttachmentRecord(input: {
  scenarioId: string;
  attachments: ApiRuntimeVisualEvidenceAttachment[];
}): ApiRuntimeVisualEvidenceAttachmentRecord {
  return {
    schemaVersion: "openclinxr.runtime-visual-evidence-attachment-record.v1",
    source: "admin_runtime_visual_evidence_attachment_refs",
    scenarioId: input.scenarioId,
    attachmentCount: input.attachments.length,
    runtimeEvidenceAttachmentCount: input.attachments.filter((attachment) => attachment.inputKind === "runtime_realism_signal_input" && attachment.attachmentStatus === "attached_metadata_only").length,
    visualQaEvidenceAttachmentCount: input.attachments.filter((attachment) => attachment.inputKind === "visual_qa_review_input" && attachment.attachmentStatus === "attached_metadata_only").length,
    attachments: input.attachments,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}


export function buildRuntimeVisualEvidenceAttachmentActionPacket(
  summary: ApiRuntimeRealismEvidenceAttachmentSummary | undefined,
): ApiRuntimeVisualEvidenceAttachmentActionPacket | undefined {
  if (!summary) return undefined;
  const runtimeReviewedCount = summary.reviewedMetadataOnlyInputIds
    .filter((inputId) => inputId.startsWith("runtime-realism-evidence-input:")).length;
  const visualReviewedCount = summary.reviewedMetadataOnlyInputIds
    .filter((inputId) => inputId.startsWith("visual-qa-evidence-input:")).length;
  const runtimeHeldCount = summary.heldMetadataOnlyInputIds
    .filter((inputId) => inputId.startsWith("runtime-realism-evidence-input:")).length;
  const visualHeldCount = summary.heldMetadataOnlyInputIds
    .filter((inputId) => inputId.startsWith("visual-qa-evidence-input:")).length;
  return {
    schemaVersion: "openclinxr.runtime-visual-evidence-attachment-action-packet.v1",
    source: "runtime_visual_evidence_attachment_summary",
    scenarioId: summary['scenarioId'],
    actionMode: "metadata_only_attachment_actions_not_runtime_execution",
    availableActions: [
      {
        actionId: "attach_runtime_realism_evidence_refs",
        status: "available",
        requiredInputCount: summary.runtimeActorEvidenceInputCount,
        reviewedMetadataOnlyCount: runtimeReviewedCount,
        heldMetadataOnlyCount: runtimeHeldCount,
        attachedEvidenceCount: summary.attachedRuntimeEvidenceCount,
        blockerIds: summary.attachedRuntimeEvidenceCount > 0 ? [] : ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        claimBoundary: "runtime_visual_evidence_attachment_action_not_runtime_execution",
      },
      {
        actionId: "attach_visual_qa_evidence_refs",
        status: "available",
        requiredInputCount: summary.visualQaEvidenceInputCount,
        reviewedMetadataOnlyCount: visualReviewedCount,
        heldMetadataOnlyCount: visualHeldCount,
        attachedEvidenceCount: summary.attachedVisualQaEvidenceCount,
        blockerIds: summary.attachedVisualQaEvidenceCount > 0 ? [] : ["visual_qa_evidence_not_attached_to_encounter_bundle"],
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        claimBoundary: "runtime_visual_evidence_attachment_action_not_runtime_execution",
      },
    ],
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "metadata_only_runtime_visual_evidence_attachment_actions",
    notEvidenceFor: [...summary.notEvidenceFor],
  };
}


export const realtimeVoiceProtocolPreference: RealtimeVoiceProtocolLaneId[] = [
  "web3-identity-signaling",
  "webtransport-http3-media",
  "direct-quic-media-gateway",
  "websocket-media",
];

export function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function createDefaultRealtimeVoiceGatewayPostureInput(): RealtimeVoiceGatewayPostureInput {
  return {
    bunAvailable: false,
    pythonBackendWebSocketUrlConfigured: false,
    pythonBackendDependenciesInstalled: false,
    pythonInferenceRuntimeInstalled: false,
  };
}

export function telemetrySnapshotFromRecorder(telemetry: TelemetryRecorder): TelemetrySnapshot {
  const real = asRealTelemetryRecorder(telemetry);
  if (real) {
    return real.snapshot();
  }
  const withSpans = telemetry as TelemetryRecorder & { spans?: () => TelemetrySpanRecord[] };
  const spans = typeof withSpans.spans === "function" ? withSpans.spans() : [];
  return {
    spans,
    spanSummary: summarizeTelemetrySpans(spans),
    runCounters: { ...EMPTY_RUN_COUNTERS },
    exportedAt: new Date().toISOString(),
  };
}

export function asRealTelemetryRecorder(telemetry: TelemetryRecorder): RealTelemetryRecorder | undefined {
  const candidate = telemetry as Partial<RealTelemetryRecorder>;
  if (
    typeof candidate.incrementRun === "function"
    && typeof candidate.incrementEncounter === "function"
    && typeof candidate.snapshot === "function"
    && typeof candidate.counters === "function"
  ) {
    return telemetry as RealTelemetryRecorder;
  }
  return undefined;
}

export const EMPTY_RUN_COUNTERS: TelemetryRunCounters = {
  runsStarted: 0,
  runsCompleted: 0,
  runsFailed: 0,
  encountersStarted: 0,
  encountersCompleted: 0,
  encountersFailed: 0,
};
