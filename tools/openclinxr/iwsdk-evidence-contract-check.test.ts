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
        "agent_tooling:adapter_sync_not_recorded",
        "agent_tooling:mcp_tool_inventory_count_not_32",
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
});
