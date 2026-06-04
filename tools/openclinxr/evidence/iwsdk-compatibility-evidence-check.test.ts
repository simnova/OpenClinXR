import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkCompatibilityEvidenceReport,
  type IwsdkCompatibilityEvidenceReport,
} from "./iwsdk-compatibility-evidence-check.js";

const execFileAsync = promisify(execFile);

describe("IWSDK compatibility evidence checker", () => {
  it("marks phase 2 blocked when the IWSDK Vite plugin peer range does not include OpenClinXR's Vite major", () => {
    const report = buildIwsdkCompatibilityEvidenceReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      evidence: {
        openclinxrViteMajor: 8,
        iwsdkVitePluginPeerRange: "^7.0.0",
        nodeMajor: 22,
        nodeRuntimePath: "/Users/patrick/.nvm/versions/node/v22.19.0/bin/node",
        rolldownNativeBindingLoaded: true,
      },
    });

    expect(report.contract.packageName).toBe("@iwsdk/vite-plugin-dev");
    expect(report.verdict).toEqual({
      readyForPhase2AgentDevtools: false,
      blockers: ["vite_plugin_peer_range_does_not_accept_openclinxr_vite_major"],
    });
  });

  it("exposes a CLI that exits nonzero for incomplete compatibility evidence", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:compatibility:evidence"]).toBe(
      "tsx tools/openclinxr/evidence/iwsdk-compatibility-evidence-check.ts",
    );

    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-compatibility-evidence-"));
    const inputPath = path.join(dir, "compatibility-evidence.json");
    await writeFile(
      inputPath,
      `${JSON.stringify({
        openclinxrViteMajor: 8,
        iwsdkVitePluginPeerRange: "^7.0.0",
        nodeMajor: 21,
        nodeRuntimePath: "",
        rolldownNativeBindingLoaded: false,
      })}\n`,
      "utf8",
    );

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        ["tools/openclinxr/evidence/iwsdk-compatibility-evidence-check.ts", "--input", inputPath],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK compatibility evidence checker to reject incomplete evidence");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(failedRun.stdout) as IwsdkCompatibilityEvidenceReport;

      expect(failedRun.code).toBe(1);
      expect(report.verdict).toEqual({
        readyForPhase2AgentDevtools: false,
        blockers: [
          "vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
          "node_runtime_major_not_22",
          "missing_node_runtime_path",
          "rolldown_native_binding_not_loaded",
        ],
      });
    }
  });
});
