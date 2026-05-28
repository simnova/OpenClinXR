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
} from "@openclinxr/scenario-runtime";
import {
  createNoopTelemetryRecorder,
  openClinXrSpanNames,
  type TelemetryRecorder,
  type TelemetrySpanRecord,
  telemetryRouteAttributes,
} from "@openclinxr/telemetry";
import {
  createRealtimeVoiceGatewayPosture,
  type RealtimeVoiceGatewayPostureInput,
  type RealtimeVoiceProtocolLaneId,
  selectRealtimeVoiceProtocol,
} from "@openclinxr/voice-gateway";
import { Hono } from "hono";
import { createOpenClinXrApiProtocolPosture } from "./protocol-support.js";

type RuntimeTraceEvents = ReturnType<ScenarioRuntime["traceEvents"]>;
type RuntimeReviewPacket = ReturnType<ScenarioRuntime["reviewPacket"]>;

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

const realtimeVoiceProtocolPreference: RealtimeVoiceProtocolLaneId[] = [
  "web3-identity-signaling",
  "webtransport-http3-media",
  "direct-quic-media-gateway",
  "websocket-media",
];

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

export type ApiPersistenceSink = {
  saveExamForm?: (form: ExamForm) => Promise<void> | void;
  saveStationRunQueueSnapshot?: (snapshot: ApiStationRunQueueSnapshot) => Promise<void> | void;
  listStationRunQueueSnapshots?: (blueprintId: string) => Promise<ApiStationRunQueueSnapshot[]> | ApiStationRunQueueSnapshot[];
  saveScenarioReviewDecision?: (record: ApiScenarioReviewDecisionRecord) => Promise<void> | void;
  listScenarioReviewDecisions?: () => Promise<ApiScenarioReviewDecisionRecord[]> | ApiScenarioReviewDecisionRecord[];
  saveTraceEvents?: (stationRunId: string, events: RuntimeTraceEvents) => Promise<void> | void;
  saveReviewPacket?: (stationRunId: string, packet: RuntimeReviewPacket) => Promise<void> | void;
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

export type ApiAppOptions = {
  telemetry?: TelemetryRecorder;
  assetGenerationFacade?: AssetGenerationCapabilityFacade;
  realtimeVoiceGatewayPosture?: RealtimeVoiceGatewayPostureInput;
};

export function createApiApp(runtime: ScenarioRuntime = createDefaultScenarioRuntime(), persistence: ApiPersistenceSink = {}, options: ApiAppOptions = {}): Hono {
  const app = new Hono();
  const telemetry = options.telemetry ?? createNoopTelemetryRecorder();
  const assetGenerationFacade = options.assetGenerationFacade ?? new AssetGenerationCapabilityFacade();
  const realtimeVoiceGatewayPosture = options.realtimeVoiceGatewayPosture ?? createDefaultRealtimeVoiceGatewayPostureInput();
  const adminScenarioOverrides = new Map<string, AdminGraphqlScenario>();
  const sceneGenerationRequests: ApiScenarioSceneGenerationRequestRecord[] = [];

  app.use("*", async (context, next) => {
    context.header("access-control-allow-origin", "*");
    context.header("access-control-allow-methods", "GET,POST,OPTIONS");
    context.header("access-control-allow-headers", "content-type");
    if (context.req.method === "OPTIONS") {
      return context.body(null, 204);
    }
    await next();
  });

  app.use("*", async (context, next) => {
    const started = performance.now();
    let errorType: string | undefined;

    try {
      await next();
    } catch (error) {
      errorType = error instanceof Error ? error.name : "unknown";
      throw error;
    } finally {
      await recordApiRouteSpan(telemetry, {
        method: context.req.method,
        url: context.req.url,
        statusCode: context.res.status,
        durationMs: Number((performance.now() - started).toFixed(2)),
        ...(errorType ? { errorType } : {}),
      });
    }
  });

  app.get(routeById("health").path, async (context) =>
    context.json({
      ok: true,
      service: "openclinxr-api",
      providerHealth: await runtime.providerHealth(),
    }),
  );

  app.get(routeById("providers-health").path, async (context) => context.json(await runtime.providerHealth()));

  app.get(routeById("runtime-protocols").path, (context) => context.json(createOpenClinXrApiProtocolPosture()));

  app.get(routeById("runtime-provider-readiness").path, (context) => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const profiles: RuntimeProfile[] = ["local-development", "local-production", "production"];
    return context.json({
      source: "capability-routing-matrix",
      claimBoundary: "deterministic_replay_ready_is_not_live_provider_readiness",
      surfaces: profiles.map((profile) => evaluateRuntimeProviderReadinessSurface(matrix, profile)),
    });
  });

  app.get(routeById("scenario-bank-dynamic-encounter-factory-planning").path, (context) =>
    context.json({
      ...buildDynamicEncounterFactoryPlanningProjection(scenarioBank),
      routeContractBoundary: routeById("scenario-bank-dynamic-encounter-factory-planning").contractBoundary,
    }),
  );

  app.get(routeById("runtime-selection-review-packet").path, (context) => {
    const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
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

    const result = await executeAdminGraphql(
      {
        query: body.query,
        ...(isRecord(body.variables) ? { variables: body.variables } : {}),
        ...(graphqlOperationName !== "anonymous" ? { operationName: graphqlOperationName } : {}),
      },
      createAdminGraphqlRoot(runtime, persistence, adminScenarioOverrides),
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

  app.get(routeById("default-exam-blueprint").path, (context) => context.json(createDefaultClinicalSkillsBlueprint()));

  app.get(routeById("step2cs-seed-exam-blueprint").path, (context) => context.json(createStep2CsStyleSeedBlueprint()));

  app.get(routeById("step2cs-seed-exam-blueprint-readiness").path, (context) =>
    context.json(evaluateBlueprintScenarioReadiness(createStep2CsStyleSeedBlueprint(), scenarioBank)),
  );

  app.get(routeById("step2cs-seed-exam-timing-plan").path, (context) =>
    context.json(createExamTimingPlan(createStep2CsStyleSeedBlueprint())),
  );

  app.get(routeById("step2cs-seed-station-run-queue").path, (context) =>
    context.json(createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank)),
  );

  app.get(routeById("list-step2cs-seed-station-run-queue-snapshots").path, async (context) => {
    const blueprintId = createStep2CsStyleSeedBlueprint().blueprintId;
    return context.json(await Promise.resolve(persistence.listStationRunQueueSnapshots?.(blueprintId) ?? []));
  });

  app.post(routeById("create-step2cs-seed-station-run-queue-snapshot").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      snapshotId?: unknown;
      createdAt?: unknown;
      reviewerId?: unknown;
    };
    const snapshot = createSeedStationRunQueueSnapshot(body);

    await persistence.saveStationRunQueueSnapshot?.(snapshot);
    return context.json(snapshot, 201);
  });

  app.post(routeById("create-exam-form").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { examFormId?: string };
    const form = assembleExamForm({
      examFormId: body.examFormId ?? "form_openclinxr_pilot_001",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
    });
    await persistence.saveExamForm?.(form);
    return context.json(form, 201);
  });

  app.post(routeById("exam-form-version-drift").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { form?: unknown };
    if (!isExamForm(body.form)) {
      return context.json({ error: "invalid_exam_form" }, 400);
    }

    return context.json(evaluateScenarioVersionDrift(body.form, [edChestPainScenario]));
  });

  app.post(routeById("submit-internal-capability-job").path, async (context) => {
    const capabilityId = context.req.param("capabilityId");
    if (!isAssetGenerationCapabilityId(capabilityId)) {
      return context.json({ error: "invalid_capability_id" }, 400);
    }

    const body = (await context.req.json().catch(() => ({}))) as {
      profile?: unknown;
      payload?: unknown;
      policy?: unknown;
    };
    const job = await assetGenerationFacade.submit({
      profile: parseRuntimeProfile(body.profile),
      capabilityId,
      payload: body.payload,
      ...(isRecord(body.policy) ? { policy: body.policy as AssetGenerationJobPolicyInput } : {}),
    });

    return context.json(job, 201);
  });

  app.get(routeById("read-internal-capability-job").path, async (context) => {
    const capabilityId = context.req.param("capabilityId");
    if (!isAssetGenerationCapabilityId(capabilityId)) {
      return context.json({ error: "invalid_capability_id" }, 400);
    }

    const jobId = context.req.param("jobId");
    const job = await assetGenerationFacade.get(jobId);
    if (!job || job.request.capabilityId !== capabilityId) {
      return context.json({ error: "job_not_found" }, 404);
    }

    return context.json(job);
  });

  app.post(routeById("start-session").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { learnerId?: string; consentAccepted?: boolean };
    if (body.consentAccepted !== true) {
      return context.json({ error: "consent_required" }, 400);
    }
    const learnerId = body.learnerId ?? "learner_001";
    if (learnerId.trim().length === 0) {
      return context.json({ error: "learner_id_required" }, 400);
    }
    const run = await runtime.startSession({ learnerId, consentAccepted: true });
    await persistTraceSnapshot(runtime, persistence, run.stationRunId);

    return context.json(run, 201);
  });

  app.post(routeById("start-encounter").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number };

    try {
      const summary = runtime.startEncounter(stationRunId, { atSecond: body.atSecond ?? 60 });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(summary);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("append-trace-event").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      eventType?: string;
      atSecond?: number;
      tag?: string;
      actorId?: string;
    };

    try {
      const event = runtime.appendLearnerEvent(stationRunId, {
        eventType: body.eventType ?? "learner.action",
        atSecond: body.atSecond ?? 0,
        ...(body.tag ? { tag: body.tag } : {}),
        ...(body.actorId ? { actorId: body.actorId } : {}),
      });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(event, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("record-clinical-action").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      atSecond?: unknown;
      actorId?: unknown;
      traceTag?: unknown;
      actionType?: unknown;
      label?: unknown;
    };

    try {
      const event = runtime.recordClinicalAction(stationRunId, {
        atSecond: typeof body.atSecond === "number" ? body.atSecond : 0,
        actorId: typeof body.actorId === "string" ? body.actorId : "",
        traceTag: typeof body.traceTag === "string" ? body.traceTag : "clinical_action",
        actionType: body.actionType === "finding_observed" ? "finding_observed" : "order_requested",
        label: typeof body.label === "string" ? body.label : "Clinical action",
      });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(event, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("actor-interaction-route").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      learnerUtterance?: unknown;
      atSecond?: unknown;
      traceContextTags?: unknown;
      source?: unknown;
    };
    const source = parseActorInteractionSource(body.source);

    try {
      const result = runtime.routeActorInteractionTurn(stationRunId, {
        learnerUtterance: typeof body.learnerUtterance === "string" ? body.learnerUtterance : "",
        atSecond: typeof body.atSecond === "number" ? body.atSecond : 0,
        traceContextTags: parseStringArray(body.traceContextTags),
        ...(source ? { source } : {}),
      });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json({
        routedActorId: result.routedActorId,
        routingReason: result.routingReason,
        conversationTurn: result.conversationTurn,
        interactionEvent: result.interactionEvent,
      }, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("actor-response").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      actorId?: unknown;
      learnerUtterance?: unknown;
      atSecond?: unknown;
      traceContextTags?: unknown;
      source?: unknown;
    };
    const learnerUtterance = typeof body.learnerUtterance === "string" ? body.learnerUtterance : "";
    const atSecond = typeof body.atSecond === "number" ? body.atSecond : 0;
    const traceContextTags = parseStringArray(body.traceContextTags);
    const actorId = typeof body.actorId === "string" ? body.actorId.trim() : "";
    const source = parseActorInteractionSource(body.source);

    try {
      const result = actorId.length > 0
        ? await runtime.generateActorResponse(stationRunId, {
            actorId,
            learnerUtterance,
            atSecond,
            traceContextTags,
          })
        : await runtime.generateRoutedActorResponse(stationRunId, {
            learnerUtterance,
            atSecond,
            traceContextTags,
            ...(source ? { source } : {}),
          });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(result, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("voice-synthesis").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as {
      actorId?: string;
      voiceId?: string;
      text?: string;
      atSecond?: number;
    };

    try {
      const result = await runtime.synthesizeActorSpeech(stationRunId, {
        actorId: body.actorId ?? "",
        voiceId: body.voiceId ?? "",
        text: body.text ?? "",
        atSecond: body.atSecond ?? 0,
      });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(result, 201);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.post(routeById("submit-note").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");
    const body = (await context.req.json().catch(() => ({}))) as { atSecond?: number; text?: string };

    try {
      const result = runtime.submitNote(stationRunId, {
        atSecond: body.atSecond ?? 1260,
        text: body.text ?? "",
      });
      await persistTraceSnapshot(runtime, persistence, stationRunId);
      return context.json(result);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get(routeById("review-packet").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");

    try {
      const packet = runtime.reviewPacket(stationRunId);
      await persistence.saveReviewPacket?.(stationRunId, packet);
      return context.json(packet);
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get(routeById("trace-events").path, (context) => {
    const stationRunId = context.req.param("stationRunId");

    try {
      return context.json(runtime.traceEvents(stationRunId));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  app.get(routeById("review-replay-readiness-summary").path, async (context) => {
    const stationRunId = context.req.param("stationRunId");

    try {
      const clinicalEventReviewSummary = summarizeClinicalEventReviewProjections(
        await persistence.listClinicalEventReviewProjections?.(stationRunId) ?? [],
      );
      return context.json(summarizeReviewReplayReadiness({
        stationRunId,
        packet: runtime.reviewPacket(stationRunId),
        clinicalEventReviewSummary,
        traceEvents: runtime.traceEvents(stationRunId),
      }));
    } catch (error) {
      return sessionErrorResponse(context, error);
    }
  });

  return app;
}

function createDefaultRealtimeVoiceGatewayPostureInput(): RealtimeVoiceGatewayPostureInput {
  return {
    bunAvailable: false,
    pythonBackendWebSocketUrlConfigured: false,
    pythonBackendDependenciesInstalled: false,
    pythonInferenceRuntimeInstalled: false,
  };
}

function createAdminGraphqlRoot(
  runtime: ScenarioRuntime,
  persistence: ApiPersistenceSink,
  scenarioOverrides: Map<string, AdminGraphqlScenario>,
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

function summarizeClinicalEventReviewProjections(projections: ApiClinicalEventReviewProjection[]) {
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

function summarizeReviewReplayReadiness(input: {
  stationRunId: string;
  packet: RuntimeReviewPacket;
  clinicalEventReviewSummary: ReturnType<typeof summarizeClinicalEventReviewProjections>;
  traceEvents: RuntimeTraceEvents;
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
    ...(caseDefinedHumanoidPerformanceContract ? { caseDefinedHumanoidPerformanceContract } : {}),
    ...(caseDefinedHumanoidRuntimeHandoff.length > 0 ? { caseDefinedHumanoidRuntimeHandoff } : {}),
    ...(reviewPacketEvidenceHandoff.xrTraceEvidenceSummary
      ? { xrTraceEvidenceSummary: reviewPacketEvidenceHandoff.xrTraceEvidenceSummary }
      : {}),
  };
}

function buildCaseDefinedHumanoidRuntimeHandoffForReview(scenarioId: string) {
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

function runtimeEvidenceGateRefsForReviewReplay() {
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

function generatedBundlePostureForReviewReplay() {
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

function buildReviewPacketEvidenceHandoff(input: {
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

function buildXrTraceEvidenceSummary(input: {
  stationRunId: string;
  traceEvents: RuntimeTraceEvents;
}) {
  const xrEvent = [...input.traceEvents].reverse().find((event) => event.eventType === "xr.trace.interaction");
  if (!xrEvent || !isRecord(xrEvent.payload)) {
    return null;
  }
  const payload = xrEvent.payload;
  const latestTraceTag = typeof payload.latestTraceTag === "string" ? payload.latestTraceTag : xrEvent.tag ?? null;
  return {
    stationRunId: input.stationRunId,
    source: typeof payload.source === "string" ? payload.source : xrEvent.source,
    evidenceRef: typeof payload.evidenceRef === "string" ? payload.evidenceRef : `trace_event:${input.stationRunId}:${xrEvent.sequence}`,
    activeLocomotionSource: typeof payload.activeLocomotionSource === "string" ? payload.activeLocomotionSource : null,
    locomotionDistanceMeters: typeof payload.locomotionDistanceMeters === "number" ? payload.locomotionDistanceMeters : null,
    locomotionTurnRadians: typeof payload.locomotionTurnRadians === "number" ? payload.locomotionTurnRadians : null,
    interactionSignalRefs: Array.isArray(payload.interactionSignalRefs)
      ? payload.interactionSignalRefs.filter((value): value is string => typeof value === "string")
      : [],
    latestTraceTag,
    latestTraceLatencyMs: typeof payload.latestTraceLatencyMs === "number" ? payload.latestTraceLatencyMs : null,
    blockers: Array.isArray(payload.blockers)
      ? payload.blockers.filter((value): value is string => typeof value === "string")
      : [],
    claimBoundary: "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness" as const,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
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

function createSeedStationRunQueueSnapshot(input: { snapshotId?: unknown; createdAt?: unknown; reviewerId?: unknown }): ApiStationRunQueueSnapshot {
  return {
    snapshotId: typeof input.snapshotId === "string" && input.snapshotId.length > 0 ? input.snapshotId : `queue_snapshot_${Date.now()}`,
    createdAt: typeof input.createdAt === "string" && input.createdAt.length > 0 ? input.createdAt : new Date().toISOString(),
    ...(typeof input.reviewerId === "string" && input.reviewerId.length > 0 ? { reviewerId: input.reviewerId } : {}),
    queue: createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank),
  };
}

async function recordApiRouteSpan(
  telemetry: TelemetryRecorder,
  input: {
    method: string;
    url: string;
    statusCode: number;
    durationMs: number;
    errorType?: string;
  },
): Promise<void> {
  const routeMatch = matchOpenClinXrRestRoute(input.method, new URL(input.url).pathname);
  const span: TelemetrySpanRecord = {
    name: openClinXrSpanNames.apiRoute,
    attributes: telemetryRouteAttributes({
      routeId: routeMatch?.route.id ?? "unmatched",
      ...(routeMatch ? {
        routeSurface: routeMatch.route.surface,
        stationRunScoped: routeMatch.route.stationRunScoped,
      } : {}),
    }),
    durationMs: input.durationMs,
    statusCode: input.statusCode,
    ...(input.errorType ? { errorType: input.errorType } : {}),
  };

  await Promise.resolve(telemetry.recordSpan(span)).catch(() => undefined);
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

async function persistTraceSnapshot(runtime: ScenarioRuntime, persistence: ApiPersistenceSink, stationRunId: string): Promise<void> {
  await persistence.saveTraceEvents?.(stationRunId, runtime.traceEvents(stationRunId));
}

function createSeedBankAssetReadiness() {
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

function findSeedBankAssetReadiness(scenarioId: string, version: number) {
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

function sessionErrorResponse(context: { json: (body: { error: string }, status: 400 | 404 | 500 | 503) => Response }, error: unknown): Response {
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

function parseActorInteractionSource(value: unknown): RouteRuntimeActorInteractionInput["source"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.kind === "voice_transcript"
    && typeof value.streamId === "string"
    && typeof value.transcriptSegmentId === "string"
    && typeof value.finalTranscriptText === "string"
    && typeof value.provider === "string") {
    return {
      kind: "voice_transcript",
      streamId: value.streamId,
      transcriptSegmentId: value.transcriptSegmentId,
      finalTranscriptText: value.finalTranscriptText,
      provider: value.provider,
      provenanceRefs: parseStringArray(value.provenanceRefs),
    };
  }

  if (value.kind === "text") {
    return {
      kind: "text",
      provenanceRefs: parseStringArray(value.provenanceRefs),
    };
  }

  return undefined;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isReviewerEvidence(value: unknown): value is ReviewerEvidence {
  return isRecord(value)
    && typeof value.reviewerRole === "string"
    && typeof value.reviewerId === "string"
    && (value.decision === "approved" || value.decision === "changes_requested")
    && typeof value.comments === "string"
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.every((ref) => typeof ref === "string")
    && typeof value.reviewedAt === "string";
}

function isRuntimeAssetReviewDecision(value: unknown): value is RuntimeAssetReviewDecision {
  return isRecord(value)
    && typeof value.assetId === "string"
    && ["asset_pipeline", "clinical_simulation", "xr_performance", "security_privacy"].includes(String(value.reviewerRole))
    && typeof value.reviewerId === "string"
    && (value.decision === "approved_for_local_runtime" || value.decision === "changes_requested")
    && typeof value.comments === "string"
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.every((ref) => typeof ref === "string")
    && typeof value.reviewedAt === "string";
}

function isExamForm(value: unknown): value is ExamForm {
  return isRecord(value)
    && typeof value.examFormId === "string"
    && Array.isArray(value.stationRefs)
    && value.stationRefs.every(isStationRef);
}

function isStationRef(value: unknown): value is ExamForm["stationRefs"][number] {
  return isRecord(value)
    && typeof value.order === "number"
    && typeof value.scenarioId === "string"
    && typeof value.scenarioVersion === "number"
    && typeof value.title === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssetGenerationCapabilityId(value: string): value is AssetGenerationCapabilityId {
  return value === "character-generation"
    || value === "medical-equipment-generation"
    || value === "voice-asset-generation"
    || value === "animation-generation"
    || value === "asset-bake";
}

function parseRuntimeProfile(value: unknown): RuntimeProfile {
  if (value === "local-development" || value === "local-production" || value === "production") {
    return value;
  }

  return "local-development";
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

function createSeedBankSceneGenerationPipelineQueue() {
  return buildScenarioSceneGenerationPipelineWorkOrderQueue(scenarioBank);
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
