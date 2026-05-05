import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwerSidecarEmulationEvidenceReport,
  type IwerSidecarEmulationEvidenceReport,
} from "./iwer-sidecar-emulation-evidence-check.js";
import { buildIwsdkMcpToolInventory } from "../../packages/openclinxr/iwsdk-spike/src/index.js";

const execFileAsync = promisify(execFile);

describe("IWER sidecar emulation evidence checker", () => {
  it("accepts the captured sidecar evidence as emulation-only and not production Quest proof", async () => {
    const evidence = JSON.parse(
      await readFile("docs/openclinxr/iwer-sidecar-emulation-evidence-2026-05-04.json", "utf8"),
    ) as IwerSidecarEmulationEvidenceReport["evidence"];
    const report = buildIwerSidecarEmulationEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      inputFile: "docs/openclinxr/iwer-sidecar-emulation-evidence-2026-05-04.json",
      evidence,
    });

    expect(report.result).toEqual({
      readyForEmulationEvidence: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
    });
    expect(report.evidence.classification?.notEvidenceFor).toEqual(expect.arrayContaining([
      "physical_quest_foreground_frame_pacing",
      "production_runtime_readiness",
    ]));
  });

  it("rejects evidence that omits Quest/production claim boundaries", () => {
    const evidence = readyEvidence();
    evidence.classification!.notEvidenceFor = ["psychometric_validity"];
    evidence.productionBuildOutputInspection!.distIndexHtmlContainsDevRuntimeInjection = true;

    const report = buildIwerSidecarEmulationEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      evidence,
    });

    expect(report.result).toEqual({
      readyForEmulationEvidence: false,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: expect.arrayContaining([
        "missing_not_evidence_for_physical_quest_foreground_frame_pacing",
        "missing_not_evidence_for_production_runtime_readiness",
        "production_build_contains_dev_runtime_injection",
      ]),
    });
  });

  it("rejects non-local endpoints, package drift, incomplete tool inventory, and weak screenshot evidence", () => {
    const evidence = readyEvidence();
    evidence.sidecar!.runtimeUrl = "https://example.com/";
    evidence.sidecar!.mcpWebSocketEndpoint = "wss://example.com/__iwer_mcp";
    evidence.packages = evidence.packages!.filter((pkg) => pkg.name !== "@iwer/sem");
    evidence.mcpToolInventory!.toolNames = ["xr_get_session_status"];
    evidence.rawWebSocketProbes = [
      { id: "screenshot", method: "screenshot", ok: true, artifact: "/tmp/screenshot.jpg", mimeType: "image/jpeg", bytes: 0, dimensions: { width: 100, height: 100 } },
    ];
    evidence.blockers = [];

    const report = buildIwerSidecarEmulationEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForEmulationEvidence).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "runtime_url_not_localhost",
      "mcp_websocket_endpoint_not_localhost",
      "missing_package_@iwer/sem_0.2.5",
      "mcp_tool_inventory_names_do_not_match_contract",
      "screenshot_probe_mime_type_not_png",
      "screenshot_probe_has_no_bytes",
      "screenshot_probe_dimensions_not_500",
      "screenshot_artifact_not_under_docs_openclinxr_screenshots",
      "known_blocker_missing_iwer_emulation_not_physical_quest_evidence",
      "known_blocker_missing_scene_hierarchy_and_ecs_blocked_until_framework_mcp_runtime_exists",
    ]));
  });

  it("exposes a CLI for scoring captured evidence JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:iwer:evidence"]).toBe(
      "tsx tools/openclinxr/iwer-sidecar-emulation-evidence-check.ts",
    );
    expect(rootPackage.scripts["iwer:sidecar:evidence"]).toBe(
      "tsx tools/openclinxr/iwer-sidecar-emulation-evidence-check.ts --input docs/openclinxr/iwer-sidecar-emulation-evidence-2026-05-04.json",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwer-evidence-"));
    const inputPath = path.join(tempDir, "iwer-evidence.json");
    const outputPath = path.join(tempDir, "iwer-report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwer-sidecar-emulation-evidence-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as IwerSidecarEmulationEvidenceReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForEmulationEvidence).toBe(true);
  });
});

function readyEvidence(): IwerSidecarEmulationEvidenceReport["evidence"] {
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
      mcpWebSocketEndpoint: "ws://127.0.0.1:5183/__iwer_mcp",
      generatedLocalCodexConfigPolicy: "ignored_by_git_and_not_committed",
    },
    packages: [
      { name: "@iwsdk/vite-plugin-dev", version: "0.3.1", dependencyPosture: "sidecar_devDependency_only" },
      { name: "iwer", version: "2.2.1", dependencyPosture: "transitive_devtool_emulation_only" },
      { name: "@iwer/devui", version: "2.2.0", dependencyPosture: "transitive_devtool_emulation_only" },
      { name: "@iwer/sem", version: "0.2.5", dependencyPosture: "transitive_devtool_emulation_only" },
      { name: "sharp", version: "0.33.5", dependencyPosture: "transitive_sidecar_devtool_only_with_approved_libvips_exception" },
      { name: "@img/sharp-libvips-darwin-arm64", version: "1.0.4", dependencyPosture: "approved_sidecar_devtool_exception_only" },
      { name: "playwright", version: "1.59.1", dependencyPosture: "transitive_managed_browser_for_sidecar_devtool" },
      { name: "ws", version: "8.20.0", dependencyPosture: "transitive_local_websocket_for_sidecar_devtool" },
      { name: "vite", version: "8.0.10", dependencyPosture: "sidecar_dev_runtime" },
    ],
    vitePluginConfiguration: {
      pluginName: "iwsdk-dev",
      apply: "serve",
      options: {
        emulator: { device: "metaQuest3", injectOnBuild: false },
        ai: { mode: "agent", tools: ["codex"], screenshotSize: { width: 500, height: 500 } },
      },
    },
    mcpToolInventory: {
      count: 32,
      toolNames: buildIwsdkMcpToolInventory().allToolNames,
    },
    rawWebSocketProbes: [
      { id: "status", method: "get_session_status", ok: true },
      {
        id: "screenshot",
        method: "screenshot",
        ok: true,
        artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
        mimeType: "image/png",
        bytes: 39536,
        dimensions: { width: 500, height: 500 },
      },
    ],
    productionBuildOutputInspection: {
      buildExitCode: 0,
      distIndexHtmlContainsDevRuntimeInjection: false,
      distSearchMatches: [],
    },
    adversarialVisualQa: {
      artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
      xrMode: "desktop_managed_browser_not_immersive_session",
      notes: ["The screenshot should be used for adversarial UI/scene iteration only."],
    },
    blockers: [
      "iwer_emulation_not_physical_quest_evidence",
      "session_acceptance_blocked_until_app_offers_xr_session",
      "input_mutation_blocked_without_active_xr_session",
      "scene_hierarchy_and_ecs_blocked_until_framework_mcp_runtime_exists",
      "vite_8_peer_mismatch_with_iwsdk_vite_plugin_dev_0_3_1",
      "iwsdk_vendor_chunk_exceeds_650kb_budget",
      "managed_chromium_first_run_downloaded_to_local_playwright_cache",
    ],
  };
}
