import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildEncounterDynamicBehaviorCoverageSummary,
  buildEncounterFactorySummaryContracts,
  buildEncounterRuntimeBundlePublicationMetadata,
  buildEnvironmentGenerationQueue,
  buildEnvironmentGenerationWorkOrderQueue,
  buildGuardedRuntimeSelectorDisabledDecision,
  buildScenarioSceneGenerationPipelineWorkOrderQueue,
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  createScenarioPlaceholderManifests,
  ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS,
  evaluateEncounterRuntimeLearnerUseGate,
  InMemoryAssetRegistry,
  type RuntimeAssetReviewDecision,
} from "@openclinxr/asset-registry";
import {
  type AuthIdentity,
  canReadStationRun,
  DEFAULT_DEV_AUTH_IDENTITY,
  DEFAULT_DEV_AUTH_SECRET,
  hasFacultyAccess,
  parseBearerAuthorization,
  resolveSessionLearnerId,
  verifyAuthToken,
} from "@openclinxr/auth";
import {
  AssetGenerationCapabilityFacade,
  type AssetGenerationCapabilityId,
  type AssetGenerationJobPolicyInput,
  buildOpenClinXrCapabilityRoutingMatrix,
  evaluateRuntimeProviderReadinessSurface,
  type RuntimeProfile,
} from "@openclinxr/capability-gateway";
import {
  assembleExamForm,
  createDefaultClinicalSkillsBlueprint,
  createExamStationRunQueue,
  createExamTimingPlan,
  createStep2CsStyleSeedBlueprint,
  type ExamForm,
  type ExamStationRunQueue,
  evaluateBlueprintScenarioReadiness,
  evaluateScenarioVersionDrift,
} from "@openclinxr/exam-assembly";
import {
  AdminGraphqlReviewDecision,
  type AdminGraphqlRootValue,
  type AdminGraphqlScenario,
  AdminGraphqlScenarioStatus,
  adminGraphqlDocuments,
  createGraphqlCodegenPlan,
  executeAdminGraphql,
  openClinXrAdminSchemaSdl,
} from "@openclinxr/graphql";
import { matchOpenClinXrRestRoute, routeById } from "@openclinxr/rest";
import {
  buildFacultyScoreDraft,
  buildReviewDecisionDraft,
  FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR,
  type FacultyScoreDraft,
  type ReviewDecisionDraft,
} from "@openclinxr/review-workflow";
import {
  buildDynamicEncounterFactoryPlanningProjection,
  buildScenarioBankExamSequenceProjection,
  createLearnerScenarioView,
  edChestPainScenario,
  evaluateScenarioBankMaturity,
  scenarioBank,
} from "@openclinxr/scenario-fixtures";
import {
  createDefaultScenarioRuntime,
  type PublicationTargetUse,
  type ReviewerEvidence,
  type RouteRuntimeActorInteractionInput,
  type ScenarioRuntime,
  type ScenarioRuntimeActorTurn,
} from "@openclinxr/scenario-runtime";
import { type Scenario, validateScenario } from "@openclinxr/shared-schemas";
import {
  createTelemetryRecorder,
  openClinXrSpanNames,
  type RealTelemetryRecorder,
  type TelemetryRecorder,
  type TelemetryRunCounters,
  type TelemetrySnapshot,
  type TelemetrySpanRecord,
  telemetryRouteAttributes,
  summarizeTelemetrySpans,
} from "@openclinxr/telemetry";
import {
  createRealtimeVoiceGatewayPosture,
  type RealtimeVoiceGatewayPostureInput,
  type RealtimeVoiceProtocolLaneId,
  selectRealtimeVoiceProtocol,
} from "@openclinxr/voice-gateway";
import { Hono } from "hono";
import { createOpenClinXrApiProtocolPosture, type OpenClinXrApiProtocolPosture } from "./protocol-support.js";
import { isRecord, parseStringArray } from "./api-support.js";

import type {
  RuntimeTraceEvents,
  RuntimeReviewPacket,
  ApiClinicalEventReviewProjection,
  ApiStationRunQueueSnapshot,
  ApiScenarioReviewerRole,
  ApiScenarioReviewDecisionRecord,
  ApiFacultyScoreDraftRecord,
  ApiFacultyReviewDecisionRecord,
  ApiPersistenceSink,
  ApiScenarioSceneGenerationRequestRecord,
  ApiMaterializationInputReviewDecision,
  ApiMaterializationInputReviewDecisionRecord,
  ApiRuntimeRealismEvidenceInputReviewDecision,
  ApiRuntimeRealismEvidenceInputReviewDecisionRecord,
  ApiRuntimeVisualEvidenceAttachment,
  ApiRuntimeVisualEvidenceAttachmentRecord,
  ApiRuntimeRealismEvidenceAttachmentSummary,
  ApiRuntimeVisualEvidenceAttachmentActionPacket,
  ApiRuntimeVisualEvidenceReplayProjection,
  ApiUiXrRuntimeEvidenceConsumerWorkflowSummary,
  ApiAssetReleaseLadderReplayProjection,
  ApiRuntimeEvidenceCaptureScaffold,
  ApiScenarioReviewGateSummary,
  ApiHumanReviewActionSummary,
  ApiAuthOptions,
  ApiAppOptions,
  ApiAppVariables,
} from "./api-types.js";

/** Route-level helpers shared by the per-domain route modules (composition-root migration). */

export function sessionErrorResponse(context: { json: (body: { error: string }, status: 400 | 404 | 500 | 503) => Response }, error: unknown): Response {
  if (error instanceof Error && error.message.startsWith("Session not found")) {
    return context.json({ error: "session_not_found" }, 404);
  }
  if (error instanceof Error && error.message.startsWith("Actor not found")) {
    return context.json({ error: "actor_not_found" }, 400);
  }
  if (error instanceof Error && error.message.startsWith("Actor response generation failed")) {
    return context.json({ error: "actor_response_generation_failed" }, 503);
  }
  if (error instanceof Error && error.message.startsWith("Cannot ")) {
    return context.json({ error: "station_command_invalid" }, 400);
  }
  return context.json({ error: "runtime_error" }, 500);
}

export async function persistTraceSnapshot(runtime: ScenarioRuntime, persistence: ApiPersistenceSink, stationRunId: string): Promise<void> {
  await persistence.saveTraceEvents?.(stationRunId, runtime.traceEvents(stationRunId));
}

export function parseActorInteractionSource(value: unknown): RouteRuntimeActorInteractionInput["source"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value["kind"] === "voice_transcript"
    && typeof value["streamId"] === "string"
    && typeof value["transcriptSegmentId"] === "string"
    && typeof value["finalTranscriptText"] === "string"
    && typeof value["provider"] === "string") {
    return {
      kind: "voice_transcript",
      streamId: value["streamId"],
      transcriptSegmentId: value["transcriptSegmentId"],
      finalTranscriptText: value["finalTranscriptText"],
      provider: value["provider"],
      provenanceRefs: parseStringArray(value["provenanceRefs"]),
    };
  }

  if (value["kind"] === "text") {
    return {
      kind: "text",
      provenanceRefs: parseStringArray(value["provenanceRefs"]),
    };
  }

  return undefined;
}

export function isAssetGenerationCapabilityId(value: string): value is AssetGenerationCapabilityId {
  return value === "character-generation"
    || value === "medical-equipment-generation"
    || value === "voice-asset-generation"
    || value === "animation-generation"
    || value === "asset-bake";
}

export function denyIfCannotReadStationRun(
  identity: AuthIdentity,
  sessionOwners: Map<string, string>,
  stationRunId: string,
): { status: 403; body: { error: string; reason: string } } | undefined {
  const ownerLearnerId = sessionOwners.get(stationRunId);
  if (!ownerLearnerId) {
    // Unknown owner (session missing or created outside this app): let handler return 404/error.
    return undefined;
  }
  if (canReadStationRun(identity, ownerLearnerId)) {
    return undefined;
  }
  return {
    status: 403,
    body: { error: "forbidden", reason: "run_ownership_required" },
  };
}

export function createApiFacultyScoreDraftRecord(input: {
  stationRunId: string;
  scenarioId: string;
  facultyScoreDraft: FacultyScoreDraft;
}): ApiFacultyScoreDraftRecord {
  const savedAt = new Date().toISOString();
  return {
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    draftId: `faculty_score_draft:${input.stationRunId}:${savedAt}`,
    savedAt,
    facultyScoreDraft: input.facultyScoreDraft,
    scoringValidityClaimed: false,
    notEvidenceFor: [...FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR],
    claimScope: FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  };
}

export function coerceRubricScores(value: Record<string, unknown>): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      scores[key] = raw;
    }
  }
  return scores;
}

export function summarizeReviewReplayReadiness(input: {
  stationRunId: string;
  packet: RuntimeReviewPacket;
  clinicalEventReviewSummary: ReturnType<typeof summarizeClinicalEventReviewProjections>;
  traceEvents: RuntimeTraceEvents;
  runtimeRealismEvidenceInputReviewDecisionRecord?: ApiRuntimeRealismEvidenceInputReviewDecisionRecord;
  runtimeVisualEvidenceAttachmentRecord?: ApiRuntimeVisualEvidenceAttachmentRecord;
}) {
  const traceSafetyLabels = input.traceEvents.flatMap((event) => {
    const tag = event.tag ?? "";
    return tag.startsWith("unsafe_") || event.eventType.includes("unsafe") || event.eventType.includes("safety")
      ? [tag || event.eventType]
      : [];
  });
  const safetySignalCount = uniqueStrings([...input.packet.unsafeEvents, ...traceSafetyLabels]).length;
  const replayEvidenceReady = input.packet.timeline.length > 0
    && input.traceEvents.length > 0
    && input.clinicalEventReviewSummary.eventCount > 0
    && input.clinicalEventReviewSummary.safeForFacultyReview;
  const iterationSignalPresent = input.packet.missingRequiredTraceTags.length > 0
    || input.packet.lateTraceTags.length > 0
    || safetySignalCount > 0;
  const blockers = [
    input.packet.timeline.length === 0 ? "review_packet_timeline_missing" : undefined,
    input.traceEvents.length === 0 ? "trace_events_missing" : undefined,
    input.clinicalEventReviewSummary.eventCount === 0 ? "durable_clinical_event_summary_empty" : undefined,
    input.clinicalEventReviewSummary.redactedEventCount < input.clinicalEventReviewSummary.eventCount ? "durable_event_redaction_incomplete" : undefined,
    input.clinicalEventReviewSummary.safeForFacultyReview ? undefined : "durable_summary_not_safe_for_faculty_review",
    input.packet.missingRequiredTraceTags.length > 0 ? "missing_required_behaviors_present" : undefined,
    input.packet.lateTraceTags.length > 0 ? "late_required_behaviors_present" : undefined,
    safetySignalCount > 0 ? "safety_signals_present" : undefined,
  ].filter((blocker): blocker is string => Boolean(blocker));
  const reviewPacketEvidenceHandoff = buildReviewPacketEvidenceHandoff(input);
  const runtimeVisualEvidenceReplayProjection = buildRuntimeVisualEvidenceReplayProjection({
    stationRunId: input.stationRunId,
    scenarioId: input.packet.scenarioId,
    ...(input.runtimeRealismEvidenceInputReviewDecisionRecord ? { decisionRecord: input.runtimeRealismEvidenceInputReviewDecisionRecord } : {}),
    ...(input.runtimeVisualEvidenceAttachmentRecord ? { attachmentRecord: input.runtimeVisualEvidenceAttachmentRecord } : {}),
  });
  const assetReleaseLadderReplayProjection = buildAssetReleaseLadderReplayProjection(input.packet.scenarioId);
  const caseDefinedHumanoidPerformanceContract = buildDynamicEncounterFactoryPlanningProjection(
    scenarioBank,
    input.packet.scenarioId,
  ).scenarios.find((scenario) => scenario.scenarioId === input.packet.scenarioId)?.humanoidPerformanceContract;
  const caseDefinedHumanoidRuntimeHandoff = buildCaseDefinedHumanoidRuntimeHandoffForReview(input.packet.scenarioId);

  return {
    stationRunId: input.stationRunId,
    replayEvidenceReady,
    facultyReviewSafe: replayEvidenceReady,
    timelineEntryCount: input.packet.timeline.length,
    traceEventCount: input.traceEvents.length,
    durableEventCount: input.clinicalEventReviewSummary.eventCount,
    redactedDurableEventCount: input.clinicalEventReviewSummary.redactedEventCount,
    missingRequiredBehaviorCount: input.packet.missingRequiredTraceTags.length,
    lateBehaviorCount: input.packet.lateTraceTags.length,
    safetySignalCount,
    blockers,
    recommendedNextAction: !replayEvidenceReady
      ? "attach_review_safe_replay_evidence"
      : iterationSignalPresent
        ? "use_replay_for_scenario_iteration_before_learner_use"
        : "prepare_faculty_debrief_with_score_use_gate",
    replayBoundary: "summary_only_no_private_payloads_or_score_use_claims",
    runtimeEvidenceGateRefs: runtimeEvidenceGateRefsForReviewReplay(),
    generatedBundlePosture: generatedBundlePostureForReviewReplay(),
    reviewPacketEvidenceHandoff,
    ...(runtimeVisualEvidenceReplayProjection ? { runtimeVisualEvidenceReplayProjection } : {}),
    ...(assetReleaseLadderReplayProjection ? { assetReleaseLadderReplayProjection } : {}),
    ...(caseDefinedHumanoidPerformanceContract ? { caseDefinedHumanoidPerformanceContract } : {}),
    ...(caseDefinedHumanoidRuntimeHandoff.length > 0 ? { caseDefinedHumanoidRuntimeHandoff } : {}),
    ...(reviewPacketEvidenceHandoff.xrTraceEvidenceSummary
      ? { xrTraceEvidenceSummary: reviewPacketEvidenceHandoff.xrTraceEvidenceSummary }
      : {}),
  };
}

export function summarizeClinicalEventReviewProjections(projections: ApiClinicalEventReviewProjection[]) {
  const stationRunIds = uniqueStrings(projections.map((projection) => projection.stationRunId));
  const durableStores = uniqueStrings(projections.map((projection) => projection.durableStore));
  return {
    stationRunId: stationRunIds.length === 1 ? (stationRunIds[0] ?? null) : null,
    eventCount: projections.length,
    redactedEventCount: projections.filter((projection) => projection.privatePayloadRedacted).length,
    clinicalEventKinds: countBy(projections.map((projection) => projection.eventKind)),
    traceTags: uniqueStrings(projections.map((projection) => projection.traceTag).filter((tag): tag is string => Boolean(tag))),
    statusCounts: countBy(projections.map((projection) => projection.status ?? "unknown")),
    latestAtSecond: projections.length === 0 ? null : Math.max(...projections.map((projection) => projection.atSecond)),
    durableStore: durableStores.length === 0 ? null : durableStores.length === 1 ? (durableStores[0] ?? null) : "mixed",
    safeForFacultyReview: projections.every((projection) =>
      projection.durableStore === "database_source_of_truth"
      && projection.privatePayloadRedacted
      && !Object.hasOwn(projection.payload, "private")
    ),
  };
}

export function parseRuntimeProfile(value: unknown): RuntimeProfile {
  if (value === "local-development" || value === "local-production" || value === "production") {
    return value;
  }

  return "local-development";
}

export function isExamForm(value: unknown): value is ExamForm {
  return isRecord(value)
    && typeof value["examFormId"] === "string"
    && Array.isArray(value["stationRefs"])
    && value["stationRefs"].every(isStationRef);
}

export function createSeedStationRunQueueSnapshot(input: { snapshotId?: unknown; createdAt?: unknown; reviewerId?: unknown }): ApiStationRunQueueSnapshot {
  return {
    snapshotId: typeof input.snapshotId === "string" && input.snapshotId.length > 0 ? input.snapshotId : `queue_snapshot_${Date.now()}`,
    createdAt: typeof input.createdAt === "string" && input.createdAt.length > 0 ? input.createdAt : new Date().toISOString(),
    ...(typeof input.reviewerId === "string" && input.reviewerId.length > 0 ? { reviewerId: input.reviewerId } : {}),
    queue: createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank),
  };
}

export function buildAssetReleaseLadderReplayProjection(scenarioId: string): ApiAssetReleaseLadderReplayProjection | undefined {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  if (!scenario) return undefined;
  const ladder = findSeedBankAssetReadiness(scenarioId, scenario.version).productionReadinessLadder;
  const blockedAssets = ladder.assetLadders
    .filter((assetLadder) => !assetLadder.productionReady)
    .map((assetLadder) => {
      const firstBlockedStep = assetLadder.steps.find((step) => step.status === "blocked")?.step ?? null;
      return {
        assetId: assetLadder.assetId,
        blockerCount: assetLadder.blockers.length,
        firstBlockedStep,
        blockerIds: [...assetLadder.blockers],
      };
    });

  return {
    schemaVersion: "openclinxr.asset-release-ladder-replay-projection.v1",
    source: "scenario_asset_production_readiness_ladder",
    scenarioId,
    productionReady: false,
    assetCount: ladder.assetCount,
    productionReadyAssetCount: ladder.productionReadyAssetIds.length,
    blockedAssetCount: ladder.blockedAssetIds.length,
    missingRequiredAssetCount: ladder.missingRequiredAssetIds.length,
    stationBudgetStatus: ladder.stationBudget.blockers.length === 0 ? "ready" : "blocked",
    blockerCount: ladder.blockers.length,
    blockerIds: [...ladder.blockers],
    blockedAssets,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "summary_only_asset_release_ladder_replay_projection_not_release_readiness",
    notEvidenceFor: [
      "provider_availability",
      "runtime_readiness",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "learner_launch_readiness",
    ],
  };
}

export function buildCaseDefinedHumanoidRuntimeHandoffForReview(scenarioId: string) {
  return createSeedBankSceneGenerationPipelineQueue().workOrders
    .filter((workOrder) => workOrder.scenarioId === scenarioId)
    .flatMap((workOrder) => workOrder.actorWorkOrders.map((actorWorkOrder) => ({
      claimBoundary: actorWorkOrder.humanoidRuntimeReadinessHandoff.claimBoundary,
      actorRole: actorWorkOrder.actorRole,
      workOrderIds: [actorWorkOrder.workOrderId],
      locomotionRequired: actorWorkOrder.humanoidRuntimeReadinessHandoff.locomotionRequired,
      expressionRequired: actorWorkOrder.humanoidRuntimeReadinessHandoff.expressionRequired,
      gazeRequired: actorWorkOrder.humanoidRuntimeReadinessHandoff.gazeRequired,
      lipSyncRequired: actorWorkOrder.humanoidRuntimeReadinessHandoff.lipSyncRequired,
      interactiveRequired: actorWorkOrder.humanoidRuntimeReadinessHandoff.interactiveRequired,
      requiredSignalIds: actorWorkOrder.humanoidRuntimeReadinessHandoff.requiredSignalIds,
      blockers: actorWorkOrder.humanoidRuntimeReadinessHandoff.blockers,
      notEvidenceFor: actorWorkOrder.humanoidRuntimeReadinessHandoff.notEvidenceFor,
    })));
}

export function buildReviewPacketEvidenceHandoff(input: {
  stationRunId: string;
  packet: RuntimeReviewPacket;
  traceEvents: RuntimeTraceEvents;
}) {
  const actorTurnEventTypes = new Set([
    "actor.interaction.routed",
    "actor.response.generated",
    "actor.response.failed",
    "voice.audio.generated",
  ]);
  const xrTraceEvidenceSummary = buildXrTraceEvidenceSummary(input);
  return {
    reviewPacketRef: `review_packet:${input.stationRunId}`,
    traceEventRefs: input.traceEvents.map((event) => `trace_event:${input.stationRunId}:${event.sequence}`),
    patientNoteRef: input.packet.patientNote ? `patient_note:${input.stationRunId}:${input.packet.patientNote.submittedAtSecond}` : null,
    actorTurnRefs: input.traceEvents
      .filter((event) => actorTurnEventTypes.has(event.eventType))
      .map((event) => `actor_turn:${input.stationRunId}:${event.sequence}`),
    timelineEntryCount: input.packet.timeline.length,
    patientNoteAttached: Boolean(input.packet.patientNote),
    actorTurnCount: input.traceEvents.filter((event) => actorTurnEventTypes.has(event.eventType)).length,
    privatePayloadRedacted: true,
    ...(xrTraceEvidenceSummary ? { xrTraceEvidenceSummary } : {}),
    claimBoundary: "review_packet_handoff_summary_only_no_private_payloads" as const,
  };
}

export function buildRuntimeVisualEvidenceReplayProjection(input: {
  stationRunId: string;
  scenarioId: string;
  decisionRecord?: ApiRuntimeRealismEvidenceInputReviewDecisionRecord;
  attachmentRecord?: ApiRuntimeVisualEvidenceAttachmentRecord;
}): ApiRuntimeVisualEvidenceReplayProjection | undefined {
  if (input.attachmentRecord?.scenarioId !== input.scenarioId) {
    return undefined;
  }

  const decisionRecord = input.decisionRecord?.scenarioId === input.scenarioId
    ? input.decisionRecord
    : undefined;
  const reviewedMetadataOnlyCount = decisionRecord?.reviewedDecisionCount ?? 0;
  const heldMetadataOnlyCount = decisionRecord?.heldDecisionCount ?? 0;
  const acceptedActionIds = Array.from(new Set(input.attachmentRecord.attachments.map((attachment) => attachment.actionId))).sort((left, right) => left.localeCompare(right)) as ApiRuntimeVisualEvidenceReplayProjection["acceptedActionIds"];
  const blockerIds = [
    reviewedMetadataOnlyCount === 0 ? "runtime_visual_evidence_review_decisions_missing" : undefined,
    input.attachmentRecord.runtimeEvidenceAttachmentCount === 0 ? "runtime_realism_evidence_refs_missing" : undefined,
    input.attachmentRecord.visualQaEvidenceAttachmentCount === 0 ? "visual_qa_evidence_refs_missing" : undefined,
    "runtime_visual_evidence_refs_are_metadata_only_not_replay_payloads",
  ].filter((blocker): blocker is string => Boolean(blocker));
  const nextActions = [
    input.attachmentRecord.attachmentCount > 0 ? `review ${input.attachmentRecord.attachmentCount} accepted metadata-only runtime/visual refs before scenario iteration` : "attach runtime/visual metadata refs before scenario iteration",
    blockerIds.length > 0 ? `carry forward projection blockers ${blockerIds.slice(0, 3).join(", ")}` : "confirm no runtime/visual projection blockers before scenario iteration",
    "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until real runtime and visual-QA evidence clears review",
  ];
  const uiXrConsumerOperatorWorkflowSummary = buildUiXrConsumerWorkflowSummary(input.attachmentRecord);

  return {
    schemaVersion: "openclinxr.runtime-visual-evidence-replay-projection.v1",
    source: "runtime_visual_evidence_attachment_record_summary",
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    reviewedMetadataOnlyCount,
    heldMetadataOnlyCount,
    acceptedAttachmentRefCount: input.attachmentRecord.attachmentCount,
    runtimeEvidenceRefCount: input.attachmentRecord.runtimeEvidenceAttachmentCount,
    visualQaEvidenceRefCount: input.attachmentRecord.visualQaEvidenceAttachmentCount,
    acceptedActionIds,
    rawPayloadDisplayed: false,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    replayEvidenceReady: false,
    blockerIds,
    nextActions,
    ...(uiXrConsumerOperatorWorkflowSummary ? { uiXrConsumerOperatorWorkflowSummary } : {}),
    claimBoundary: "summary_only_runtime_visual_evidence_replay_projection_not_raw_payload_or_readiness",
    notEvidenceFor: [
      "raw_payload_display",
      "runtime_readiness",
      "learner_launch_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export function generatedBundlePostureForReviewReplay() {
  const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
  const learnerUseGate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  const publicationMetadata = buildEncounterRuntimeBundlePublicationMetadata(bundle);
  return {
    bundleId: bundle.bundleId,
    scenarioId: bundle.scenarioId,
    stationId: bundle.stationId,
    status: publicationMetadata.status,
    learnerRuntimeUseBlocked: true as const,
    learnerRuntimeUseBlockers: learnerUseGate.blockers,
    pendingEvidenceGateIds: learnerUseGate.pendingGateIds,
    attachedEvidenceGateIds: learnerUseGate.attachedGateIds,
    publicationArtifactRefs: publicationMetadata.publicationArtifactRefs,
    claimBoundary: "generated_bundle_posture_blocks_learner_use_until_evidence_gates_attach" as const,
    notEvidenceFor: [...publicationMetadata.notEvidenceFor],
  };
}

export function isStationRef(value: unknown): value is ExamForm["stationRefs"][number] {
  return isRecord(value)
    && typeof value["order"] === "number"
    && typeof value["scenarioId"] === "string"
    && typeof value["scenarioVersion"] === "number"
    && typeof value["title"] === "string";
}

export function runtimeEvidenceGateRefsForReviewReplay() {
  const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
  return bundle.evidenceGateRefs.map((gateRef) => ({
    gateId: gateRef.gateId,
    status: gateRef.status,
    evidenceRefs: [...gateRef.evidenceRefs],
    requiredSignalIds: [...gateRef.requiredSignalIds],
    blockers: [...gateRef.blockers],
    notEvidenceFor: [...gateRef.notEvidenceFor],
    claimBoundary: "runtime_evidence_gate_ref_not_learner_or_quest_readiness" as const,
  }));
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function buildUiXrConsumerWorkflowSummary(
  attachmentRecord: ApiRuntimeVisualEvidenceAttachmentRecord,
): ApiUiXrRuntimeEvidenceConsumerWorkflowSummary | undefined {
  const uiXrAttachments = attachmentRecord.attachments.filter((attachment) =>
    attachment.reviewerId === "ui_xr_manual_runtime_evidence_capture_scaffold"
    || attachment.evidenceRef.startsWith("ui-xr-manual-runtime-evidence://")
    || attachment.evidenceRef.startsWith("ui-xr-manual-visual-qa-evidence://")
  );
  if (uiXrAttachments.length === 0) return undefined;
  return {
    schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-workflow-summary.v1",
    source: "ui_xr_runtime_evidence_consumer_operator_workflow",
    scenarioId: attachmentRecord['scenarioId'],
    acceptedAttachmentRefCount: uiXrAttachments.length,
    runtimeEvidenceRefCount: uiXrAttachments.filter((attachment) => attachment.actionId === "attach_runtime_realism_evidence_refs").length,
    visualQaEvidenceRefCount: uiXrAttachments.filter((attachment) => attachment.actionId === "attach_visual_qa_evidence_refs").length,
    targetRoute: "/runtime/visual-evidence-attachments",
    method: "POST",
    submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
    submitPreview: {
      route: "/runtime/visual-evidence-attachments",
      bodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
      attachmentCount: uiXrAttachments.length,
      operatorSelectableAttachmentCount: uiXrAttachments.length,
      operatorSelectionEnabled: true,
      operatorSelectionSupport: 'subset-via-count',
      actionIds: uiXrAttachments.map((attachment) => attachment.actionId),
      inputIds: uiXrAttachments.map((attachment) => attachment.inputId),
      localArtifactPaths: uiXrAttachments.map((attachment) => attachment.localArtifactPath),
      rawPayloadDisplayed: false,
      claimBoundary: "ui_xr_consumer_workflow_submit_preview_metadata_only",
    },
    reviewerAction: "submit_metadata_only_runtime_visual_evidence_refs",
    preflightChecks: [
      "scenario_id_matches_payload_and_expected_scenario",
      "attachments_non_empty",
      "raw_payload_hidden",
      "all_execution_and_readiness_gates_false",
    ],
    nextActions: [
      `submit ${uiXrAttachments.length} metadata-only UI-XR runtime/visual refs through the guarded attachment route`,
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
    blockerIds: ["ui_xr_consumer_refs_are_metadata_only_not_runtime_or_visual_proof"],
    claimBoundary: "summary_only_ui_xr_consumer_workflow_not_raw_payload_or_readiness",
    notEvidenceFor: [
      "raw_payload_display",
      "runtime_readiness",
      "learner_launch_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function buildXrTraceEvidenceSummary(input: {
  stationRunId: string;
  traceEvents: RuntimeTraceEvents;
}) {
  const xrEvent = [...input.traceEvents].reverse().find((event) => event.eventType === "xr.trace.interaction");
  if (!xrEvent || !isRecord(xrEvent.payload)) {
    return null;
  }
  const payload = xrEvent.payload;
  const latestTraceTag = typeof payload["latestTraceTag"] === "string" ? payload["latestTraceTag"] : xrEvent.tag ?? null;
  return {
    stationRunId: input.stationRunId,
    source: typeof payload["source"] === "string" ? payload["source"] : xrEvent.source,
    evidenceRef: typeof payload["evidenceRef"] === "string" ? payload["evidenceRef"] : `trace_event:${input.stationRunId}:${xrEvent.sequence}`,
    activeLocomotionSource: typeof payload["activeLocomotionSource"] === "string" ? payload["activeLocomotionSource"] : null,
    locomotionDistanceMeters: typeof payload["locomotionDistanceMeters"] === "number" ? payload["locomotionDistanceMeters"] : null,
    locomotionTurnRadians: typeof payload["locomotionTurnRadians"] === "number" ? payload["locomotionTurnRadians"] : null,
    interactionSignalRefs: Array.isArray(payload["interactionSignalRefs"])
      ? payload["interactionSignalRefs"].filter((value): value is string => typeof value === "string")
      : [],
    latestTraceTag,
    latestTraceLatencyMs: typeof payload["latestTraceLatencyMs"] === "number" ? payload["latestTraceLatencyMs"] : null,
    blockers: Array.isArray(payload["blockers"])
      ? payload["blockers"].filter((value): value is string => typeof value === "string")
      : [],
    claimBoundary: "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness" as const,
  };
}

export function createSeedBankSceneGenerationPipelineQueue() {
  return buildScenarioSceneGenerationPipelineWorkOrderQueue(scenarioBank);
}

export function findSeedBankAssetReadiness(scenarioId: string, version: number) {
  const scenarioExists = scenarioBank.some((scenario) => scenario.scenarioId === scenarioId && scenario.version === version);
  if (!scenarioExists) {
    throw new Error(`Scenario not found: ${scenarioId} v${version}`);
  }

  const readiness = createSeedBankAssetReadiness().find((candidate) => candidate.scenarioId === scenarioId);
  if (!readiness) {
    throw new Error(`Scenario asset readiness not found: ${scenarioId} v${version}`);
  }

  return readiness;
}

export function createSeedBankAssetReadiness() {
  const registry = new InMemoryAssetRegistry();
  for (const scenario of scenarioBank) {
    for (const manifest of createScenarioPlaceholderManifests(scenario)) {
      registry.upsert(manifest);
    }
  }

  return scenarioBank.map((scenario) => ({
    ...registry.evaluateScenarioReadiness(scenario),
    productionReadinessLadder: registry.evaluateScenarioProductionReadinessLadder(scenario),
  }));
}
