import type { EnvironmentGenerationQueue, ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import type { ExamStationRunQueue } from "@openclinxr/exam-assembly";
import { Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type { AdminRealtimeVoicePosture, AdminRuntimeProtocolPosture, AdminRuntimeProviderReadiness } from "./api-client.js";

export type SeedExamReadinessBoundaryPanelProps = {
  assetReadiness: ScenarioAssetReadiness[];
  stationRunQueue: ExamStationRunQueue;
  runtimeProviderReadiness: AdminRuntimeProviderReadiness;
  runtimeProtocolPosture: AdminRuntimeProtocolPosture;
  realtimeVoicePosture: AdminRealtimeVoicePosture;
  environmentGenerationQueue: EnvironmentGenerationQueue;
};

export function SeedExamReadinessBoundaryPanel({
  assetReadiness,
  stationRunQueue,
  runtimeProviderReadiness,
  runtimeProtocolPosture,
  realtimeVoicePosture,
  environmentGenerationQueue,
}: SeedExamReadinessBoundaryPanelProps): ReactElement {
  const productionBlockedScenes = assetReadiness.filter((readiness) => !readiness.productionReady).length;
  const developmentPlaceholderScenes = assetReadiness.filter((readiness) => readiness.devReady && !readiness.productionReady).length;
  const releaseLadderAssetCount = assetReadiness.reduce(
    (count, readiness) => count + (readiness.productionReadinessLadder?.assetCount ?? 0),
    0,
  );
  const blockedReleaseAssetCount = assetReadiness.reduce(
    (count, readiness) => count + (readiness.productionReadinessLadder?.blockedAssetIds.length ?? 0),
    0,
  );
  const releaseBlockerTypes = summarizeReleaseBlockerTypes(assetReadiness);
  const stationQueueBlockerCount = stationRunQueue.stationQueue.reduce(
    (count, station) => count + station.blockers.length,
    0,
  );
  const deterministicReplayReadyProfiles = runtimeProviderReadiness.surfaces.filter((surface) => surface.deterministicReplayReady).length;
  const liveInteractiveProviderReadyProfiles = runtimeProviderReadiness.surfaces.filter((surface) => surface.liveInteractiveProviderReady).length;
  const localDevelopmentProviderSurface = runtimeProviderReadiness.surfaces.find((surface) => surface.profile === "local-development");
  const providerCapabilityGateCounts = summarizeProviderCapabilityGateCounts(runtimeProviderReadiness);
  const providerWarningIds = summarizeProviderWarningIds(runtimeProviderReadiness);
  const providerNextActions = summarizeProviderNextActions(runtimeProviderReadiness);
  const missingVoiceGateIds = summarizeMissingVoiceGateIds(realtimeVoicePosture);
  const runtimeReadyProtocolCount = runtimeProtocolPosture.protocols.filter((protocol) => protocol.status === "ready").length;
  const evidenceGatedMediaProtocolCount = runtimeProtocolPosture.protocols.filter((protocol) =>
    protocol.role === "media-transport" && protocol.claimScope !== "runtime_ready"
  ).length;
  const websocketProtocol = runtimeProtocolPosture.protocols.find((protocol) => protocol.protocolId === "websocket");
  const selectedVoiceLane = realtimeVoicePosture.recommendedProtocolSelection.selectedLane;
  const rejectedVoiceLaneCount = realtimeVoicePosture.recommendedProtocolSelection.rejectedLaneReasons.length;
  const voiceProxyStatus = realtimeVoicePosture.backends.pythonFastApi.transportProxy.status;
  const environmentNextGateSummary = summarizeEnvironmentNextGateCounts(environmentGenerationQueue);

  return (
    <section className="workbench-panel" aria-label="Seed exam readiness boundary">
      <div className="station-queue-row">
        <Typography.Title level={4}>Seed Exam Readiness Boundary</Typography.Title>
        <Tag color={stationRunQueue.canStartLearnerExam ? "green" : "gold"}>
          {stationRunQueue.canStartLearnerExam ? "Learner launch ready" : "Learner launch blocked"}
        </Tag>
      </div>
      <Typography.Paragraph>
        Development placeholder scenes support local review only; they do not establish learner launch, Quest readiness, or production asset release.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Runtime and provider readiness are not attached to this seed exam launch gate; use deterministic replay and faculty review summaries until live provider gates are explicitly approved.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {`Provider gate source: ${runtimeProviderReadiness.source}; local-development deterministic replay is ${localDevelopmentProviderSurface?.deterministicReplayReady ? "ready" : "not ready"} and live provider readiness is ${localDevelopmentProviderSurface?.liveInteractiveProviderReady ? "ready" : "not ready"}.`}
      </Typography.Paragraph>
      {providerWarningIds.length > 0 ? (
        <ul className="compact-list" aria-label="Provider gate warning IDs">
          {providerWarningIds.map((warningId) => (
            <li key={warningId}>
              <Typography.Text type="secondary">{warningId}</Typography.Text>
            </li>
          ))}
        </ul>
      ) : null}
      {providerNextActions.length > 0 ? (
        <ul className="compact-list" aria-label="Provider gate recommended next actions">
          {providerNextActions.map((nextAction) => (
            <li key={nextAction}>
              <Typography.Text type="secondary">{nextAction}</Typography.Text>
            </li>
          ))}
        </ul>
      ) : null}
      <Typography.Paragraph type="secondary">
        {`Runtime protocol posture: ${runtimeProtocolPosture.primaryRuntimeTarget} primary with ${runtimeProtocolPosture.localFallbackRuntimeTarget} fallback; WebSocket is ${websocketProtocol?.status ?? "not listed"} until ${websocketProtocol?.blockers[0] ?? "runtime evidence"} clears.`}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {`Realtime voice posture: ${selectedVoiceLane?.id ?? "no media lane selected"} selected, Python proxy ${voiceProxyStatus}, cloud APIs used: ${realtimeVoicePosture.policy.cloudApisUsed ? "yes" : "no"}.`}
      </Typography.Paragraph>
      {missingVoiceGateIds.length > 0 ? (
        <Typography.Paragraph type="secondary" aria-label="Missing voice provider gates">
          {`Voice/speech gates pending evidence: ${missingVoiceGateIds.join(", ")}.`}
        </Typography.Paragraph>
      ) : null}
      <Typography.Paragraph type="secondary">
        3D environment generation queue is planning evidence only; it does not mean assets have been produced or Quest runtime evidence is attached.
      </Typography.Paragraph>
      <div className="readiness-strip" aria-label="Seed exam boundary metrics">
        <BoundaryReadinessMetric label={`${developmentPlaceholderScenes} development placeholder scenes`} detail={`${productionBlockedScenes} production-blocked scenes`} />
        <BoundaryReadinessMetric label={`${releaseLadderAssetCount} release-ladder assets`} detail={`${blockedReleaseAssetCount} release-blocked assets`} />
        <BoundaryReadinessMetric label={`${releaseBlockerTypes.count} release blocker ${releaseBlockerTypes.count === 1 ? "type" : "types"}`} detail={releaseBlockerTypes.summary} />
        <BoundaryReadinessMetric
          label={`${environmentGenerationQueue.packetCount} environment packets`}
          detail={`${environmentGenerationQueue.blockedScenarioIds.length} generation-review blocked`}
        />
        <BoundaryReadinessMetric
          label={`${environmentGenerationQueue.readyForGenerationReviewScenarioIds.length} generation-review ready`}
          detail={environmentNextGateSummary}
        />
        <BoundaryReadinessMetric
          label={`${stationQueueBlockerCount} station queue blockers`}
          detail={stationRunQueue.canStartLearnerExam ? "no queue blockers" : "queue still needs faculty review"}
        />
        <BoundaryReadinessMetric
          label={`${deterministicReplayReadyProfiles} deterministic replay profiles`}
          detail={`${liveInteractiveProviderReadyProfiles} live-provider profiles ready`}
        />
        <BoundaryReadinessMetric
          label={`${providerCapabilityGateCounts.planned} planned provider capabilities`}
          detail={`${providerCapabilityGateCounts.blocked} blocked, ${providerCapabilityGateCounts.notConfigured} not configured`}
        />
        <BoundaryReadinessMetric
          label={`${runtimeReadyProtocolCount} runtime-ready protocols`}
          detail={`${evidenceGatedMediaProtocolCount} evidence-gated media lanes`}
        />
        <BoundaryReadinessMetric
          label={selectedVoiceLane?.id ?? "no voice media lane"}
          detail={`${rejectedVoiceLaneCount} voice lanes rejected`}
        />
      </div>
    </section>
  );
}

function summarizeProviderNextActions(runtimeProviderReadiness: AdminRuntimeProviderReadiness): string[] {
  return [
    ...new Set(runtimeProviderReadiness.surfaces.flatMap((surface) => [
      ...(surface.recommendedNextAction ? [`${surface.profile}:${surface.recommendedNextAction}`] : []),
      ...(surface.providerGates ?? [])
        .filter((gate) => !gate.liveProviderReady && gate.recommendedNextAction)
        .map((gate) => `${gate.gateId}:${gate.recommendedNextAction}`),
    ])),
  ].sort().slice(0, 8);
}

function summarizeMissingVoiceGateIds(realtimeVoicePosture: AdminRealtimeVoicePosture): string[] {
  return (realtimeVoicePosture.providerGates ?? [])
    .filter((gate) => !gate.liveProviderReady)
    .map((gate) => `${gate.gateId}:${gate.recommendedNextAction}`)
    .sort();
}

function summarizeProviderWarningIds(runtimeProviderReadiness: AdminRuntimeProviderReadiness): string[] {
  return runtimeProviderReadiness.surfaces
    .flatMap((surface) => surface.warnings.map((warning) => `${surface.profile}:${warning}`))
    .sort();
}

function summarizeProviderCapabilityGateCounts(runtimeProviderReadiness: AdminRuntimeProviderReadiness): {
  blocked: number;
  notConfigured: number;
  planned: number;
} {
  return runtimeProviderReadiness.surfaces.reduce(
    (counts, surface) => {
      const planes = [surface.interactiveRuntime, surface.assetPipeline, surface.persistence];
      for (const plane of planes) {
        counts.blocked += plane.blockedCapabilityIds.length;
        counts.notConfigured += plane.notConfiguredCapabilityIds.length;
        counts.planned += plane.plannedCapabilityIds.length;
      }
      return counts;
    },
    { blocked: 0, notConfigured: 0, planned: 0 },
  );
}

function BoundaryReadinessMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function summarizeReleaseBlockerTypes(assetReadiness: readonly ScenarioAssetReadiness[]): { count: number; summary: string } {
  const counts = new Map<string, number>();
  for (const readiness of assetReadiness) {
    for (const blocker of readiness.productionReadinessLadder?.blockers ?? []) {
      const blockerType = blocker.includes(":") ? blocker.slice(blocker.indexOf(":") + 1) : blocker;
      counts.set(blockerType, (counts.get(blockerType) ?? 0) + 1);
    }
  }

  const entries = [...counts.entries()]
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .map(([blocker, count]) => `${blocker}: ${count}`);

  return {
    count: entries.length,
    summary: entries.length > 0 ? entries.slice(0, 3).join(", ") : "no release blockers",
  };
}

function summarizeEnvironmentNextGateCounts(environmentGenerationQueue: EnvironmentGenerationQueue): string {
  const entries = Object.entries(environmentGenerationQueue.nextReviewGateCounts)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .map(([gate, count]) => `${gate}: ${count}`);

  return entries.length > 0 ? entries.slice(0, 3).join(", ") : "no blocked generation gates";
}
