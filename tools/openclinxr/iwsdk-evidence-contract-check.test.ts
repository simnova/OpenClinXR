import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkEvidenceContractReport,
  mapIwerSidecarEvidenceToIwsdkAgentToolingEvidence,
  validateIwsdkEvidenceContractReport,
  type IwsdkEvidenceContractReport,
} from "./iwsdk-evidence-contract-check.js";
import type { IwerSidecarEmulationEvidence } from "./iwer-sidecar-emulation-evidence-check.js";
import { buildIwsdkMcpInventoryEvidenceReport } from "./iwsdk-mcp-inventory-evidence.js";
import { buildIwsdkMcpToolInventory, type IwsdkAgentToolingEvidence } from "../../packages/openclinxr/iwsdk-spike/src/index.js";

const execFileAsync = promisify(execFile);

describe("IWSDK evidence contract checker", () => {
  it("builds a blocked evidence report for the approved Phase 1 sidecar state", () => {
    const report = buildIwsdkEvidenceContractReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
    });

    expect(report.status).toBe("phase_1_install_backed_sidecar");
    expect(report.sidecar.currentState).toBe("phase_1_approved_install_backed");
    expect(report.sidecar.runnable).toBe(true);
    expect(report.preinstall.policy.reviewRequiredPackages).toEqual(expect.arrayContaining([
      "@iwsdk/vite-plugin-uikitml",
      "@iwsdk/vite-plugin-metaspatial",
    ]));
    expect(report.preinstall.policy.blockedPackages).toEqual(expect.arrayContaining([
      "@iwsdk/create",
      "@iwsdk/starter-assets",
      "@meta-quest/hzdb",
    ]));
    expect(report.viteAiDevConfig).toEqual(expect.objectContaining({
      packageName: "@iwsdk/vite-plugin-dev",
      requiredOptions: {
        emulatorDevice: "metaQuest3",
        aiMode: "agent",
        aiTools: ["codex"],
        screenshotSize: { width: 500, height: 500 },
        verbose: true,
      },
      blockedUntil: expect.arrayContaining([
        "phase_1_runtime_shell_metrics_pass",
      ]),
    }));
    expect(report.compatibility).toEqual({
      contract: expect.objectContaining({
        packageName: "@iwsdk/vite-plugin-dev",
        packageVersion: "0.3.1",
        openclinxrViteMajor: 8,
        iwsdkVitePluginPeerRange: "^7.0.0",
      }),
      currentKnownEvidence: {
        openclinxrViteMajor: 8,
        iwsdkVitePluginPeerRange: "^7.0.0",
        nodeMajor: 22,
        nodeRuntimePath: "/Users/patrick/.nvm/versions/node/v22.19.0/bin/node",
        rolldownNativeBindingLoaded: true,
      },
      result: {
        readyForPhase2AgentDevtools: false,
        blockers: ["vite_plugin_peer_range_does_not_accept_openclinxr_vite_major"],
      },
    });
    expect(report.metadataDrift).toEqual({
      policies: [
        expect.objectContaining({
          packageName: "@iwsdk/reference",
          docsVersion: "0.3.1",
          npmLatestVersion: "0.3.2",
          blockedActions: ["npx iwsdk reference warmup"],
        }),
      ],
      result: {
        readyForUnattendedUse: false,
        blockers: ["package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2"],
      },
    });
    expect(report.uiXrParity).toEqual(expect.objectContaining({
      source: "apps/ui-xr/src/runtime-state.ts",
      smokePlanHash: "runtime-state:iwsdk-station-mcp-smoke-plan:v1",
      controllerSelectTraceTag: "ecg_request",
    }));
    expect(report.toolSelection).toEqual(expect.objectContaining({
      status: "contract_only",
      blockers: [
        "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
        "tool_selection:manual_quest_foreground_required_for_production_readiness",
      ],
      toolContracts: expect.arrayContaining([
        expect.objectContaining({
          toolId: "browser_use_playwright",
          cannotSupportClaims: expect.arrayContaining(["foreground_quest_frame_pacing"]),
        }),
        expect.objectContaining({
          toolId: "quest_cdp",
          canSupportClaims: expect.arrayContaining(["quest_browser_shell_loaded"]),
        }),
        expect.objectContaining({
          toolId: "iwsdk_mcp_future",
          blockedUntil: expect.arrayContaining(["iwsdk_adapter_sync_recorded"]),
        }),
        expect.objectContaining({
          toolId: "manual_quest_foreground",
          canSupportClaims: expect.arrayContaining(["foreground_quest_frame_pacing"]),
        }),
      ]),
    }));
    expect(report.operatorApprovals).toEqual(expect.objectContaining({
      status: "operator_approved_with_sidecar_gates",
      approvedAt: "2026-05-04",
      approvals: expect.arrayContaining([
        expect.objectContaining({
          id: "iwsdk-reference-warmup-download-approval",
          pnpmEquivalentCandidate: "pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup",
        }),
        expect.objectContaining({
          id: "iwsdk-hzdb-legal-procurement-approval",
          npmResolution: expect.objectContaining({
            resolvedPackage: "@meta-quest/hzdb",
            resolvedVersion: "1.1.0",
            license: "UNLICENSED",
          }),
        }),
      ]),
    }));
    expect(report.operatorSteeringBlockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "iwsdk-quest-foreground-frame-pacing",
        blockedAction: "foreground Quest frame pacing",
      }),
    ]));
    expect(report.operatorSteeringBlockers.map((blocker) => blocker.id)).not.toContain("iwsdk-install-backed-sidecar-approval");
    expect(report.operatorSteeringBlockers.map((blocker) => blocker.id)).not.toContain("iwsdk-reference-warmup-download-approval");
    expect(report.operatorSteeringBlockers.map((blocker) => blocker.id)).not.toContain("iwsdk-hzdb-legal-procurement-approval");
    expect(report.agentTooling.readyForAgentTooling).toBe(false);
    expect(report.agentTooling.blockers).toEqual(["phase2_devtools_not_installed_in_sidecar"]);
    expect(report.agentToolingLocalPreflight).toEqual({
      readyForLocalAgentToolingPreflight: false,
      blockers: ["phase2_devtools_not_installed_in_sidecar"],
      notEvidenceFor: expect.arrayContaining([
        "adapter_sync_completed",
        "mcp_runtime_registered",
        "managed_browser_ready",
        "mcp_smoke_tools_validated",
        "scene_hierarchy_query_passed",
        "ecs_runtime_query_passed",
      ]),
    });
    expect(report.productionRuntime.readyForProductionRuntime).toBe(false);
    expect(report.verdict).toEqual({
      readyForInstallBackedSidecar: true,
      readyForAgentTooling: false,
      readyForProductionRuntime: false,
      blockers: expect.arrayContaining([
        "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        "agent_tooling:phase2_devtools_not_installed_in_sidecar",
        "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
        "tool_selection:manual_quest_foreground_required_for_production_readiness",
        "production_runtime:avg_fps_below_floor",
        "production_runtime:missing_controller_select_latency_ms",
      ]),
    });
    expect(report.verdict.blockers).not.toEqual(expect.arrayContaining([
      "agent_tooling:adapter_sync_not_recorded",
      "agent_tooling:missing_managed_browser_evidence",
      "agent_tooling:mcp_tool_inventory_count_not_32",
    ]));
  });

  it("can consume captured Phase 2 evidence without carrying stale agent-tooling blockers", () => {
    const report = buildIwsdkEvidenceContractReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      agentToolingEvidence: readyAgentToolingEvidence(),
      compatibilityEvidence: {
        openclinxrViteMajor: 8,
        iwsdkVitePluginPeerRange: "^7.0.0 || ^8.0.0",
        nodeMajor: 22,
        nodeRuntimePath: "/Users/patrick/.nvm/versions/node/v22.19.0/bin/node",
        rolldownNativeBindingLoaded: true,
      },
      metadataDriftEvidence: {
        packageName: "@iwsdk/reference",
        docsVersion: "0.3.2",
        npmLatestVersion: "0.3.2",
      },
    });

    expect(report.agentTooling.readyForAgentTooling).toBe(true);
    expect(report.agentToolingLocalPreflight.readyForLocalAgentToolingPreflight).toBe(true);
    expect(report.compatibility.result.readyForPhase2AgentDevtools).toBe(true);
    expect(report.metadataDrift.result.readyForUnattendedUse).toBe(true);
    expect(report.verdict.readyForAgentTooling).toBe(true);
    expect(report.verdict.readyForProductionRuntime).toBe(false);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "tool_selection:manual_quest_foreground_required_for_production_readiness",
      "production_runtime:avg_fps_below_floor",
      "production_runtime:p95_frame_ms_over_budget",
      "production_runtime:missing_controller_select_latency_ms",
    ]));
    expect(report.verdict.blockers).not.toEqual(expect.arrayContaining([
      "agent_tooling:adapter_sync_not_recorded",
      "agent_tooling:mcp_tool_inventory_count_not_32",
      "agent_tooling:missing_managed_browser_evidence",
      "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
      "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
      "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
    ]));
  });

  it("exposes a CLI that prints the blocked report while Phase 1 sidecar is not production-ready", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:evidence"]).toBe(
      "tsx tools/openclinxr/iwsdk-evidence-contract-check.ts --mcp-inventory-input docs/openclinxr/iwsdk-mcp-inventory-evidence-2026-05-06.json --iwer-sidecar-input docs/openclinxr/iwer-sidecar-emulation-evidence-2026-05-04.json",
    );

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        ["tools/openclinxr/iwsdk-evidence-contract-check.ts"],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK evidence contract checker to report current blockers");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(failedRun.stdout) as IwsdkEvidenceContractReport;

      expect(failedRun.code).toBe(1);
      expect(report.verdict.readyForInstallBackedSidecar).toBe(true);
      expect(report.verdict.readyForProductionRuntime).toBe(false);
      expect(report.agentToolingLocalPreflight.readyForLocalAgentToolingPreflight).toBe(false);
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        "agent_tooling:phase2_devtools_not_installed_in_sidecar",
        "production_runtime:avg_fps_below_floor",
        "production_runtime:missing_controller_select_latency_ms",
      ]));
      expect(report.verdict.blockers).not.toEqual(expect.arrayContaining([
        "agent_tooling:adapter_sync_not_recorded",
        "agent_tooling:missing_managed_browser_evidence",
        "agent_tooling:mcp_tool_inventory_count_not_32",
      ]));
    }
  });

  it("maps committed MCP inventory evidence into partial agent-tooling readiness", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-mcp-contract-"));
    const inventoryInputPath = path.join(tempDir, "iwsdk-mcp-inventory.json");
    const outputPath = path.join(tempDir, "iwsdk-evidence-contract.json");

    await writeFile(inventoryInputPath, `${JSON.stringify(buildIwsdkMcpInventoryEvidenceReport({
      generatedAt: "2026-05-06T02:00:00.000Z",
      packageVersion: "0.3.1",
      server: {
        name: "iwsdk-dev-mcp",
        version: "1.0.0",
        protocolVersion: "2024-11-05",
      },
      observedToolNames: buildIwsdkMcpToolInventory().allToolNames,
    }), null, 2)}\n`, "utf8");

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        [
          "tools/openclinxr/iwsdk-evidence-contract-check.ts",
          "--mcp-inventory-input",
          inventoryInputPath,
          "--",
          "--output",
          outputPath,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK evidence contract checker to preserve remaining blockers");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(await readFile(outputPath, "utf8")) as IwsdkEvidenceContractReport;

      expect(failedRun.code).toBe(1);
      expect(failedRun.stdout).toContain(`Wrote ${outputPath}`);
      expect(report.agentToolingLocalPreflight.readyForLocalAgentToolingPreflight).toBe(true);
      expect(report.agentToolingLocalPreflight.blockers).toEqual([]);
      expect(report.agentTooling.readyForAgentTooling).toBe(false);
      expect(report.agentTooling.blockers).toEqual(expect.arrayContaining([
        "adapter_sync_not_recorded",
        "missing_managed_browser_evidence",
        "mcp_runtime_not_registered",
        "scene_hierarchy_required_objects_not_confirmed",
        "ecs_runtime_not_queryable",
      ]));
      expect(report.agentTooling.blockers).not.toEqual(expect.arrayContaining([
        "phase2_devtools_not_installed_in_sidecar",
        "mcp_tool_inventory_count_not_32",
      ]));
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        "agent_tooling:adapter_sync_not_recorded",
        "agent_tooling:missing_managed_browser_evidence",
        "agent_tooling:mcp_runtime_not_registered",
        "agent_tooling:scene_hierarchy_required_objects_not_confirmed",
        "agent_tooling:ecs_runtime_not_queryable",
        "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
      ]));
      expect(report.verdict.blockers).not.toEqual(expect.arrayContaining([
        "agent_tooling:phase2_devtools_not_installed_in_sidecar",
        "agent_tooling:mcp_tool_inventory_count_not_32",
      ]));
    }
  });

  it("maps IWER sidecar evidence into partial agent-tooling readiness without physical Quest claims", () => {
    const mappedEvidence = mapIwerSidecarEvidenceToIwsdkAgentToolingEvidence(iwerSidecarEvidence());

    expect(mappedEvidence).toMatchObject({
      phase2DevtoolsConfiguredInSidecar: true,
      adapterSyncRecorded: false,
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
        "browser_get_console_logs",
        "browser_screenshot",
        "xr_get_device_state",
        "xr_get_session_status",
      ],
      mcpRuntimeRegistered: true,
      sceneHierarchyContainsRequiredObjects: false,
      ecsRuntimeQueryable: false,
      optionalServerActions: [],
    });
    expect(mappedEvidence.managedBrowserEvidence).toEqual({
      mode: "oversight",
      runtimeUrl: "http://127.0.0.1:5183/",
      managedBrowserReady: true,
      managedSessionId: "iwer-managed-browser:5183",
      normalBrowserOpened: false,
      screenshotWidth: 500,
      screenshotHeight: 500,
      managedDevUiVisible: false,
    });

    const report = buildIwsdkEvidenceContractReport({
      generatedAt: "2026-05-06T08:00:00.000Z",
      iwerSidecarEvidence: iwerSidecarEvidence(),
    });

    expect(report.agentToolingLocalPreflight.readyForLocalAgentToolingPreflight).toBe(true);
    expect(report.agentToolingLocalPreflight.blockers).toEqual([]);
    expect(report.agentTooling.readyForAgentTooling).toBe(false);
    expect(report.agentTooling.blockers).toEqual(expect.arrayContaining([
      "adapter_sync_not_recorded",
      "mcp_smoke_tool_not_validated_xr_accept_session",
      "mcp_smoke_tool_not_validated_scene_get_hierarchy",
      "mcp_smoke_tool_not_validated_xr_select",
      "scene_hierarchy_required_objects_not_confirmed",
      "ecs_runtime_not_queryable",
    ]));
    expect(report.agentTooling.blockers).not.toEqual(expect.arrayContaining([
      "phase2_devtools_not_installed_in_sidecar",
      "mcp_tool_inventory_count_not_32",
      "mcp_tool_names_not_recorded",
      "missing_managed_browser_evidence",
      "mcp_runtime_not_registered",
    ]));
    expect(report.verdict.readyForProductionRuntime).toBe(false);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "agent_tooling:scene_hierarchy_required_objects_not_confirmed",
      "agent_tooling:ecs_runtime_not_queryable",
      "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
      "tool_selection:manual_quest_foreground_required_for_production_readiness",
      "production_runtime:avg_fps_below_floor",
    ]));
  });

  it("exposes a CLI input for committed IWER sidecar emulation evidence", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwer-iwsdk-contract-"));
    const iwerInputPath = path.join(tempDir, "iwer-sidecar-evidence.json");
    const outputPath = path.join(tempDir, "iwsdk-evidence-contract.json");

    await writeFile(iwerInputPath, `${JSON.stringify(iwerSidecarEvidence(), null, 2)}\n`, "utf8");

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        [
          "tools/openclinxr/iwsdk-evidence-contract-check.ts",
          "--iwer-sidecar-input",
          iwerInputPath,
          "--output",
          outputPath,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK evidence contract checker to preserve remaining blockers");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(await readFile(outputPath, "utf8")) as IwsdkEvidenceContractReport;

      expect(failedRun.code).toBe(1);
      expect(failedRun.stdout).toContain(`Wrote ${outputPath}`);
      expect(report.agentToolingLocalPreflight.readyForLocalAgentToolingPreflight).toBe(true);
      expect(report.agentTooling.blockers).not.toEqual(expect.arrayContaining([
        "phase2_devtools_not_installed_in_sidecar",
        "missing_managed_browser_evidence",
        "mcp_runtime_not_registered",
      ]));
      expect(report.verdict.readyForProductionRuntime).toBe(false);
    }
  });

  it("exposes CLI inputs for captured Phase 2 evidence while preserving production blockers", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-evidence-inputs-"));
    const agentToolingInputPath = path.join(tempDir, "agent-tooling.json");
    const compatibilityInputPath = path.join(tempDir, "compatibility.json");
    const metadataInputPath = path.join(tempDir, "metadata-drift.json");
    const outputPath = path.join(tempDir, "iwsdk-evidence-contract.json");

    await writeFile(agentToolingInputPath, `${JSON.stringify(readyAgentToolingEvidence(), null, 2)}\n`, "utf8");
    await writeFile(compatibilityInputPath, `${JSON.stringify({
      openclinxrViteMajor: 8,
      iwsdkVitePluginPeerRange: "^7.0.0 || ^8.0.0",
      nodeMajor: 22,
      nodeRuntimePath: "/Users/patrick/.nvm/versions/node/v22.19.0/bin/node",
      rolldownNativeBindingLoaded: true,
    }, null, 2)}\n`, "utf8");
    await writeFile(metadataInputPath, `${JSON.stringify({
      packageName: "@iwsdk/reference",
      docsVersion: "0.3.2",
      npmLatestVersion: "0.3.2",
    }, null, 2)}\n`, "utf8");

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        [
          "tools/openclinxr/iwsdk-evidence-contract-check.ts",
          "--agent-tooling-input",
          agentToolingInputPath,
          "--compatibility-input",
          compatibilityInputPath,
          "--metadata-drift-input",
          metadataInputPath,
          "--output",
          outputPath,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK evidence contract checker to preserve production blockers");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(await readFile(outputPath, "utf8")) as IwsdkEvidenceContractReport;

      expect(failedRun.code).toBe(1);
      expect(failedRun.stdout).toContain(`Wrote ${outputPath}`);
      expect(report.verdict.readyForAgentTooling).toBe(true);
      expect(report.agentToolingLocalPreflight.readyForLocalAgentToolingPreflight).toBe(true);
      expect(report.verdict.readyForProductionRuntime).toBe(false);
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        "tool_selection:manual_quest_foreground_required_for_production_readiness",
        "production_runtime:avg_fps_below_floor",
      ]));
      expect(report.verdict.blockers).not.toEqual(expect.arrayContaining([
        "agent_tooling:adapter_sync_not_recorded",
        "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
      ]));
    }
  });

  it("validates the generated evidence contract shape independently from readiness blockers", () => {
    const report = buildIwsdkEvidenceContractReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
    });

    expect(validateIwsdkEvidenceContractReport(report)).toEqual({ ok: true });
    expect(validateIwsdkEvidenceContractReport({
      ...report,
      metadataDrift: {
        ...report.metadataDrift,
        result: {
          ...report.metadataDrift.result,
          blockers: "package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        },
      },
    })).toEqual({
      ok: false,
      errors: ["/metadataDrift/result/blockers must be array"],
    });
    expect(validateIwsdkEvidenceContractReport({
      ...report,
      compatibility: {
        ...report.compatibility,
        result: {
          ...report.compatibility.result,
          blockers: "vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        },
      },
    })).toEqual({
      ok: false,
      errors: ["/compatibility/result/blockers must be array"],
    });
    expect(validateIwsdkEvidenceContractReport({
      ...report,
      toolSelection: {
        ...report.toolSelection,
        blockers: "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
      },
    })).toEqual({
      ok: false,
      errors: ["/toolSelection/blockers must be array"],
    });
    expect(validateIwsdkEvidenceContractReport({
      ...report,
      agentToolingLocalPreflight: {
        ...report.agentToolingLocalPreflight,
        blockers: "mcp_tool_inventory_count_not_32",
      },
    })).toEqual({
      ok: false,
      errors: ["/agentToolingLocalPreflight/blockers must be array"],
    });
    expect(validateIwsdkEvidenceContractReport({
      ...report,
      verdict: {
        ...report.verdict,
        blockers: "agent_tooling:phase_1_runtime_shell_metrics_pass",
      },
    })).toEqual({
      ok: false,
      errors: ["/verdict/blockers must be array"],
    });
  });

  it("exposes a latest-file validation CLI for committed IWSDK evidence snapshots", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:evidence:validate"]).toBe(
      "tsx tools/openclinxr/iwsdk-evidence-contract-check.ts --validate-latest",
    );
    expect(rootPackage.scripts["iwsdk:verify"]).toContain("pnpm iwsdk:evidence:validate");

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-evidence-"));
    const reportPath = path.join(tempDir, "iwsdk-evidence-contract-2026-05-04.json");
    await writeFile(
      reportPath,
      `${JSON.stringify(buildIwsdkEvidenceContractReport({ generatedAt: "2026-05-04T00:00:00.000Z" }), null, 2)}\n`,
      "utf8",
    );

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwsdk-evidence-contract-check.ts", "--validate-latest", path.join(tempDir, "*.json")],
      { encoding: "utf8", timeout: 15000 },
    );

    expect(stdout).toContain(`Validated ${reportPath}`);
  });

  it("keeps the committed IWSDK evidence snapshot aligned with the current builders", async () => {
    const latestSnapshot = JSON.parse(
      await readFile("docs/openclinxr/iwsdk-evidence-contract-2026-05-04.json", "utf8"),
    ) as IwsdkEvidenceContractReport;

    expect(latestSnapshot).toEqual(buildIwsdkEvidenceContractReport({
      generatedAt: latestSnapshot.generatedAt,
    }));
  });
});

function readyAgentToolingEvidence(): IwsdkAgentToolingEvidence {
  return {
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
  };
}

function iwerSidecarEvidence(): IwerSidecarEmulationEvidence {
  return {
    schemaVersion: "openclinxr.iwer-sidecar-emulation-evidence.v1",
    proposal: "proposals/approved/proposal-iwer-sidecar-emulation-spike.md",
    classification: {
      lane: "iwer_managed_browser_emulation",
      scope: "sidecar_only_dev_evidence",
      notEvidenceFor: [
        "physical_quest_foreground_frame_pacing",
        "quest_controller_latency",
        "quest_hand_tracking_quality",
        "quest_passthrough_privacy_or_safety",
        "in_headset_text_readability",
        "thermal_or_battery_behavior",
        "production_runtime_readiness",
      ],
    },
    sidecar: {
      app: "apps/ui-xr-iwsdk-spike",
      runtimeUrl: "http://127.0.0.1:5183/",
      devServerPort: 5183,
      mcpWebSocketEndpoint: "ws://127.0.0.1:5183/__iwsdk/mcp",
      generatedLocalCodexConfigPolicy: "ignored_by_git_and_not_committed",
    },
    mcpToolInventory: {
      count: 32,
      toolNames: buildIwsdkMcpToolInventory().allToolNames,
    },
    rawWebSocketProbes: [
      {
        id: "codex-probe-status",
        method: "get_session_status",
        elapsedMs: 12,
        ok: true,
      },
      {
        id: "codex-probe-screenshot",
        method: "screenshot",
        elapsedMs: 526,
        ok: true,
        artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
        mimeType: "image/png",
        bytes: 39536,
        dimensions: { width: 500, height: 500 },
      },
      {
        id: "codex-probe-device-state",
        method: "get_device_state",
        elapsedMs: 18,
        ok: true,
      },
      {
        id: "logs-after-serve-only",
        method: "get_console_logs",
        elapsedMs: 24,
        ok: true,
      },
      {
        id: "codex-probe-accept",
        method: "accept_session",
        elapsedMs: 13,
        ok: false,
        blocker: "no_session_has_been_offered",
      },
      {
        id: "codex-probe-scene",
        method: "get_scene_hierarchy",
        elapsedMs: 6001,
        ok: false,
        blocker: "scene_hierarchy_timeout",
      },
      {
        id: "codex-probe-select",
        method: "select",
        ok: false,
        blocker: "no_active_xr_session",
      },
    ],
    blockers: [
      "iwer_emulation_not_physical_quest_evidence",
      "session_acceptance_blocked_until_app_offers_xr_session",
      "input_mutation_blocked_without_active_xr_session",
      "scene_hierarchy_and_ecs_blocked_until_framework_mcp_runtime_exists",
    ],
  };
}
