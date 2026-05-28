import {
  buildEnvironmentGenerationWorkOrder,
  buildEnvironmentGenerationWorkOrderQueue,
  type EnvironmentGenerationPacket,
  type EnvironmentGenerationQueue,
  type EnvironmentGenerationWorkOrderQueue,
  type ScenarioSceneGenerationPipelineWorkOrderQueue,
} from "@openclinxr/asset-registry";
import { Button, Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type { CreateScenarioSceneGenerationRequestResult, ScenarioSceneGenerationRequestPublicationReadiness, ScenarioSceneGenerationRequestQueue } from "./api-client.js";
import {
  sceneGenerationRequestProjectionArtifactStatusColor,
  sceneGenerationRequestProjectionArtifactStatusLabel,
  sceneGenerationRequestReviewStatusColor,
} from "./status-view-model.js";

export type EnvironmentGenerationQueuePanelProps = {
  environmentGenerationQueue: EnvironmentGenerationQueue;
  environmentGenerationWorkOrderQueue?: EnvironmentGenerationWorkOrderQueue;
  sceneGenerationPipelineQueue?: ScenarioSceneGenerationPipelineWorkOrderQueue;
  sceneGenerationRequestQueue?: ScenarioSceneGenerationRequestQueue;
  sceneGenerationPublicationReadiness?: ScenarioSceneGenerationRequestPublicationReadiness;
  onInitiateSceneGeneration?: (scenarioId: string) => void;
  onAttachSceneGenerationReview?: (request: CreateScenarioSceneGenerationRequestResult) => void;
  onCheckSceneGenerationPublicationReadiness?: (request: CreateScenarioSceneGenerationRequestResult) => void;
};

export function EnvironmentGenerationQueuePanel({
  environmentGenerationQueue,
  environmentGenerationWorkOrderQueue,
  sceneGenerationPipelineQueue,
  sceneGenerationRequestQueue,
  sceneGenerationPublicationReadiness,
  onInitiateSceneGeneration,
  onAttachSceneGenerationReview,
  onCheckSceneGenerationPublicationReadiness,
}: EnvironmentGenerationQueuePanelProps): ReactElement {
  const nextGateSummary = summarizeEnvironmentNextGateCounts(environmentGenerationQueue);
  const workOrderQueue = environmentGenerationWorkOrderQueue ?? buildEnvironmentGenerationWorkOrderQueue(environmentGenerationQueue);
  const prohibitedActionSummary = summarizeEnvironmentWorkOrderCounts(workOrderQueue.prohibitedActionCounts);
  const missingEvidenceCountSummary = summarizeEnvironmentWorkOrderCounts(workOrderQueue.missingEvidenceCounts);
  const prohibitedActionEntries = summarizeEnvironmentWorkOrderCountEntries(workOrderQueue.prohibitedActionCounts);
  const featuredPackets = environmentGenerationQueue.packets.slice(0, 3);
  const featuredPipeline = sceneGenerationPipelineQueue?.workOrders.find((workOrder) =>
    workOrder.workOrderId === sceneGenerationPipelineQueue.featuredFactoryPlanningWorkOrderId
  ) ?? sceneGenerationPipelineQueue?.workOrders[0];
  const latestSceneGenerationRequest = sceneGenerationRequestQueue?.requests[0];

  return (
    <section className="workbench-panel" aria-label="3D environment generation queue">
      <div className="station-queue-row">
        <Typography.Title level={4}>3D Environment Generation Queue</Typography.Title>
        <Tag color={environmentGenerationQueue.readyForGenerationReviewScenarioIds.length > 0 ? "blue" : "gold"}>
          {`${environmentGenerationQueue.blockedScenarioIds.length} blocked before generation review`}
        </Tag>
      </div>
      <Typography.Paragraph type="secondary">
        Admin-initiated scene generation starts after scenario configuration and covers humanoids, hair, clothing, rigging, animation, equipment, environment assets, blob publication, runtime bundle binding, and review evidence. Planning/review packet only; no generated asset, runtime dependency, or Quest evidence is implied.
      </Typography.Paragraph>
      <div className="readiness-strip">
        <EnvironmentQueueMetric label={`${environmentGenerationQueue.packetCount} environment packets`} detail={`${environmentGenerationQueue.scenarioCount} seed-bank scenarios`} />
        <EnvironmentQueueMetric label={`${environmentGenerationQueue.readyForGenerationReviewScenarioIds.length} ready for generation review`} detail={`${environmentGenerationQueue.blockedScenarioIds.length} blocked before generation review`} />
        <EnvironmentQueueMetric label="Next blocked gate" detail={nextGateSummary} />
        <EnvironmentQueueMetric label="Prohibited generation actions" detail={prohibitedActionSummary} />
        <EnvironmentQueueMetric label="Missing evidence types" detail={missingEvidenceCountSummary} />
        <EnvironmentQueueMetric label={`${workOrderQueue.pendingTaskCount} pending authoring tasks`} detail={`${workOrderQueue.blockedWorkOrderCount} blocked ${workOrderQueue.blockedWorkOrderCount === 1 ? "work order" : "work orders"}`} />
        <EnvironmentQueueMetric label="Work-order boundary" detail={workOrderQueue.claimBoundary} />
        {sceneGenerationPipelineQueue ? (
          <EnvironmentQueueMetric label={`${sceneGenerationPipelineQueue.pendingStageCount} pending pipeline stages`} detail={sceneGenerationPipelineQueue.claimBoundary} />
        ) : null}
        {sceneGenerationPipelineQueue ? (
          <EnvironmentQueueMetric
            label={`factory target ${sceneGenerationPipelineQueue.featuredFactoryPlanningScenarioId ?? "none"}`}
            detail={`${sceneGenerationPipelineQueue.factoryPlanningClaimBoundary}; generation approval inferred ${String(sceneGenerationPipelineQueue.generationApprovalInferred)}`}
          />
        ) : null}
        {sceneGenerationRequestQueue ? (
          <EnvironmentQueueMetric label={`${sceneGenerationRequestQueue.requestCount} scene generation requests`} detail={sceneGenerationRequestQueue.claimBoundary} />
        ) : null}
      </div>
      {featuredPipeline ? (
        <div className="station-queue-row">
          <Typography.Text strong>{`Scene pipeline: ${featuredPipeline.scenarioId}`}</Typography.Text>
          <Tag color="gold">review-gated factory target</Tag>
          <Tag color="blue">{featuredPipeline.initiatedFrom}</Tag>
          <Tag color="cyan">{featuredPipeline.storageTarget.storeKind}</Tag>
          <Typography.Text type="secondary">{featuredPipeline.stages.map((stage) => stage.stageId).slice(0, 5).join(" -> ")}</Typography.Text>
          {onInitiateSceneGeneration ? (
            <Button size="small" onClick={() => onInitiateSceneGeneration(featuredPipeline.scenarioId)}>
              Initiate scene generation request
            </Button>
          ) : null}
        </div>
      ) : null}
      {featuredPipeline ? (
        <div className="station-queue-row">
          <Typography.Text strong>Humanoid runtime readiness handoff</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanoidRuntimeReadinessHandoff(featuredPipeline)}</Typography.Text>
        </div>
      ) : null}
      {latestSceneGenerationRequest ? (
        <div className="station-queue-row">
          <Typography.Text strong>{`Latest scene request: ${latestSceneGenerationRequest.scenarioId}`}</Typography.Text>
          <Tag color={sceneGenerationRequestReviewStatusColor(latestSceneGenerationRequest.reviewStatus)}>{latestSceneGenerationRequest.reviewStatus}</Tag>
          <Tag color={sceneGenerationRequestProjectionArtifactStatusColor(latestSceneGenerationRequest.reviewStatus)}>
            {sceneGenerationRequestProjectionArtifactStatusLabel(latestSceneGenerationRequest.reviewStatus)}
          </Tag>
          <Typography.Text type="secondary">{latestSceneGenerationRequest.nextAction}</Typography.Text>
          <Typography.Text type="secondary">
            {`${latestSceneGenerationRequest.runtimeAssetReviewDecisionCount} runtime asset review decision${latestSceneGenerationRequest.runtimeAssetReviewDecisionCount === 1 ? "" : "s"}`}
          </Typography.Text>
          {latestSceneGenerationRequest.factoryPlanningContext ? (
            <Typography.Text type="secondary">
              {`Factory planning context: ${latestSceneGenerationRequest.factoryPlanningContext.workOrderId}; featured=${String(latestSceneGenerationRequest.factoryPlanningContext.isFeaturedFactoryPlanningTarget)}; ${latestSceneGenerationRequest.factoryPlanningContext.factoryPlanningClaimBoundary}; generation approval inferred ${String(latestSceneGenerationRequest.factoryPlanningContext.generationApprovalInferred)}`}
            </Typography.Text>
          ) : null}
          {onAttachSceneGenerationReview ? (
            <Button size="small" onClick={() => onAttachSceneGenerationReview(latestSceneGenerationRequest)}>
              Attach local runtime review decisions
            </Button>
          ) : null}
          {onCheckSceneGenerationPublicationReadiness ? (
            <Button size="small" onClick={() => onCheckSceneGenerationPublicationReadiness(latestSceneGenerationRequest)}>
              Check publication readiness
            </Button>
          ) : null}
        </div>
      ) : null}
      {sceneGenerationPublicationReadiness ? (
        <div className="station-queue-row">
          <Typography.Text strong>{sceneGenerationPublicationReadiness.canRunGeneratedBundlePublisher ? "Publication gate: ready to run generated bundle publisher" : "Publication gate: blocked"}</Typography.Text>
          <Tag color={sceneGenerationPublicationReadiness.canRunGeneratedBundlePublisher ? "blue" : "gold"}>{sceneGenerationPublicationReadiness.claimBoundary}</Tag>
          <Tag color={sceneGenerationPublicationReadiness.canUseGeneratedBundleForLearnerRuntime ? "blue" : "gold"}>
            {sceneGenerationPublicationReadiness.canUseGeneratedBundleForLearnerRuntime ? "learner runtime gate: evidence attached" : "learner runtime gate: blocked"}
          </Tag>
          <Typography.Text type="secondary">{sceneGenerationPublicationReadiness.blockers.join(", ") || sceneGenerationPublicationReadiness.nextAction}</Typography.Text>
          <Typography.Text type="secondary">{`Learner-use blockers: ${sceneGenerationPublicationReadiness.learnerRuntimeUseBlockers?.join(", ") || "none"}`}</Typography.Text>
          <Typography.Text type="secondary">{`Evidence gates: ${summarizeEvidenceGateRefs(sceneGenerationPublicationReadiness.evidenceGateRefs)}`}</Typography.Text>
          <Typography.Text type="secondary">{summarizeScenarioReviewGate(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeBundleGateRefs(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeBundleAssemblyAudit(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizePublicationMetadata(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanoidRealismProfiles(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanoidMetadataBlockers(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanReviewActions(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeDynamicBehaviorCoverage(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeEncounterFactoryInputPlanning(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeEncounterFactoryDryRun(sceneGenerationPublicationReadiness)}</Typography.Text>
        </div>
      ) : null}
      {prohibitedActionEntries.length > 0 ? (
        <div className="station-queue-row">
          {prohibitedActionEntries.map((entry) => (
            <Tag color="orange" key={entry}>
              {entry}
            </Tag>
          ))}
        </div>
      ) : null}
      {featuredPackets.length > 0 ? (
        <ol className="station-queue-list" aria-label="3D environment queue packet preview">
          {featuredPackets.map((packet) => (
            <EnvironmentPacketPreview key={`${packet.scenarioId}:${packet.environmentAssetId}`} packet={packet} />
          ))}
        </ol>
      ) : (
        <Typography.Text type="secondary">No environment packets are attached yet.</Typography.Text>
      )}
    </section>
  );
}

function EnvironmentQueueMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function EnvironmentPacketPreview({ packet }: { packet: EnvironmentGenerationPacket }): ReactElement {
  const firstZone = packet.spatialZones[0];
  const workOrder = buildEnvironmentGenerationWorkOrder(packet);
  const firstTask = workOrder.tasks[0];
  const requiredEvidenceSummary = workOrder.requiredOutputEvidence.slice(0, 3).join(", ");
  const gateBlockerSummary = summarizeEnvironmentPacketGateBlockers(packet);
  const missingEvidenceSummary = workOrder.operatorHandoff.missingEvidenceIds.slice(0, 3).join(", ");
  const reviewBlockerSummary = workOrder.operatorHandoff.reviewBlockerIds.slice(0, 3).join(", ") || "no review blockers";

  return (
    <li>
      <div className="station-queue-row">
        <div>
          <Typography.Text strong>{packet.displayName}</Typography.Text>
          <Typography.Text type="secondary">{packet.environmentAssetId}</Typography.Text>
        </div>
        <Tag color={packet.readyForGenerationReview ? "blue" : "gold"}>
          {packet.readyForGenerationReview ? "generation review ready" : packet.nextReviewGate ?? "generation review blocked"}
        </Tag>
      </div>
      <Typography.Paragraph type="secondary">
        {`${packet.spatialZones.length} spatial zones; first zone: ${firstZone?.zoneId ?? "none"}. Required assets: ${packet.requiredAssetIds.length}.`}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {`${workOrder.tasks.length} authoring tasks; first task: ${firstTask?.taskId ?? "none"}. Authoring tool: ${workOrder.authoringToolId}.`}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Handoff summary: ${workOrder.operatorHandoff.summary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Next action: ${workOrder.operatorHandoff.nextAction}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Missing evidence: ${missingEvidenceSummary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Review blockers: ${reviewBlockerSummary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Gate blockers: ${gateBlockerSummary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Required evidence: ${requiredEvidenceSummary}`}</Typography.Paragraph>
      <Typography.Text type="secondary">{`Handoff boundary: ${workOrder.operatorHandoff.claimBoundary}`}</Typography.Text>
      <Typography.Text type="secondary">{workOrder.claimBoundary}</Typography.Text>
    </li>
  );
}

function summarizeEnvironmentPacketGateBlockers(packet: EnvironmentGenerationPacket): string {
  const blockers = Array.from(new Set(packet.reviewGates.flatMap((gate) => gate.blockers)));

  return blockers.length > 0 ? blockers.slice(0, 3).join(", ") : "no gate blockers";
}

function summarizeEnvironmentNextGateCounts(environmentGenerationQueue: EnvironmentGenerationQueue): string {
  const entries = Object.entries(environmentGenerationQueue.nextReviewGateCounts)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .map(([gate, count]) => `${gate}: ${count}`);

  return entries.length > 0 ? entries.slice(0, 3).join(", ") : "no blocked generation gates";
}

function summarizeEnvironmentWorkOrderCounts(counts: Record<string, number>): string {
  const entries = summarizeEnvironmentWorkOrderCountEntries(counts);

  return entries.length > 0 ? entries.slice(0, 3).join(", ") : "no prohibited generation actions";
}

function summarizeEnvironmentWorkOrderCountEntries(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .map(([item, count]) => `${item}: ${count}`);
}

function summarizeHumanoidRuntimeReadinessHandoff(
  workOrder: ScenarioSceneGenerationPipelineWorkOrderQueue["workOrders"][number],
): string {
  const actorSummaries = workOrder.actorWorkOrders
    .slice(0, 4)
    .map((actorWorkOrder) => {
      const handoff = actorWorkOrder.humanoidRuntimeReadinessHandoff;
      return [
        actorWorkOrder.actorRole,
        "badge realismBlocked until actor-specific humanoid gate evidence attaches",
        `signals ${handoff.requiredSignalIds.join(", ") || "none"}`,
        `locomotion ${String(handoff.locomotionRequired)}`,
        `expression ${String(handoff.expressionRequired)}`,
        `gaze ${String(handoff.gazeRequired)}`,
        `lip-sync ${String(handoff.lipSyncRequired)}`,
        `interactive ${String(handoff.interactiveRequired)}`,
        `blockers ${handoff.blockers.join(", ") || "none"}`,
        handoff.claimBoundary,
        `not evidence for ${handoff.notEvidenceFor.join(", ")}`,
      ].join("; ");
    });
  return actorSummaries.length > 0
    ? actorSummaries.join(" | ")
    : "No humanoid actor runtime handoff metadata attached";
}

function summarizePublicationMetadata(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const metadata = readiness.publicationMetadata;
  if (!metadata) {
    return "Publication metadata: not attached";
  }
  return `Publication metadata: ${metadata.generatedAssetCount} generated asset refs; ${metadata.humanoidActorCount} humanoids; ${metadata.equipmentCount} equipment refs; publication review refs ${metadata.publicationReviewEvidenceRefs?.join(", ") || "none"}; ${metadata.claimBoundary}`;
}

function summarizeRuntimeBundleAssemblyAudit(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const audit = readiness.publicationMetadata?.assemblyAuditMetadata;
  if (!audit) {
    return "Runtime bundle assembly audit: not attached";
  }
  return `Runtime bundle assembly audit: sources ${audit.sourceDefinitionRefs.join(", ") || "none"}; humanoid refs ${audit.humanoidMetadataRefs.map((ref) => `${ref.actorRole}:${ref.actorId}`).join(", ") || "none"}; learner-use blocked until gates attach=${String(audit.fallbackPosture.learnerUseBlockedUntilEvidenceGatesAttach)}; ${audit.claimBoundary}`;
}

function summarizeHumanoidRealismProfiles(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.publicationMetadata?.humanoidRealismProfileSummary;
  if (!summary) {
    return "Humanoid realism profiles: not attached";
  }
  const actorRoleSummary = summary.actorRoles.length > 0 ? summary.actorRoles.join(", ") : "roles not attached";
  return `Humanoid realism profiles: ${summary.profileCount}; actor roles: ${actorRoleSummary}; required signals: ${summary.requiredSignalIds.join(", ")}; ${summary.claimScope}`;
}

function summarizeHumanoidMetadataBlockers(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const blockers = readiness.humanoidMetadataBlockerIds ?? [];
  return `Humanoid metadata blockers: ${blockers.length > 0 ? blockers.join(", ") : "none"}`;
}

function summarizeScenarioReviewGate(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const gate = readiness.scenarioReviewGate;
  if (!gate) {
    return "Scenario status boundary: not attached";
  }
  return `Scenario status boundary: ${gate.scenarioStatus}; ${gate.approvalBoundary}; learner-use blocked=${String(gate.learnerUseBlocked)}; blockers ${gate.blockerIds.join(", ") || "none"}; ${gate.claimBoundary}`;
}

function summarizeRuntimeBundleGateRefs(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const refs = readiness.runtimeBundleGateRefs ?? [];
  if (refs.length === 0) {
    return "Runtime bundle gate refs: not attached";
  }
  return `Runtime bundle gate refs: ${refs.map((ref) => `${ref.gateId} ${ref.status}${ref.blockerIds.length > 0 ? ` (${ref.blockerIds.join(", ")})` : ""}`).join(", ")}`;
}

function summarizeHumanReviewActions(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const actions = readiness.humanReviewActions ?? [];
  if (actions.length === 0) {
    return "Human review actions: not attached";
  }
  return `Human review actions: ${actions.map((action) => `${action.actionId} ${action.status}${action.blockerIds.length > 0 ? ` (${action.blockerIds.join(", ")})` : ""}`).join(", ")}; human_review_action_not_automated_approval`;
}

function summarizeDynamicBehaviorCoverage(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const coverage = readiness.dynamicBehaviorCoverage;
  if (!coverage) {
    return "Dynamic behavior coverage: not attached";
  }
  const missing = [
    ...coverage.missingDialogueActorRoles.map((actorRole) => `dialogue:${actorRole}`),
    ...coverage.missingGazeActorRoles.map((actorRole) => `gaze:${actorRole}`),
    ...coverage.missingPlacementActorRoles.map((actorRole) => `placement:${actorRole}`),
    ...(coverage.missingAffectActorRoles ?? []).map((actorRole) => `affect:${actorRole}`),
  ];
  return `Dynamic behavior coverage: dialogue ${coverage.dialogueActorRoles.join(", ") || "none"}; gaze ${coverage.gazeActorRoles.join(", ") || "none"}; placement ${coverage.placementActorRoles.join(", ") || "none"}; affect ${(coverage.affectActorRoles ?? []).join(", ") || "none"} (${coverage.affectTimelineCount ?? 0} timelines; ${coverage.affectClaimBoundary ?? "metadata_only_not_runtime_facial_animation_evidence"}); missing ${missing.join(", ") || "none"}; blockers ${coverage.blockerIds.join(", ") || "none"}; ${coverage.claimBoundary}`;
}

function summarizeEncounterFactoryDryRun(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.encounterFactoryDryRunSummary;
  if (!summary) {
    return "Encounter factory dry-run: not attached";
  }
  return `Encounter factory dry-run: status ${summary.status}; ${summary.stageIds.length} stages; actors ${summary.actorRoles.join(", ") || "none"}; review gates ${summary.reviewGateIds.join(", ") || "none"}; next ${summary.recommendedNextAction}; blockers ${summary.blockerIds.join(", ") || "none"}; warnings ${summary.warningIds.join(", ") || "none"}; boundaries metadataOnly=${String(summary.evidenceBoundaries.metadataOnlyPlan)} generatedAssets=${String(summary.evidenceBoundaries.generatedAssetsMaterialized)} learnerRuntime=${String(summary.evidenceBoundaries.learnerRuntimeEnabled)} questClaim=${String(summary.evidenceBoundaries.questReadinessClaimed)}; ${summary.claimBoundary}`;
}

function summarizeEncounterFactoryInputPlanning(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.inputPlanningSummary;
  if (!summary) {
    return "Encounter factory input planning: not attached";
  }
  const selection = summary.factorySelectionMetadata
    ? `; factory selection ${summary.factorySelectionMetadata.factorySelectionRole} order ${summary.factorySelectionMetadata.scenarioBankOrder ?? "unspecified"} via ${summary.factorySelectionMetadata.factorySelectionMode} (${summary.factorySelectionMetadata.factorySelectionClaimBoundary})`
    : "";
  return `Encounter factory input planning: ${summary.assetWorkOrderIntent.total} work-order intents (actors ${summary.assetWorkOrderIntent.actor}, environment ${summary.assetWorkOrderIntent.environment}, equipment ${summary.assetWorkOrderIntent.equipment}); shared asset lookup keys ${summary.sharedAssetLibraryReuse.lookupKeyCount}; dynamic behavior tags ${summary.dynamicBehaviorTraceTags.join(", ") || "none"}${selection}; blockers ${summary.blockerIds.join(", ") || "none"}; ${summary.claimBoundary}`;
}

function summarizeEvidenceGateRefs(
  gateRefs: ScenarioSceneGenerationRequestPublicationReadiness["evidenceGateRefs"],
): string {
  if (!gateRefs || gateRefs.length === 0) {
    return "no encounter bundle evidence gates attached";
  }
  return gateRefs
    .map((gateRef) => {
      const blockerSummary = gateRef.blockers.length > 0 ? ` (${gateRef.blockers.length} blockers)` : "";
      const signalSummary = gateRef.requiredSignalIds.length > 0 ? ` requires ${gateRef.requiredSignalIds.join(", ")}` : " requires no additional signal ids";
      return `${gateRef.gateId} ${gateRef.status}${blockerSummary}${signalSummary}`;
    })
    .join(", ");
}
