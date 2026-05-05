import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";

type CliOptions = {
  inputPath?: string;
  outputPath: string;
};

export type QuestManualPerformanceReport = {
  generatedAt?: string;
  runContext?: {
    performedBy?: string;
    durationMinutes?: number;
    notes?: string;
  };
  setup?: {
    foregroundPageConfirmed?: boolean;
    devtoolsScreencastDisabled?: boolean;
    extraBrowserWindowsClosed?: boolean;
  };
  station?: {
    shellLoaded?: boolean;
    traceInteractionPassed?: boolean;
    textReadable?: boolean;
    immersiveSessionStarted?: boolean;
    consoleErrors?: string[];
  };
  experience?: {
    modeId?: string;
    phaseLabel?: string;
    requestedSessionMode?: string;
    mixedRealityPassthroughImplemented?: boolean;
    handTrackingPosture?: string;
    locomotionPosture?: string;
  };
  input?: {
    handModelCount?: number;
    handModelStatus?: string;
    handInputsObserved?: number;
    locomotionMode?: string;
    activeLocomotionSource?: "none" | "keyboard" | "xr_gamepad" | "xr_hand_gesture" | "mixed";
    lastLocomotionAtMs?: number | null;
    rigPosition?: {
      x?: number;
      z?: number;
    };
  } | null;
  traceLatencyProxy?: {
    lastTraceTag?: string | null;
    lastSelectLatencyMs?: number | null;
    source?: string;
    measuredAtMs?: number | null;
    productionControllerLatencySubstitute?: boolean;
  } | null;
  performance?: {
    source?: string;
    framesObserved?: number | null;
    sampleWindowSize?: number | null;
    avgFps?: number | null;
    p95FrameMs?: number | null;
    minimumObservedFps?: number | null;
    controllerSelectLatencyMs?: number | null;
  };
  comfort?: {
    motionComfort?: "comfortable" | "good" | "mild_discomfort" | "uncomfortable" | "not_run";
    heatConcern?: boolean | null;
    batteryDropPercent?: number | null;
  };
};

export type QuestManualPerformanceCheck = {
  generatedAt: string;
  inputFile: string | null;
  readyToClaimFramePacing: boolean;
  satisfiedConditions: string[];
  blockers: string[];
  adversarialFindings: string[];
  nextSteps: string[];
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = options.inputPath ?? await latestManualReportPath();
  const report = inputPath ? await readJson<QuestManualPerformanceReport>(inputPath) : undefined;
  const check = buildQuestManualPerformanceCheck(inputPath, report);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(check, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}; readyToClaimFramePacing=${check.readyToClaimFramePacing}`);
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    outputPath: ".agent-factory/quest-manual-performance-report.json",
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--input") {
      options.inputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function latestManualReportPath(): Promise<string | undefined> {
  const files = (await fg("docs/openclinxr/quest-manual-performance-*.json", { onlyFiles: true }))
    .filter((file) => !file.endsWith("quest-manual-performance-template.json"))
    .sort();
  return files.at(-1);
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

export function buildQuestManualPerformanceCheck(inputFile: string | undefined, report: QuestManualPerformanceReport | undefined): QuestManualPerformanceCheck {
  if (!report) {
    return {
      generatedAt: new Date().toISOString(),
      inputFile: null,
      readyToClaimFramePacing: false,
      satisfiedConditions: [],
      blockers: ["missing_quest_manual_performance_report"],
      adversarialFindings: [],
      nextSteps: ["Create a dated Quest manual performance report from docs/openclinxr/quest-manual-performance-template.json."],
    };
  }

  const durationMinutes = report.runContext?.durationMinutes ?? 0;
  const rawConsoleErrors = report.station?.consoleErrors;
  const consoleErrors = Array.isArray(rawConsoleErrors) ? rawConsoleErrors : [];
  const consoleErrorsAreStringArray = rawConsoleErrors === undefined
    || (Array.isArray(rawConsoleErrors) && rawConsoleErrors.every((entry) => typeof entry === "string"));
  const performedBy = report.runContext?.performedBy ?? "";
  const framesObserved = report.performance?.framesObserved ?? null;
  const sampleWindowSize = report.performance?.sampleWindowSize ?? null;
  const batteryDropPercent = report.comfort?.batteryDropPercent ?? null;
  const avgFps = report.performance?.avgFps ?? null;
  const p95FrameMs = report.performance?.p95FrameMs ?? null;
  const minimumObservedFps = report.performance?.minimumObservedFps ?? null;
  const controllerSelectLatencyMs = report.performance?.controllerSelectLatencyMs ?? null;
  const traceLatencyProxy = report.traceLatencyProxy ?? null;
  const headsetInputObserved = hasObservedHeadsetInput(report.input);
  const locomotionObserved = hasObservedLocomotion(report.input);
  const framesObservedValid = isNonNegativeInteger(framesObserved);
  const sampleWindowSizeValid = isNonNegativeInteger(sampleWindowSize);
  const sampleWindowWithinObservedFrames = framesObservedValid
    && sampleWindowSizeValid
    && sampleWindowSize <= framesObserved;
  const avgFpsPlausible = isPlausibleFps(avgFps);
  const minimumObservedFpsPlausible = isPlausibleFps(minimumObservedFps);
  const minimumFpsAtOrBelowAverage = typeof minimumObservedFps === "number"
    && typeof avgFps === "number"
    && Number.isFinite(minimumObservedFps)
    && Number.isFinite(avgFps)
    ? minimumObservedFps <= avgFps
    : true;
  const p95FrameMsValid = isPositiveFiniteNumber(p95FrameMs);
  const controllerSelectLatencyMsValid = isPositiveFiniteNumber(controllerSelectLatencyMs);
  const batteryDropPercentValid = isPercentInRange(batteryDropPercent);
  const motionComfortConfirmed = isMotionComfortConfirmed(report.comfort?.motionComfort);
  const blockers = [
    isValidIsoDate(report.generatedAt) ? undefined : "generated_at_invalid_or_missing",
    performedBy.trim().length > 0 ? undefined : "performed_by_missing",
    report.setup?.foregroundPageConfirmed === true ? undefined : "foreground_page_not_confirmed",
    report.setup?.devtoolsScreencastDisabled === true ? undefined : "devtools_screencast_not_disabled",
    report.setup?.extraBrowserWindowsClosed === true ? undefined : "extra_browser_windows_not_closed",
    durationMinutes >= 10 ? undefined : "duration_under_10_minutes",
    report.station?.shellLoaded === true ? undefined : "station_shell_not_loaded",
    report.station?.traceInteractionPassed === true ? undefined : "trace_interaction_not_confirmed",
    report.station?.textReadable === true ? undefined : "text_readability_not_confirmed",
    report.station?.immersiveSessionStarted === true ? undefined : "immersive_session_not_confirmed",
    isFullVrExperienceEvidence(report.experience) ? undefined : "experience_mode_full_vr_not_recorded",
    headsetInputObserved ? undefined : "hand_or_controller_input_not_observed",
    locomotionObserved ? undefined : "locomotion_not_observed",
    consoleErrorsAreStringArray ? undefined : "console_errors_not_string_array",
    consoleErrors.length === 0 ? undefined : "console_errors_present",
    report.performance?.source === "window.__openClinXrFrameStats" ? undefined : "performance_source_not_openclinxr_frame_stats",
    typeof framesObserved === "number" && !framesObservedValid ? "frames_observed_not_non_negative_integer" : undefined,
    framesObserved === null || (framesObservedValid && framesObserved < 600) ? "frame_sample_under_600_or_missing" : undefined,
    typeof sampleWindowSize === "number" && !sampleWindowSizeValid ? "rolling_frame_window_not_non_negative_integer" : undefined,
    sampleWindowSizeValid && framesObservedValid && sampleWindowSize > framesObserved ? "rolling_frame_window_exceeds_frames_observed" : undefined,
    sampleWindowSize === null || (sampleWindowSizeValid && sampleWindowSize < 120) ? "rolling_frame_window_under_120_or_missing" : undefined,
    typeof avgFps === "number" && !avgFpsPlausible ? "average_fps_unrealistic_or_non_finite" : undefined,
    avgFps === null || (avgFpsPlausible && avgFps < 72) ? "average_fps_below_72_or_missing" : undefined,
    typeof minimumObservedFps === "number" && !minimumObservedFpsPlausible ? "minimum_fps_unrealistic_or_non_finite" : undefined,
    minimumFpsAtOrBelowAverage ? undefined : "minimum_fps_above_average_fps",
    minimumObservedFps === null || (minimumObservedFpsPlausible && minimumObservedFps < 60) ? "minimum_fps_below_60_or_missing" : undefined,
    typeof p95FrameMs === "number" && !p95FrameMsValid ? "p95_frame_ms_not_positive_finite" : undefined,
    p95FrameMs === null || (p95FrameMsValid && p95FrameMs > 25) ? "p95_frame_ms_above_25_or_missing" : undefined,
    typeof controllerSelectLatencyMs === "number" && !controllerSelectLatencyMsValid ? "controller_select_latency_ms_not_positive_finite" : undefined,
    controllerSelectLatencyMs === null || (controllerSelectLatencyMsValid && controllerSelectLatencyMs > 150)
      ? "controller_select_latency_ms_above_150_or_missing"
      : undefined,
    traceLatencyProxy?.productionControllerLatencySubstitute === true
      ? "trace_latency_proxy_marked_as_production_substitute"
      : undefined,
    motionComfortConfirmed ? undefined : "motion_comfort_not_confirmed",
    report.comfort?.heatConcern === false ? undefined : "heat_concern_not_cleared",
    typeof batteryDropPercent === "number" && !batteryDropPercentValid ? "battery_drop_not_finite_range_0_to_100" : undefined,
    batteryDropPercent === null ? "battery_drop_not_recorded" : undefined,
    batteryDropPercentValid && batteryDropPercent > 20 ? "battery_drop_above_20" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const adversarialFindings = buildAdversarialFindings({
    report,
    durationMinutes,
    framesObserved,
    framesObservedValid,
    heatConcern: report.comfort?.heatConcern,
    traceLatencyProxy,
  });

  return {
    generatedAt: new Date().toISOString(),
    inputFile: inputFile ?? null,
    readyToClaimFramePacing: blockers.length === 0,
    satisfiedConditions: [
      isValidIsoDate(report.generatedAt) ? "generated_at_valid" : undefined,
      performedBy.trim().length > 0 ? "performed_by_recorded" : undefined,
      report.setup?.foregroundPageConfirmed === true ? "foreground_page_confirmed" : undefined,
      report.setup?.devtoolsScreencastDisabled === true ? "devtools_screencast_disabled" : undefined,
      report.setup?.extraBrowserWindowsClosed === true ? "extra_browser_windows_closed" : undefined,
      durationMinutes >= 10 ? "duration_10_minutes_or_more" : undefined,
      report.station?.immersiveSessionStarted === true ? "immersive_session_started" : undefined,
      report.station?.textReadable === true ? "text_readability_confirmed" : undefined,
      report.performance?.source === "window.__openClinXrFrameStats" ? "performance_source_openclinxr_frame_stats" : undefined,
      framesObservedValid && framesObserved >= 600 ? "frame_sample_600_or_more" : undefined,
      sampleWindowWithinObservedFrames && sampleWindowSize >= 120 ? "rolling_frame_window_120_or_more" : undefined,
      avgFpsPlausible && avgFps >= 72 ? "average_fps_72_or_higher" : undefined,
      minimumObservedFpsPlausible && minimumFpsAtOrBelowAverage && minimumObservedFps >= 60 ? "minimum_fps_60_or_higher" : undefined,
      p95FrameMsValid && p95FrameMs <= 25 ? "p95_frame_ms_25_or_lower" : undefined,
      controllerSelectLatencyMsValid && controllerSelectLatencyMs <= 150 ? "controller_select_latency_150ms_or_lower" : undefined,
      isFullVrExperienceEvidence(report.experience) ? "experience_mode_full_vr_recorded" : undefined,
      headsetInputObserved ? "hand_or_controller_input_observed" : undefined,
      locomotionObserved ? "locomotion_observed" : undefined,
      isSupportingTraceLatencyProxy(traceLatencyProxy) ? "trace_latency_proxy_recorded_as_supporting_evidence" : undefined,
      motionComfortConfirmed ? "motion_comfort_confirmed" : undefined,
      batteryDropPercentValid && batteryDropPercent <= 20 ? "battery_drop_recorded_under_20" : undefined,
    ].filter((condition): condition is string => typeof condition === "string"),
    blockers,
    adversarialFindings,
    nextSteps: unique([
      ...blockers.map(questManualNextStepForBlocker),
      ...adversarialFindings.map(questManualNextStepForAdversarialFinding),
    ]),
  };
}

function buildAdversarialFindings(input: {
  report: QuestManualPerformanceReport;
  durationMinutes: number;
  framesObserved: number | null;
  framesObservedValid: boolean;
  heatConcern: boolean | null | undefined;
  traceLatencyProxy: QuestManualPerformanceReport["traceLatencyProxy"];
}): string[] {
  const notes = input.report.runContext?.notes ?? "";
  const handTrackingPosture = input.report.experience?.handTrackingPosture ?? "";
  const primitiveHandModelObserved = /primitive|box/i.test(handTrackingPosture)
    || /series of boxes|not realistic/i.test(notes);
  const handTrackingObserved = (input.report.input?.handInputsObserved ?? 0) > 0
    && /hand tracking/i.test(notes);
  const locomotionModeDeclared = typeof input.report.input?.locomotionMode === "string"
    && input.report.input.locomotionMode.trim().length > 0;
  const locomotionEventMissing = typeof input.report.input?.lastLocomotionAtMs !== "number";
  const immersiveWithNoFrameStats = input.report.station?.immersiveSessionStarted === true
    && input.framesObservedValid
    && input.framesObserved === 0;

  return [
    input.report.setup?.devtoolsScreencastDisabled === false ? "devtools_screencast_enabled_during_run" : undefined,
    primitiveHandModelObserved ? "hand_tracking_uses_primitive_box_model" : undefined,
    primitiveHandModelObserved && handTrackingObserved ? "hand_tracking_observed_without_realistic_hand_meshes" : undefined,
    locomotionModeDeclared && locomotionEventMissing ? "locomotion_mode_declared_without_locomotion_event" : undefined,
    immersiveWithNoFrameStats ? "immersive_session_started_but_frame_stats_empty" : undefined,
    input.traceLatencyProxy?.source === "dom_click_trace_button" && input.traceLatencyProxy.lastSelectLatencyMs === null
      ? "trace_latency_proxy_not_measured"
      : undefined,
    input.heatConcern === undefined || input.heatConcern === null ? "heat_observation_not_recorded" : undefined,
    input.durationMinutes < 10 ? "short_run_under_reliability_window" : undefined,
  ].filter((finding): finding is string => typeof finding === "string");
}

function questManualNextStepForAdversarialFinding(finding: string): string {
  switch (finding) {
    case "devtools_screencast_enabled_during_run":
      return "Rerun with DevTools screencast disabled so headset frame timing is less distorted.";
    case "hand_tracking_uses_primitive_box_model":
    case "hand_tracking_observed_without_realistic_hand_meshes":
      return "Replace primitive box hands with an articulated hand model or document why controller-only affordances are acceptable for this station.";
    case "locomotion_mode_declared_without_locomotion_event":
      return "Record an actual locomotion event timestamp after thumbstick, hand-gesture, or room-scale movement.";
    case "immersive_session_started_but_frame_stats_empty":
      return "Keep the headset foreground for a longer run and verify window.__openClinXrFrameStats increments while immersive mode is active.";
    case "trace_latency_proxy_not_measured":
      return "Capture a trace interaction or leave the proxy section explicitly unmeasured with a note.";
    case "heat_observation_not_recorded":
      return "Record heatConcern as false or true after the worn-headset run.";
    case "short_run_under_reliability_window":
      return "Repeat the run for at least 10 minutes before using it as readiness evidence.";
    default:
      return `Resolve Quest manual evidence-quality finding: ${finding}.`;
  }
}

function questManualNextStepForBlocker(blocker: string): string {
  switch (blocker) {
    case "generated_at_invalid_or_missing":
      return "Record a strict ISO generatedAt timestamp from the foreground headset capture.";
    case "performed_by_missing":
      return "Record the operator identity in runContext.performedBy.";
    case "foreground_page_not_confirmed":
      return "Confirm the page is foreground-visible in the headset.";
    case "devtools_screencast_not_disabled":
      return "Disable DevTools screencast while observing headset performance.";
    case "extra_browser_windows_not_closed":
      return "Close extra Quest Browser windows before the run.";
    case "duration_under_10_minutes":
      return "Observe for at least 10 minutes in the foreground headset session.";
    case "station_shell_not_loaded":
      return "Confirm the station shell loads in Quest Browser.";
    case "trace_interaction_not_confirmed":
      return "Confirm a trace interaction advances in the headset.";
    case "text_readability_not_confirmed":
      return "Confirm in-headset EHR and station text readability.";
    case "immersive_session_not_confirmed":
      return "Confirm the immersive session starts in-headset.";
    case "experience_mode_full_vr_not_recorded":
      return "Record experience.modeId full_vr, requestedSessionMode immersive-vr, and mixedRealityPassthroughImplemented false for this Full VR manual report.";
    case "hand_or_controller_input_not_observed":
      return "Observe at least one foreground headset hand or controller interaction.";
    case "locomotion_not_observed":
      return "Observe thumbstick, hand-gesture, or room-scale locomotion and record lastLocomotionAtMs.";
    case "console_errors_not_string_array":
      return "Record consoleErrors as an array of strings.";
    case "console_errors_present":
      return "Resolve or explicitly triage console errors before readiness.";
    case "performance_source_not_openclinxr_frame_stats":
      return "Use window.__openClinXrFrameStats as the performance source.";
    case "frames_observed_not_non_negative_integer":
      return "Record framesObserved as a non-negative integer.";
    case "frame_sample_under_600_or_missing":
      return "Observe at least 600 frames before claiming frame pacing.";
    case "rolling_frame_window_not_non_negative_integer":
      return "Record sampleWindowSize as a non-negative integer.";
    case "rolling_frame_window_exceeds_frames_observed":
      return "Keep the rolling frame window at or below framesObserved.";
    case "rolling_frame_window_under_120_or_missing":
      return "Record a rolling frame window with at least 120 samples.";
    case "average_fps_unrealistic_or_non_finite":
      return "Record a finite average FPS between 0 and 144.";
    case "average_fps_below_72_or_missing":
      return "Record average FPS at or above 72.";
    case "minimum_fps_unrealistic_or_non_finite":
      return "Record a finite minimum observed FPS between 0 and 144.";
    case "minimum_fps_above_average_fps":
      return "Ensure minimum observed FPS is not above average FPS.";
    case "minimum_fps_below_60_or_missing":
      return "Record minimum observed FPS at or above 60.";
    case "p95_frame_ms_not_positive_finite":
      return "Record p95 frame time as a positive finite number.";
    case "p95_frame_ms_above_25_or_missing":
      return "Record p95 frame time at or below 25 ms.";
    case "controller_select_latency_ms_not_positive_finite":
      return "Record controller-select latency as a positive finite number.";
    case "controller_select_latency_ms_above_150_or_missing":
      return "Record controller-select latency at or below 150 ms.";
    case "trace_latency_proxy_marked_as_production_substitute":
      return "Record a real headset controller-select latency measurement; DOM trace-click latency is supporting evidence only.";
    case "motion_comfort_not_confirmed":
      return "Confirm motion comfort is comfortable/good.";
    case "heat_concern_not_cleared":
      return "Clear heat concern as false after the run.";
    case "battery_drop_not_finite_range_0_to_100":
      return "Record battery drop as a finite percent from 0 to 100.";
    case "battery_drop_not_recorded":
      return "Record battery drop percent.";
    case "battery_drop_above_20":
      return "Investigate or rerun if battery drop exceeds 20 percent.";
    default:
      return `Resolve Quest manual blocker: ${blocker}.`;
  }
}

function isValidIsoDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isNonNegativeInteger(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isPlausibleFps(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 144;
}

function isPositiveFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPercentInRange(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isMotionComfortConfirmed(value: string | undefined): boolean {
  return value === "comfortable" || value === "good";
}

function hasObservedHeadsetInput(value: QuestManualPerformanceReport["input"]): boolean {
  return typeof value?.handInputsObserved === "number"
    && Number.isInteger(value.handInputsObserved)
    && value.handInputsObserved > 0;
}

function hasObservedLocomotion(value: QuestManualPerformanceReport["input"]): boolean {
  const hasLocomotionSource = typeof value?.activeLocomotionSource === "string"
    && value.activeLocomotionSource !== "none";
  const hasLocomotionMode = typeof value?.locomotionMode === "string"
    && value.locomotionMode.trim().length > 0;

  return typeof value?.lastLocomotionAtMs === "number"
    && Number.isFinite(value.lastLocomotionAtMs)
    && value.lastLocomotionAtMs >= 0
    && (hasLocomotionSource || hasLocomotionMode);
}

function isFullVrExperienceEvidence(value: QuestManualPerformanceReport["experience"]): boolean {
  return value?.modeId === "full_vr"
    && value.phaseLabel === "Phase 1 Full VR"
    && value.requestedSessionMode === "immersive-vr"
    && value.mixedRealityPassthroughImplemented === false;
}

function isSupportingTraceLatencyProxy(value: QuestManualPerformanceReport["traceLatencyProxy"]): boolean {
  return value?.source === "dom_click_trace_button"
    && value.productionControllerLatencySubstitute === false
    && isPositiveFiniteNumber(value.lastSelectLatencyMs ?? null);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
