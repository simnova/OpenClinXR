import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkSidecarMetricsReport,
  type IwsdkSidecarMetricsReport,
} from "./iwsdk-sidecar-metrics-check.js";

const execFileAsync = promisify(execFile);

describe("IWSDK sidecar metrics checker", () => {
  it("marks a future IWSDK sidecar metrics file ready when committed and production budgets pass", () => {
    expect(buildIwsdkSidecarMetricsReport({
      inputFile: "docs/openclinxr/iwsdk-sidecar-metrics-ready.json",
      generatedAt: "2026-05-04T00:00:00.000Z",
      metrics: readyMetrics(),
    })).toEqual({
      generatedAt: "2026-05-04T00:00:00.000Z",
      inputFile: "docs/openclinxr/iwsdk-sidecar-metrics-ready.json",
      metrics: readyMetrics(),
      result: {
        readyForCommittedSpike: true,
        readyForProductionRuntime: true,
        blockers: [],
      },
    });
  });

  it("keeps production runtime blocked when only committed sidecar metrics are present", () => {
    const report = buildIwsdkSidecarMetricsReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      metrics: {
        installedNodeModulesMb: 287,
        injectedDevRuntimeKb: 1116.3,
        appJsBundleKb: 504.47,
        bundleDeltaVsUiXrKb: 24,
        consoleErrorCount: 0,
      },
    });

    expect(report.result).toEqual({
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

  it("accepts local shell metrics while preserving headset-only production blockers", () => {
    const report = buildIwsdkSidecarMetricsReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      metrics: localShellMetrics(),
    });

    expect(report.result).toEqual({
      readyForCommittedSpike: true,
      readyForProductionRuntime: false,
      blockers: [
        "missing_foreground_quest_preflight_ready",
        "missing_controller_select_latency_ms",
      ],
    });
  });

  it("exposes a CLI for scoring captured IWSDK sidecar metrics JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:sidecar:metrics"]).toBe(
      "tsx tools/openclinxr/iwsdk-sidecar-metrics-check.ts",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-sidecar-metrics-"));
    const inputPath = path.join(tempDir, "ready.json");
    const outputPath = path.join(tempDir, "report.json");
    await writeFile(inputPath, `${JSON.stringify(readyMetrics(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwsdk-sidecar-metrics-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as IwsdkSidecarMetricsReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForProductionRuntime).toBe(true);
  });
});

function readyMetrics(): IwsdkSidecarMetricsReport["metrics"] {
  return {
    installedNodeModulesMb: 287,
    injectedDevRuntimeKb: 1116.3,
    appJsBundleKb: 504.47,
    bundleDeltaVsUiXrKb: 24,
    baselineAppBundleSource: "apps/ui-xr/dist/assets/index-BIObl4Qc.js",
    smokePlanHash: "runtime-state:iwsdk-station-mcp-smoke-plan:v1",
    canvasNonblank: true,
    requiredSceneObjectNames: [
      "openclinxr.ed-chest-pain.bed",
      "openclinxr.ed-chest-pain.monitor",
      "openclinxr.ed-chest-pain.patient-robert-hayes",
    ],
    observedSceneObjectNames: [
      "openclinxr.ed-chest-pain.bed",
      "openclinxr.ed-chest-pain.monitor",
      "openclinxr.ed-chest-pain.patient-robert-hayes",
    ],
    controllerSelectTraceTag: "ecg_request",
    observedTraceActionTags: ["ecg_request"],
    avgFps: 72,
    p95FrameMs: 24,
    controllerSelectLatencyMs: 140,
    foregroundQuestPreflightReady: true,
    consoleErrorCount: 0,
  };
}

function localShellMetrics(): IwsdkSidecarMetricsReport["metrics"] {
  return {
    installedNodeModulesMb: 24,
    injectedDevRuntimeKb: 0,
    appJsBundleKb: 504,
    bundleDeltaVsUiXrKb: 24,
    baselineAppBundleSource: "apps/ui-xr/dist/assets/index-D2UAcKLL.js",
    smokePlanHash: "runtime-state:iwsdk-station-mcp-smoke-plan:v1",
    canvasNonblank: true,
    requiredSceneObjectNames: [
      "openclinxr.ed-chest-pain.bed",
      "openclinxr.ed-chest-pain.monitor",
      "openclinxr.ed-chest-pain.patient-robert-hayes",
    ],
    observedSceneObjectNames: [
      "openclinxr.ed-chest-pain.bed",
      "openclinxr.ed-chest-pain.monitor",
      "openclinxr.ed-chest-pain.patient-robert-hayes",
    ],
    controllerSelectTraceTag: "ecg_request",
    observedTraceActionTags: ["ecg_request"],
    avgFps: 74.1,
    p95FrameMs: 15,
    consoleErrorCount: 0,
  };
}
