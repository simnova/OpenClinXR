import { describe, expect, it } from "vitest";
import {
  buildIwsdkAgentVerificationRunbook,
  buildIwsdkCommittedSpikeSequence,
  buildIwsdkSpikeMetricThresholds,
  buildIwsdkSpikePlan,
  evaluateIwsdkSpikeMetrics,
  evaluateIwsdkSpikeReadiness,
  type IwsdkSpikeGateEvidence,
} from "./index.js";

describe("IWSDK spike plan", () => {
  it("keeps Meta IWSDK as an isolated spike with source-backed package guidance", () => {
    const plan = buildIwsdkSpikePlan();

    expect(plan.workspaceScope.allowedRoots).toEqual([
      "apps/ui-xr-iwsdk-spike/",
      "packages/openclinxr/iwsdk-spike/",
    ]);
    expect(plan.sourceRecordIds).toEqual([
      "src-meta-iwsdk-github-2026",
      "src-iwsdk-ai-docs-2026",
      "src-iwsdk-npm-metadata-2026-05-04",
      "src-iwsdk-local-spike-2026-05-04",
      "src-openclinxr-iwsdk-spike-plan-2026-05-04",
    ]);
    expect(plan.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "@iwsdk/vite-plugin-dev",
        posture: "spike_candidate",
        gates: expect.arrayContaining(["vite_8_peer_compatibility", "agent_mcp_runtime_smoke"]),
      }),
      expect.objectContaining({
        name: "@iwsdk/reference",
        posture: "blocked_unattended",
        gates: expect.arrayContaining(["operator_approval_for_model_and_corpus_downloads"]),
      }),
      expect.objectContaining({
        name: "@meta-quest/hzdb",
        posture: "blocked",
        gates: expect.arrayContaining(["legal_review_for_unlicensed_metadata"]),
      }),
    ]));
  });

  it("blocks adoption until local compatibility, license, and physical Quest evidence are present", () => {
    const evidence: IwsdkSpikeGateEvidence = {
      vite8PeerCompatibility: "blocked",
      explicitNode22Runtime: "ready",
      rolldownNativeBinding: "ready",
      licenseReview: "blocked",
      packageWeightAccepted: "ready",
      agentMcpRuntimeSmoke: "blocked",
      quest3PhysicalSmoke: "blocked",
      foregroundFramePacing: "blocked",
    };

    expect(evaluateIwsdkSpikeReadiness(evidence)).toEqual({
      readyForCommittedSpike: false,
      readyForProductionRuntime: false,
      blockers: [
        "vite_8_peer_compatibility",
        "license_review",
        "agent_mcp_runtime_smoke",
        "quest3_physical_smoke",
        "foreground_frame_pacing",
      ],
    });
  });

  it("keeps agent verification ordered around session status before XR interaction", () => {
    const runbook = buildIwsdkAgentVerificationRunbook({ aiTool: "codex", mode: "agent" });

    expect(runbook.adapterConfigTarget).toBe(".codex/config.toml");
    expect(runbook.steps.map((step) => step.toolOrCommand).slice(0, 4)).toEqual([
      "iwsdk dev status",
      "xr_get_session_status",
      "xr_accept_session",
      "browser_screenshot",
    ]);
    expect(runbook.doNotRunUnattended).toEqual([
      "npx iwsdk reference warmup",
      "install @meta-quest/hzdb",
      "adopt @iwsdk/vite-plugin-gltf-optimizer in production builds",
    ]);
  });

  it("defines a contained committed sidecar spike sequence before production adoption", () => {
    const sequence = buildIwsdkCommittedSpikeSequence();

    expect(sequence.sidecarAppRoot).toBe("apps/ui-xr-iwsdk-spike/");
    expect(sequence.productionRootsBlocked).toEqual(["apps/ui-xr/", "apps/api/", "packages/openclinxr/scenario-runtime/"]);
    expect(sequence.phases.map((phase) => phase.id)).toEqual([
      "phase-0-policy",
      "phase-1-runtime-shell",
      "phase-2-agent-devtools",
      "phase-3-quest-device-proof",
    ]);
    expect(sequence.phases).toHaveLength(4);
    const [policyPhase, runtimeShellPhase, agentDevtoolsPhase, questDevicePhase] = sequence.phases;

    expect(policyPhase?.allowedPackages).toEqual(["@iwsdk/core", "@iwsdk/xr-input"]);
    expect(runtimeShellPhase?.requiredMetrics).toEqual(expect.arrayContaining([
      "canvas_nonblank",
      "bundle_size_delta_vs_apps_ui_xr",
      "controller_select_trace_event",
    ]));
    expect(agentDevtoolsPhase?.blockedPackages).toEqual(["@iwsdk/reference", "@meta-quest/hzdb"]);
    expect(questDevicePhase?.requiredMetrics).toEqual(expect.arrayContaining([
      "foreground_frame_pacing",
      "quest3_controller_select_latency",
      "headset_text_readability",
    ]));
  });

  it("defines machine-readable metric thresholds for a committed IWSDK spike", () => {
    expect(buildIwsdkSpikeMetricThresholds()).toEqual({
      installedNodeModulesMbMax: 300,
      injectedDevRuntimeKbMax: 1200,
      appJsBundleKbMax: 550,
      bundleDeltaVsUiXrKbMax: 100,
      avgFpsMin: 72,
      p95FrameMsMax: 25,
      controllerSelectLatencyMsMax: 150,
      consoleErrorCountMax: 0,
    });
  });

  it("separates sidecar spike readiness from production readiness when Quest evidence is missing", () => {
    expect(evaluateIwsdkSpikeMetrics({
      installedNodeModulesMb: 287,
      injectedDevRuntimeKb: 1116.3,
      appJsBundleKb: 504.47,
      bundleDeltaVsUiXrKb: 24,
      consoleErrorCount: 0,
    })).toEqual({
      readyForCommittedSpike: true,
      readyForProductionRuntime: false,
      blockers: [
        "missing_avg_fps",
        "missing_p95_frame_ms",
        "missing_controller_select_latency_ms",
      ],
    });
  });

  it("reports concrete metric blockers when a spike exceeds budget", () => {
    expect(evaluateIwsdkSpikeMetrics({
      installedNodeModulesMb: 315,
      injectedDevRuntimeKb: 1250,
      appJsBundleKb: 610,
      bundleDeltaVsUiXrKb: 140,
      avgFps: 65,
      p95FrameMs: 31,
      controllerSelectLatencyMs: 220,
      consoleErrorCount: 1,
    })).toEqual({
      readyForCommittedSpike: false,
      readyForProductionRuntime: false,
      blockers: [
        "installed_node_modules_mb_over_budget",
        "injected_dev_runtime_kb_over_budget",
        "app_js_bundle_kb_over_budget",
        "bundle_delta_vs_ui_xr_kb_over_budget",
        "console_errors_present",
        "avg_fps_below_floor",
        "p95_frame_ms_over_budget",
        "controller_select_latency_ms_over_budget",
      ],
    });
  });
});
