import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkEvidenceContractReport,
  validateIwsdkEvidenceContractReport,
  type IwsdkEvidenceContractReport,
} from "./iwsdk-evidence-contract-check.js";
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
    expect(rootPackage.scripts["iwsdk:evidence"]).toBe("tsx tools/openclinxr/iwsdk-evidence-contract-check.ts");

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
