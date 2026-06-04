import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkMcpToolInventory,
  buildIwsdkPackageManagedMcpCommand,
} from "../../../packages/openclinxr/arena/iwsdk-spike/src/index.js";
import {
  buildIwsdkMcpInventoryEvidenceReport,
} from "./iwsdk-mcp-inventory-evidence.js";

describe("IWSDK MCP inventory evidence", () => {
  it("turns an observed stdio tools/list inventory into a bounded readiness report", () => {
    const observedToolNames = buildIwsdkMcpToolInventory().allToolNames;
    const report = buildIwsdkMcpInventoryEvidenceReport({
      generatedAt: "2026-05-06T02:00:00.000Z",
      cwd: "/Volumes/files/src/openclinxr",
      packageVersion: "0.3.1",
      server: {
        name: "iwsdk-dev-mcp",
        version: "1.0.0",
        protocolVersion: "2024-11-05",
      },
      observedToolNames,
    });

    expect(report).toMatchObject({
      generatedAt: "2026-05-06T02:00:00.000Z",
      source: "iwsdk_dev_mcp_stdio_tools_list",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        mcpConfigMutated: false,
        optionalReferenceWarmupUsed: false,
        hzdbUsed: false,
        productionUseAllowed: false,
        physicalQuestClaimed: false,
      },
      package: {
        name: "@iwsdk/vite-plugin-dev",
        version: "0.3.1",
      },
      command: {
        executable: "pnpm",
        args: buildIwsdkPackageManagedMcpCommand().args,
        cwd: "/Volumes/files/src/openclinxr",
      },
      server: {
        name: "iwsdk-dev-mcp",
        version: "1.0.0",
        protocolVersion: "2024-11-05",
      },
      inventory: {
        expectedToolCount: 32,
        observedToolCount: 32,
        missingExpectedToolNames: [],
        unknownToolNames: [],
        requiredCategoriesCovered: true,
        matchedExpectedInventory: true,
      },
      agentToolingReadiness: {
        readyForAgentTooling: false,
        blockers: expect.arrayContaining([
          "adapter_sync_not_recorded",
          "missing_managed_browser_evidence",
          "mcp_runtime_not_registered",
          "scene_hierarchy_required_objects_not_confirmed",
          "ecs_runtime_not_queryable",
        ]),
      },
      localPreflightReadiness: {
        readyForLocalAgentToolingPreflight: true,
        blockers: [],
        notEvidenceFor: expect.arrayContaining([
          "adapter_sync_completed",
          "mcp_runtime_registered",
          "managed_browser_ready",
          "mcp_smoke_tools_validated",
          "scene_hierarchy_query_passed",
          "ecs_runtime_query_passed",
          "physical_quest_readiness",
          "production_runtime_readiness",
        ]),
      },
    });
    expect(report.inventory.coveredCategories).toEqual([
      "session",
      "transforms",
      "input_mode",
      "select_trigger",
      "gamepad",
      "device_state",
      "browser",
      "scene",
      "ecs",
    ]);
    expect(report.agentToolingReadiness.blockers).not.toContain("mcp_tool_inventory_count_not_32");
  });

  it("flags missing and unknown MCP tools before agent tooling can be claimed", () => {
    const report = buildIwsdkMcpInventoryEvidenceReport({
      observedToolNames: [
        ...buildIwsdkMcpToolInventory().allToolNames.filter((toolName) => toolName !== "ecs_diff"),
        "xr_future_tool",
      ],
    });

    expect(report.inventory.matchedExpectedInventory).toBe(false);
    expect(report.inventory.missingExpectedToolNames).toEqual(["ecs_diff"]);
    expect(report.inventory.unknownToolNames).toEqual(["xr_future_tool"]);
    expect(report.agentToolingReadiness.blockers).toEqual(expect.arrayContaining([
      "mcp_tool_missing_ecs_diff",
      "mcp_tool_unknown_xr_future_tool",
    ]));
    expect(report.localPreflightReadiness.readyForLocalAgentToolingPreflight).toBe(false);
    expect(report.localPreflightReadiness.blockers).toEqual(expect.arrayContaining([
      "mcp_tool_missing_ecs_diff",
      "mcp_tool_unknown_xr_future_tool",
    ]));
  });

  it("adds an opt-in package script without putting MCP capture in default verify", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["iwsdk:mcp-inventory:evidence"]).toBe(
      "tsx tools/openclinxr/evidence/iwsdk-mcp-inventory-evidence.ts",
    );
    expect(rootPackage.scripts.verify).not.toContain("iwsdk:mcp-inventory:evidence");
  });

});
