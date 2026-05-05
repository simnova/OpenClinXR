import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildQuestManualPerformanceCheck, type QuestManualPerformanceReport } from "./check-quest-manual-performance.js";

const execFileAsync = promisify(execFile);

function completedQuestManualReport(): QuestManualPerformanceReport {
  return {
    generatedAt: "2026-05-04T00:00:00.000Z",
    runContext: {
      performedBy: "xr-systems-architect",
      durationMinutes: 10,
    },
    setup: {
      foregroundPageConfirmed: true,
      devtoolsScreencastDisabled: true,
      extraBrowserWindowsClosed: true,
    },
    station: {
      shellLoaded: true,
      traceInteractionPassed: true,
      traceInteractionAttempt: "runtime_event_observed",
      textReadable: true,
      immersiveSessionStarted: true,
      consoleErrors: [],
    },
    experience: {
      modeId: "full_vr",
      phaseLabel: "Phase 1 Full VR",
      requestedSessionMode: "immersive-vr",
      mixedRealityPassthroughImplemented: false,
    },
    input: {
      handModelCount: 2,
      handModelStatus: "active",
      handRepresentationKind: "mesh",
      handInputsObserved: 2,
      locomotionMode: "experimental_keyboard_thumbstick_and_hand_gesture_dolly",
      locomotionAttempt: "runtime_event_observed",
      activeLocomotionSource: "xr_hand_gesture",
      xrHandGestureState: {
        armed: true,
        dwellMs: 520,
        leftPinch: true,
        rightPinch: false,
        gestureDeadzoneMeters: 0.045,
        turnCooldownMs: 450,
      },
      lastLocomotionAtMs: 60_000,
      rigPosition: { x: 0.4, z: -0.2 },
      locomotionDelta: {
        from: { x: 0, z: 0, yawRadians: 0 },
        to: { x: 0.4, z: -0.2, yawRadians: 0.15 },
        delta: { x: 0.4, z: -0.2, yawRadians: 0.15 },
        distanceMeters: 0.447,
        turnRadians: 0.15,
      },
    },
    traceLatencyProxy: {
      source: "xr_controller_select",
      lastTraceTag: "ecg_request",
      lastSelectLatencyMs: 12,
      measuredAtMs: 1234,
      productionControllerLatencySubstitute: false,
    },
    performance: {
      source: "window.__openClinXrFrameStats",
      framesObserved: 600,
      sampleWindowSize: 120,
      firstFrameAtMs: 1000,
      previewFramesObserved: 0,
      immersiveFramesObserved: 600,
      avgFps: 72,
      p95FrameMs: 25,
      minimumObservedFps: 60,
      controllerSelectLatencyMs: 12,
    },
    reproducibility: {
      source: "browser_runtime",
      url: "http://localhost:5173/",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Quest 3) AppleWebKit/537.36 OculusBrowser/40.0.0.0.0 Chrome/120.0.0.0",
      browserVersionHints: {
        oculusBrowser: "40.0.0.0.0",
        chrome: "120.0.0.0",
      },
      app: {
        packageName: "@openclinxr/ui-xr",
        version: "0.1.0",
        gitCommit: "abc1234",
        buildTime: "2026-05-04T00:00:00.000Z",
        mode: "production",
      },
      webXr: {
        navigatorXrPresent: true,
        immersiveVrSupported: true,
        immersiveVrSupportCheckedAtMs: 228.6,
        immersiveArSupported: false,
        immersiveArSupportCheckedAtMs: 228.7,
        supportError: null,
      },
      display: {
        viewportWidth: 2064,
        viewportHeight: 2208,
        screenWidth: 2064,
        screenHeight: 2208,
        devicePixelRatio: 1,
        visibilityState: "visible",
      },
      limitations: [
        "browser_reported_metadata_not_device_firmware_proof",
        "display_refresh_rate_inferred_from_frame_cadence",
      ],
    },
    comfort: {
      motionComfort: "good",
      heatConcern: false,
      batteryDropPercent: 2,
    },
  };
}

describe("Quest manual performance checker", () => {
  it("accepts a completed foreground headset report at the current readiness thresholds", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-pass-"));
    const input = path.join(dir, "quest-manual-performance.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      generatedAt: "2026-05-04T00:00:00.000Z",
      runContext: {
        performedBy: "xr-systems-architect",
        durationMinutes: 10,
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: true,
        consoleErrors: [],
      },
      experience: {
        modeId: "full_vr",
        phaseLabel: "Phase 1 Full VR",
        requestedSessionMode: "immersive-vr",
        mixedRealityPassthroughImplemented: false,
      },
      input: {
        handModelCount: 2,
        handModelStatus: "active",
        handInputsObserved: 2,
        locomotionMode: "xr_hand_gesture",
        activeLocomotionSource: "xr_hand_gesture",
        xrHandGestureState: {
          armed: true,
          dwellMs: 520,
          leftPinch: true,
          rightPinch: false,
          gestureDeadzoneMeters: 0.045,
          turnCooldownMs: 450,
        },
        lastLocomotionAtMs: 60_000,
        rigPosition: { x: 0.4, z: -0.2 },
        locomotionDelta: {
          from: { x: 0, z: 0, yawRadians: 0 },
          to: { x: 0.4, z: -0.2, yawRadians: 0.15 },
          delta: { x: 0.4, z: -0.2, yawRadians: 0.15 },
          distanceMeters: 0.447,
          turnRadians: 0.15,
        },
      },
      traceLatencyProxy: {
        source: "xr_controller_select",
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 12,
        measuredAtMs: 1234,
        productionControllerLatencySubstitute: false,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 600,
        sampleWindowSize: 120,
        firstFrameAtMs: 1000,
        previewFramesObserved: 0,
        immersiveFramesObserved: 600,
        avgFps: 72,
        p95FrameMs: 25,
        minimumObservedFps: 60,
        controllerSelectLatencyMs: 12,
      },
      comfort: {
        motionComfort: "good",
        heatConcern: false,
        batteryDropPercent: 2,
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      evidencePosture: string;
      readyToClaimFramePacing: boolean;
      blockers: string[];
      satisfiedConditions: string[];
    };

    expect(check.evidencePosture).toBe("full_vr_frame_pacing_readiness");
    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "generated_at_valid",
      "performed_by_recorded",
      "immersive_session_started",
      "foreground_page_confirmed",
      "duration_10_minutes_or_more",
      "frame_sample_600_or_more",
      "immersive_frame_count_recorded",
      "rolling_frame_window_120_or_more",
      "average_fps_72_or_higher",
      "p95_frame_ms_25_or_lower",
      "controller_select_latency_150ms_or_lower",
      "experience_mode_full_vr_recorded",
      "hand_or_controller_input_observed",
      "locomotion_observed",
      "trace_latency_proxy_recorded_as_supporting_evidence",
      "motion_comfort_confirmed",
    ]));
  });

  it("accepts deliberate hand-select trace latency for hand-tracking-only headset reports", () => {
    const report = completedQuestManualReport();
    report.traceLatencyProxy = {
      source: "xr_hand_select",
      lastTraceTag: "ecg_request",
      lastSelectLatencyMs: 12,
      measuredAtMs: 1234,
      productionControllerLatencySubstitute: false,
    };
    report.input = {
      ...report.input,
      activeLocomotionSource: "xr_hand_gesture",
      xrHandGestureState: {
        armed: true,
        dwellMs: 520,
        leftPinch: true,
        rightPinch: false,
        gestureDeadzoneMeters: 0.045,
        turnCooldownMs: 450,
      },
    };

    const check = buildQuestManualPerformanceCheck("quest-manual-performance-hand-select.json", report);

    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "xr_hand_select_trace_latency_recorded",
      "controller_select_latency_matches_trace_proxy",
    ]));
  });

  it("accepts copied in-app payloads while preserving capture-summary blockers", () => {
    const payload = {
      manualPerformanceDraft: completedQuestManualReport(),
      captureSummary: {
        draftAvailable: true,
        manualValidationReady: false,
        frameStatsFresh: false,
        blockers: ["frame_stats_stale_or_unsampled"],
      },
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-copy.json", payload);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "frame_sample_600_or_more",
      "immersive_frame_count_recorded",
      "controller_select_latency_150ms_or_lower",
    ]));
    expect(check.blockers).toEqual([
      "copied_payload_summary_not_ready",
      "frame_stats_stale_or_unsampled",
    ]);
    expect(check.adversarialFindings).toEqual(["copied_ui_manual_performance_payload"]);
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Keep the headset foreground and copy the evidence only while frameStatsFresh is true.",
    ]));
  });

  it("surfaces a timed-out CDP manual evidence harvest without breaking copied payload compatibility", () => {
    const payload = {
      manualPerformanceDraft: completedQuestManualReport(),
      captureSummary: {
        draftAvailable: true,
        manualValidationReady: true,
        frameStatsFresh: true,
        blockers: [],
      },
      harvestSummary: {
        source: "quest_cdp_manual_evidence_harvest",
        ready: false,
        timedOut: true,
        blockers: ["locomotion_evidence_missing"],
        elapsedWallMs: 9000,
      },
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-harvest.json", payload);
    const checkWithHarvestSummary = check as typeof check & {
      harvestSummary?: {
        source?: string;
        ready?: boolean;
        timedOut?: boolean;
        blockers?: string[];
        elapsedWallMs?: number | null;
      };
    };

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(checkWithHarvestSummary.harvestSummary).toEqual({
      source: "quest_cdp_manual_evidence_harvest",
      ready: false,
      timedOut: true,
      blockers: ["locomotion_evidence_missing"],
      elapsedWallMs: 9000,
    });
    expect(check.blockers).toEqual([
      "manual_evidence_harvest_not_ready",
      "manual_evidence_harvest_timed_out",
      "locomotion_evidence_missing",
    ]);
    expect(check.adversarialFindings).toEqual([
      "copied_ui_manual_performance_payload",
      "cdp_manual_evidence_harvest_payload",
    ]);
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Rerun the CDP manual evidence harvester after the headset is foregrounded and the missing technical signal is visible.",
      "Retry thumbstick, hand-gesture, or room-scale locomotion before harvesting manual evidence.",
    ]));
  });

  it("reads the copied in-app Quest Evidence payload through the CLI", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-copy-pass-"));
    const input = path.join(dir, "quest-manual-performance-copy.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      manualPerformanceDraft: completedQuestManualReport(),
      captureSummary: {
        draftAvailable: true,
        manualValidationReady: true,
        frameStatsFresh: true,
        blockers: [],
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      readyToClaimFramePacing: boolean;
      blockers: string[];
      adversarialFindings: string[];
    };

    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.adversarialFindings).toEqual(["copied_ui_manual_performance_payload"]);
  });

  it("records complete reproducibility metadata as audit evidence", () => {
    const check = buildQuestManualPerformanceCheck(
      "docs/openclinxr/quest-manual-performance-copy.json",
      completedQuestManualReport(),
    );

    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "reproducibility_source_browser_runtime",
      "reproducibility_url_recorded",
      "reproducibility_browser_version_recorded",
      "reproducibility_app_build_recorded",
      "reproducibility_webxr_support_recorded",
      "reproducibility_display_context_recorded",
      "reproducibility_metadata_recorded",
    ]));
    expect(check.adversarialFindings).toEqual([]);
  });

  it("treats missing reproducibility metadata as audit-only evidence debt", () => {
    const report = completedQuestManualReport();
    delete report.reproducibility;

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance.json", report);

    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.adversarialFindings).toEqual([
      "reproducibility_metadata_missing",
      "raw_manual_report_without_copied_ui_payload",
    ]);
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Prefer the copied in-app Quest Evidence payload so URL, user agent, app build, WebXR support, and display context are preserved as audit metadata.",
    ]));
  });

  it("surfaces incomplete reproducibility metadata without blocking frame-pacing readiness", () => {
    const report = completedQuestManualReport();
    report.reproducibility = {
      source: "manual_notes",
      url: "",
      userAgent: "Mozilla/5.0 Quest",
      browserVersionHints: {
        oculusBrowser: null,
        chrome: null,
      },
      app: {
        packageName: "@openclinxr/ui-xr",
      },
      webXr: {
        navigatorXrPresent: true,
      },
      display: {
        viewportWidth: 0,
        viewportHeight: 0,
      },
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance.json", report);

    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining([
      "reproducibility_metadata_recorded",
    ]));
    expect(check.adversarialFindings).toEqual([
      "reproducibility_source_not_browser_runtime",
      "reproducibility_url_missing",
      "reproducibility_browser_version_missing",
      "reproducibility_app_build_missing",
      "reproducibility_webxr_support_missing",
      "reproducibility_display_context_missing",
    ]);
  });

  it("requires copied in-app payloads to include a fresh capture summary", () => {
    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-copy.json", {
      manualPerformanceDraft: completedQuestManualReport(),
    });

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "copied_payload_capture_summary_missing",
      "frame_stats_stale_or_unsampled",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Copy the full in-app Quest Evidence JSON payload, including captureSummary.",
      "Keep the headset foreground and copy the evidence only while frameStatsFresh is true.",
    ]));
  });

  it("ignores generated check artifacts when locating the latest manual report", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-latest-"));
    const docsDir = path.join(dir, "docs/openclinxr");
    const reportPath = path.join(docsDir, "quest-manual-performance-2026-05-04.json");
    const generatedCheckPath = path.join(docsDir, "quest-manual-performance-check-2099-01-01.json");
    const output = path.join(dir, ".agent-factory/quest-manual-performance-report.json");
    await mkdir(docsDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(completedQuestManualReport(), null, 2), "utf8");
    await writeFile(generatedCheckPath, JSON.stringify({
      generatedAt: "2099-01-01T00:00:00.000Z",
      readyToClaimFramePacing: false,
      blockers: ["generated_check_artifact_should_not_be_used_as_input"],
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      path.resolve("tools/openclinxr/check-quest-manual-performance.ts"),
      "--output",
      output,
    ], { cwd: dir, encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      inputFile: string | null;
      readyToClaimFramePacing: boolean;
      blockers: string[];
    };

    expect(check.inputFile).toBe("docs/openclinxr/quest-manual-performance-2026-05-04.json");
    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
  });

  it("does not clear readiness from mostly preview-frame samples", () => {
    const report = completedQuestManualReport();
    report.performance = {
      ...report.performance,
      framesObserved: 600,
      previewFramesObserved: 599,
      immersiveFramesObserved: 1,
      sampleWindowSize: 120,
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "immersive_frame_sample_under_600_or_missing",
      "rolling_frame_window_exceeds_immersive_frames_observed",
    ]));
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining([
      "immersive_frame_sample_600_or_more",
      "rolling_frame_window_120_or_more",
    ]));
  });

  it("requires headset select latency to come from an XR controller or hand trace path", () => {
    const report = completedQuestManualReport();
    report.traceLatencyProxy = {
      source: "dom_click_trace_button",
      lastTraceTag: "ecg_request",
      lastSelectLatencyMs: 12,
      measuredAtMs: 1234,
      productionControllerLatencySubstitute: false,
    };
    report.performance = {
      ...report.performance,
      controllerSelectLatencyMs: 12,
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "controller_select_trace_source_not_xr_controller_select",
    ]));
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining([
      "xr_controller_select_trace_latency_recorded",
      "xr_hand_select_trace_latency_recorded",
    ]));
  });

  it("requires controller latency to match the trace latency payload", () => {
    const report = completedQuestManualReport();
    report.traceLatencyProxy = {
      source: "xr_controller_select",
      lastTraceTag: "ecg_request",
      lastSelectLatencyMs: 12,
      measuredAtMs: 1234,
      productionControllerLatencySubstitute: false,
    };
    report.performance = {
      ...report.performance,
      controllerSelectLatencyMs: 80,
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "controller_select_latency_mismatch",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Copy headset select latency from the same xr_controller_select or xr_hand_select trace event used for the Trace row.",
    ]));
  });

  it("requires foreground headset input and locomotion observations before clearing readiness", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-input-blocked-"));
    const input = path.join(dir, "quest-manual-performance.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      generatedAt: "2026-05-04T00:00:00.000Z",
      runContext: {
        performedBy: "xr-systems-architect",
        durationMinutes: 10,
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: true,
        consoleErrors: [],
      },
      experience: {
        modeId: "full_vr",
        phaseLabel: "Phase 1 Full VR",
        requestedSessionMode: "immersive-vr",
        mixedRealityPassthroughImplemented: false,
      },
      input: {
        handModelCount: 0,
        handModelStatus: "pending_immersive_session",
        handInputsObserved: 0,
        locomotionMode: "thumbstick",
        lastLocomotionAtMs: null,
        rigPosition: { x: 0, z: 0 },
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 600,
        sampleWindowSize: 120,
        firstFrameAtMs: 1000,
        previewFramesObserved: 0,
        immersiveFramesObserved: 600,
        avgFps: 72,
        p95FrameMs: 25,
        minimumObservedFps: 60,
        controllerSelectLatencyMs: 150,
      },
      comfort: {
        motionComfort: "comfortable",
        heatConcern: false,
        batteryDropPercent: 2,
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      readyToClaimFramePacing: boolean;
      blockers: string[];
      satisfiedConditions: string[];
      nextSteps: string[];
    };

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "hand_or_controller_input_not_observed",
      "locomotion_not_observed",
    ]));
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining([
      "hand_or_controller_input_observed",
      "locomotion_observed",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Observe at least one foreground headset hand or controller interaction.",
      "Observe thumbstick, hand-gesture, or room-scale locomotion and record lastLocomotionAtMs.",
    ]));
  });

  it("does not treat a locomotion timestamp as hand-gesture movement without an active source", () => {
    const report: QuestManualPerformanceReport = {
      generatedAt: "2026-05-04T00:00:00.000Z",
      runContext: {
        performedBy: "xr-systems-architect",
        durationMinutes: 10,
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: true,
        consoleErrors: [],
      },
      experience: {
        modeId: "full_vr",
        phaseLabel: "Phase 1 Full VR",
        requestedSessionMode: "immersive-vr",
        mixedRealityPassthroughImplemented: false,
      },
      input: {
        handModelCount: 2,
        handModelStatus: "active",
        handInputsObserved: 2,
        locomotionMode: "experimental_keyboard_thumbstick_and_hand_gesture_dolly",
        activeLocomotionSource: "none",
        lastLocomotionAtMs: 60_000,
        xrHandGestureState: {
          armed: false,
          dwellMs: 180,
          leftPinch: true,
          rightPinch: false,
          gestureDeadzoneMeters: 0.045,
          turnCooldownMs: 450,
          blockedReason: "arming_dwell",
        },
        rigPosition: { x: 0, z: 0 },
      },
      traceLatencyProxy: {
        source: "xr_controller_select",
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 12,
        measuredAtMs: 1234,
        productionControllerLatencySubstitute: false,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 600,
        sampleWindowSize: 120,
        firstFrameAtMs: 1000,
        previewFramesObserved: 0,
        immersiveFramesObserved: 600,
        avgFps: 72,
        p95FrameMs: 25,
        minimumObservedFps: 60,
        controllerSelectLatencyMs: 150,
      },
      comfort: {
        motionComfort: "good",
        heatConcern: false,
        batteryDropPercent: 2,
      },
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining(["locomotion_not_observed"]));
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining(["locomotion_observed"]));
    expect(check.adversarialFindings).toEqual(expect.arrayContaining([
      "hand_gesture_locomotion_timestamp_without_active_source",
    ]));
  });

  it("requires locomotion claims to include a measurable rig delta", () => {
    const report = completedQuestManualReport();
    report.input = {
      ...report.input,
      activeLocomotionSource: "xr_hand_gesture",
      lastLocomotionAtMs: 60_000,
      rigPosition: { x: 0.4, z: -0.2 },
    };
    delete report.input.locomotionDelta;

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining(["locomotion_not_observed"]));
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining(["locomotion_observed"]));
    expect(check.adversarialFindings).toEqual(expect.arrayContaining([
      "locomotion_source_without_rig_delta",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Record locomotionDelta from the same accepted rig movement event as the active locomotion source.",
    ]));
  });

  it("records adversarial evidence-quality findings from a short worn-headset hand-tracking run", () => {
    const report: QuestManualPerformanceReport = {
      generatedAt: "2026-05-04T20:36:00.000Z",
      runContext: {
        performedBy: "Patrick Gidich",
        durationMinutes: 2,
        notes: "Virtual hands were just a series of boxes, not realistic representations. Patrick was using hand tracking, not controllers.",
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: false,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: false,
        traceInteractionAttempt: "xr_hand_select_attempted_no_runtime_event",
        textReadable: true,
        immersiveSessionStarted: true,
        consoleErrors: [],
      },
      experience: {
        modeId: "full_vr",
        phaseLabel: "Phase 1 Full VR",
        requestedSessionMode: "immersive-vr",
        mixedRealityPassthroughImplemented: false,
        handTrackingPosture: "optional_feature_with_primitive_hand_model",
        locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
      },
      input: {
        handModelCount: 2,
        handModelStatus: "active",
        handRepresentationKind: "primitive_boxes",
        handInputsObserved: 2,
        locomotionMode: "thumbstick",
        locomotionAttempt: "thumbstick_attempted_no_runtime_event",
        activeLocomotionSource: "none",
        xrHandGestureState: {
          armed: false,
          dwellMs: 0,
          leftPinch: false,
          rightPinch: false,
          gestureDeadzoneMeters: 0.045,
          turnCooldownMs: 450,
          blockedReason: "not_pinching",
        },
        lastLocomotionAtMs: null,
        rigPosition: { x: 0, z: 0 },
      },
      traceLatencyProxy: {
        source: "dom_click_trace_button",
        lastTraceTag: null,
        lastSelectLatencyMs: null,
        measuredAtMs: null,
        productionControllerLatencySubstitute: false,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 0,
        sampleWindowSize: 0,
        firstFrameAtMs: null,
        previewFramesObserved: 0,
        immersiveFramesObserved: 0,
        avgFps: null,
        p95FrameMs: null,
        minimumObservedFps: null,
        controllerSelectLatencyMs: null,
      },
      comfort: {
        motionComfort: "comfortable",
        heatConcern: null,
        batteryDropPercent: 0,
      },
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-2026-05-04.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "immersive_session_started",
      "text_readability_confirmed",
      "hand_or_controller_input_observed",
    ]));
    expect(check.blockers).toEqual(expect.arrayContaining([
      "trace_interaction_not_confirmed",
      "locomotion_not_observed",
      "frame_sample_under_600_or_missing",
      "immersive_frame_count_zero_or_missing",
    ]));
    expect(check.adversarialFindings).toEqual([
      "devtools_screencast_enabled_during_run",
      "trace_interaction_attempted_without_runtime_event",
      "hand_tracking_uses_primitive_box_model",
      "hand_tracking_observed_without_realistic_hand_meshes",
      "locomotion_attempted_without_runtime_event",
      "locomotion_mode_declared_without_locomotion_event",
      "immersive_session_started_but_frame_stats_empty",
      "trace_latency_proxy_not_measured",
      "heat_observation_not_recorded",
      "short_run_under_reliability_window",
      "reproducibility_metadata_missing",
      "raw_manual_report_without_copied_ui_payload",
    ]);
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Retry the in-headset trace action and preserve the resulting xr_controller_select or xr_hand_select runtime event.",
      "Replace primitive box hands with an articulated hand model or document why controller-only affordances are acceptable for this station.",
      "Retry thumbstick, hand-gesture, or room-scale locomotion and preserve the runtime locomotion event plus rig delta.",
      "Keep the headset foreground for a longer run and verify window.__openClinXrFrameStats increments while immersive mode is active.",
    ]));
  });

  it("keeps the tracked Patrick Quest evidence below readiness while preserving useful observations", async () => {
    const evidencePath = "docs/openclinxr/quest-manual-performance-2026-05-04.json";
    const report = JSON.parse(await readFile(evidencePath, "utf8")) as QuestManualPerformanceReport;

    const check = buildQuestManualPerformanceCheck(evidencePath, report);

    expect(report.runContext?.performedBy).toBe("Patrick Gidich");
    expect(report.station?.traceInteractionAttempt).toBe("dom_click_attempted_no_runtime_event");
    expect(report.input?.handRepresentationKind).toBe("primitive_boxes");
    expect(report.input?.locomotionAttempt).toBe("thumbstick_attempted_no_runtime_event");
    expect(report.input?.activeLocomotionSource).toBe("none");
    expect(report.input?.xrHandGestureState?.armed).toBe(false);
    expect(check.evidencePosture).toBe("early_worn_headset_full_vr_observation");
    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "immersive_session_started",
      "text_readability_confirmed",
      "hand_or_controller_input_observed",
    ]));
    expect(check.blockers).toEqual(expect.arrayContaining([
      "duration_under_10_minutes",
      "trace_interaction_not_confirmed",
      "locomotion_not_observed",
      "frame_sample_under_600_or_missing",
      "immersive_frame_count_zero_or_missing",
    ]));
    expect(check.adversarialFindings).toEqual(expect.arrayContaining([
      "trace_interaction_attempted_without_runtime_event",
      "hand_tracking_observed_without_realistic_hand_meshes",
      "locomotion_attempted_without_runtime_event",
      "locomotion_mode_declared_without_locomotion_event",
      "immersive_session_started_but_frame_stats_empty",
    ]));
  });

  it("flags raw human reports that are missing structured attempt and representation fields", () => {
    const report: QuestManualPerformanceReport = {
      generatedAt: "2026-05-04T20:36:00.000Z",
      runContext: {
        performedBy: "Patrick Gidich",
        durationMinutes: 2,
        notes: "Everything seemed to be ok. Virtual hands were just a series of boxes (not realistic representations). I was using hand tracking, not controllers.",
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: false,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: false,
        textReadable: true,
        immersiveSessionStarted: true,
        consoleErrors: [],
      },
      experience: {
        modeId: "full_vr",
        phaseLabel: "Phase 1 Full VR",
        requestedSessionMode: "immersive-vr",
        mixedRealityPassthroughImplemented: false,
        handTrackingPosture: "optional_feature_with_primitive_hand_model",
        locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
      },
      input: {
        handModelCount: 2,
        handModelStatus: "active",
        handInputsObserved: 2,
        locomotionMode: "thumbstick",
        lastLocomotionAtMs: null,
        rigPosition: { x: 0, z: 0 },
      },
      traceLatencyProxy: {
        source: "dom_click_trace_button",
        lastTraceTag: null,
        lastSelectLatencyMs: null,
        measuredAtMs: null,
        productionControllerLatencySubstitute: false,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 0,
        sampleWindowSize: 0,
        avgFps: null,
        p95FrameMs: null,
        minimumObservedFps: null,
        controllerSelectLatencyMs: null,
      },
      comfort: {
        motionComfort: "good",
        heatConcern: null,
        batteryDropPercent: 0,
      },
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-raw-operator.json", report);

    expect(check.evidencePosture).toBe("early_worn_headset_full_vr_observation");
    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.adversarialFindings).toEqual(expect.arrayContaining([
      "trace_interaction_attempt_status_missing",
      "hand_representation_kind_missing",
      "hand_tracking_uses_primitive_box_model",
      "locomotion_attempt_status_missing",
      "locomotion_mode_declared_without_locomotion_event",
      "raw_manual_report_without_copied_ui_payload",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Record station.traceInteractionAttempt so failed trace attempts distinguish not-attempted from attempted-without-runtime-event.",
      "Record input.handRepresentationKind so hand-tracking quality is auditable without relying on prose notes.",
      "Record input.locomotionAttempt so failed locomotion attempts distinguish not-attempted from attempted-without-runtime-event.",
    ]));
  });

  it("blocks invalid structured Quest manual evidence enum values", () => {
    const report = completedQuestManualReport();
    const unsafeStation = report.station as unknown as Record<string, string>;
    const unsafeInput = report.input as unknown as Record<string, string>;
    unsafeStation.traceInteractionAttempt = "clicked_the_button";
    unsafeInput.handRepresentationKind = "primitive_box";
    unsafeInput.locomotionAttempt = "thumbstick_attempted";

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-invalid-enums.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "trace_interaction_attempt_invalid",
      "hand_representation_kind_invalid",
      "locomotion_attempt_invalid",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Use a supported station.traceInteractionAttempt value from the Quest manual evidence template.",
      "Use a supported input.handRepresentationKind value from the Quest manual evidence template.",
      "Use a supported input.locomotionAttempt value from the Quest manual evidence template.",
    ]));
  });

  it("accepts primitive sphere hands as primitive non-mesh evidence", () => {
    const report = completedQuestManualReport();
    report.runContext = {
      ...report.runContext,
      durationMinutes: 2,
      notes: "Operator used hand tracking with primitive sphere hands as a no-new-asset visual improvement.",
    };
    report.experience = {
      ...report.experience,
      handTrackingPosture: "optional_feature_with_primitive_hand_model",
    };
    const unsafeInput = report.input as unknown as Record<string, string>;
    unsafeInput.handRepresentationKind = "primitive_spheres";

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-primitive-spheres.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).not.toEqual(expect.arrayContaining([
      "hand_representation_kind_invalid",
    ]));
    expect(check.adversarialFindings).toEqual(expect.arrayContaining([
      "hand_tracking_observed_without_realistic_hand_meshes",
    ]));
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining([
      "hand_representation_mesh_observed",
      "realistic_hand_meshes_observed",
    ]));
  });

  it("surfaces contradictory structured Quest manual evidence claims", () => {
    const report = completedQuestManualReport();
    report.runContext = {
      ...report.runContext,
      notes: "Operator reported the virtual hands were still a series of boxes, not realistic mesh hands.",
    };
    report.experience = {
      ...report.experience,
      handTrackingPosture: "optional_feature_with_primitive_hand_model",
    };
    report.traceLatencyProxy = {
      source: "xr_hand_select",
      lastTraceTag: null,
      lastSelectLatencyMs: null,
      measuredAtMs: null,
      productionControllerLatencySubstitute: false,
    };
    report.performance = {
      ...report.performance,
      controllerSelectLatencyMs: null,
    };
    report.input = {
      ...report.input,
      handRepresentationKind: "mesh",
      locomotionAttempt: "runtime_event_observed",
      lastLocomotionAtMs: null,
      locomotionDelta: undefined,
    };

    const check = buildQuestManualPerformanceCheck("docs/openclinxr/quest-manual-performance-contradictory.json", report);

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.adversarialFindings).toEqual(expect.arrayContaining([
      "trace_attempt_runtime_event_without_trace_evidence",
      "hand_representation_kind_mismatch",
      "locomotion_runtime_event_without_threshold_evidence",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Reconcile station.traceInteractionAttempt with the same headset trace tag, latency, and measuredAtMs evidence.",
      "Reconcile input.handRepresentationKind with observed hand model count, notes, and hand-tracking posture.",
      "Re-copy the Quest evidence after locomotion so the runtime event includes lastLocomotionAtMs and measurable locomotionDelta.",
    ]));
  });

  it("keeps missing comfort and frame metrics as explicit blockers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-blocked-"));
    const input = path.join(dir, "quest-manual-performance.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      generatedAt: "not-a-date",
      runContext: {
        performedBy: "",
        durationMinutes: 2,
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: false,
        consoleErrors: [],
      },
      performance: {
        source: "manual-summary",
        framesObserved: 12,
        sampleWindowSize: 3,
        avgFps: null,
        p95FrameMs: null,
        minimumObservedFps: null,
        controllerSelectLatencyMs: null,
      },
      comfort: {
        motionComfort: "not_run",
        heatConcern: null,
        batteryDropPercent: null,
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      readyToClaimFramePacing: boolean;
      blockers: string[];
      nextSteps: string[];
    };

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "generated_at_invalid_or_missing",
      "performed_by_missing",
      "duration_under_10_minutes",
      "immersive_session_not_confirmed",
      "experience_mode_full_vr_not_recorded",
      "performance_source_not_openclinxr_frame_stats",
      "frame_sample_under_600_or_missing",
      "rolling_frame_window_under_120_or_missing",
      "average_fps_below_72_or_missing",
      "minimum_fps_below_60_or_missing",
      "p95_frame_ms_above_25_or_missing",
      "controller_select_latency_ms_above_150_or_missing",
      "motion_comfort_not_confirmed",
      "heat_concern_not_cleared",
      "battery_drop_not_recorded",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Record a strict ISO generatedAt timestamp from the foreground headset capture.",
      "Record the operator identity in runContext.performedBy.",
      "Observe for at least 10 minutes in the foreground headset session.",
      "Confirm the immersive session starts in-headset.",
      "Record experience.modeId full_vr, requestedSessionMode immersive-vr, and mixedRealityPassthroughImplemented false for this Full VR manual report.",
      "Use window.__openClinXrFrameStats as the performance source.",
      "Observe at least 600 frames before claiming frame pacing.",
      "Record a rolling frame window with at least 120 samples.",
      "Record average FPS at or above 72.",
      "Record p95 frame time at or below 25 ms.",
      "Record headset select latency at or below 150 ms.",
      "Confirm motion comfort is comfortable/good.",
      "Clear heat concern as false after the run.",
      "Record battery drop percent.",
    ]));
  });

  it("blocks attempts to use DOM trace latency as production controller latency", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-proxy-latency-"));
    const input = path.join(dir, "quest-manual-performance.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      generatedAt: "2026-05-04T00:00:00.000Z",
      runContext: {
        performedBy: "xr-systems-architect",
        durationMinutes: 10,
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: true,
        consoleErrors: [],
      },
      traceLatencyProxy: {
        source: "dom_click_trace_button",
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 12,
        measuredAtMs: 1234,
        productionControllerLatencySubstitute: true,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 600,
        sampleWindowSize: 120,
        firstFrameAtMs: 1000,
        previewFramesObserved: 0,
        immersiveFramesObserved: 600,
        avgFps: 72,
        p95FrameMs: 25,
        minimumObservedFps: 60,
        controllerSelectLatencyMs: null,
      },
      comfort: {
        motionComfort: "comfortable",
        heatConcern: false,
        batteryDropPercent: 2,
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      readyToClaimFramePacing: boolean;
      blockers: string[];
      satisfiedConditions: string[];
      nextSteps: string[];
    };

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "controller_select_latency_ms_above_150_or_missing",
      "trace_latency_proxy_marked_as_production_substitute",
    ]));
    expect(check.satisfiedConditions).not.toContain("trace_latency_proxy_recorded_as_supporting_evidence");
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Record a real headset select latency measurement; DOM trace-click latency is supporting evidence only.",
    ]));
  });

  it("rejects malformed console error arrays and impossible frame metrics", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-impossible-"));
    const input = path.join(dir, "quest-manual-performance.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      generatedAt: "2026-05-04T00:00:00.000Z",
      runContext: {
        performedBy: "xr-systems-architect",
        durationMinutes: 10,
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: true,
        consoleErrors: [42],
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 600,
        sampleWindowSize: 700,
        firstFrameAtMs: 1000,
        previewFramesObserved: 0,
        immersiveFramesObserved: -1,
        avgFps: 180,
        p95FrameMs: -1,
        minimumObservedFps: 190,
        controllerSelectLatencyMs: -1,
      },
      comfort: {
        motionComfort: "comfortable",
        heatConcern: false,
        batteryDropPercent: -2,
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      readyToClaimFramePacing: boolean;
      blockers: string[];
      satisfiedConditions: string[];
    };

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "console_errors_not_string_array",
      "rolling_frame_window_exceeds_frames_observed",
      "immersive_frames_observed_not_non_negative_integer",
      "average_fps_unrealistic_or_non_finite",
      "minimum_fps_unrealistic_or_non_finite",
      "minimum_fps_above_average_fps",
      "p95_frame_ms_not_positive_finite",
      "controller_select_latency_ms_not_positive_finite",
      "battery_drop_not_finite_range_0_to_100",
    ]));
    expect(check.satisfiedConditions).not.toEqual(expect.arrayContaining([
      "average_fps_72_or_higher",
      "minimum_fps_60_or_higher",
      "p95_frame_ms_25_or_lower",
      "battery_drop_recorded_under_20",
    ]));
  });
});
