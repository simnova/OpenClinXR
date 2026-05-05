import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

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
        locomotionMode: "thumbstick",
        lastLocomotionAtMs: 60_000,
        rigPosition: { x: 0.4, z: -0.2 },
      },
      traceLatencyProxy: {
        source: "dom_click_trace_button",
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 12,
        measuredAtMs: 1234,
        productionControllerLatencySubstitute: false,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 600,
        sampleWindowSize: 120,
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
    };

    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "generated_at_valid",
      "performed_by_recorded",
      "immersive_session_started",
      "foreground_page_confirmed",
      "duration_10_minutes_or_more",
      "frame_sample_600_or_more",
      "rolling_frame_window_120_or_more",
      "average_fps_72_or_higher",
      "p95_frame_ms_25_or_lower",
      "controller_select_latency_150ms_or_lower",
      "experience_mode_full_vr_recorded",
      "hand_or_controller_input_observed",
      "locomotion_observed",
      "trace_latency_proxy_recorded_as_supporting_evidence",
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
      "Observe thumbstick or room-scale locomotion and record lastLocomotionAtMs.",
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
      "Record controller-select latency at or below 150 ms.",
      "Confirm motion comfort is comfortable.",
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
      "Record a real headset controller-select latency measurement; DOM trace-click latency is supporting evidence only.",
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
