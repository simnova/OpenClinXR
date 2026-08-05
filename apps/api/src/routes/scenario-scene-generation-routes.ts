import type { Hono } from "hono";
import { ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS, buildEncounterDynamicBehaviorCoverageSummary, buildEncounterFactorySummaryContracts, buildEncounterRuntimeBundlePublicationMetadata, createEdChestPainLocalLearnerRuntimeAssetBundle, evaluateEncounterRuntimeLearnerUseGate } from "@openclinxr/asset-registry";
import { routeById } from "@openclinxr/rest";
import { buildScenarioBankExamSequenceProjection, createLearnerScenarioView, edChestPainScenario, evaluateScenarioBankMaturity, scenarioBank } from "@openclinxr/scenario-fixtures";
import type { ApiScenarioSceneGenerationRequestRecord } from "../api-types.js";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { approvedRuntimeAssetReviewEvidence, buildAssetReleaseLadderReplayProjection, buildHumanReviewActions, buildScenarioReviewGateSummary, createSeedBankAssetReadiness, createSeedBankEnvironmentGenerationQueue, createSeedBankEnvironmentWorkOrderQueue, createSeedBankSceneGenerationPipelineQueue, hasApprovedRuntimeAssetReviewEvidence, isMaterializationInputReviewDecision, isRuntimeAssetReviewDecision, parsePublicationTargetUse, parseReviewerEvidence, uniqueStrings } from "../api-route-support.js";
import { buildMaterializationInputReviewActionPacket, buildMaterializationInputReviewDecisionRecord, buildRuntimeRealismEvidenceAttachmentSummary, buildRuntimeVisualEvidenceAttachmentActionPacket, readMaterializationEvidenceAttachmentSummaryForScenario, readMaterializationInputManifestSummaryForScenario, readRuntimeEvidenceCaptureScaffoldForScenario } from "../api-support.js";

/** ScenarioSceneGeneration domain routes (composition-root migration). */
export function registerScenarioSceneGenerationRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { runtime, sceneGenerationRequests } = ctx;

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

}
