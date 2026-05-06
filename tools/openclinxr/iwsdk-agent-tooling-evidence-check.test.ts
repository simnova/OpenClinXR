import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkAgentToolingEvidenceReport,
  type IwsdkAgentToolingEvidenceReport,
} from "./iwsdk-agent-tooling-evidence-check.js";
import { buildIwsdkMcpToolInventory } from "../../packages/openclinxr/iwsdk-spike/src/index.js";

const execFileAsync = promisify(execFile);

describe("IWSDK agent-tooling evidence checker", () => {
  it("scores complete future IWSDK MCP evidence as ready without requiring an installed sidecar now", () => {
    const report = buildIwsdkAgentToolingEvidenceReport({
      inputFile: "docs/openclinxr/iwsdk-agent-tooling-evidence-ready.json",
      generatedAt: "2026-05-04T00:00:00.000Z",
      evidence: readyEvidence(),
    });

    expect(report).toEqual({
      generatedAt: "2026-05-04T00:00:00.000Z",
      inputFile: "docs/openclinxr/iwsdk-agent-tooling-evidence-ready.json",
      evidence: readyEvidence(),
      result: {
        readyForAgentTooling: true,
        blockers: [],
      },
      localPreflightResult: {
        readyForLocalAgentToolingPreflight: true,
        blockers: [],
        notEvidenceFor: expect.arrayContaining([
          "adapter_sync_completed",
          "mcp_runtime_registered",
          "managed_browser_ready",
          "mcp_smoke_tools_validated",
        ]),
      },
    });
  });

  it("reports aggregate blockers for incomplete or unsafe future IWSDK MCP evidence", () => {
    const report = buildIwsdkAgentToolingEvidenceReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      evidence: {
        adapterSyncRecorded: false,
        toolCount: 31,
        coveredCategories: ["session", "browser"],
        validatedSmokeTools: ["xr_get_session_status"],
        optionalServerActions: ["npx iwsdk reference warmup"],
      },
    });

    expect(report.result.readyForAgentTooling).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "adapter_sync_not_recorded",
      "mcp_runtime_not_registered",
      "scene_hierarchy_required_objects_not_confirmed",
      "ecs_runtime_not_queryable",
      "mcp_tool_inventory_count_not_32",
      "mcp_required_category_missing_ecs",
      "mcp_required_category_missing_select_trigger",
      "mcp_smoke_tool_not_validated_xr_select",
      "missing_managed_browser_evidence",
      "optional_mcp_server_action_blocked:npx iwsdk reference warmup",
    ]));
    expect(report.localPreflightResult.readyForLocalAgentToolingPreflight).toBe(false);
    expect(report.localPreflightResult.blockers).toEqual(expect.arrayContaining([
      "mcp_tool_inventory_count_not_32",
      "mcp_tool_names_not_recorded",
      "mcp_required_category_missing_ecs",
      "optional_mcp_server_action_blocked:npx iwsdk reference warmup",
    ]));
  });

  it("exposes a CLI for scoring captured IWSDK MCP evidence JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:agent-tooling:evidence"]).toBe(
      "tsx tools/openclinxr/iwsdk-agent-tooling-evidence-check.ts",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-agent-evidence-"));
    const inputPath = path.join(tempDir, "ready.json");
    const outputPath = path.join(tempDir, "report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwsdk-agent-tooling-evidence-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as IwsdkAgentToolingEvidenceReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.localPreflightResult.readyForLocalAgentToolingPreflight).toBe(true);
    expect(report.result.readyForAgentTooling).toBe(true);
  });
});

function readyEvidence(): IwsdkAgentToolingEvidenceReport["evidence"] {
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
