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
export type {
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
import {
  isRecord,
  readGeneratedJsonIfExists,
  readRepoGeneratedJsonIfExists,
  readMaterializationInputManifestSummaryForScenario,
  readPedsHumanoidMaterializationHandoffForScenario,
  attachPedsHumanoidMaterializationHandoff,
  readMaterializationAttachmentPlanSummaryForScenario,
  readMaterializationEvidenceAttachmentSummaryForScenario,
  readRuntimeEvidenceCaptureScaffoldForScenario,
  readRuntimeRealismEvidenceInputDraftForScenario,
  attachMaterializationInputManifestSummary,
  attachMaterializationAttachmentPlanSummary,
  attachMaterializationEvidenceAttachmentSummary,
  attachRuntimeRealismEvidenceInputDraft,
  attachRuntimeRealismEvidenceInputReviewDecisionRecord,
  attachRuntimeVisualEvidenceAttachmentSummary,
  attachRuntimeVisualEvidenceAttachmentActionPacket,
  attachRuntimeVisualEvidenceAttachmentRecord,
  attachRuntimeEvidenceCaptureScaffold,
  attachMaterializationInputReviewDecisionRecord,
  buildMaterializationInputReviewActionPacket,
  buildMaterializationInputReviewDecisionRecord,
  buildRuntimeRealismEvidenceInputReviewDecisionRecord,
  buildRuntimeRealismEvidenceAttachmentSummary,
  buildRuntimeVisualEvidenceAttachmentRecord,
  buildRuntimeVisualEvidenceAttachmentActionPacket,
  realtimeVoiceProtocolPreference,
  parseStringArray,
  createDefaultRealtimeVoiceGatewayPostureInput,
  telemetrySnapshotFromRecorder,
  asRealTelemetryRecorder,
} from "./api-support.js";
import { type ApiAppContext } from "./api-app-context.js";
import { ApiApplication, type ApiApp } from "./api-application.js";
import { registerReviewRoutes } from "./routes/review-routes.js";
import { registerEncounterSessionRoutes } from "./routes/encounter-session-routes.js";
import { registerCapabilityJobRoutes } from "./routes/capability-job-routes.js";
import { registerAuthoringRoutes } from "./routes/authoring-routes.js";
import { registerExamRoutes } from "./routes/exam-routes.js";
import { registerPlatformRoutes } from "./routes/platform-routes.js";
import { buildAssetReleaseLadderReplayProjection, createSeedBankAssetReadiness, createSeedBankSceneGenerationPipelineQueue, createSeedStationRunQueueSnapshot, findSeedBankAssetReadiness, summarizeClinicalEventReviewProjections, summarizeReviewReplayReadiness, uniqueStrings } from "./api-route-support.js";

const FACULTY_ONLY_GRAPHQL_OPERATIONS = new Set([
  "SaveFacultyScoreDraft",
  "SubmitScenarioReview",
]);


/** Narrow optional counter/snapshot surface without coupling callers to concrete recorder type. */


/**
 * Compose the API app.
 *
 * Thin composition root: phases are sequenced by {@link ApiApplication}, feature logic lives in
 * the per-domain route modules. Adding a domain = one line in {@link registerAllRoutes}.
 */
export function createApiApp(
  runtime: ScenarioRuntime = createDefaultScenarioRuntime(),
  persistence: ApiPersistenceSink = {},
  options: ApiAppOptions = {},
): ApiApp {
  return ApiApplication.create()
    .withContext(runtime, persistence, options)
    .withCoreMiddleware()
    .withRoutes(registerAllRoutes)
    .build();
}

/** Route registration surface — one line per domain (routes still inline here are mid-migration). */
function registerAllRoutes(app: ApiApp, ctx: ApiAppContext): void {
  const {
    runtime,
    persistence,
    telemetry,
    assetGenerationFacade,
    realtimeVoiceGatewayPosture,
    apiProtocolPosture,
    sessionOwners,
    adminScenarioOverrides,
    sceneGenerationRequests,
    runtimeRealismEvidenceInputReviewDecisions,
    runtimeVisualEvidenceAttachments,
    latestMaterializationInputReviewDecisionRecordForScenario,
    latestMaterializationInputReviewDecisionRecordForPacket,
  } = ctx;
  const { allowDevDefaultIdentity, secret: authSecret, defaultIdentity } = ctx.auth;


  registerPlatformRoutes(app, ctx);

  app.get(routeById("scenario-bank-dynamic-encounter-factory-planning").path, (context) =>
    context.json({
      ...buildDynamicEncounterFactoryPlanningProjection(scenarioBank),
      routeContractBoundary: routeById("scenario-bank-dynamic-encounter-factory-planning").contractBoundary,
    }),
  );

  app.get(routeById("runtime-selection-review-packet").path, (context) => {
    const inMemoryReviewScenarioId = ctx.state.runtimeVisualEvidenceAttachmentRecord?.scenarioId
      ?? ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId
      ?? sceneGenerationRequests.find((candidate) => candidate.materializationInputReviewDecisionRecord)?.scenarioId;
    const durablePacket = readRepoGeneratedJsonIfExists(
      "docs/openclinxr/encounter-runtime-selection-review-packet-peds-asthma-parent-anxiety-2026-05-28.json",
    );
    if (durablePacket && (!inMemoryReviewScenarioId || inMemoryReviewScenarioId === "peds_asthma_parent_anxiety_v1")) {
      const packetWithSummary = attachMaterializationEvidenceAttachmentSummary(
        attachMaterializationAttachmentPlanSummary(
          attachMaterializationInputManifestSummary(attachRuntimeRealismEvidenceInputDraft(attachPedsHumanoidMaterializationHandoff(durablePacket))),
        ),
      );
      const packetWithRuntimeReviewRecord = attachRuntimeRealismEvidenceInputReviewDecisionRecord(packetWithSummary, ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord);
      const packetWithRuntimeEvidenceScaffold = attachMaterializationInputReviewDecisionRecord(
        attachRuntimeVisualEvidenceAttachmentRecord(
          attachRuntimeVisualEvidenceAttachmentActionPacket(
            attachRuntimeVisualEvidenceAttachmentSummary(packetWithRuntimeReviewRecord, ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord),
            ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord,
            ctx.state.runtimeVisualEvidenceAttachmentRecord,
          ),
          ctx.state.runtimeVisualEvidenceAttachmentRecord,
        ),
        latestMaterializationInputReviewDecisionRecordForPacket(packetWithSummary),
      );
      return context.json(attachRuntimeEvidenceCaptureScaffold(packetWithRuntimeEvidenceScaffold));
    }

    const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const materializationInputReviewDecisionRecord = latestMaterializationInputReviewDecisionRecordForScenario(bundle.scenarioId);
    const guardedRuntimeSelectorDecision = buildGuardedRuntimeSelectorDisabledDecision({
      selectedRuntimeAssetBundleId: bundle.bundleId,
      selectedScenarioId: bundle.scenarioId,
      selectedStationId: bundle.stationId,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      candidateBundles: [bundle],
    });
    return context.json({
      generatedAt: "2026-05-25T00:00:00.000Z",
      schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
      source: "api_local_runtime_bundle_fixture",
      selectedScenarioId: bundle.scenarioId,
      selectedEncounterId: "ed_chest_pain_local_encounter",
      selectedStationId: bundle.stationId,
      selectedRuntimeAssetBundleId: bundle.bundleId,
      reviewPacketMode: "read_only_guarded_runtime_handoff",
      handoffArtifactsInternallyPaired: true,
      runtimeCandidates: {
        model: "mock",
        voice: "mock",
      },
      guardedRuntimeSelectorDecision,
      publicationPayloadLinkage: {
        source: "encounter_publication_payloads",
        status: "blocked",
        blockers: ["humanoid_realism_requirement_actor_missing:family"],
        localMaterializationHandoff: {
          requestId: "encounter_assets_ed_chest_pain_priority_executable_v1",
          scenarioId: "ed_chest_pain_priority_v2",
          rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1",
          plannedOutputCount: 8,
          materializedOutputCount: 0,
          allOutputsPlannedMetadataOnly: true,
        },
        assetNeedsReadiness: {
          readyForDeterministicGeneration: true,
          missingRequiredAssetNeedIds: [],
          blockers: [],
          requiredHumanoidRoles: ["patient", "family", "nurse"],
          animationRequirementCount: 3,
          emotionRequirementCount: 3,
          gazeRequirementCount: 3,
          lipSyncRequirementCount: 3,
          sharedAssetLibrarySemanticKeyCount: 8,
        },
        realismEvidenceRefs: {
          claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
          refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
          refs: [
            { refId: "humanoid-realism-gate", evidenceRef: "encounter-publication-realism://ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1/humanoid-realism-gate/0-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] },
            { refId: "runtime-realism-evidence-check", evidenceRef: "encounter-publication-realism://ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1/runtime-realism-evidence-check/0-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] },
            { refId: "visual-qa-evidence-check", evidenceRef: "encounter-publication-realism://ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1/visual-qa-evidence-check/0-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] },
          ],
          requiredBefore: "guarded_runtime_wiring",
          runtimeExecutionAllowed: false,
          providerExecutionPerformed: false,
          questReadinessClaimed: false,
        },
      },
      operatorReviewReadiness: {
        status: "not_ready_for_operator_review",
        reviewedArtifactCount: 4,
        blockingArtifactCount: 4,
        blockerIds: [
          "runtime_selector_disabled_guard_not_wired",
          "publication_payload_not_materialized",
          "humanoid_realism_requirement_actor_missing:family",
          "runtime_selection_review_packet_api_surface_read_only",
        ],
        requiredOperatorActions: [
          "materialize_or_attach_generated_assets_before_guarded_runtime_wiring",
          "attach_humanoid_runtime_visual_qa_evidence_refs",
          "confirm_provider_execution_remains_disabled_until_explicit_approval",
          "confirm_runtime_selector_remains_disabled_until_evidence_gates_clear",
        ],
        materializationRequiredBeforeRuntime: true,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "operator_review_readiness_metadata_only",
      },
      materializationInputManifestSummary: readMaterializationInputManifestSummaryForScenario(bundle.scenarioId),
      materializationAttachmentPlanSummary: readMaterializationAttachmentPlanSummaryForScenario(bundle.scenarioId),
      materializationEvidenceAttachmentSummary: readMaterializationEvidenceAttachmentSummaryForScenario(bundle.scenarioId),
      materializationInputReviewDecisionRecord,
      runtimeRealismEvidenceInputReviewDecisionRecord: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord,
      runtimeVisualEvidenceAttachmentSummary: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId === bundle.scenarioId
        ? buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord)
        : undefined,
      runtimeVisualEvidenceAttachmentActionPacket: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId === bundle.scenarioId
        ? buildRuntimeVisualEvidenceAttachmentActionPacket(buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord))
        : undefined,
      runtimeVisualEvidenceAttachmentRecord: ctx.state.runtimeVisualEvidenceAttachmentRecord?.scenarioId === bundle.scenarioId ? ctx.state.runtimeVisualEvidenceAttachmentRecord : undefined,
      runtimeEvidenceCaptureScaffold: readRuntimeEvidenceCaptureScaffoldForScenario(bundle.scenarioId),
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      broadVerificationPerformed: false,
      reviewerChecklist: [
        checklist("confirm_selector_guard_remains_disabled", ["runtime_selector_disabled_guard_not_wired"]),
        checklist("confirm_provider_execution_disabled", ["provider_execution_disabled_by_policy"]),
        checklist("confirm_learner_launch_blocked", ["learner_launch_disabled_until_evidence_gates_clear"]),
        checklist("confirm_no_readiness_claims", []),
      ],
      blockers: uniqueStrings([
        ...guardedRuntimeSelectorDecision.blockers,
        "publication_payload_not_materialized",
        "humanoid_realism_requirement_actor_missing:family",
        "runtime_selection_review_packet_api_surface_read_only",
      ]),
      nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
      claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
  });

  app.post(routeById("submit-runtime-realism-evidence-input-review").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { scenarioId?: unknown; decisions?: unknown };
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "peds_asthma_parent_anxiety_v1";
    const decisions = Array.isArray(body.decisions) ? body.decisions.filter(isRuntimeRealismEvidenceInputReviewDecision) : [];
    runtimeRealismEvidenceInputReviewDecisions.push(...decisions);
    ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord = buildRuntimeRealismEvidenceInputReviewDecisionRecord({
      scenarioId,
      decisions: runtimeRealismEvidenceInputReviewDecisions,
    });
    return context.json(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord);
  });

  app.post(routeById("submit-runtime-visual-evidence-attachment").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { scenarioId?: unknown; attachments?: unknown };
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId ?? "peds_asthma_parent_anxiety_v1";
    if (isRecord(body) && isRawUiXrManualPerformancePayload(body)) {
      return context.json({
        error: "raw_ui_xr_payload_not_accepted",
        scenarioId,
        acceptedBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
        rawPayloadDisplayed: false,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "runtime_visual_evidence_attachment_route_rejects_raw_ui_xr_payloads",
      }, 400);
    }
    if (!ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord || ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord.scenarioId !== scenarioId) {
      return context.json({ error: "runtime_realism_evidence_input_review_required", scenarioId }, 400);
    }
    const actionPacket = buildRuntimeVisualEvidenceAttachmentActionPacket(
      buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, undefined),
    );
    const reviewedInputIds = new Set(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord.decisions
      .filter((decision) => decision.decision === "reviewed_metadata_only")
      .map((decision) => decision.inputId));
    const allowedActionIds = new Set(actionPacket?.availableActions.map((action) => action.actionId) ?? []);
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.filter((attachment): attachment is ApiRuntimeVisualEvidenceAttachment =>
        isRuntimeVisualEvidenceAttachment(attachment)
        && allowedActionIds.has(attachment.actionId)
        && reviewedInputIds.has(attachment.inputId)
        && (
          (attachment.actionId === "attach_runtime_realism_evidence_refs" && attachment.inputKind === "runtime_realism_signal_input")
          || (attachment.actionId === "attach_visual_qa_evidence_refs" && attachment.inputKind === "visual_qa_review_input")
        ))
      : [];
    runtimeVisualEvidenceAttachments.push(...attachments);
    ctx.state.runtimeVisualEvidenceAttachmentRecord = buildRuntimeVisualEvidenceAttachmentRecord({
      scenarioId,
      attachments: runtimeVisualEvidenceAttachments,
    });
    return context.json(ctx.state.runtimeVisualEvidenceAttachmentRecord);
  });

  app.get(routeById("learner-runtime-asset-bundle-list").path, async (context) => {
    const fallbackBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const persistedBundles = await persistence.listLearnerRuntimeAssetBundles?.() ?? [];
    const bundleSummaries = [fallbackBundle, ...persistedBundles]
      .filter((bundle, index, bundles) => bundles.findIndex((candidate) => candidate.bundleId === bundle.bundleId) === index)
      .map((bundle) => ({
        bundleId: bundle.bundleId,
        scenarioId: bundle.scenarioId,
        stationId: bundle.stationId,
        identityScope: bundle.identityScope,
        actorCount: bundle.actors.length,
        equipmentCount: bundle.equipment.length,
        retrievalMode: bundle.bundleId === fallbackBundle.bundleId ? "local_fixture_fallback" : "persistence_sink",
      }));

    return context.json({
      bundles: bundleSummaries,
      productionCloudCall: false,
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
  });

  app.get(routeById("learner-runtime-asset-bundle").path, async (context) => {
    const bundleId = context.req.param("bundleId");
    const persistedBundle = await persistence.getLearnerRuntimeAssetBundle?.(bundleId);
    if (persistedBundle) {
      return context.json({
        ...persistedBundle,
        retrievalMode: "persistence_sink",
        productionCloudCall: false,
      });
    }

    const fallbackBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    if (bundleId !== fallbackBundle.bundleId && bundleId !== "ed_chest_pain_local_encounter") {
      return context.json({
        error: "asset_bundle_not_found",
        fallbackBundleId: fallbackBundle.bundleId,
        productionCloudCall: false,
      }, 404);
    }
    return context.json({
      ...fallbackBundle,
      retrievalMode: "local_fixture_fallback",
      productionCloudCall: false,
    });
  });

  app.get(routeById("realtime-voice-posture").path, (context) => {
    const posture = createRealtimeVoiceGatewayPosture(realtimeVoiceGatewayPosture);
    return context.json({
      ...posture,
      recommendedProtocolSelection: selectRealtimeVoiceProtocol(posture, {
        preferredProtocolLaneIds: realtimeVoiceProtocolPreference,
        requireMedia: true,
      }),
    });
  });

  app.get(routeById("admin-graphql-schema").path, () =>
    new Response(openClinXrAdminSchemaSdl, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );

  app.get(routeById("admin-graphql-codegen-plan").path, (context) => context.json(createGraphqlCodegenPlan()));

  app.get(routeById("admin-graphql-documents").path, (context) => context.json(adminGraphqlDocuments));

  app.post(routeById("admin-graphql-execute").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      query?: unknown;
      variables?: unknown;
      operationName?: unknown;
    };
    const graphqlOperationName = typeof body.operationName === "string" && body.operationName.length > 0 ? body.operationName : "anonymous";
    const graphqlStarted = performance.now();

    if (typeof body.query !== "string" || body.query.length === 0) {
      await recordGraphqlOperationSpan(telemetry, {
        operationName: graphqlOperationName,
        statusCode: 400,
        durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
        hasErrors: true,
      });
      return context.json({ errors: [{ message: "query_required" }] }, 400);
    }

    if (isFacultyOnlyGraphqlOperation(graphqlOperationName, body.query) && !hasFacultyAccess(context.get("identity"))) {
      await recordGraphqlOperationSpan(telemetry, {
        operationName: graphqlOperationName,
        statusCode: 403,
        durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
        hasErrors: true,
      });
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const result = await executeAdminGraphql(
      {
        query: body.query,
        ...(isRecord(body.variables) ? { variables: body.variables } : {}),
        ...(graphqlOperationName !== "anonymous" ? { operationName: graphqlOperationName } : {}),
      },
      createAdminGraphqlRoot(runtime, persistence, adminScenarioOverrides, {
        ...(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord ? { runtimeRealismEvidenceInputReviewDecisionRecord: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord } : {}),
        ...(ctx.state.runtimeVisualEvidenceAttachmentRecord ? { runtimeVisualEvidenceAttachmentRecord: ctx.state.runtimeVisualEvidenceAttachmentRecord } : {}),
      }),
    );
    await recordGraphqlOperationSpan(telemetry, {
      operationName: graphqlOperationName,
      statusCode: 200,
      durationMs: Number((performance.now() - graphqlStarted).toFixed(2)),
      hasErrors: Boolean(result.errors?.length),
    });

    return context.json(result);
  });

  app.get(routeById("learner-scenario").path, (context) => context.json(createLearnerScenarioView(edChestPainScenario)));

  app.get(routeById("scenario-bank-maturity").path, (context) => context.json(evaluateScenarioBankMaturity(scenarioBank)));

  app.get(routeById("scenario-bank-exam-sequence").path, (context) => context.json(buildScenarioBankExamSequenceProjection(scenarioBank)));

  app.get(routeById("scenario-bank-asset-readiness").path, (context) => context.json(createSeedBankAssetReadiness()));

  app.get(routeById("scenario-bank-environment-generation-queue").path, (context) => context.json(createSeedBankEnvironmentGenerationQueue()));

  app.get(routeById("scenario-bank-environment-work-order-queue").path, (context) => context.json(createSeedBankEnvironmentWorkOrderQueue()));

  app.get(routeById("scenario-bank-scene-generation-pipeline").path, (context) => context.json(createSeedBankSceneGenerationPipelineQueue()));

  app.get(routeById("list-scenario-scene-generation-requests").path, (context) => context.json({
    requestCount: sceneGenerationRequests.length,
    claimBoundary: "scene_generation_request_queue_not_asset_production",
    requests: sceneGenerationRequests,
  }));

  app.post(routeById("create-scenario-scene-generation-request").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { scenarioId?: unknown };
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
    const pipelineQueue = createSeedBankSceneGenerationPipelineQueue();
    const workOrder = pipelineQueue.workOrders.find((candidate) => candidate.scenarioId === scenarioId);
    if (!workOrder) {
      return context.json({ error: "scenario_scene_generation_pipeline_not_found", scenarioId }, 404);
    }

    const record: ApiScenarioSceneGenerationRequestRecord = {
      requestId: `scene_generation_request:${scenarioId}:local-admin`,
      scenarioId,
      createdAt: new Date().toISOString(),
      status: "accepted",
      reviewStatus: "pending_runtime_asset_review",
      nextAction: "attach_runtime_asset_review_decisions",
      runtimeAssetReviewDecisionCount: 0,
      runtimeAssetReviewDecisions: [],
      materializationInputReviewDecisions: [],
      scenarioReviewGate: buildScenarioReviewGateSummary(scenarioId),
      humanReviewActions: buildHumanReviewActions({
        scenarioId,
        runtimeAssetReviewDecisions: [],
        learnerRuntimeUseBlockers: [],
        humanoidMetadataBlockerIds: [],
      }),
      accepted: true,
      productionAssetReadinessClaimed: false,
      claimBoundary: "scene_generation_request_not_asset_production",
      factoryPlanningContext: {
        scenarioId,
        workOrderId: workOrder.workOrderId,
        isFeaturedFactoryPlanningTarget: workOrder.workOrderId === pipelineQueue.featuredFactoryPlanningWorkOrderId,
        factoryPlanningClaimBoundary: pipelineQueue.factoryPlanningClaimBoundary,
        generationApprovalInferred: false,
      },
      workOrder,
    };
    sceneGenerationRequests.unshift(record);

    return context.json(record);
  });

  app.post(routeById("submit-scenario-scene-generation-request-review").path, async (context) => {
    const requestId = context.req.param("requestId");
    const body = (await context.req.json().catch(() => ({}))) as { decisions?: unknown };
    const record = sceneGenerationRequests.find((candidate) => candidate.requestId === requestId);
    if (!record) {
      return context.json({ error: "scene_generation_request_not_found", requestId }, 404);
    }
    const decisions = Array.isArray(body.decisions) ? body.decisions.filter(isRuntimeAssetReviewDecision) : [];
    record.runtimeAssetReviewDecisions = [...record.runtimeAssetReviewDecisions, ...decisions];
    record.runtimeAssetReviewDecisionCount = record.runtimeAssetReviewDecisions.length;
    record.reviewStatus = record.runtimeAssetReviewDecisionCount > 0 ? "runtime_asset_review_attached" : "pending_runtime_asset_review";
    record.scenarioReviewGate = buildScenarioReviewGateSummary(record.scenarioId);
    record.nextAction = hasApprovedRuntimeAssetReviewEvidence(record.runtimeAssetReviewDecisions) && !record.scenarioReviewGate.learnerUseBlocked
      ? "run_generated_bundle_publisher"
      : "attach_runtime_asset_review_decisions";
    record.humanReviewActions = buildHumanReviewActions({
      scenarioId: record.scenarioId,
      runtimeAssetReviewDecisions: record.runtimeAssetReviewDecisions,
      learnerRuntimeUseBlockers: [],
      humanoidMetadataBlockerIds: [],
    });

    return context.json(record);
  });

  app.post(routeById("submit-scenario-scene-generation-materialization-input-review").path, async (context) => {
    const requestId = context.req.param("requestId");
    const body = (await context.req.json().catch(() => ({}))) as { decisions?: unknown };
    const record = sceneGenerationRequests.find((candidate) => candidate.requestId === requestId);
    if (!record) {
      return context.json({ error: "scene_generation_request_not_found", requestId }, 404);
    }
    const decisions = Array.isArray(body.decisions) ? body.decisions.filter(isMaterializationInputReviewDecision) : [];
    record.materializationInputReviewDecisions = [
      ...record.materializationInputReviewDecisions,
      ...decisions,
    ];
    record.materializationInputReviewDecisionRecord = buildMaterializationInputReviewDecisionRecord({
      requestId: record.requestId,
      scenarioId: record.scenarioId,
      decisions: record.materializationInputReviewDecisions,
    });

    return context.json(record.materializationInputReviewDecisionRecord);
  });

  app.get(routeById("scenario-scene-generation-request-publication-readiness").path, (context) => {
    const requestId = context.req.param("requestId");
    const record = sceneGenerationRequests.find((candidate) => candidate.requestId === requestId);
    if (!record) {
      return context.json({ error: "scene_generation_request_not_found", requestId }, 404);
    }
    const scenarioReviewGate = buildScenarioReviewGateSummary(record.scenarioId);
    const canRunGeneratedBundlePublisher = hasApprovedRuntimeAssetReviewEvidence(record.runtimeAssetReviewDecisions)
      && !scenarioReviewGate.learnerUseBlocked;
    const approvedRuntimeAssetReviewEvidenceRefs = approvedRuntimeAssetReviewEvidence(record.runtimeAssetReviewDecisions);
    const notEvidenceFor = ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] as const;
    const learnerRuntimeBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const learnerUseGate = evaluateEncounterRuntimeLearnerUseGate(learnerRuntimeBundle);
    const runtimeRealismRequiredSignalIds = [...ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS];
    const publicationMetadata = buildEncounterRuntimeBundlePublicationMetadata(learnerRuntimeBundle, {
      publicationReviewEvidenceRefs: approvedRuntimeAssetReviewEvidenceRefs,
      humanoidRealismProfiles: learnerRuntimeBundle.actors
        .filter((actor) => actor.embodiment === "humanoid")
        .map((actor) => ({
          actorRole: actor.role,
          requiredRealismEvidenceIds: runtimeRealismRequiredSignalIds,
          claimScope: "metadata_only_not_visual_quality_evidence",
        })),
    });
    const humanoidActors = learnerRuntimeBundle.actors.filter((actor) => actor.embodiment === "humanoid");
    const humanoidRoles = uniqueStrings(humanoidActors.map((actor) => actor.role));
    const dynamicBehaviorCoverageSummary = buildEncounterDynamicBehaviorCoverageSummary({
      learnerRuntimeBundle,
      requiredActorRoles: humanoidRoles,
      scenarioId: record.scenarioId,
    });
    const encounterFactorySummary = buildEncounterFactorySummaryContracts({
      requestId: record.requestId,
      scenarioId: record.scenarioId,
      learnerRuntimeBundle,
      actorRoles: humanoidRoles,
      reviewAttached: canRunGeneratedBundlePublisher,
    });
    const publicationBlockers = [
      ...(hasApprovedRuntimeAssetReviewEvidence(record.runtimeAssetReviewDecisions) ? [] : ["runtime_asset_review_decisions_missing"]),
      ...scenarioReviewGate.blockerIds,
    ];
    const humanoidMetadataBlockerIds = runtimeRealismRequiredSignalIds.map((signalId) => `humanoid_metadata_review_required:${signalId}`);
    const runtimeBundleGateRefs = [
      {
        gateId: "runtime_bundle_assembly_audit",
        status: "blocked",
        refId: publicationMetadata.bundleId,
        blockerIds: learnerUseGate.blockers,
        claimBoundary: "runtime_bundle_gate_ref_not_published_runtime",
      },
      {
        gateId: "human_runtime_asset_review",
        status: approvedRuntimeAssetReviewEvidenceRefs.length > 0 ? "attached" : "pending",
        refId: record.requestId,
        blockerIds: approvedRuntimeAssetReviewEvidenceRefs.length > 0 ? [] : ["runtime_asset_review_decisions_missing"],
        claimBoundary: "runtime_bundle_gate_ref_not_published_runtime",
      },
      {
        gateId: "scenario_approval_boundary",
        status: scenarioReviewGate.learnerUseBlocked ? "blocked" : "attached",
        refId: record.scenarioId,
        blockerIds: scenarioReviewGate.blockerIds,
        claimBoundary: "runtime_bundle_gate_ref_not_published_runtime",
      },
    ];
    const humanReviewActions = buildHumanReviewActions({
      scenarioId: record.scenarioId,
      runtimeAssetReviewDecisions: record.runtimeAssetReviewDecisions,
      learnerRuntimeUseBlockers: learnerUseGate.blockers,
      humanoidMetadataBlockerIds,
    });
    record.scenarioReviewGate = scenarioReviewGate;
    record.humanReviewActions = humanReviewActions;
    const materializationInputManifestSummary = readMaterializationInputManifestSummaryForScenario(record.scenarioId);
    const materializationEvidenceAttachmentSummary = readMaterializationEvidenceAttachmentSummaryForScenario(record.scenarioId);
    return context.json({
      requestId,
      scenarioId: record.scenarioId,
      canRunGeneratedBundlePublisher,
      canUseGeneratedBundleForLearnerRuntime: learnerUseGate.canUseGeneratedBundleForLearnerRuntime,
      blockers: publicationBlockers,
      learnerRuntimeUseBlockers: learnerUseGate.blockers,
      nextAction: canRunGeneratedBundlePublisher ? "run_generated_bundle_publisher" : "attach_runtime_asset_review_decisions",
      scenarioReviewGate,
      runtimeBundleGateRefs,
      humanoidMetadataBlockerIds,
      humanReviewActions,
      evidenceGateRefs: [
        {
          gateId: "asset_production_review",
          status: canRunGeneratedBundlePublisher ? "attached" : "pending",
          evidenceRefs: approvedRuntimeAssetReviewEvidenceRefs,
          requiredSignalIds: [],
          blockers: canRunGeneratedBundlePublisher ? [] : ["runtime_asset_review_decisions_missing"],
          notEvidenceFor,
        },
        {
          gateId: "runtime_realism_evidence",
          status: "pending",
          evidenceRefs: [],
          requiredSignalIds: runtimeRealismRequiredSignalIds,
          blockers: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
          notEvidenceFor,
        },
        {
          gateId: "visual_qa_evidence",
          status: "pending",
          evidenceRefs: [],
          requiredSignalIds: ["humanoid_realism_visual_qa_review", "no_rejected_visual_regression_cues", "emotion_expression_transition_readability"],
          blockers: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
          notEvidenceFor,
        },
        {
          gateId: "quest_runtime_evidence",
          status: "pending",
          evidenceRefs: [],
          requiredSignalIds: ["worn_headset_or_documented_quest_webxr_evidence"],
          blockers: ["quest_runtime_evidence_not_attached_to_encounter_bundle"],
          notEvidenceFor,
        },
      ],
      publicationMetadata,
      dynamicBehaviorCoverage: {
        ...dynamicBehaviorCoverageSummary,
        dialogueActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.dialogueTurnCoverage.actorRolesWithDialogueTurns),
        missingDialogueActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.dialogueTurnCoverage.missingActorRoles),
        gazeActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.gazeTargetCoverage.actorRolesWithGazeTargets),
        missingGazeActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.gazeTargetCoverage.missingActorRoles),
        placementActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.actorRolePlacementCoverage.actorRolesWithPlacements),
        missingPlacementActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.actorRolePlacementCoverage.missingActorRoles),
        affectActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.affectTimelineCoverage.actorRolesWithAffectTimelines),
        missingAffectActorRoles: uniqueStrings(dynamicBehaviorCoverageSummary.affectTimelineCoverage.missingActorRoles),
        affectTimelineCount: dynamicBehaviorCoverageSummary.affectTimelineCoverage.affectTimelineCount,
        affectClaimBoundary: dynamicBehaviorCoverageSummary.affectTimelineCoverage.claimBoundary,
        blockerIds: dynamicBehaviorCoverageSummary.blockerIds,
        warningIds: dynamicBehaviorCoverageSummary.warningIds,
      },
      encounterFactoryDryRunSummary: encounterFactorySummary.encounterFactoryDryRunSummary,
      materializationInputManifestSummary,
      materializationEvidenceAttachmentSummary,
      materializationInputReviewActionPacket: buildMaterializationInputReviewActionPacket(materializationInputManifestSummary, notEvidenceFor),
      materializationInputReviewDecisionRecord: record.materializationInputReviewDecisionRecord,
      runtimeRealismEvidenceInputReviewDecisionRecord: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId === record.scenarioId
        ? ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord
        : undefined,
      runtimeVisualEvidenceAttachmentSummary: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId === record.scenarioId
        ? buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord)
        : undefined,
      runtimeVisualEvidenceAttachmentActionPacket: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId === record.scenarioId
        ? buildRuntimeVisualEvidenceAttachmentActionPacket(buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord))
        : undefined,
      runtimeVisualEvidenceAttachmentRecord: ctx.state.runtimeVisualEvidenceAttachmentRecord?.scenarioId === record.scenarioId ? ctx.state.runtimeVisualEvidenceAttachmentRecord : undefined,
      assetReleaseLadderReplayProjection: buildAssetReleaseLadderReplayProjection(record.scenarioId),
      runtimeEvidenceCaptureScaffold: readRuntimeEvidenceCaptureScaffoldForScenario(record.scenarioId),
      claimBoundary: "publication_readiness_not_learner_bundle_persistence",
      notEvidenceFor,
    });
  });

  app.get(routeById("scenario-asset-readiness").path, (context) => context.json(runtime.assetReadiness()));

  app.post(routeById("scenario-publication-readiness").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      targetUse?: unknown;
      reviewerEvidence?: unknown;
    };

    return context.json(
      runtime.scenarioPublicationReadiness({
        targetUse: parsePublicationTargetUse(body.targetUse),
        reviewerEvidence: parseReviewerEvidence(body.reviewerEvidence),
      }),
    );
  });

  registerExamRoutes(app, ctx);
  registerAuthoringRoutes(app, ctx);
  registerCapabilityJobRoutes(app, ctx);
  registerEncounterSessionRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
}




function createAdminGraphqlRoot(
  runtime: ScenarioRuntime,
  persistence: ApiPersistenceSink,
  scenarioOverrides: Map<string, AdminGraphqlScenario>,
  state: {
    runtimeRealismEvidenceInputReviewDecisionRecord?: ApiRuntimeRealismEvidenceInputReviewDecisionRecord;
    runtimeVisualEvidenceAttachmentRecord?: ApiRuntimeVisualEvidenceAttachmentRecord;
  } = {},
): AdminGraphqlRootValue {
  return {
    assetReadiness: ({ scenarioId, version }) => findSeedBankAssetReadiness(String(scenarioId), version),
    scenario: async ({ scenarioId, version }) =>
      (await listAdminGraphqlScenarios(persistence, scenarioOverrides)).find((scenario) =>
        scenario.scenarioId === scenarioId && (version === undefined || scenario.version === version)
      ),
    scenarios: async ({ status }) =>
      (await listAdminGraphqlScenarios(persistence, scenarioOverrides)).filter((scenario) => status === undefined || scenario.status === status),
    scenarioReviewDecisions: async ({ scenarioId, version }) =>
      (await listScenarioReviewDecisionRecords(persistence))
        .filter((decision) => decision.scenarioId === String(scenarioId) && decision.version === version),
    reviewPacket: ({ stationRunId }) => runtime.reviewPacket(String(stationRunId)),
    clinicalEventReviewSummary: async ({ stationRunId }) =>
      summarizeClinicalEventReviewProjections(
        await persistence.listClinicalEventReviewProjections?.(String(stationRunId)) ?? [],
      ),
    reviewReplayReadinessSummary: async ({ stationRunId }) => {
      const stationRunIdString = String(stationRunId);
      const clinicalEventReviewSummary = summarizeClinicalEventReviewProjections(
        await persistence.listClinicalEventReviewProjections?.(stationRunIdString) ?? [],
      );
      return summarizeReviewReplayReadiness({
        stationRunId: stationRunIdString,
        packet: runtime.reviewPacket(stationRunIdString),
        clinicalEventReviewSummary,
        traceEvents: runtime.traceEvents(stationRunIdString),
        ...(state.runtimeRealismEvidenceInputReviewDecisionRecord ? { runtimeRealismEvidenceInputReviewDecisionRecord: state.runtimeRealismEvidenceInputReviewDecisionRecord } : {}),
        ...(state.runtimeVisualEvidenceAttachmentRecord ? { runtimeVisualEvidenceAttachmentRecord: state.runtimeVisualEvidenceAttachmentRecord } : {}),
      });
    },
    traceEvents: ({ stationRunId }) => runtime.traceEvents(String(stationRunId)),
    submitScenarioReview: async ({ input }) => {
      const adminScenarios = await listAdminGraphqlScenarios(persistence, scenarioOverrides);
      const scenario = adminScenarios.find((candidate) => candidate.scenarioId === input.scenarioId && candidate.version === input.version);
      if (!scenario) {
        throw new Error(`Scenario not found: ${input.scenarioId} v${input.version}`);
      }

      const reviewGate = parseScenarioReviewGate(input.reviewerRole);
      validateScenarioReviewDecisionInput(input);

      const reviewDecision = toApiScenarioReviewDecisionRecord(input, reviewGate);
      const nextScenario = applyScenarioReviewDecision(scenario, reviewDecision);
      await persistence.saveScenarioReviewDecision?.(reviewDecision);
      scenarioOverrides.set(scenarioVersionKey(nextScenario.scenarioId, nextScenario.version), nextScenario);

      return nextScenario;
    },
    stationRunQueueSnapshots: async ({ blueprintId }) => Promise.resolve(persistence.listStationRunQueueSnapshots?.(blueprintId) ?? []),
    createStationRunQueueSnapshot: async ({ input }) => {
      const snapshot = createSeedStationRunQueueSnapshot(input);
      await persistence.saveStationRunQueueSnapshot?.(snapshot);
      return snapshot;
    },
    saveFacultyScoreDraft: async ({ input }) => {
      const stationRunId = String(input.stationRunId);
      const packet = runtime.saveFacultyScoreDraft(stationRunId, {
        reviewerId: String(input.reviewerId),
        comments: input.comments,
        rubricScores: isRecord(input.rubricScores) ? input.rubricScores : {},
      });
      await persistence.saveTraceEvents?.(stationRunId, runtime.traceEvents(stationRunId));
      await persistence.saveReviewPacket?.(stationRunId, packet);
      return packet;
    },
  };
}












function checklist(
  checkId:
    | "confirm_selector_guard_remains_disabled"
    | "confirm_provider_execution_disabled"
    | "confirm_learner_launch_blocked"
    | "confirm_no_readiness_claims",
  blockerIds: string[],
) {
  return { checkId, status: "required_before_runtime_wiring" as const, blockerIds };
}

function hasApprovedRuntimeAssetReviewEvidence(decisions: RuntimeAssetReviewDecision[]): boolean {
  return approvedRuntimeAssetReviewEvidence(decisions).length > 0;
}

function approvedRuntimeAssetReviewEvidence(decisions: RuntimeAssetReviewDecision[]): string[] {
  return decisions
    .filter((decision) => decision.decision === "approved_for_local_runtime")
    .flatMap((decision) => decision.evidenceRefs)
    .filter((evidenceRef) => evidenceRef.trim().length > 0);
}


async function listAdminGraphqlScenarios(
  persistence: ApiPersistenceSink,
  scenarioOverrides: Map<string, AdminGraphqlScenario>,
): Promise<AdminGraphqlScenario[]> {
  const reviewDecisions = await listScenarioReviewDecisionRecords(persistence);

  return scenarioBank.map((scenario) => {
    const scenarioKey = scenarioVersionKey(scenario.scenarioId, scenario.version);
    const baseScenario = scenarioOverrides.get(scenarioKey) ?? toAdminGraphqlScenario(scenario);

    return reviewDecisions
      .filter((decision) => decision.scenarioId === baseScenario.scenarioId && decision.version === baseScenario.version)
      .sort(compareScenarioReviewDecisions)
      .reduce(applyScenarioReviewDecision, baseScenario);
  });
}

async function listScenarioReviewDecisionRecords(
  persistence: ApiPersistenceSink,
): Promise<ApiScenarioReviewDecisionRecord[]> {
  const reviewDecisions = await Promise.resolve(persistence.listScenarioReviewDecisions?.() ?? []);
  return [...reviewDecisions].sort(compareScenarioReviewDecisions);
}

function toAdminGraphqlScenario(scenario: (typeof scenarioBank)[number]): AdminGraphqlScenario {
  return {
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    title: scenario.title,
    status: toAdminGraphqlScenarioStatus(scenario.status),
    clinicalObjectives: scenario.clinicalObjectives,
    actors: scenario.actors.map(({ hiddenFacts: _hiddenFacts, ...actor }) => actor),
    requiredTraceTags: scenario.requiredTraceTags,
    review: { ...scenario.review },
    governance: scenario.governance,
    equipment: [...(scenario.equipment ?? [])],
    assetNeeds: [...(scenario.assetNeeds ?? [])],
    ...(scenario.environment === undefined ? {} : { environment: scenario.environment }),
  };
}

function toAdminGraphqlScenarioStatus(status: (typeof scenarioBank)[number]["status"]): AdminGraphqlScenario["status"] {
  switch (status) {
    case "approved":
      return AdminGraphqlScenarioStatus.Approved;
    case "retired":
      return AdminGraphqlScenarioStatus.Archived;
    case "draft":
      return AdminGraphqlScenarioStatus.Draft;
  }
}

function scenarioVersionKey(scenarioId: string, version: number): string {
  return `${scenarioId}:${version}`;
}

function parseScenarioReviewGate(reviewerRole: string): ApiScenarioReviewerRole {
  if (reviewerRole === "clinical" || reviewerRole === "psychometric" || reviewerRole === "legal" || reviewerRole === "simulationQa") {
    return reviewerRole;
  }

  throw new Error(`Unsupported scenario review gate: ${reviewerRole}`);
}

function validateScenarioReviewDecisionInput(input: {
  reviewerId: string | number;
  comments: string;
  evidenceRefs: Array<string>;
}): void {
  if (String(input.reviewerId).trim().length === 0) {
    throw new Error("Scenario review decision requires reviewerId.");
  }
  if (input.comments.trim().length === 0) {
    throw new Error("Scenario review decision requires comments.");
  }
  if (input.evidenceRefs.length === 0 || input.evidenceRefs.some((evidenceRef) => evidenceRef.trim().length === 0)) {
    throw new Error("Scenario review decision requires evidenceRefs.");
  }
}

function toApiScenarioReviewDecisionRecord(
  input: {
    scenarioId: string | number;
    version: number;
    reviewerId: string | number;
    decision: AdminGraphqlReviewDecision;
    comments: string;
    evidenceRefs: Array<string>;
  },
  reviewerRole: ApiScenarioReviewerRole,
): ApiScenarioReviewDecisionRecord {
  return {
    scenarioId: String(input.scenarioId),
    version: input.version,
    reviewerRole,
    reviewerId: String(input.reviewerId),
    decision: input.decision === AdminGraphqlReviewDecision.Approved ? "approved" : "changes_requested",
    comments: input.comments,
    evidenceRefs: [...input.evidenceRefs],
    reviewedAt: new Date().toISOString(),
  };
}

function applyScenarioReviewDecision(
  scenario: AdminGraphqlScenario,
  reviewDecision: ApiScenarioReviewDecisionRecord,
): AdminGraphqlScenario {
  const nextReview = {
    ...scenario.review,
    [reviewDecision.reviewerRole]: reviewDecision.decision,
  };

  return {
    ...scenario,
    review: nextReview,
    status: scenarioStatusForReview(nextReview),
  };
}

function compareScenarioReviewDecisions(left: ApiScenarioReviewDecisionRecord, right: ApiScenarioReviewDecisionRecord): number {
  return Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt)
    || left.scenarioId.localeCompare(right.scenarioId)
    || left.version - right.version
    || left.reviewerRole.localeCompare(right.reviewerRole)
    || left.reviewerId.localeCompare(right.reviewerId);
}

function scenarioStatusForReview(review: AdminGraphqlScenario["review"]): AdminGraphqlScenario["status"] {
  if (Object.values(review).every((state) => state === "approved")) {
    return AdminGraphqlScenarioStatus.Approved;
  }
  if (Object.values(review).some((state) => state === "changes_requested")) {
    return AdminGraphqlScenarioStatus.Draft;
  }
  return AdminGraphqlScenarioStatus.ReadyForReview;
}



async function recordGraphqlOperationSpan(
  telemetry: TelemetryRecorder,
  input: {
    operationName: string;
    statusCode: number;
    durationMs: number;
    hasErrors: boolean;
  },
): Promise<void> {
  await Promise.resolve(telemetry.recordSpan({
    name: openClinXrSpanNames.graphqlOperation,
    attributes: telemetryRouteAttributes({
      graphqlOperationName: input.operationName,
    }),
    durationMs: input.durationMs,
    statusCode: input.statusCode,
    ...(input.hasErrors ? { errorType: "graphql_errors" } : {}),
  })).catch(() => undefined);
}





function isFacultyOnlyGraphqlOperation(operationName: string, query: string): boolean {
  if (FACULTY_ONLY_GRAPHQL_OPERATIONS.has(operationName)) {
    return true;
  }
  // Fallback when clients omit operationName: detect mutation field names.
  return /\bsaveFacultyScoreDraft\b/.test(query) || /\bsubmitScenarioReview\b/.test(query);
}


function parsePublicationTargetUse(value: unknown): PublicationTargetUse {
  if (value === "pilot_research" || value === "summative") {
    return value;
  }
  return "local_formative";
}

function parseReviewerEvidence(value: unknown): ReviewerEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isReviewerEvidence);
}



function isReviewerEvidence(value: unknown): value is ReviewerEvidence {
  return isRecord(value)
    && typeof value["reviewerRole"] === "string"
    && typeof value["reviewerId"] === "string"
    && (value["decision"] === "approved" || value["decision"] === "changes_requested")
    && typeof value["comments"] === "string"
    && Array.isArray(value["evidenceRefs"])
    && value["evidenceRefs"].every((ref) => typeof ref === "string")
    && typeof value["reviewedAt"] === "string";
}

function isRuntimeAssetReviewDecision(value: unknown): value is RuntimeAssetReviewDecision {
  return isRecord(value)
    && typeof value["assetId"] === "string"
    && ["asset_pipeline", "clinical_simulation", "xr_performance", "security_privacy"].includes(String(value["reviewerRole"]))
    && typeof value["reviewerId"] === "string"
    && (value["decision"] === "approved_for_local_runtime" || value["decision"] === "changes_requested")
    && typeof value["comments"] === "string"
    && Array.isArray(value["evidenceRefs"])
    && value["evidenceRefs"].every((ref) => typeof ref === "string")
    && typeof value["reviewedAt"] === "string";
}

function isMaterializationInputReviewDecision(value: unknown): value is ApiMaterializationInputReviewDecision {
  return isRecord(value)
    && (
      value["actionId"] === "review_actor_materialization_inputs"
      || value["actionId"] === "hold_actor_materialization_inputs"
      || value["actionId"] === "review_equipment_materialization_inputs"
      || value["actionId"] === "hold_equipment_materialization_inputs"
    )
    && typeof value["reviewerId"] === "string"
    && (value["decision"] === "reviewed_metadata_only" || value["decision"] === "held_metadata_only")
    && typeof value["comments"] === "string"
    && Array.isArray(value["evidenceRefs"])
    && value["evidenceRefs"].every((ref) => typeof ref === "string")
    && typeof value["reviewedAt"] === "string";
}

function isRuntimeRealismEvidenceInputReviewDecision(value: unknown): value is ApiRuntimeRealismEvidenceInputReviewDecision {
  return isRecord(value)
    && typeof value["inputId"] === "string"
    && (value["inputKind"] === "runtime_realism_signal_input" || value["inputKind"] === "visual_qa_review_input")
    && typeof value["reviewerId"] === "string"
    && (value["decision"] === "reviewed_metadata_only" || value["decision"] === "held_metadata_only")
    && typeof value["comments"] === "string"
    && Array.isArray(value["evidenceRefs"])
    && value["evidenceRefs"].every((ref) => typeof ref === "string")
    && typeof value["reviewedAt"] === "string";
}

function isRuntimeVisualEvidenceAttachment(value: unknown): value is ApiRuntimeVisualEvidenceAttachment {
  return isRecord(value)
    && (value["actionId"] === "attach_runtime_realism_evidence_refs" || value["actionId"] === "attach_visual_qa_evidence_refs")
    && typeof value["inputId"] === "string"
    && (value["inputKind"] === "runtime_realism_signal_input" || value["inputKind"] === "visual_qa_review_input")
    && typeof value["evidenceRef"] === "string"
    && typeof value["localArtifactPath"] === "string"
    && typeof value["reviewerId"] === "string"
    && (value["attachmentStatus"] === "attached_metadata_only" || value["attachmentStatus"] === "held_metadata_only")
    && typeof value["comments"] === "string"
    && typeof value["attachedAt"] === "string";
}

function isRawUiXrManualPerformancePayload(value: Record<string, unknown>): boolean {
  return "runtimeVisualEvidenceCaptureScaffold" in value
    || "manualPerformanceDraft" in value
    || "captureSummary" in value
    || "runtimeEvidenceConsumerReadiness" in value;
}






function createSeedBankEnvironmentGenerationQueue() {
  return buildEnvironmentGenerationQueue(
    scenarioBank,
    scenarioBank.flatMap((scenario) => createScenarioPlaceholderManifests(scenario)),
  );
}

function createSeedBankEnvironmentWorkOrderQueue() {
  return buildEnvironmentGenerationWorkOrderQueue(createSeedBankEnvironmentGenerationQueue());
}


function buildScenarioReviewGateSummary(scenarioId: string): ApiScenarioReviewGateSummary {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  const scenarioStatus = scenario?.status ?? "unknown";
  const blockerIds = scenarioStatus === "approved" ? [] : [`scenario_status:${scenarioStatus}`, "human_scenario_approval_required"];

  return {
    scenarioStatus,
    approvalBoundary: scenarioStatus === "approved" ? "approved_scenario_factory_planning_only" : "draft_no_learner_use_without_human_approval",
    learnerUseBlocked: blockerIds.length > 0,
    blockerIds,
    claimBoundary: "scenario_status_gate_not_clinical_or_production_readiness",
  };
}

function buildHumanReviewActions(input: {
  scenarioId: string;
  runtimeAssetReviewDecisions: RuntimeAssetReviewDecision[];
  learnerRuntimeUseBlockers: string[];
  humanoidMetadataBlockerIds: string[];
}): ApiHumanReviewActionSummary[] {
  const approvedRuntimeEvidenceRefs = approvedRuntimeAssetReviewEvidence(input.runtimeAssetReviewDecisions);
  const scenarioReviewGate = buildScenarioReviewGateSummary(input.scenarioId);

  return [
    {
      actionId: "attach_runtime_asset_review_decisions",
      status: approvedRuntimeEvidenceRefs.length > 0 ? "complete" : "available",
      label: "Attach local runtime asset review decisions",
      blockerIds: approvedRuntimeEvidenceRefs.length > 0 ? [] : ["runtime_asset_review_decisions_missing"],
      evidenceRefs: approvedRuntimeEvidenceRefs,
      claimBoundary: "human_review_action_not_automated_approval",
    },
    {
      actionId: "review_humanoid_realism_metadata",
      status: input.learnerRuntimeUseBlockers.includes("runtime_realism_evidence_not_attached_to_encounter_bundle") ? "available" : "complete",
      label: "Review humanoid realism metadata and evidence blockers",
      blockerIds: input.humanoidMetadataBlockerIds,
      evidenceRefs: [],
      claimBoundary: "human_review_action_not_automated_approval",
    },
    {
      actionId: "review_runtime_bundle_assembly_audit",
      status: input.learnerRuntimeUseBlockers.length > 0 ? "available" : "complete",
      label: "Review runtime bundle assembly audit and learner-use gates",
      blockerIds: input.learnerRuntimeUseBlockers,
      evidenceRefs: [],
      claimBoundary: "human_review_action_not_automated_approval",
    },
    {
      actionId: "resolve_scenario_approval_boundary",
      status: scenarioReviewGate.learnerUseBlocked ? "blocked" : "complete",
      label: "Resolve scenario status and no-approval boundary",
      blockerIds: scenarioReviewGate.blockerIds,
      evidenceRefs: [],
      claimBoundary: "human_review_action_not_automated_approval",
    },
  ];
}

