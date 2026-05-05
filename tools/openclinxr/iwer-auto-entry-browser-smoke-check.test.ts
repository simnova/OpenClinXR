import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwerAutoEntryBrowserSmokeReport,
  type IwerAutoEntryBrowserSmokeEvidence,
  type IwerAutoEntryBrowserSmokeReport,
} from "./iwer-auto-entry-browser-smoke-check.js";

const execFileAsync = promisify(execFile);

describe("IWER auto-entry browser smoke checker", () => {
  it("accepts emulated auto-entry evidence without promoting it to physical Quest proof", () => {
    const report = buildIwerAutoEntryBrowserSmokeReport({
      generatedAt: "2026-05-05T02:45:00.000Z",
      evidence: readyEvidence(),
    });

    expect(report.result).toEqual({
      readyForAutoEntryEvidence: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
      warnings: [
        "console_issue_observed",
        "console_warning_observed",
        "hand_models_installed_but_no_hand_inputs_observed",
        "locomotion_not_observed",
      ],
    });
    expect(report.evidence.classification?.notEvidenceFor).toEqual(expect.arrayContaining([
      "physical_quest_immersive_entry",
      "in_headset_text_readability",
      "production_runtime_readiness",
    ]));
  });

  it("rejects contradictory session-start claims and unsafe claim boundaries", () => {
    const evidence = readyEvidence();
    evidence.classification!.notEvidenceFor = ["psychometric_validity"];
    evidence.sessionEntryEvidence!.appEvidence!.lastStatus = "failed";
    evidence.sessionEntryEvidence!.appEvidence!.lastOutcome = "request_failed";
    evidence.sessionEntryEvidence!.pageEvidence!.xrStatusText = "Enter Full VR";
    evidence.screenshot!.artifact = "/tmp/iwer-auto-entry.png";
    evidence.screenshot!.bytes = 1;

    const report = buildIwerAutoEntryBrowserSmokeReport({
      generatedAt: "2026-05-05T02:45:00.000Z",
      evidence,
    });

    expect(report.result.readyForAutoEntryEvidence).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "missing_not_evidence_for_physical_quest_immersive_entry",
      "session_started_without_app_started_status",
      "session_started_without_in_full_vr_status_text",
      "screenshot_artifact_not_under_docs_openclinxr_screenshots",
      "screenshot_artifact_file_missing",
    ]));
  });

  it("accepts the committed live browser smoke evidence fixture", async () => {
    const evidence = JSON.parse(
      await readFile("docs/openclinxr/iwer-auto-entry-browser-smoke-2026-05-04.json", "utf8"),
    ) as IwerAutoEntryBrowserSmokeEvidence;
    const report = buildIwerAutoEntryBrowserSmokeReport({
      generatedAt: "2026-05-05T02:45:00.000Z",
      inputFile: "docs/openclinxr/iwer-auto-entry-browser-smoke-2026-05-04.json",
      evidence,
    });

    expect(report.result.readyForAutoEntryEvidence).toBe(true);
    expect(report.result.readyForPhysicalQuestClaim).toBe(false);
    expect(report.evidence.sessionEntryEvidence?.outcome).toBe("session_started");
  });

  it("exposes a CLI for scoring captured auto-entry evidence JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwer:auto-entry:evidence"]).toBe(
      "tsx tools/openclinxr/iwer-auto-entry-browser-smoke-check.ts",
    );
    expect(rootPackage.scripts["iwer:auto-entry:evidence:validate"]).toBe(
      "tsx tools/openclinxr/iwer-auto-entry-browser-smoke-check.ts --input docs/openclinxr/iwer-auto-entry-browser-smoke-2026-05-04.json",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwer-auto-entry-"));
    const inputPath = path.join(tempDir, "iwer-auto-entry.json");
    const outputPath = path.join(tempDir, "iwer-auto-entry-report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwer-auto-entry-browser-smoke-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as IwerAutoEntryBrowserSmokeReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForAutoEntryEvidence).toBe(true);
  });
});

function readyEvidence(): IwerAutoEntryBrowserSmokeEvidence {
  return {
    schemaVersion: "openclinxr.iwer-auto-entry-browser-smoke.v1",
    classification: {
      lane: "iwer_devtools_managed_browser_auto_entry",
      scope: "sidecar_only_dev_evidence",
      notEvidenceFor: [
        "physical_quest_immersive_entry",
        "physical_quest_foreground_frame_pacing",
        "quest_controller_latency",
        "quest_hand_tracking_quality",
        "in_headset_text_readability",
        "thermal_or_battery_behavior",
        "production_runtime_readiness",
      ],
    },
    sidecar: {
      app: "apps/ui-xr-iwsdk-spike",
      runtimeUrl: "http://127.0.0.1:5183/?iwerAutoEnterVr=true",
      devServerPort: 5183,
      devCommand: "PORT=5183 pnpm --filter @openclinxr/ui-xr-iwsdk-spike dev:portless",
      queryFlag: "iwerAutoEnterVr=true",
    },
    sessionEntryEvidence: {
      sessionMode: "immersive-vr",
      requestedBy: "iwer_auto_entry_probe",
      autoAttemptEnabled: true,
      outcome: "session_started",
      appEvidence: {
        attempts: 1,
        lastStatus: "started",
        lastOutcome: "session_started",
        lastError: null,
      },
      pageEvidence: {
        xrStatusText: "In Full VR",
        bodyTextIncludesFullVrStatus: true,
      },
    },
    frameStats: {
      sampleCount: 180,
      avgFrameMs: 8.33,
      p95FrameMs: 10.4,
      maxFrameMs: 12.3,
      approxFps: 120,
      framesObserved: 27237,
      sampleWindowSize: 180,
    },
    inputEvidence: {
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 0,
      locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
      lastLocomotionAtMs: null,
      rigPosition: { x: 0, z: 0 },
    },
    bootEvidence: {
      app: "ui-xr-iwsdk-spike",
      events: [
        { phase: "station_render_loop_started", atMs: 25.1 },
        { phase: "full_vr_entry_iwer_auto_entry_probe", atMs: 277.2 },
      ],
    },
    browserEvidence: {
      title: "OpenClinXR IWSDK Spike",
      hasCanvas: true,
      consoleErrors: [],
      consoleWarnings: ["Could not find menu_pressed_min in the model"],
      consoleIssues: ["A form field element should have an id or name attribute"],
    },
    screenshot: {
      source: "chrome_devtools_mcp",
      artifact: "docs/openclinxr/screenshots/iwer-auto-entry-2026-05-04.png",
      mimeType: "image/png",
      bytes: 524126,
      dimensions: {
        width: 1910,
        height: 1670,
      },
      captureCommand: "Chrome DevTools MCP take_screenshot",
    },
    blockers: [
      "iwer_auto_entry_not_physical_quest_evidence",
      "physical_quest_foreground_metrics_still_required",
      "hand_tracking_visuals_remain_primitive",
      "hand_locomotion_not_observed",
    ],
  };
}
