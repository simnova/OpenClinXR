import { describe, expect, it } from "vitest";
import {
  buildIwsdkAiModeProfiles,
  buildIwsdkAgentVerificationRunbook,
  buildIwsdkCodexMcpAdapterTemplate,
  buildIwsdkCommittedSpikeSequence,
  buildIwsdkManagedBrowserEvidenceContract,
  buildIwsdkMcpToolInventoryRequirement,
  buildIwsdkMcpToolCoverage,
  buildIwsdkOptionalMcpServerPolicy,
  buildIwsdkPreInstallPackagePolicy,
  buildIwsdkSidecarReadinessContract,
  buildIwsdkSpikeMetricThresholds,
  buildIwsdkSpikePlan,
  evaluateIwsdkManagedBrowserEvidence,
  evaluateIwsdkPreInstallPackageSelection,
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
    expect(runbook.adapterSyncCommand).toBe("iwsdk adapter sync");
    expect(runbook.modeProfile.mode).toBe("agent");
    expect(runbook.modeProfile.playwrightBrowser).toBe("headless_fixed_viewport");
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

  it("defines IWSDK AI mode profiles so agents can pick the right verification posture", () => {
    expect(buildIwsdkAiModeProfiles()).toEqual([
      {
        mode: "agent",
        playwrightBrowser: "headless_fixed_viewport",
        devUi: "off",
        normalBrowser: "opens_independently",
        openclinxrUse: "Default unattended Codex smoke for screenshots, console logs, scene hierarchy, and controller-input regression.",
      },
      {
        mode: "oversight",
        playwrightBrowser: "visible_resizable",
        devUi: "off",
        normalBrowser: "playwright_browser",
        openclinxrUse: "Human-observed debug run when visual framing, text readability, or XR entry behavior needs review.",
      },
      {
        mode: "collaborate",
        playwrightBrowser: "visible_resizable",
        devUi: "on",
        normalBrowser: "playwright_browser",
        openclinxrUse: "Hands-on pairing session for controller, hand, or spatial UI tuning after the sidecar shell is stable.",
      },
    ]);
  });

  it("maps IWSDK MCP tool categories to OpenClinXR evidence needs", () => {
    expect(buildIwsdkMcpToolCoverage()).toEqual([
      {
        category: "session",
        representativeTools: ["xr_get_session_status", "xr_accept_session"],
        evidenceUse: "XR entry readiness and session state before screenshots or controller actions.",
      },
      {
        category: "browser",
        representativeTools: ["browser_screenshot", "browser_get_console_logs"],
        evidenceUse: "Nonblank canvas and warning/error capture for unattended sidecar smoke.",
      },
      {
        category: "scene",
        representativeTools: ["scene_get_hierarchy"],
        evidenceUse: "Named station object presence without relying only on visual screenshots.",
      },
      {
        category: "input",
        representativeTools: ["xr_select"],
        evidenceUse: "Controller-triggered learner trace actions in the emulated runtime.",
      },
      {
        category: "transforms",
        representativeTools: ["xr_set_headset_transform", "xr_set_controller_transform"],
        evidenceUse: "Repeatable headset/controller positioning for station framing checks.",
      },
      {
        category: "ecs",
        representativeTools: ["ecs_pause", "ecs_step", "ecs_query_entities"],
        evidenceUse: "Deterministic inspection of runtime entity state during scenario transitions.",
      },
    ]);
  });

  it("requires the IWSDK 32-tool MCP inventory before agent tooling readiness is claimed", () => {
    expect(buildIwsdkMcpToolInventoryRequirement()).toEqual({
      expectedToolCount: 32,
      sourceRecordIds: ["src-iwsdk-ai-docs-2026"],
      requiredCategories: ["session", "transforms", "input", "browser", "scene", "ecs"],
      minimalSmokeSubset: [
        "xr_get_session_status",
        "xr_accept_session",
        "browser_screenshot",
        "scene_get_hierarchy",
        "xr_select",
        "browser_get_console_logs",
      ],
      readinessBlockersWhenMissing: [
        "mcp_tool_inventory_count_not_recorded",
        "mcp_required_category_missing",
        "mcp_smoke_subset_not_validated",
      ],
    });
  });

  it("defines managed-browser evidence separately from normal-browser evidence", () => {
    expect(buildIwsdkManagedBrowserEvidenceContract()).toEqual({
      sourceRecordIds: ["src-iwsdk-ai-docs-2026"],
      requiredModeEvidence: [
        {
          mode: "agent",
          managedBrowser: "headless Playwright browser with fixed screenshot viewport",
          normalBrowser: "opens independently with its own XR session",
          requiredEvidence: [
            "runtime_url",
            "managed_browser_ready",
            "managed_session_id",
            "normal_browser_opened",
            "normal_session_id",
            "session_ids_differ",
            "fixed_screenshot_size",
            "managed_devui_off",
            "normal_devui_on",
          ],
        },
        {
          mode: "oversight",
          managedBrowser: "visible resizable Playwright browser",
          normalBrowser: "suppressed by default",
          requiredEvidence: [
            "runtime_url",
            "managed_browser_ready",
            "managed_session_id",
            "normal_browser_not_opened",
            "managed_devui_off",
          ],
        },
        {
          mode: "collaborate",
          managedBrowser: "visible resizable Playwright browser with DevUI",
          normalBrowser: "suppressed by default",
          requiredEvidence: [
            "runtime_url",
            "managed_browser_ready",
            "managed_session_id",
            "normal_browser_not_opened",
            "managed_devui_on",
          ],
        },
      ],
      readinessBlockersWhenMissing: [
        "managed_browser_readiness_not_recorded",
        "normal_browser_independence_not_recorded_for_agent_mode",
        "devui_posture_not_recorded",
        "screenshot_size_not_recorded_for_agent_mode",
      ],
    });
  });

  it("requires agent-mode evidence to prove managed and normal browser sessions are independent", () => {
    expect(evaluateIwsdkManagedBrowserEvidence({
      mode: "agent",
      runtimeUrl: "http://127.0.0.1:5181",
      managedBrowserReady: true,
      managedSessionId: "managed-session",
      normalBrowserOpened: true,
      normalSessionId: "normal-session",
      screenshotWidth: 500,
      screenshotHeight: 500,
      managedDevUiVisible: false,
      normalDevUiVisible: true,
    })).toEqual({
      ready: true,
      blockers: [],
    });
  });

  it("reports concrete blockers when IWSDK browser evidence is incomplete or contradicts the selected mode", () => {
    expect(evaluateIwsdkManagedBrowserEvidence({
      mode: "agent",
      managedBrowserReady: false,
      managedSessionId: "same-session",
      normalBrowserOpened: true,
      normalSessionId: "same-session",
      managedDevUiVisible: true,
      normalDevUiVisible: false,
    })).toEqual({
      ready: false,
      blockers: [
        "missing_runtime_url",
        "managed_browser_not_ready",
        "normal_browser_session_not_independent",
        "missing_agent_fixed_screenshot_size",
        "managed_devui_should_be_off",
        "normal_devui_should_be_on",
      ],
    });

    expect(evaluateIwsdkManagedBrowserEvidence({
      mode: "collaborate",
      runtimeUrl: "http://127.0.0.1:5181",
      managedBrowserReady: true,
      managedSessionId: "managed-session",
      normalBrowserOpened: true,
      managedDevUiVisible: false,
    })).toEqual({
      ready: false,
      blockers: [
        "normal_browser_should_not_open_automatically",
        "managed_devui_should_be_on",
      ],
    });
  });

  it("classifies reference and hzdb as optional MCP servers blocked in unattended runs", () => {
    expect(buildIwsdkOptionalMcpServerPolicy()).toEqual([
      {
        serverName: "iwsdk-reference",
        packageName: "@iwsdk/reference",
        posture: "blocked_unattended",
        sourceRecordIds: ["src-iwsdk-ai-docs-2026", "src-iwsdk-npm-metadata-2026-05-04"],
        allowedOnlyAfter: ["operator_approval_for_model_and_corpus_downloads", "cache_location_documented"],
        blockedActions: ["npx iwsdk reference warmup"],
      },
      {
        serverName: "hzdb",
        packageName: "@meta-quest/hzdb",
        posture: "blocked",
        sourceRecordIds: ["src-iwsdk-ai-docs-2026", "src-iwsdk-npm-metadata-2026-05-04"],
        allowedOnlyAfter: ["legal_review_for_unlicensed_metadata", "procurement_approval"],
        blockedActions: ["install @meta-quest/hzdb"],
      },
    ]);
  });

  it("builds a Codex MCP adapter template that stays package-managed and reversible", () => {
    const template = buildIwsdkCodexMcpAdapterTemplate();

    expect(template.target).toBe(".codex/config.toml");
    expect(template.serverName).toBe("iwsdk-runtime");
    expect(template.tomlSnippet).toContain("[mcp_servers.iwsdk-runtime]");
    expect(template.tomlSnippet).toContain('command = "pnpm"');
    expect(template.tomlSnippet).toContain('args = ["exec", "iwsdk", "mcp", "stdio"]');
    expect(template.validationCommandOrder).toEqual([
      "iwsdk dev status",
      "xr_get_session_status",
      "xr_accept_session",
      "browser_screenshot",
      "scene_get_hierarchy",
      "xr_select",
      "browser_get_console_logs",
    ]);
    expect(template.prerequisites).toEqual([
      "Use only after apps/ui-xr-iwsdk-spike exists with exact IWSDK package versions installed.",
      "Run pnpm iwsdk:verify before adding the adapter to local Codex config.",
      "Keep the adapter local and reversible; do not commit .codex/config.toml changes.",
    ]);
    expect(template.blockedActions).toEqual([
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

  it("keeps the IWSDK sidecar as a non-runnable contract until install evidence exists", () => {
    expect(buildIwsdkSidecarReadinessContract()).toEqual({
      sidecarAppRoot: "apps/ui-xr-iwsdk-spike/",
      currentState: "contract_only",
      runnable: false,
      createAppOnlyAfter: [
        "operator_accepts_iwsdk_install_scope",
        "exact_iwsdk_versions_selected",
        "license_review_accepts_transitive_dependency_posture",
        "pnpm_iwsdk_verify_passes",
      ],
      misleadingScaffoldRisks: [
        "A no-install sidecar app can look like runtime progress while proving no IWSDK behavior.",
        "A scaffold without exact IWSDK dependencies cannot measure Vite peer compatibility, install footprint, MCP runtime behavior, or Quest 3 frame pacing.",
      ],
    });
  });

  it("defines pre-install package policy for the first IWSDK sidecar dependency proposal", () => {
    expect(buildIwsdkPreInstallPackagePolicy()).toEqual({
      exactVersionRequired: true,
      allowedFirstSlicePackages: ["@iwsdk/core", "@iwsdk/xr-input"],
      reviewRequiredPackages: ["@iwsdk/locomotor", "@iwsdk/vite-plugin-dev", "@iwsdk/vite-plugin-gltf-optimizer"],
      blockedPackages: ["@iwsdk/reference", "@meta-quest/hzdb"],
      blockedTransitivePackages: ["@img/sharp-libvips-darwin-arm64"],
      blockedLicenseExpressions: ["AGPL", "GPL", "LGPL", "UNLICENSED", "Unknown"],
      requiredPackageManagerControls: ["pin_exact_versions", "pin_three_override", "record_pnpm_audit", "record_license_policy_report"],
    });
  });

  it("accepts a pinned first-slice IWSDK package selection before installation", () => {
    expect(evaluateIwsdkPreInstallPackageSelection([
      { name: "@iwsdk/core", version: "0.3.1", license: "MIT", transitivePackages: ["three"] },
      { name: "@iwsdk/xr-input", version: "0.3.1", license: "MIT", transitivePackages: [] },
    ])).toEqual({
      readyToInstallInSidecar: true,
      blockers: [],
      reviewWarnings: [],
    });
  });

  it("blocks unpinned, blocked, and license-sensitive IWSDK package selections before installation", () => {
    expect(evaluateIwsdkPreInstallPackageSelection([
      { name: "@iwsdk/core", version: "^0.3.1", license: "MIT", transitivePackages: [] },
      { name: "@iwsdk/reference", version: "0.3.2", license: "MIT", transitivePackages: ["@huggingface/transformers"] },
      { name: "@meta-quest/hzdb", version: "1.1.0", license: "UNLICENSED", transitivePackages: [] },
      {
        name: "@iwsdk/vite-plugin-gltf-optimizer",
        version: "0.3.1",
        license: "MIT",
        transitivePackages: ["@img/sharp-libvips-darwin-arm64"],
      },
    ])).toEqual({
      readyToInstallInSidecar: false,
      blockers: [
        "@iwsdk/core:version_not_exact",
        "@iwsdk/reference:blocked_package",
        "@meta-quest/hzdb:blocked_package",
        "@meta-quest/hzdb:blocked_license_UNLICENSED",
        "@iwsdk/vite-plugin-gltf-optimizer:blocked_transitive_@img/sharp-libvips-darwin-arm64",
      ],
      reviewWarnings: [
        "@iwsdk/vite-plugin-gltf-optimizer:review_required_package",
      ],
    });
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
