import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkAiModeProfiles,
  buildIwsdkAgentVerificationRunbook,
  buildIwsdkCodexMcpAdapterTemplate,
  buildIwsdkCommittedSpikeSequence,
  buildIwsdkCompatibilityContract,
  buildIwsdkManagedBrowserEvidenceContract,
  buildIwsdkMcpToolInventory,
  buildIwsdkMcpToolInventoryRequirement,
  buildIwsdkMcpToolCoverage,
  buildIwsdkOptionalMcpServerPolicy,
  buildIwsdkPackageMetadataDriftPolicies,
  buildIwsdkPreInstallPackagePolicy,
  buildIwsdkSidecarReadinessContract,
  buildIwsdkSpikeMetricThresholds,
  buildIwsdkSpikePlan,
  buildIwsdkSourceRecordIdContract,
  buildIwsdkViteAiDevConfigContract,
  evaluateIwsdkCompatibilityEvidence,
  evaluateIwsdkWorkspacePosture,
  evaluateIwsdkAgentToolingEvidence,
  evaluateIwsdkManagedBrowserEvidence,
  evaluateIwsdkPackageMetadataDriftEvidence,
  evaluateIwsdkPreInstallPackageSelection,
  evaluateIwsdkSpikeMetrics,
  evaluateIwsdkSpikeReadiness,
  type IwsdkSpikeGateEvidence,
} from "./index.js";

describe("IWSDK spike plan", () => {
  it("requires every IWSDK contract source ID to resolve to a committed source record", () => {
    const contract = buildIwsdkSourceRecordIdContract();
    const sourceRecords = readSourceRecords();

    expect(contract.sourceRecordIds).toEqual([
      "src-iwsdk-ai-docs-2026",
      "src-iwsdk-local-spike-2026-05-04",
      "src-iwsdk-npm-metadata-2026-05-04",
      "src-meta-iwsdk-github-2026",
      "src-openclinxr-iwsdk-spike-plan-2026-05-04",
    ]);
    expect(contract.sourceRecordIds.filter((sourceId) => !sourceRecords.has(sourceId))).toEqual([]);
  });

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
        name: "@iwsdk/glxf",
        posture: "review_required",
        gates: expect.arrayContaining(["scene_format_review", "asset_pipeline_smoke"]),
      }),
      expect.objectContaining({
        name: "@iwsdk/vite-plugin-dev",
        posture: "spike_candidate",
        gates: expect.arrayContaining(["vite_8_peer_compatibility", "agent_mcp_runtime_smoke"]),
      }),
      expect.objectContaining({
        name: "@iwsdk/vite-plugin-uikitml",
        posture: "review_required",
        gates: expect.arrayContaining(["headset_text_readability", "accessibility_review"]),
      }),
      expect.objectContaining({
        name: "@iwsdk/vite-plugin-metaspatial",
        posture: "review_required",
        gates: expect.arrayContaining(["asset_authoring_workflow_review", "license_review"]),
      }),
      expect.objectContaining({
        name: "@iwsdk/create",
        posture: "blocked_unattended",
        gates: expect.arrayContaining(["operator_approves_scaffold_generation"]),
      }),
      expect.objectContaining({
        name: "@iwsdk/starter-assets",
        posture: "blocked_unattended",
        gates: expect.arrayContaining(["asset_license_and_cache_review"]),
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
        category: "transforms",
        representativeTools: ["xr_set_transform", "xr_look_at"],
        evidenceUse: "Repeatable headset/controller positioning for station framing checks.",
      },
      {
        category: "input_mode",
        representativeTools: ["xr_set_input_mode", "xr_set_connected"],
        evidenceUse: "Controller/hand tracking mode and device connectivity checks for repeatable station setup.",
      },
      {
        category: "select_trigger",
        representativeTools: ["xr_select", "xr_set_select_value"],
        evidenceUse: "Controller-triggered learner trace actions and grab/release interaction checks.",
      },
      {
        category: "gamepad",
        representativeTools: ["xr_get_gamepad_state", "xr_set_gamepad_state"],
        evidenceUse: "Thumbstick/button regression evidence for high-pressure station controls.",
      },
      {
        category: "device_state",
        representativeTools: ["xr_get_device_state", "xr_set_device_state"],
        evidenceUse: "Whole-device reset and headset/controller state snapshots for deterministic smoke setup.",
      },
      {
        category: "ecs",
        representativeTools: ["ecs_pause", "ecs_step", "ecs_query_entity"],
        evidenceUse: "Deterministic inspection of runtime entity state during scenario transitions.",
      },
    ]);
  });

  it("records the exact IWSDK MCP tool inventory by category", () => {
    const inventory = buildIwsdkMcpToolInventory();

    expect(inventory.sourceRecordIds).toEqual(["src-iwsdk-ai-docs-2026"]);
    expect(inventory.categories).toEqual([
      {
        category: "session",
        tools: ["xr_get_session_status", "xr_accept_session", "xr_end_session"],
      },
      {
        category: "transforms",
        tools: ["xr_get_transform", "xr_set_transform", "xr_look_at", "xr_animate_to"],
      },
      {
        category: "input_mode",
        tools: ["xr_set_input_mode", "xr_set_connected"],
      },
      {
        category: "select_trigger",
        tools: ["xr_get_select_value", "xr_set_select_value", "xr_select"],
      },
      {
        category: "gamepad",
        tools: ["xr_get_gamepad_state", "xr_set_gamepad_state"],
      },
      {
        category: "device_state",
        tools: ["xr_get_device_state", "xr_set_device_state"],
      },
      {
        category: "browser",
        tools: ["browser_screenshot", "browser_get_console_logs", "browser_reload_page"],
      },
      {
        category: "scene",
        tools: ["scene_get_hierarchy", "scene_get_object_transform"],
      },
      {
        category: "ecs",
        tools: [
          "ecs_pause",
          "ecs_resume",
          "ecs_step",
          "ecs_query_entity",
          "ecs_find_entities",
          "ecs_list_systems",
          "ecs_list_components",
          "ecs_toggle_system",
          "ecs_set_component",
          "ecs_snapshot",
          "ecs_diff",
        ],
      },
    ]);
    expect(inventory.allToolNames).toHaveLength(32);
    expect(new Set(inventory.allToolNames).size).toBe(32);
  });

  it("requires the IWSDK 32-tool MCP inventory before agent tooling readiness is claimed", () => {
    expect(buildIwsdkMcpToolInventoryRequirement()).toEqual({
      expectedToolCount: 32,
      sourceRecordIds: ["src-iwsdk-ai-docs-2026"],
      expectedToolNames: buildIwsdkMcpToolInventory().allToolNames,
      requiredCategories: [
        "session",
        "transforms",
        "input_mode",
        "select_trigger",
        "gamepad",
        "device_state",
        "browser",
        "scene",
        "ecs",
      ],
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
        "mcp_tool_names_not_recorded",
        "mcp_expected_tool_missing",
        "mcp_unknown_tool_present",
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

  it("blocks aggregate IWSDK agent-tooling readiness until adapter, tool inventory, smoke tools, and browser evidence pass", () => {
    expect(evaluateIwsdkAgentToolingEvidence({
      adapterSyncRecorded: false,
      toolCount: 31,
      coveredCategories: [
        "session",
        "transforms",
        "input_mode",
        "select_trigger",
        "gamepad",
        "device_state",
        "browser",
        "scene",
      ],
      validatedSmokeTools: [
        "xr_get_session_status",
        "xr_accept_session",
        "browser_screenshot",
        "scene_get_hierarchy",
        "xr_select",
      ],
      managedBrowserEvidence: {
        mode: "agent",
        runtimeUrl: "http://127.0.0.1:5181",
        managedBrowserReady: true,
        managedSessionId: "managed-session",
        normalBrowserOpened: true,
        normalSessionId: "normal-session",
        managedDevUiVisible: false,
        normalDevUiVisible: true,
      },
      optionalServerActions: [],
    })).toEqual({
      readyForAgentTooling: false,
      blockers: [
        "adapter_sync_not_recorded",
        "ecs_runtime_not_queryable",
        "managed_browser:missing_agent_fixed_screenshot_size",
        "mcp_required_category_missing_ecs",
        "mcp_runtime_not_registered",
        "mcp_smoke_tool_not_validated_browser_get_console_logs",
        "mcp_tool_inventory_count_not_32",
        "mcp_tool_names_not_recorded",
        "scene_hierarchy_required_objects_not_confirmed",
      ],
    });
  });

  it("keeps optional reference and hzdb server actions as blockers inside aggregate agent-tooling evidence", () => {
    expect(evaluateIwsdkAgentToolingEvidence({
      adapterSyncRecorded: true,
      toolCount: 32,
      coveredCategories: [
        "session",
        "transforms",
        "input_mode",
        "select_trigger",
        "gamepad",
        "device_state",
        "browser",
        "scene",
        "ecs",
      ],
      validatedSmokeTools: [
        "xr_get_session_status",
        "xr_accept_session",
        "browser_screenshot",
        "scene_get_hierarchy",
        "xr_select",
        "browser_get_console_logs",
      ],
      observedToolNames: buildIwsdkMcpToolInventory().allToolNames,
      managedBrowserEvidence: {
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
      },
      mcpRuntimeRegistered: true,
      sceneHierarchyContainsRequiredObjects: true,
      ecsRuntimeQueryable: true,
      optionalServerActions: ["npx iwsdk reference warmup", "install @meta-quest/hzdb"],
    })).toEqual({
      readyForAgentTooling: false,
      blockers: [
        "optional_mcp_server_action_blocked:install @meta-quest/hzdb",
        "optional_mcp_server_action_blocked:npx iwsdk reference warmup",
      ],
    });
  });

  it("requires captured IWSDK MCP tool names instead of trusting only the 32-tool count", () => {
    const observedToolNames = buildIwsdkMcpToolInventory().allToolNames.filter((tool) => tool !== "ecs_diff");

    expect(evaluateIwsdkAgentToolingEvidence({
      adapterSyncRecorded: true,
      toolCount: 32,
      coveredCategories: [
        "session",
        "transforms",
        "input_mode",
        "select_trigger",
        "gamepad",
        "device_state",
        "browser",
        "scene",
        "ecs",
      ],
      validatedSmokeTools: [
        "xr_get_session_status",
        "xr_accept_session",
        "browser_screenshot",
        "scene_get_hierarchy",
        "xr_select",
        "browser_get_console_logs",
      ],
      observedToolNames: [...observedToolNames, "xr_unexpected_future_tool"],
      managedBrowserEvidence: {
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
      },
      mcpRuntimeRegistered: true,
      sceneHierarchyContainsRequiredObjects: true,
      ecsRuntimeQueryable: true,
      optionalServerActions: [],
    })).toEqual({
      readyForAgentTooling: false,
      blockers: [
        "mcp_tool_missing_ecs_diff",
        "mcp_tool_unknown_xr_unexpected_future_tool",
      ],
    });
  });

  it("marks aggregate IWSDK agent-tooling evidence ready only when all contract slices pass", () => {
    expect(evaluateIwsdkAgentToolingEvidence({
      adapterSyncRecorded: true,
      toolCount: 32,
      coveredCategories: [
        "session",
        "transforms",
        "input_mode",
        "select_trigger",
        "gamepad",
        "device_state",
        "browser",
        "scene",
        "ecs",
      ],
      validatedSmokeTools: [
        "xr_get_session_status",
        "xr_accept_session",
        "browser_screenshot",
        "scene_get_hierarchy",
        "xr_select",
        "browser_get_console_logs",
      ],
      observedToolNames: buildIwsdkMcpToolInventory().allToolNames,
      managedBrowserEvidence: {
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
      },
      mcpRuntimeRegistered: true,
      sceneHierarchyContainsRequiredObjects: true,
      ecsRuntimeQueryable: true,
      optionalServerActions: [],
    })).toEqual({
      readyForAgentTooling: true,
      blockers: [],
    });
  });

  it("requires MCPRuntime, scene, and ECS hooks before treating tool inventory as meaningful", () => {
    expect(evaluateIwsdkAgentToolingEvidence({
      adapterSyncRecorded: true,
      toolCount: 32,
      coveredCategories: [
        "session",
        "transforms",
        "input_mode",
        "select_trigger",
        "gamepad",
        "device_state",
        "browser",
        "scene",
        "ecs",
      ],
      validatedSmokeTools: [
        "xr_get_session_status",
        "xr_accept_session",
        "browser_screenshot",
        "scene_get_hierarchy",
        "xr_select",
        "browser_get_console_logs",
      ],
      observedToolNames: buildIwsdkMcpToolInventory().allToolNames,
      managedBrowserEvidence: {
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
      },
      optionalServerActions: [],
    })).toEqual({
      readyForAgentTooling: false,
      blockers: [
        "ecs_runtime_not_queryable",
        "mcp_runtime_not_registered",
        "scene_hierarchy_required_objects_not_confirmed",
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

  it("records the @iwsdk/reference docs-vs-npm metadata drift before any reference warmup", () => {
    const policies = buildIwsdkPackageMetadataDriftPolicies();

    expect(policies).toEqual([
      {
        packageName: "@iwsdk/reference",
        docsVersion: "0.3.1",
        npmLatestVersion: "0.3.2",
        sourceRecordIds: ["src-iwsdk-ai-docs-2026", "src-iwsdk-npm-metadata-2026-05-04"],
        impact: "Do not run reference warmup until the exact package version, docs version, model/corpus payload, and cache path are revalidated together.",
        blockedActions: ["npx iwsdk reference warmup"],
        requiredResolutionEvidence: [
          "docs_and_npm_versions_match_or_exact_pin_is_approved",
          "model_and_corpus_download_size_recorded",
          "cache_location_recorded",
          "operator_approval_for_model_and_corpus_downloads",
        ],
      },
    ]);
  });

  it("blocks unattended reference warmup when package metadata versions drift", () => {
    expect(evaluateIwsdkPackageMetadataDriftEvidence({
      packageName: "@iwsdk/reference",
      docsVersion: "0.3.1",
      npmLatestVersion: "0.3.2",
    })).toEqual({
      readyForUnattendedUse: false,
      blockers: ["package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2"],
    });
  });

  it("accepts package metadata only when docs and npm versions align", () => {
    expect(evaluateIwsdkPackageMetadataDriftEvidence({
      packageName: "@iwsdk/reference",
      docsVersion: "0.3.2",
      npmLatestVersion: "0.3.2",
    })).toEqual({
      readyForUnattendedUse: true,
      blockers: [],
    });
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

  it("defines the future IWSDK Vite AI config contract for Codex and Quest 3 emulation", () => {
    const contract = buildIwsdkViteAiDevConfigContract();

    expect(contract.status).toBe("phase_2_after_sidecar_shell");
    expect(contract.sourceRecordIds).toEqual(["src-iwsdk-ai-docs-2026"]);
    expect(contract.packageName).toBe("@iwsdk/vite-plugin-dev");
    expect(contract.requiredOptions).toEqual({
      emulatorDevice: "metaQuest3",
      aiMode: "agent",
      aiTools: ["codex"],
      screenshotSize: { width: 500, height: 500 },
      verbose: true,
    });
    expect(contract.viteConfigSnippet).toContain("iwsdkDev({");
    expect(contract.viteConfigSnippet).toContain("emulator: { device: 'metaQuest3' }");
    expect(contract.viteConfigSnippet).toContain("ai: { mode: 'agent', tools: ['codex'], screenshotSize: { width: 500, height: 500 } }");
    expect(contract.requiredEvidence).toEqual([
      "vite_config_uses_iwsdk_dev_plugin",
      "ai_tools_includes_codex",
      "agent_mode_selected_for_unattended_runs",
      "quest3_emulator_selected",
      "screenshot_size_bounded",
      "adapter_sync_generates_codex_config",
      "runtime_status_records_browser_command_ready",
    ]);
    expect(contract.blockedUntil).toEqual([
      "apps/ui-xr-iwsdk-spike_exists_with_exact_iwsdk_versions",
      "phase_1_runtime_shell_metrics_pass",
      "operator_accepts_iwsdk_install_scope",
      "license_review_accepts_transitive_dependency_posture",
    ]);
    expect(contract.doNotRunUnattended).toEqual([
      "npx iwsdk reference warmup",
      "install @meta-quest/hzdb",
    ]);
  });

  it("defines an executable IWSDK Vite/Node/Rolldown compatibility contract", () => {
    const contract = buildIwsdkCompatibilityContract();

    expect(contract).toEqual({
      sourceRecordIds: ["src-iwsdk-npm-metadata-2026-05-04", "src-iwsdk-local-spike-2026-05-04"],
      packageName: "@iwsdk/vite-plugin-dev",
      packageVersion: "0.3.1",
      requiredNodeMajor: 22,
      openclinxrViteMajor: 8,
      iwsdkVitePluginPeerRange: "^7.0.0",
      requiredEvidence: [
        "vite_plugin_peer_range_accepts_openclinxr_vite_major",
        "node_runtime_major_22",
        "node_runtime_path_recorded",
        "rolldown_native_binding_load_recorded",
      ],
    });
  });

  it("blocks IWSDK phase 2 agent tooling when the Vite peer range does not cover OpenClinXR's Vite major", () => {
    expect(evaluateIwsdkCompatibilityEvidence({
      openclinxrViteMajor: 8,
      iwsdkVitePluginPeerRange: "^7.0.0",
      nodeMajor: 22,
      nodeRuntimePath: "/Users/patrick/.nvm/versions/node/v22.19.0/bin/node",
      rolldownNativeBindingLoaded: true,
    })).toEqual({
      readyForPhase2AgentDevtools: false,
      blockers: ["vite_plugin_peer_range_does_not_accept_openclinxr_vite_major"],
    });
  });

  it("accepts IWSDK phase 2 compatibility evidence only when all runtime gates are proven", () => {
    expect(evaluateIwsdkCompatibilityEvidence({
      openclinxrViteMajor: 8,
      iwsdkVitePluginPeerRange: "^7.0.0 || ^8.0.0",
      nodeMajor: 22,
      nodeRuntimePath: "/Users/patrick/.nvm/versions/node/v22.19.0/bin/node",
      rolldownNativeBindingLoaded: true,
    })).toEqual({
      readyForPhase2AgentDevtools: true,
      blockers: [],
    });
  });

  it("reports missing compatibility evidence as separate remediation blockers", () => {
    expect(evaluateIwsdkCompatibilityEvidence({})).toEqual({
      readyForPhase2AgentDevtools: false,
      blockers: [
        "missing_openclinxr_vite_major",
        "missing_iwsdk_vite_plugin_peer_range",
        "missing_node_major",
        "missing_node_runtime_path",
        "rolldown_native_binding_not_loaded",
      ],
    });
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
    expect(agentDevtoolsPhase?.requiredMetrics).toEqual([
      "vite_8_peer_compatibility",
      "node_22_runtime_path",
      "scene_get_hierarchy",
      "xr_select",
      "browser_get_console_logs",
    ]);
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
      reviewRequiredPackages: [
        "@iwsdk/glxf",
        "@iwsdk/locomotor",
        "@iwsdk/vite-plugin-dev",
        "@iwsdk/vite-plugin-gltf-optimizer",
        "@iwsdk/vite-plugin-uikitml",
        "@iwsdk/vite-plugin-metaspatial",
      ],
      blockedPackages: ["@iwsdk/create", "@iwsdk/reference", "@iwsdk/starter-assets", "@meta-quest/hzdb"],
      blockedTransitivePackages: ["@img/sharp-libvips-darwin-arm64"],
      blockedLicenseExpressions: ["AGPL", "GPL", "LGPL", "UNLICENSED", "Unknown"],
      requiredPackageManagerControls: ["pin_exact_versions", "pin_three_override", "record_pnpm_audit", "record_license_policy_report"],
      requiredTransitivePackagesByPackageName: {
        "@iwsdk/core": [
          "@babylonjs/havok",
          "@iwsdk/glxf",
          "@iwsdk/locomotor",
          "@iwsdk/xr-input",
          "@pmndrs/handle",
          "@pmndrs/pointer-events",
          "@pmndrs/uikit",
          "@pmndrs/uikitml",
          "@preact/signals-core",
          "elics",
          "three",
          "three-mesh-bvh",
        ],
      },
    });
  });

  it("accepts a pinned first-slice IWSDK package selection before installation", () => {
    expect(evaluateIwsdkPreInstallPackageSelection([
      {
        name: "@iwsdk/core",
        version: "0.3.1",
        license: "MIT",
        transitivePackages: [
          "@babylonjs/havok",
          "@iwsdk/glxf",
          "@iwsdk/locomotor",
          "@iwsdk/xr-input",
          "@pmndrs/handle",
          "@pmndrs/pointer-events",
          "@pmndrs/uikit",
          "@pmndrs/uikitml",
          "@preact/signals-core",
          "elics",
          "three",
          "three-mesh-bvh",
        ],
        transitivePackageLicenses: {
          "@babylonjs/havok": "Apache-2.0",
          "@iwsdk/glxf": "MIT",
          "@iwsdk/locomotor": "MIT",
          "@iwsdk/xr-input": "MIT",
          "@pmndrs/handle": "MIT",
          "@pmndrs/pointer-events": "MIT",
          "@pmndrs/uikit": "MIT",
          "@pmndrs/uikitml": "MIT",
          "@preact/signals-core": "MIT",
          elics: "MIT",
          three: "MIT",
          "three-mesh-bvh": "MIT",
        },
      },
      { name: "@iwsdk/xr-input", version: "0.3.1", license: "MIT", transitivePackages: [] },
    ])).toEqual({
      readyToInstallInSidecar: true,
      blockers: [],
      reviewWarnings: [],
    });
  });

  it("blocks a first-slice IWSDK package selection when core transitive package evidence is incomplete", () => {
    expect(evaluateIwsdkPreInstallPackageSelection([
      { name: "@iwsdk/core", version: "0.3.1", license: "MIT", transitivePackages: ["three"] },
      { name: "@iwsdk/xr-input", version: "0.3.1", license: "MIT", transitivePackages: [] },
    ])).toEqual({
      readyToInstallInSidecar: false,
      blockers: [
        "@iwsdk/core:missing_required_transitive_@babylonjs/havok",
        "@iwsdk/core:missing_required_transitive_@iwsdk/glxf",
        "@iwsdk/core:missing_required_transitive_@iwsdk/locomotor",
        "@iwsdk/core:missing_required_transitive_@iwsdk/xr-input",
        "@iwsdk/core:missing_required_transitive_@pmndrs/handle",
        "@iwsdk/core:missing_required_transitive_@pmndrs/pointer-events",
        "@iwsdk/core:missing_required_transitive_@pmndrs/uikit",
        "@iwsdk/core:missing_required_transitive_@pmndrs/uikitml",
        "@iwsdk/core:missing_required_transitive_@preact/signals-core",
        "@iwsdk/core:missing_required_transitive_elics",
        "@iwsdk/core:missing_required_transitive_three-mesh-bvh",
        "@iwsdk/core:missing_transitive_license_three",
      ],
      reviewWarnings: [],
    });
  });

  it("blocks IWSDK package selections outside the allowed unattended first slice", () => {
    expect(evaluateIwsdkPreInstallPackageSelection([
      { name: "@iwsdk/spatial-ui", version: "0.3.1", license: "MIT", transitivePackages: [] },
      { name: "@iwsdk/locomotor", version: "0.3.1", license: "MIT", transitivePackages: [] },
      { name: "@iwsdk/vite-plugin-uikitml", version: "0.3.1", license: "MIT", transitivePackages: [] },
    ])).toEqual({
      readyToInstallInSidecar: false,
      blockers: [
        "@iwsdk/spatial-ui:not_allowed_in_first_slice",
        "@iwsdk/locomotor:not_allowed_in_first_slice",
        "@iwsdk/vite-plugin-uikitml:not_allowed_in_first_slice",
      ],
      reviewWarnings: [
        "@iwsdk/locomotor:review_required_package",
        "@iwsdk/vite-plugin-uikitml:review_required_package",
      ],
    });
  });

  it("blocks sharp-libvips transitive variants and normalizes copyleft license matching", () => {
    expect(evaluateIwsdkPreInstallPackageSelection([
      {
        name: "@iwsdk/core",
        version: "0.3.1",
        license: "lgpl-3.0-or-later",
        transitivePackages: ["@img/sharp-libvips-linux-x64"],
      },
      {
        name: "@iwsdk/xr-input",
        version: "0.3.1",
        license: "Apache-2.0 OR gpl-3.0-only",
        transitivePackages: [],
      },
    ])).toEqual({
      readyToInstallInSidecar: false,
      blockers: [
        "@iwsdk/core:blocked_license_LGPL",
        "@iwsdk/core:blocked_transitive_@img/sharp-libvips-linux-x64",
        "@iwsdk/xr-input:blocked_license_GPL",
      ],
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
        "@iwsdk/vite-plugin-gltf-optimizer:not_allowed_in_first_slice",
        "@iwsdk/vite-plugin-gltf-optimizer:blocked_transitive_@img/sharp-libvips-darwin-arm64",
      ],
      reviewWarnings: [
        "@iwsdk/vite-plugin-gltf-optimizer:review_required_package",
      ],
    });
  });

  it("treats the current no-sidecar workspace as contract-only and posture-ready", () => {
    expect(evaluateIwsdkWorkspacePosture({
      sidecarAppExists: false,
      sidecarInstallApproved: false,
      dependencies: [],
      sourceReferences: [],
      scriptReferences: [],
      lockfilePackageNames: [],
      packageManagerControls: {
        workspacePostureInVerify: true,
        auditScriptPresent: true,
        licenseScriptPresent: true,
      },
    })).toEqual({
      ready: true,
      sidecarStatus: "absent_contract_only",
      blockers: [],
      reviewWarnings: [],
    });
  });

  it("blocks IWSDK dependencies or imports outside the sidecar roots", () => {
    expect(evaluateIwsdkWorkspacePosture({
      sidecarAppExists: false,
      sidecarInstallApproved: false,
      dependencies: [
        {
          manifestPath: "apps/ui-xr/package.json",
          field: "dependencies",
          name: "@iwsdk/core",
          version: "0.3.1",
        },
      ],
      sourceReferences: [
        {
          filePath: "apps/ui-xr/src/runtime.tsx",
          packageName: "@iwsdk/xr-input",
        },
      ],
      scriptReferences: [],
      lockfilePackageNames: [],
      packageManagerControls: {
        workspacePostureInVerify: true,
        auditScriptPresent: true,
        licenseScriptPresent: true,
      },
    })).toEqual({
      ready: false,
      sidecarStatus: "absent_contract_only",
      blockers: [
        "dependency_outside_iwsdk_sidecar:apps/ui-xr/package.json:dependencies.@iwsdk/core",
        "source_import_outside_iwsdk_sidecar:apps/ui-xr/src/runtime.tsx:@iwsdk/xr-input",
      ],
      reviewWarnings: [],
    });
  });

  it("blocks IWSDK installs and imports in the advisory policy package", () => {
    expect(evaluateIwsdkWorkspacePosture({
      sidecarAppExists: false,
      sidecarInstallApproved: false,
      dependencies: [
        {
          manifestPath: "packages/openclinxr/iwsdk-spike/package.json",
          field: "devDependencies",
          name: "@iwsdk/core",
          version: "0.3.1",
        },
      ],
      sourceReferences: [
        {
          filePath: "packages/openclinxr/iwsdk-spike/src/accidental.ts",
          packageName: "@iwsdk/xr-input",
        },
      ],
      scriptReferences: [
        {
          manifestPath: "package.json",
          scriptName: "iwsdk:create",
          command: "pnpm create @iwsdk@0.3.1",
        },
      ],
      lockfilePackageNames: [],
      packageManagerControls: {
        workspacePostureInVerify: true,
        auditScriptPresent: true,
        licenseScriptPresent: true,
      },
    })).toEqual({
      ready: false,
      sidecarStatus: "absent_contract_only",
      blockers: [
        "dependency_outside_iwsdk_sidecar:packages/openclinxr/iwsdk-spike/package.json:devDependencies.@iwsdk/core",
        "source_import_outside_iwsdk_sidecar:packages/openclinxr/iwsdk-spike/src/accidental.ts:@iwsdk/xr-input",
        "blocked_script_action:package.json:scripts.iwsdk:create:iwsdk_create",
      ],
      reviewWarnings: [],
    });
  });

  it("requires operator approval and root package-manager controls when the sidecar exists", () => {
    expect(evaluateIwsdkWorkspacePosture({
      sidecarAppExists: true,
      sidecarInstallApproved: false,
      dependencies: [
        {
          manifestPath: "apps/ui-xr-iwsdk-spike/package.json",
          field: "dependencies",
          name: "@iwsdk/core",
          version: "0.3.1",
        },
      ],
      sourceReferences: [],
      scriptReferences: [],
      lockfilePackageNames: [],
      packageManagerControls: {
        workspacePostureInVerify: true,
        auditScriptPresent: true,
        licenseScriptPresent: true,
      },
    })).toEqual({
      ready: false,
      sidecarStatus: "present_unapproved",
      blockers: ["sidecar_app_present_without_operator_approval"],
      reviewWarnings: [],
    });

    expect(evaluateIwsdkWorkspacePosture({
      sidecarAppExists: true,
      sidecarInstallApproved: true,
      sidecarLockfileImporterPresent: true,
      sidecarLockfilePackageNames: ["@iwsdk/core", "@iwsdk/xr-input"],
      dependencies: [
        {
          manifestPath: "apps/ui-xr-iwsdk-spike/package.json",
          field: "dependencies",
          name: "@iwsdk/core",
          version: "0.3.1",
        },
        {
          manifestPath: "apps/ui-xr-iwsdk-spike/package.json",
          field: "dependencies",
          name: "@iwsdk/xr-input",
          version: "0.3.1",
        },
      ],
      sourceReferences: [],
      scriptReferences: [],
      lockfilePackageNames: [],
      packageManagerControls: {
        workspacePostureInVerify: true,
        threeOverrideExact: true,
        auditScriptPresent: true,
        licenseScriptPresent: true,
      },
    })).toEqual({
      ready: true,
      sidecarStatus: "present_approved",
      blockers: [],
      reviewWarnings: [],
    });
  });

  it("blocks unpinned, review-only, and blocked IWSDK workspace package posture", () => {
    expect(evaluateIwsdkWorkspacePosture({
      sidecarAppExists: true,
      sidecarInstallApproved: true,
      sidecarLockfileImporterPresent: true,
      dependencies: [
        {
          manifestPath: "apps/ui-xr-iwsdk-spike/package.json",
          field: "dependencies",
          name: "@iwsdk/core",
          version: "^0.3.1",
        },
        {
          manifestPath: "apps/ui-xr-iwsdk-spike/package.json",
          field: "devDependencies",
          name: "@iwsdk/vite-plugin-uikitml",
          version: "0.3.1",
        },
        {
          manifestPath: "apps/ui-xr-iwsdk-spike/package.json",
          field: "devDependencies",
          name: "@iwsdk/reference",
          version: "0.3.1",
        },
      ],
      sourceReferences: [],
      scriptReferences: [
        {
          manifestPath: "package.json",
          scriptName: "iwsdk:reference:warmup",
          command: "npx iwsdk reference warmup",
        },
        {
          manifestPath: "apps/ui-xr/package.json",
          scriptName: "iwsdk:create",
          command: "pnpm dlx @iwsdk/create@0.3.1",
        },
      ],
      lockfilePackageNames: ["@meta-quest/hzdb", "@img/sharp-libvips-linux-x64"],
      packageManagerControls: {
        workspacePostureInVerify: false,
        auditScriptPresent: false,
        licenseScriptPresent: false,
      },
    })).toEqual({
      ready: false,
      sidecarStatus: "present_approved",
      blockers: [
        "blocked_script_action:package.json:scripts.iwsdk:reference:warmup:iwsdk_reference_warmup",
        "blocked_script_action:apps/ui-xr/package.json:scripts.iwsdk:create:iwsdk_create",
        "@iwsdk/core:version_not_exact",
        "@iwsdk/vite-plugin-uikitml:not_allowed_in_first_slice",
        "@iwsdk/reference:blocked_package",
        "blocked_package_in_lockfile:@meta-quest/hzdb",
        "blocked_transitive_package_in_lockfile:@img/sharp-libvips-linux-x64",
        "missing_package_manager_control_pin_three_override",
        "missing_package_manager_control_record_pnpm_audit",
        "missing_package_manager_control_record_license_policy_report",
        "iwsdk_workspace_posture_not_in_verify",
      ],
      reviewWarnings: [
        "@iwsdk/vite-plugin-uikitml:review_required_package",
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

  it("keeps sidecar spike readiness blocked when semantic parity evidence is missing", () => {
    expect(evaluateIwsdkSpikeMetrics({
      installedNodeModulesMb: 287,
      injectedDevRuntimeKb: 1116.3,
      appJsBundleKb: 504.47,
      bundleDeltaVsUiXrKb: 24,
      consoleErrorCount: 0,
    })).toEqual({
      readyForCommittedSpike: false,
      readyForProductionRuntime: false,
      blockers: [
        "missing_baseline_app_bundle_source",
        "missing_smoke_plan_hash",
        "canvas_nonblank_not_confirmed",
        "missing_required_scene_object_names",
        "missing_observed_scene_object_names",
        "missing_controller_select_trace_tag",
        "missing_foreground_quest_preflight_ready",
        "missing_avg_fps",
        "missing_p95_frame_ms",
        "missing_controller_select_latency_ms",
      ],
    });
  });

  it("separates sidecar spike readiness from production readiness when Quest evidence is missing", () => {
    expect(evaluateIwsdkSpikeMetrics({
      installedNodeModulesMb: 287,
      injectedDevRuntimeKb: 1116.3,
      appJsBundleKb: 504.47,
      bundleDeltaVsUiXrKb: 24,
      baselineAppBundleSource: "apps/ui-xr/dist/assets/index-BIObl4Qc.js",
      smokePlanHash: "runtime-state:iwsdk-station-mcp-smoke-plan:v1",
      canvasNonblank: true,
      requiredSceneObjectNames: ["openclinxr.ed-chest-pain.bed", "openclinxr.ed-chest-pain.monitor"],
      observedSceneObjectNames: ["openclinxr.ed-chest-pain.bed", "openclinxr.ed-chest-pain.monitor"],
      controllerSelectTraceTag: "ecg_request",
      observedTraceActionTags: ["ecg_request"],
      consoleErrorCount: 0,
    })).toEqual({
      readyForCommittedSpike: true,
      readyForProductionRuntime: false,
      blockers: [
        "missing_foreground_quest_preflight_ready",
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
      foregroundQuestPreflightReady: false,
      baselineAppBundleSource: "apps/ui-xr/dist/assets/index-BIObl4Qc.js",
      smokePlanHash: "runtime-state:iwsdk-station-mcp-smoke-plan:v1",
      canvasNonblank: true,
      requiredSceneObjectNames: ["bed", "monitor"],
      observedSceneObjectNames: ["bed"],
      controllerSelectTraceTag: "ecg_request",
      observedTraceActionTags: ["urgent_escalation"],
    })).toEqual({
      readyForCommittedSpike: false,
      readyForProductionRuntime: false,
      blockers: [
        "installed_node_modules_mb_over_budget",
        "injected_dev_runtime_kb_over_budget",
        "app_js_bundle_kb_over_budget",
        "bundle_delta_vs_ui_xr_kb_over_budget",
        "console_errors_present",
        "missing_scene_object:monitor",
        "controller_select_trace_tag_not_observed:ecg_request",
        "foreground_quest_preflight_not_ready",
        "avg_fps_below_floor",
        "p95_frame_ms_over_budget",
        "controller_select_latency_ms_over_budget",
      ],
    });
  });
});

function readSourceRecords(): Set<string> {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const sourcesDir = path.resolve(testDir, "../../../../sources");

  return new Set(
    readdirSync(sourcesDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => {
        const sourceRecord = JSON.parse(readFileSync(path.join(sourcesDir, fileName), "utf8")) as {
          source_id?: string;
        };
        return sourceRecord.source_id ?? "";
      })
      .filter(Boolean),
  );
}
