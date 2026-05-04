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

const execFileAsync = promisify(execFile);

describe("IWSDK evidence contract checker", () => {
  it("builds a blocked no-install evidence report for the current contract-only sidecar state", () => {
    const report = buildIwsdkEvidenceContractReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
    });

    expect(report.status).toBe("contract_only");
    expect(report.sidecar.currentState).toBe("contract_only");
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
        "apps/ui-xr-iwsdk-spike_exists_with_exact_iwsdk_versions",
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
    expect(report.operatorSteeringBlockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "iwsdk-install-backed-sidecar-approval",
        blockedAction: "apps/ui-xr-iwsdk-spike",
      }),
      expect.objectContaining({
        id: "iwsdk-reference-warmup-download-approval",
        blockedAction: "npx iwsdk reference warmup",
      }),
    ]));
    expect(report.agentTooling.readyForAgentTooling).toBe(false);
    expect(report.productionRuntime.readyForProductionRuntime).toBe(false);
    expect(report.verdict).toEqual({
      readyForInstallBackedSidecar: false,
      readyForAgentTooling: false,
      readyForProductionRuntime: false,
      blockers: expect.arrayContaining([
        "sidecar:operator_accepts_iwsdk_install_scope",
        "sidecar:exact_iwsdk_versions_selected",
        "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        "agent_tooling:adapter_sync_not_recorded",
        "agent_tooling:mcp_tool_inventory_count_not_32",
        "tool_selection:iwsdk_mcp_future_blocked_until_sidecar",
        "tool_selection:manual_quest_foreground_required_for_production_readiness",
        "production_runtime:missing_foreground_quest_preflight_ready",
        "production_runtime:missing_avg_fps",
      ]),
    });
  });

  it("exposes a CLI that prints the blocked report without installing IWSDK packages", async () => {
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
      expect(report.verdict.readyForProductionRuntime).toBe(false);
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        "sidecar:operator_accepts_iwsdk_install_scope",
        "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        "agent_tooling:missing_managed_browser_evidence",
        "production_runtime:missing_foreground_quest_preflight_ready",
        "production_runtime:missing_controller_select_latency_ms",
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
        blockers: "sidecar:operator_accepts_iwsdk_install_scope",
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
