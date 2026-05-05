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
    xrHandGestureState?: {
      armed?: boolean;
      dwellMs?: number;
      leftPinch?: boolean;
      rightPinch?: boolean;
      gestureDeadzoneMeters?: number;
      turnCooldownMs?: number;
      blockedReason?: string;
    };
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
    firstFrameAtMs?: number | null;
    previewFramesObserved?: number | null;
    immersiveFramesObserved?: number | null;
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

export type QuestManualPerformanceCopiedPayload = {
  manualPerformanceDraft?: QuestManualPerformanceReport | null;
  captureSummary?: {
    draftAvailable?: boolean;
    manualValidationReady?: boolean;
    frameStatsFresh?: boolean | null;
    blockers?: string[];
  } | null;
};

export type QuestManualPerformancePayload = QuestManualPerformanceReport | QuestManualPerformanceCopiedPayload;

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
  const payload = inputPath ? await readJson<QuestManualPerformancePayload>(inputPath) : undefined;
  const check = buildQuestManualPerformanceCheck(inputPath, payload);
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
    .filter((file) => !path.basename(file).startsWith("quest-manual-performance-check-"))
    .sort();
  return files.at(-1);
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

export function buildQuestManualPerformanceCheck(inputFile: string | undefined, payload: QuestManualPerformancePayload | undefined): QuestManualPerformanceCheck {
  const normalizedPayload = normalizeQuestManualPerformancePayload(payload);
  const report = normalizedPayload.report;
  if (!report) {
    const blockers = unique([
      "missing_quest_manual_performance_report",
      ...normalizedPayload.blockers,
    ]);
    return {
      generatedAt: new Date().toISOString(),
      inputFile: null,
      readyToClaimFramePacing: false,
      satisfiedConditions: [],
      blockers,
      adversarialFindings: [],
      nextSteps: blockers.map(questManualNextStepForBlocker),
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
  const immersiveFramesObserved = report.performance?.immersiveFramesObserved ?? null;
  const batteryDropPercent = report.comfort?.batteryDropPercent ?? null;
  const avgFps = report.performance?.avgFps ?? null;
  const p95FrameMs = report.performance?.p95FrameMs ?? null;
  const minimumObservedFps = report.performance?.minimumObservedFps ?? null;
  const controllerSelectLatencyMs = report.performance?.controllerSelectLatencyMs ?? null;
  const traceLatencyProxy = report.traceLatencyProxy ?? null;
  const traceLastSelectLatencyMs = traceLatencyProxy?.lastSelectLatencyMs ?? null;
  const traceMeasuredAtMs = traceLatencyProxy?.measuredAtMs ?? null;
  const traceLastTraceTag = traceLatencyProxy?.lastTraceTag ?? null;
  const traceSourceXrControllerSelect = traceLatencyProxy?.source === "xr_controller_select";
  const traceLastTraceTagRecorded = typeof traceLastTraceTag === "string"
    && traceLastTraceTag.trim().length > 0;
  const traceSelectLatencyMsValid = isPositiveFiniteNumber(traceLastSelectLatencyMs);
  const traceMeasuredAtMsValid = isNonNegativeFiniteNumber(traceMeasuredAtMs);
  const headsetInputObserved = hasObservedHeadsetInput(report.input);
  const locomotionObserved = hasObservedLocomotion(report.input);
  const framesObservedValid = isNonNegativeInteger(framesObserved);
  const sampleWindowSizeValid = isNonNegativeInteger(sampleWindowSize);
  const immersiveFramesObservedValid = isNonNegativeInteger(immersiveFramesObserved);
  const immersiveFrameSampleReady = immersiveFramesObservedValid && immersiveFramesObserved >= 600;
  const sampleWindowWithinObservedFrames = framesObservedValid
    && sampleWindowSizeValid
    && sampleWindowSize <= framesObserved;
  const sampleWindowWithinImmersiveFrames = immersiveFramesObservedValid
    && sampleWindowSizeValid
    && sampleWindowSize <= immersiveFramesObserved;
  const rollingFrameWindowReady = sampleWindowWithinObservedFrames
    && sampleWindowWithinImmersiveFrames
    && sampleWindowSize >= 120;
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
  const controllerSelectLatencyMatchesTrace = controllerSelectLatencyMsValid && traceSelectLatencyMsValid
    ? Math.abs(controllerSelectLatencyMs - traceLastSelectLatencyMs) <= 1
    : false;
  const controllerSelectLatencyReady = controllerSelectLatencyMsValid
    && controllerSelectLatencyMs <= 150
    && traceSourceXrControllerSelect
    && traceLastTraceTagRecorded
    && traceSelectLatencyMsValid
    && traceMeasuredAtMsValid
    && controllerSelectLatencyMatchesTrace;
  const batteryDropPercentValid = isPercentInRange(batteryDropPercent);
  const motionComfortConfirmed = isMotionComfortConfirmed(report.comfort?.motionComfort);
  const blockers = unique([
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
    typeof immersiveFramesObserved === "number" && !immersiveFramesObservedValid
      ? "immersive_frames_observed_not_non_negative_integer"
      : undefined,
    report.station?.immersiveSessionStarted === true
    && (immersiveFramesObserved === null || (immersiveFramesObservedValid && immersiveFramesObserved <= 0))
      ? "immersive_frame_count_zero_or_missing"
      : undefined,
    report.station?.immersiveSessionStarted === true
    && (immersiveFramesObserved === null || (immersiveFramesObservedValid && immersiveFramesObserved < 600))
      ? "immersive_frame_sample_under_600_or_missing"
      : undefined,
    typeof sampleWindowSize === "number" && !sampleWindowSizeValid ? "rolling_frame_window_not_non_negative_integer" : undefined,
    sampleWindowSizeValid && framesObservedValid && sampleWindowSize > framesObserved ? "rolling_frame_window_exceeds_frames_observed" : undefined,
    sampleWindowSizeValid && immersiveFramesObservedValid && sampleWindowSize > immersiveFramesObserved
      ? "rolling_frame_window_exceeds_immersive_frames_observed"
      : undefined,
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
    traceSourceXrControllerSelect ? undefined : "controller_select_trace_source_not_xr_controller_select",
    traceLastTraceTagRecorded ? undefined : "controller_select_trace_tag_missing",
    traceSelectLatencyMsValid ? undefined : "controller_select_trace_latency_missing",
    traceMeasuredAtMsValid ? undefined : "controller_select_trace_measured_at_missing",
    controllerSelectLatencyMsValid && traceSelectLatencyMsValid && !controllerSelectLatencyMatchesTrace
      ? "controller_select_latency_mismatch"
      : undefined,
    traceLatencyProxy?.productionControllerLatencySubstitute === true
      ? "trace_latency_proxy_marked_as_production_substitute"
      : undefined,
    motionComfortConfirmed ? undefined : "motion_comfort_not_confirmed",
    report.comfort?.heatConcern === false ? undefined : "heat_concern_not_cleared",
    typeof batteryDropPercent === "number" && !batteryDropPercentValid ? "battery_drop_not_finite_range_0_to_100" : undefined,
    batteryDropPercent === null ? "battery_drop_not_recorded" : undefined,
    batteryDropPercentValid && batteryDropPercent > 20 ? "battery_drop_above_20" : undefined,
    ...normalizedPayload.blockers,
  ].filter((blocker): blocker is string => typeof blocker === "string"));
  const adversarialFindings = unique([
    ...buildAdversarialFindings({
      report,
      durationMinutes,
      framesObserved,
      framesObservedValid,
      heatConcern: report.comfort?.heatConcern,
      traceLatencyProxy,
    }),
    ...normalizedPayload.adversarialFindings,
  ]);

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
      report.station?.immersiveSessionStarted === true && immersiveFramesObservedValid && immersiveFramesObserved > 0
        ? "immersive_frame_count_recorded"
        : undefined,
      immersiveFrameSampleReady ? "immersive_frame_sample_600_or_more" : undefined,
      rollingFrameWindowReady ? "rolling_frame_window_120_or_more" : undefined,
      avgFpsPlausible && avgFps >= 72 ? "average_fps_72_or_higher" : undefined,
      minimumObservedFpsPlausible && minimumFpsAtOrBelowAverage && minimumObservedFps >= 60 ? "minimum_fps_60_or_higher" : undefined,
      p95FrameMsValid && p95FrameMs <= 25 ? "p95_frame_ms_25_or_lower" : undefined,
      controllerSelectLatencyReady ? "controller_select_latency_150ms_or_lower" : undefined,
      traceSourceXrControllerSelect
      && traceLastTraceTagRecorded
      && traceSelectLatencyMsValid
      && traceMeasuredAtMsValid
        ? "xr_controller_select_trace_latency_recorded"
        : undefined,
      controllerSelectLatencyMatchesTrace ? "controller_select_latency_matches_trace_proxy" : undefined,
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

function normalizeQuestManualPerformancePayload(payload: QuestManualPerformancePayload | undefined): {
  report: QuestManualPerformanceReport | undefined;
  blockers: string[];
  adversarialFindings: string[];
} {
  if (!payload) {
    return { report: undefined, blockers: [], adversarialFindings: [] };
  }
  if (!isCopiedManualPerformancePayload(payload)) {
    return { report: payload, blockers: [], adversarialFindings: [] };
  }

  const report = isRecord(payload.manualPerformanceDraft)
    ? payload.manualPerformanceDraft as QuestManualPerformanceReport
    : undefined;
  const captureSummary = isRecord(payload.captureSummary) ? payload.captureSummary : undefined;
  const summaryBlockers = Array.isArray(captureSummary?.blockers)
    ? captureSummary.blockers.filter((blocker): blocker is string => typeof blocker === "string")
    : [];
  const blockers = unique([
    report ? undefined : "copied_payload_missing_manual_performance_draft",
    captureSummary ? undefined : "copied_payload_capture_summary_missing",
    captureSummary && captureSummary.manualValidationReady !== true ? "copied_payload_summary_not_ready" : undefined,
    captureSummary && captureSummary.draftAvailable !== true ? "copied_payload_summary_missing_draft_or_frame_stats" : undefined,
    captureSummary?.frameStatsFresh === true ? undefined : "frame_stats_stale_or_unsampled",
    ...summaryBlockers,
  ].filter((blocker): blocker is string => typeof blocker === "string"));

  return {
    report,
    blockers,
    adversarialFindings: ["copied_ui_manual_performance_payload"],
  };
}

function isCopiedManualPerformancePayload(payload: QuestManualPerformancePayload): payload is QuestManualPerformanceCopiedPayload {
  return isRecord(payload) && "manualPerformanceDraft" in payload;
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
  const handGestureTimestampWithoutActiveSource = typeof input.report.input?.lastLocomotionAtMs === "number"
    && input.report.input?.xrHandGestureState !== undefined
    && input.report.input.activeLocomotionSource !== "xr_hand_gesture"
    && input.report.input.activeLocomotionSource !== "mixed";
  const immersiveWithNoFrameStats = input.report.station?.immersiveSessionStarted === true
    && input.framesObservedValid
    && input.framesObserved === 0;
  const traceLatencyProxy = input.traceLatencyProxy;

  return [
    input.report.setup?.devtoolsScreencastDisabled === false ? "devtools_screencast_enabled_during_run" : undefined,
    primitiveHandModelObserved ? "hand_tracking_uses_primitive_box_model" : undefined,
    primitiveHandModelObserved && handTrackingObserved ? "hand_tracking_observed_without_realistic_hand_meshes" : undefined,
    locomotionModeDeclared && locomotionEventMissing ? "locomotion_mode_declared_without_locomotion_event" : undefined,
    handGestureTimestampWithoutActiveSource ? "hand_gesture_locomotion_timestamp_without_active_source" : undefined,
    immersiveWithNoFrameStats ? "immersive_session_started_but_frame_stats_empty" : undefined,
    traceLatencyProxy
    && isKnownTraceLatencySource(traceLatencyProxy.source)
    && traceLatencyProxy.lastSelectLatencyMs === null
      ? "trace_latency_proxy_not_measured"
      : undefined,
    input.heatConcern === undefined || input.heatConcern === null ? "heat_observation_not_recorded" : undefined,
    input.durationMinutes < 10 ? "short_run_under_reliability_window" : undefined,
  ].filter((finding): finding is string => typeof finding === "string");
}

function questManualNextStepForAdversarialFinding(finding: string): string {
  switch (finding) {
    case "copied_ui_manual_performance_payload":
      return "The checker accepted the copied in-app payload; preserve the manualPerformanceDraft and captureSummary fields for auditability.";
    case "devtools_screencast_enabled_during_run":
      return "Rerun with DevTools screencast disabled so headset frame timing is less distorted.";
    case "hand_tracking_uses_primitive_box_model":
    case "hand_tracking_observed_without_realistic_hand_meshes":
      return "Replace primitive box hands with an articulated hand model or document why controller-only affordances are acceptable for this station.";
    case "locomotion_mode_declared_without_locomotion_event":
      return "Record an actual locomotion event timestamp after thumbstick, hand-gesture, or room-scale movement.";
    case "hand_gesture_locomotion_timestamp_without_active_source":
      return "Re-copy the Quest evidence after deliberate hand-gesture locomotion is armed and active, or clear the locomotion timestamp.";
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
    case "immersive_frames_observed_not_non_negative_integer":
      return "Record immersiveFramesObserved as a non-negative integer.";
    case "immersive_frame_count_zero_or_missing":
      return "Copy the in-app Quest Evidence payload after entering Full VR and confirm performance.immersiveFramesObserved is greater than zero.";
    case "immersive_frame_sample_under_600_or_missing":
      return "Observe at least 600 immersive Full VR frames before claiming headset frame pacing.";
    case "rolling_frame_window_not_non_negative_integer":
      return "Record sampleWindowSize as a non-negative integer.";
    case "rolling_frame_window_exceeds_frames_observed":
      return "Keep the rolling frame window at or below framesObserved.";
    case "rolling_frame_window_exceeds_immersive_frames_observed":
      return "Copy the evidence after the rolling frame window is fully backed by immersive Full VR frames.";
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
    case "controller_select_trace_source_not_xr_controller_select":
      return "Record controller latency from the xr_controller_select headset trace path, not a DOM click or desktop proxy.";
    case "controller_select_trace_tag_missing":
      return "Record the trace tag triggered by the headset controller or deliberate hand-select event.";
    case "controller_select_trace_latency_missing":
      return "Record positive lastSelectLatencyMs from the xr_controller_select trace event.";
    case "controller_select_trace_measured_at_missing":
      return "Record measuredAtMs for the xr_controller_select trace event.";
    case "controller_select_latency_mismatch":
      return "Copy controller-select latency from the same xr_controller_select trace event used for the Trace row.";
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
    case "copied_payload_missing_manual_performance_draft":
      return "Copy the full in-app Quest Evidence JSON payload, including manualPerformanceDraft.";
    case "copied_payload_capture_summary_missing":
      return "Copy the full in-app Quest Evidence JSON payload, including captureSummary.";
    case "copied_payload_summary_not_ready":
      return "Resolve the copied captureSummary blockers before using the payload as readiness evidence.";
    case "copied_payload_summary_missing_draft_or_frame_stats":
      return "Copy the in-app Quest Evidence payload after the draft and frame stats are both available.";
    case "frame_stats_stale_or_unsampled":
      return "Keep the headset foreground and copy the evidence only while frameStatsFresh is true.";
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

function isNonNegativeFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

  return typeof value?.lastLocomotionAtMs === "number"
    && Number.isFinite(value.lastLocomotionAtMs)
    && value.lastLocomotionAtMs >= 0
    && hasLocomotionSource;
}

function isFullVrExperienceEvidence(value: QuestManualPerformanceReport["experience"]): boolean {
  return value?.modeId === "full_vr"
    && value.phaseLabel === "Phase 1 Full VR"
    && value.requestedSessionMode === "immersive-vr"
    && value.mixedRealityPassthroughImplemented === false;
}

function isSupportingTraceLatencyProxy(value: QuestManualPerformanceReport["traceLatencyProxy"]): boolean {
  if (!value) {
    return false;
  }

  return isKnownTraceLatencySource(value.source)
    && value.productionControllerLatencySubstitute === false
    && isPositiveFiniteNumber(value.lastSelectLatencyMs ?? null);
}

function isKnownTraceLatencySource(value: string | undefined): boolean {
  return value === "dom_click_trace_button" || value === "xr_controller_select";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
