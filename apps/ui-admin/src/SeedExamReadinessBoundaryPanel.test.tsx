import "@testing-library/jest-dom/vitest";
import type { EnvironmentGenerationQueue, ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import { findUnsafeClaimLanguage } from "@openclinxr/domain/claim-language";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeedExamReadinessBoundaryPanel } from "./SeedExamReadinessBoundaryPanel.js";

describe("SeedExamReadinessBoundaryPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("summarizes seed-bank release ladders without promoting runtime readiness", () => {
    render(
      <SeedExamReadinessBoundaryPanel
        assetReadiness={[
          scenarioReadiness("ed_chest_pain_priority_v1", ["patient_robert_hayes_character", "ed_exam_bay_environment"]),
          scenarioReadiness("peds_asthma_parent_anxiety_v1", ["patient_maya_johnson_character"]),
        ]}
        stationRunQueue={{
          blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
          canStartLearnerExam: false,
          stationQueue: [
            {
              stationOrder: 1,
              slotId: "station_1",
              label: "Station 1",
              scenarioId: "ed_chest_pain_priority_v1",
              scenarioVersion: 1,
              status: "draft_blocked",
              blockers: ["scenario_not_approved"],
              timing: stationTimingWindow(1),
            },
          ],
          breakCheckpoints: [],
          totalStationTimeSeconds: 1560,
          summary: { activationReady: 0, draftBlocked: 1, governanceBlocked: 0, missingScenario: 0 },
        }}
        runtimeProviderReadiness={{
          source: "capability-routing-matrix",
          claimBoundary: "deterministic_replay_ready_is_not_live_provider_readiness",
          surfaces: [
            {
              profile: "local-development",
              deterministicReplayReady: true,
              liveInteractiveProviderReady: false,
              interactiveRuntime: { readyCapabilityIds: ["model-dialogue"], notConfiguredCapabilityIds: [], plannedCapabilityIds: [], blockedCapabilityIds: [] },
              assetPipeline: { readyCapabilityIds: [], notConfiguredCapabilityIds: [], plannedCapabilityIds: ["character-generation"], blockedCapabilityIds: [] },
              persistence: { readyCapabilityIds: ["persistence"], notConfiguredCapabilityIds: [], plannedCapabilityIds: [], blockedCapabilityIds: [] },
              recommendedNextAction: "attach_manual_asset_generation_review_evidence",
              providerGates: [
                {
                  gateId: "local-development:local/manual:asset-generation",
                  domain: "asset-generation",
                  path: "local/manual",
                  capabilityIds: ["character-generation"],
                  state: "available_for_local_manual_review",
                  liveProviderReady: false,
                  credentialEvidencePresent: false,
                  runtimeEvidencePresent: false,
                  blockers: ["manual_asset_generation_review_evidence_not_attached"],
                  recommendedNextAction: "attach_manual_asset_generation_review_evidence",
                  claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
                },
              ],
              warnings: ["deterministic_mock_only_not_live_provider_readiness"],
            },
          ],
        }}
        runtimeProtocolPosture={{
          primaryRuntimeTarget: "bun-hono",
          localFallbackRuntimeTarget: "node-hono",
          azureRuntimeTarget: "azure-functions-node",
          protocols: [
            protocol("http-rest", "ready", "runtime_ready", "control-plane", []),
            protocol("websocket", "contract_ready", "contract_only", "media-transport", ["api_bun_websocket_runtime_not_verified"]),
          ],
        }}
        realtimeVoicePosture={{
          policy: { cloudApisUsed: false, paidApisUsed: false, modelDownloadsPerformed: false, productionUseAllowed: false },
          transports: {
            websocket: { status: "working_spike_transport", path: "/voice/realtime/ws", codec: "opus" },
            webTransport: { status: "blocked_pending_runtime_support", blockers: ["quest_webtransport_path_not_verified"] },
          },
          gatewayRuntime: { target: "bun-hono-http3", localVerifiedFallback: "node-hono-ws", blockers: [] },
          backends: {
            pythonFastApi: {
              status: "source_present_not_executed",
              websocketPath: "/voice/realtime/ws",
              transportProxy: {
                status: "not_configured",
                backendUrlConfigured: false,
                readyForLiveDialog: false,
                blockers: ["python_backend_websocket_url_not_configured"],
              },
              blockers: ["python_backend_not_executed"],
            },
          },
          protocolLanes: [],
          providerGates: [
            {
              gateId: "stt",
              capability: "transcription",
              providerPath: "local-runtime",
              state: "planned_pending_evidence",
              liveProviderReady: false,
              credentialEvidencePresent: false,
              runtimeEvidencePresent: false,
              blockers: ["stt_medical_vocabulary_wer_evidence_missing"],
              recommendedNextAction: "attach_stt_medical_vocabulary_and_latency_evidence",
              claimBoundary: "voice_provider_gate_metadata_not_live_dialog_readiness",
            },
            {
              gateId: "lip_sync_timing",
              capability: "lip_sync_timing",
              providerPath: "blocked",
              state: "blocked",
              liveProviderReady: false,
              credentialEvidencePresent: false,
              runtimeEvidencePresent: false,
              blockers: ["lip_sync_timing_evidence_missing"],
              recommendedNextAction: "attach_lip_sync_timing_and_viseme_alignment_evidence",
              claimBoundary: "voice_provider_gate_metadata_not_live_dialog_readiness",
            },
          ],
          recommendedProtocolSelection: {
            selectedLane: {
              id: "websocket-media",
              protocol: "websocket",
              role: "media-transport",
              status: "working_spike_transport",
              mediaAllowed: true,
              blockers: [],
              notes: "WebSocket media lane.",
            },
            rejectedLaneReasons: [{ id: "webtransport-http3-media", reason: "proposal_required", blockers: ["quest_webtransport_path_not_verified"] }],
          },
        }}
        environmentGenerationQueue={environmentGenerationQueueFixture()}
      />,
    );

    expect(screen.getByText("3 release-ladder assets")).toBeInTheDocument();
    expect(screen.getByText("3 release-blocked assets")).toBeInTheDocument();
    expect(screen.getByText("1 release blocker type")).toBeInTheDocument();
    expect(screen.getByText("visual_clinical_critique_missing: 3")).toBeInTheDocument();
    expect(screen.getByText("12 environment packets")).toBeInTheDocument();
    expect(screen.getByText("12 generation-review blocked")).toBeInTheDocument();
    expect(screen.getByText("attach_environment_generation_evidence: 12")).toBeInTheDocument();
    expect(screen.getByText("3D environment generation queue is planning evidence only; it does not mean assets have been produced or Quest runtime evidence is attached.")).toBeInTheDocument();
    expect(screen.getByText("Realtime voice posture: websocket-media selected, Python proxy not_configured, cloud APIs used: no.")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider gate warning IDs")).toHaveTextContent("local-development:deterministic_mock_only_not_live_provider_readiness");
    expect(screen.getByLabelText("Provider gate recommended next actions")).toHaveTextContent("local-development:local/manual:asset-generation:attach_manual_asset_generation_review_evidence");
    expect(screen.getByLabelText("Missing voice provider gates")).toHaveTextContent("stt:attach_stt_medical_vocabulary_and_latency_evidence");
    expect(screen.getByLabelText("Missing voice provider gates")).toHaveTextContent("lip_sync_timing:attach_lip_sync_timing_and_viseme_alignment_evidence");
    expect(screen.getByText("1 planned provider capabilities")).toBeInTheDocument();
    expect(screen.getByText("0 blocked, 0 not configured")).toBeInTheDocument();
    expect(findUnsafeClaimLanguage(screen.getByLabelText("Seed exam readiness boundary").textContent ?? "")).toEqual([]);
  });
});

function environmentGenerationQueueFixture(): EnvironmentGenerationQueue {
  return {
    scenarioCount: 12,
    packetCount: 12,
    readyForGenerationReviewScenarioIds: [],
    blockedScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
    nextReviewGateCounts: { attach_environment_generation_evidence: 12 },
    packets: [],
  };
}

function scenarioReadiness(scenarioId: string, assetIds: string[]): ScenarioAssetReadiness {
  return {
    scenarioId,
    devReady: true,
    productionReady: false,
    stationBudget: {
      maxVisibleTriangles: 180000,
      maxTextureMegabytes: 512,
      maxDrawCalls: 120,
      totalTriangles: 48000,
      totalTextureMegabytes: 72,
      totalDrawCalls: 24,
      blockers: [],
    },
    missingRequiredAssetIds: [],
    blockedAssets: [],
    productionBlockedAssets: assetIds.map((assetId) => ({ assetId, blockers: ["placeholder_asset_not_clinical_release_ready"] })),
    productionReadinessLadder: {
      scenarioId,
      productionReady: false,
      assetCount: assetIds.length,
      productionReadyAssetIds: [],
      blockedAssetIds: assetIds,
      missingRequiredAssetIds: [],
      blockers: assetIds.map((assetId) => `${assetId}:visual_clinical_critique_missing`),
      stationBudget: {
        maxVisibleTriangles: 180000,
        maxTextureMegabytes: 512,
        maxDrawCalls: 120,
        totalTriangles: 48000,
        totalTextureMegabytes: 72,
        totalDrawCalls: 24,
        blockers: [],
      },
      assetLadders: assetIds.map((assetId) => ({
        assetId,
        scenarioId,
        productionReady: false,
        blockers: ["visual_clinical_critique_missing"],
        steps: [
          { step: "provenance_license", status: "complete", evidenceRefs: [`${assetId}:license`], blockers: [] },
          { step: "visual_clinical_critique", status: "blocked", evidenceRefs: [], blockers: ["visual_clinical_critique_missing"] },
        ],
      })),
    },
  };
}

function stationTimingWindow(stationOrder: number) {
  return {
    stationOrder,
    slotId: `station_${stationOrder}`,
    label: `Station ${stationOrder}`,
    doorway: { startsAtSecond: 0, endsAtSecond: 120, durationSeconds: 120 },
    encounter: { startsAtSecond: 120, endsAtSecond: 1020, durationSeconds: 900 },
    note: { startsAtSecond: 1020, endsAtSecond: 1560, durationSeconds: 540 },
  };
}

function protocol(protocolId: string, status: string, claimScope: string, role: string, blockers: string[]) {
  return {
    protocolId,
    status,
    claimScope,
    runtimeTarget: "bun-hono",
    role,
    clinicalMediaAllowed: role === "media-transport",
    blockers,
    notes: "Test protocol posture.",
  };
}
