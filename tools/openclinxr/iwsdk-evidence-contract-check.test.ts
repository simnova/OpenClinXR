import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkEvidenceContractReport,
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
    expect(report.agentTooling.readyForAgentTooling).toBe(false);
    expect(report.productionRuntime.readyForProductionRuntime).toBe(false);
    expect(report.verdict).toEqual({
      readyForInstallBackedSidecar: false,
      readyForAgentTooling: false,
      readyForProductionRuntime: false,
      blockers: expect.arrayContaining([
        "sidecar:operator_accepts_iwsdk_install_scope",
        "sidecar:exact_iwsdk_versions_selected",
        "agent_tooling:adapter_sync_not_recorded",
        "agent_tooling:mcp_tool_inventory_count_not_32",
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
        "agent_tooling:missing_managed_browser_evidence",
        "production_runtime:missing_controller_select_latency_ms",
      ]));
    }
  });
});
