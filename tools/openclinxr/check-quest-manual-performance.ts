import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";

type CliOptions = {
  inputPath?: string;
  outputPath: string;
};

type QuestTraceInteractionAttempt =
  | "not_attempted"
  | "dom_click_attempted_no_runtime_event"
  | "xr_controller_select_attempted_no_runtime_event"
  | "xr_hand_select_attempted_no_runtime_event"
  | "runtime_event_observed";

type QuestLocomotionAttempt =
  | "not_attempted"
  | "keyboard_attempted_no_runtime_event"
  | "thumbstick_attempted_no_runtime_event"
  | "hand_gesture_attempted_no_runtime_event"
  | "room_scale_attempted_no_runtime_event"
  | "mixed_attempted_no_runtime_event"
  | "runtime_event_observed";

type QuestHandRepresentationKind = "primitive_boxes" | "primitive_spheres" | "mesh" | "controller_only" | "not_visible" | "unknown";
type QuestHandModelStatus = "pending_immersive_session" | "installed" | "failed";
type QuestLocomotionProbeReasonCode =
  | "locomotion_observed"
  | "active_vector_without_rig_delta"
  | "no_gamepad_sources"
  | "gamepad_axes_below_deadzone"
  | "hand_not_pinching"
  | "hand_arming_dwell"
  | "hand_missing_joints"
  | "hand_below_deadzone"
  | "hand_turn_cooldown"
  | "hand_other_locomotion_source_active"
  | "no_xr_input_sources"
  | "locomotion_delta_missing";

const expectedFullVrHandTrackingPosture = "optional_feature_with_local_mesh_hand_model_and_primitive_fallback";
const expectedFullVrLocomotionPosture = "room_scale_keyboard_thumbstick_and_hand_gesture_dolly";

const validQuestTraceInteractionAttempts = new Set<string>([
  "not_attempted",
  "dom_click_attempted_no_runtime_event",
  "xr_controller_select_attempted_no_runtime_event",
  "xr_hand_select_attempted_no_runtime_event",
  "runtime_event_observed",
]);

const validQuestLocomotionAttempts = new Set<string>([
  "not_attempted",
  "keyboard_attempted_no_runtime_event",
  "thumbstick_attempted_no_runtime_event",
  "hand_gesture_attempted_no_runtime_event",
  "room_scale_attempted_no_runtime_event",
  "mixed_attempted_no_runtime_event",
  "runtime_event_observed",
]);

const validQuestHandRepresentationKinds = new Set<string>([
  "primitive_boxes",
  "primitive_spheres",
  "mesh",
  "controller_only",
  "not_visible",
  "unknown",
]);

const validQuestHandModelStatuses = new Set<string>([
  "pending_immersive_session",
  "installed",
  "failed",
]);

const validQuestLocomotionProbeReasonCodes = new Set<string>([
  "locomotion_observed",
  "active_vector_without_rig_delta",
  "no_gamepad_sources",
  "gamepad_axes_below_deadzone",
  "hand_not_pinching",
  "hand_arming_dwell",
  "hand_missing_joints",
  "hand_below_deadzone",
  "hand_turn_cooldown",
  "hand_other_locomotion_source_active",
  "no_xr_input_sources",
  "locomotion_delta_missing",
]);

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
    traceInteractionAttempt?: QuestTraceInteractionAttempt;
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
    handModelStatus?: QuestHandModelStatus;
    handRepresentationKind?: QuestHandRepresentationKind;
    handInputsObserved?: number;
    locomotionMode?: string;
    locomotionAttempt?: QuestLocomotionAttempt;
    activeLocomotionSource?: "none" | "keyboard" | "xr_gamepad" | "xr_hand_gesture" | "xr_room_scale" | "mixed";
    locomotionDiagnostics?: {
      claimScope?: "attempt_diagnostics_only";
      gamepadDeadzone?: number;
      handPinchThresholdMeters?: number;
      handGestureDeadzoneMeters?: number;
      handGestureTurnDeadzoneMeters?: number;
      gamepadSources?: Array<{
        handedness?: string;
        rawAxes?: number[];
        selectedXAxisIndex?: number | null;
        selectedYAxisIndex?: number | null;
        xAxisAfterDeadzone?: number;
        yAxisAfterDeadzone?: number;
        activeAfterDeadzone?: boolean;
        contribution?: "move" | "turn";
      }>;
      handGestureHands?: Array<{
        handedness?: "left" | "right";
        jointsVisible?: {
          wrist?: boolean;
          indexTip?: boolean;
          thumbTip?: boolean;
        };
        pinchDistanceMeters?: number | null;
        pinching?: boolean;
        armed?: boolean;
        dwellMs?: number;
        relativeOffsetMeters?: { x?: number; z?: number } | null;
        movementCrossedDeadzone?: boolean;
        blockedReason?: string;
      }>;
    };
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
    locomotionDelta?: {
      from?: {
        x?: number;
        z?: number;
        yawRadians?: number;
      };
      to?: {
        x?: number;
        z?: number;
        yawRadians?: number;
      };
      delta?: {
        x?: number;
        z?: number;
        yawRadians?: number;
      };
      distanceMeters?: number;
      turnRadians?: number;
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
  reproducibility?: {
    source?: string;
    url?: string;
    userAgent?: string;
    browserVersionHints?: {
      oculusBrowser?: string | null;
      chrome?: string | null;
    };
    app?: {
      packageName?: string;
      version?: string;
      gitCommit?: string;
      buildTime?: string;
      mode?: string;
    };
    webXr?: {
      navigatorXrPresent?: boolean;
      immersiveVrSupported?: boolean | null;
      immersiveVrSupportCheckedAtMs?: number | null;
      immersiveArSupported?: boolean | null;
      immersiveArSupportCheckedAtMs?: number | null;
      supportError?: string | null;
    };
    display?: {
      viewportWidth?: number;
      viewportHeight?: number;
      screenWidth?: number | null;
      screenHeight?: number | null;
      devicePixelRatio?: number;
      visibilityState?: string;
    };
    limitations?: string[];
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
    technicalGaps?: string[];
    locomotionProbeSummary?: {
      claimScope?: "runtime_probe_only";
      readiness?: "ready" | "blocked";
      primaryReason?: string;
      reasonCodes?: string[];
    } | null;
  } | null;
  textPanelEvidence?: {
    source?: string;
    panelCount?: number;
    panels?: Array<{
      name?: string;
      lineCount?: number;
      readabilityClaim?: string;
    }>;
  } | null;
  harvestSummary?: {
    source?: string;
    ready?: boolean;
    timedOut?: boolean;
    blockers?: string[];
    elapsedWallMs?: number | null;
    signalSnapshot?: QuestManualPerformanceHarvestSignalSnapshot | null;
  } | null;
};

export type QuestManualPerformancePayload = QuestManualPerformanceReport | QuestManualPerformanceCopiedPayload;
type QuestManualLocomotionDelta = NonNullable<NonNullable<QuestManualPerformanceReport["input"]>["locomotionDelta"]>;
export type QuestManualPerformanceHarvestSignalSnapshot = {
  textPanelMetadataPresent: boolean;
  textPanelCount: number | null;
  frameStatsFresh: boolean;
  immersiveFramesObserved: number | null;
  sampleWindowSize: number | null;
  immersiveFrameReady: boolean;
  sampleWindowReady: boolean;
  traceSource: string | null;
  lastTraceTag: string | null;
  lastTraceLatencyMs: number | null;
  headsetTraceEvidencePresent: boolean;
  activeLocomotionSource: string | null;
  locomotionAttempt: string | null;
  lastLocomotionAtMs: number | null;
  locomotionDistanceMeters: number | null;
  locomotionTurnRadians: number | null;
  locomotionEvidencePresent: boolean;
  locomotionProbeReasonCodes: string[];
  technicalGaps: string[];
};
export type QuestManualPerformanceHarvestSummary = NonNullable<QuestManualPerformanceCopiedPayload["harvestSummary"]>;

export type QuestManualPerformanceCheck = {
  generatedAt: string;
  inputFile: string | null;
  evidencePosture: QuestManualPerformanceEvidencePosture;
  readyToClaimFramePacing: boolean;
  satisfiedConditions: string[];
  blockers: string[];
  adversarialFindings: string[];
  nextSteps: string[];
  harvestSummary?: QuestManualPerformanceHarvestSummary;
};

export type QuestManualPerformanceEvidencePosture =
  | "missing_manual_report"
  | "blocked_manual_observation"
  | "early_worn_headset_full_vr_observation"
  | "full_vr_frame_pacing_readiness";

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
      evidencePosture: "missing_manual_report",
      readyToClaimFramePacing: false,
      satisfiedConditions: [],
      blockers,
      adversarialFindings: [],
      nextSteps: blockers.map(questManualNextStepForBlocker),
      ...(normalizedPayload.harvestSummary ? { harvestSummary: normalizedPayload.harvestSummary } : {}),
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
  const traceSourceXrHandSelect = traceLatencyProxy?.source === "xr_hand_select";
  const traceSourceXrHeadsetSelect = traceSourceXrControllerSelect || traceSourceXrHandSelect;
  const traceLastTraceTagRecorded = typeof traceLastTraceTag === "string"
    && traceLastTraceTag.trim().length > 0;
  const traceSelectLatencyMsValid = isPositiveFiniteNumber(traceLastSelectLatencyMs);
  const traceMeasuredAtMsValid = isNonNegativeFiniteNumber(traceMeasuredAtMs);
  const traceInteractionAttemptValid = report.station?.traceInteractionAttempt === undefined
    || validQuestTraceInteractionAttempts.has(report.station.traceInteractionAttempt);
  const locomotionAttemptValid = report.input?.locomotionAttempt === undefined
    || validQuestLocomotionAttempts.has(report.input.locomotionAttempt);
  const handRepresentationKindValid = report.input?.handRepresentationKind === undefined
    || validQuestHandRepresentationKinds.has(report.input.handRepresentationKind);
  const handModelStatusValid = report.input?.handModelStatus === undefined
    || validQuestHandModelStatuses.has(report.input.handModelStatus);
  const currentFullVrHandTrackingPosture = report.experience?.handTrackingPosture === expectedFullVrHandTrackingPosture;
  const currentFullVrLocomotionPosture = report.experience?.locomotionPosture === expectedFullVrLocomotionPosture;
  const headsetInputObserved = hasObservedHeadsetInput(report.input);
  const locomotionObserved = hasObservedLocomotion(report.input);
  const operatorNotesContradictLocomotionEvidence = locomotionObserved
    && notesContradictLocomotion(report.runContext?.notes);
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
    && traceSourceXrHeadsetSelect
    && traceLastTraceTagRecorded
    && traceSelectLatencyMsValid
    && traceMeasuredAtMsValid
    && controllerSelectLatencyMatchesTrace;
  const reproducibilityEvidence = buildReproducibilityEvidence(report.reproducibility);
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
    traceInteractionAttemptValid ? undefined : "trace_interaction_attempt_invalid",
    isFullVrExperienceEvidence(report.experience) ? undefined : "experience_mode_full_vr_not_recorded",
    currentFullVrHandTrackingPosture ? undefined : "hand_tracking_posture_not_current_mesh_or_fallback",
    currentFullVrLocomotionPosture ? undefined : "locomotion_posture_not_current_room_scale_contract",
    handModelStatusValid ? undefined : "hand_model_status_invalid",
    handRepresentationKindValid ? undefined : "hand_representation_kind_invalid",
    locomotionAttemptValid ? undefined : "locomotion_attempt_invalid",
    headsetInputObserved ? undefined : "hand_or_controller_input_not_observed",
    locomotionObserved ? undefined : "locomotion_not_observed",
    operatorNotesContradictLocomotionEvidence ? "operator_notes_contradict_locomotion_evidence" : undefined,
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
    traceSourceXrHeadsetSelect ? undefined : "controller_select_trace_source_not_xr_controller_select",
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
      locomotionObserved,
    }),
    ...reproducibilityEvidence.adversarialFindings,
    ...normalizedPayload.adversarialFindings,
  ]);

  const readyToClaimFramePacing = blockers.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    inputFile: inputFile ?? null,
    evidencePosture: questManualEvidencePosture(report, readyToClaimFramePacing),
    readyToClaimFramePacing,
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
      traceSourceXrHandSelect
      && traceLastTraceTagRecorded
      && traceSelectLatencyMsValid
      && traceMeasuredAtMsValid
        ? "xr_hand_select_trace_latency_recorded"
        : undefined,
      controllerSelectLatencyMatchesTrace ? "controller_select_latency_matches_trace_proxy" : undefined,
      isFullVrExperienceEvidence(report.experience) ? "experience_mode_full_vr_recorded" : undefined,
      currentFullVrHandTrackingPosture ? "hand_tracking_posture_current_mesh_or_fallback" : undefined,
      currentFullVrLocomotionPosture ? "locomotion_posture_current_room_scale_contract" : undefined,
      headsetInputObserved ? "hand_or_controller_input_observed" : undefined,
      locomotionObserved ? "locomotion_observed" : undefined,
      isSupportingTraceLatencyProxy(traceLatencyProxy) ? "trace_latency_proxy_recorded_as_supporting_evidence" : undefined,
      ...reproducibilityEvidence.satisfiedConditions,
      motionComfortConfirmed ? "motion_comfort_confirmed" : undefined,
      batteryDropPercentValid && batteryDropPercent <= 20 ? "battery_drop_recorded_under_20" : undefined,
    ].filter((condition): condition is string => typeof condition === "string"),
    blockers,
    adversarialFindings,
    nextSteps: unique([
      ...blockers.map(questManualNextStepForBlocker),
      ...adversarialFindings.map(questManualNextStepForAdversarialFinding),
    ]),
    ...(normalizedPayload.harvestSummary ? { harvestSummary: normalizedPayload.harvestSummary } : {}),
  };
}

function questManualEvidencePosture(
  report: QuestManualPerformanceReport,
  readyToClaimFramePacing: boolean,
): QuestManualPerformanceEvidencePosture {
  if (readyToClaimFramePacing) {
    return "full_vr_frame_pacing_readiness";
  }

  const fullVrObservationRecorded = isFullVrExperienceEvidence(report.experience)
    && (
      report.station?.immersiveSessionStarted === true
      || report.station?.textReadable === true
      || hasObservedHeadsetInput(report.input)
    );

  return fullVrObservationRecorded
    ? "early_worn_headset_full_vr_observation"
    : "blocked_manual_observation";
}

function normalizeQuestManualPerformancePayload(payload: QuestManualPerformancePayload | undefined): {
  report: QuestManualPerformanceReport | undefined;
  blockers: string[];
  adversarialFindings: string[];
  harvestSummary?: QuestManualPerformanceHarvestSummary;
} {
  if (!payload) {
    return { report: undefined, blockers: [], adversarialFindings: [] };
  }
  if (!isCopiedManualPerformancePayload(payload)) {
    const rawReport = payload as QuestManualPerformanceReport;
    return {
      report: rawReport,
      blockers: [],
      adversarialFindings: isRecord(rawReport.reproducibility) ? [] : ["raw_manual_report_without_copied_ui_payload"],
    };
  }

  const report = isRecord(payload.manualPerformanceDraft)
    ? payload.manualPerformanceDraft as QuestManualPerformanceReport
    : undefined;
  const captureSummary = isRecord(payload.captureSummary) ? payload.captureSummary : undefined;
  const summaryBlockers = Array.isArray(captureSummary?.blockers)
    ? captureSummary.blockers.filter((blocker): blocker is string => typeof blocker === "string")
    : [];
  const summaryTechnicalGaps = Array.isArray(captureSummary?.technicalGaps)
    ? captureSummary.technicalGaps.filter((gap): gap is string => typeof gap === "string")
    : [];
  const textPanelEvidence = isRecord(payload.textPanelEvidence) ? payload.textPanelEvidence : undefined;
  const textPanelMetadataPresent = hasCopiedTextPanelMetadataEvidence(textPanelEvidence);
  const locomotionProbeSummary = isRecord(captureSummary?.locomotionProbeSummary)
    ? captureSummary.locomotionProbeSummary
    : undefined;
  const locomotionProbeReasonCodes = Array.isArray(locomotionProbeSummary?.reasonCodes)
    ? locomotionProbeSummary.reasonCodes.filter((reason): reason is QuestLocomotionProbeReasonCode =>
      typeof reason === "string" && validQuestLocomotionProbeReasonCodes.has(reason)
    )
    : [];
  const invalidLocomotionProbeReasonCodes = Array.isArray(locomotionProbeSummary?.reasonCodes)
    ? locomotionProbeSummary.reasonCodes.filter((reason): reason is string =>
      typeof reason === "string" && !validQuestLocomotionProbeReasonCodes.has(reason)
    )
    : [];
  const locomotionProbePrimaryReasonInvalid = typeof locomotionProbeSummary?.primaryReason === "string"
    && !validQuestLocomotionProbeReasonCodes.has(locomotionProbeSummary.primaryReason);
  const hasHarvestSummary = "harvestSummary" in payload;
  const harvestSummary = isRecord(payload.harvestSummary) ? payload.harvestSummary : undefined;
  const harvestBlockers = Array.isArray(harvestSummary?.blockers)
    ? harvestSummary.blockers.filter((blocker): blocker is string => typeof blocker === "string")
    : [];
  const blockers = unique([
    report ? undefined : "copied_payload_missing_manual_performance_draft",
    captureSummary ? undefined : "copied_payload_capture_summary_missing",
    captureSummary && captureSummary.manualValidationReady !== true ? "copied_payload_summary_not_ready" : undefined,
    captureSummary && captureSummary.draftAvailable !== true ? "copied_payload_summary_missing_draft_or_frame_stats" : undefined,
    captureSummary?.frameStatsFresh === true ? undefined : "frame_stats_stale_or_unsampled",
    report?.station?.textReadable === true && !textPanelMetadataPresent ? "copied_payload_text_panel_metadata_missing" : undefined,
    summaryTechnicalGaps.length > 0 ? "copied_payload_technical_gaps_present" : undefined,
    ...summaryTechnicalGaps.map((gap) => `copied_payload_technical_gap:${gap}`),
    locomotionProbeSummary && locomotionProbeSummary.claimScope !== "runtime_probe_only"
      ? "copied_payload_locomotion_probe_scope_invalid"
      : undefined,
    locomotionProbePrimaryReasonInvalid
      ? `copied_payload_locomotion_probe_reason_invalid:${locomotionProbeSummary.primaryReason}`
      : undefined,
    ...invalidLocomotionProbeReasonCodes.map((reason) => `copied_payload_locomotion_probe_reason_invalid:${reason}`),
    ...locomotionProbeReasonCodes
      .filter((reason) => reason !== "locomotion_observed")
      .map((reason) => `copied_payload_locomotion_probe:${reason}`),
    hasHarvestSummary && !harvestSummary ? "manual_evidence_harvest_summary_invalid" : undefined,
    harvestSummary && harvestSummary.ready !== true ? "manual_evidence_harvest_not_ready" : undefined,
    harvestSummary?.timedOut === true ? "manual_evidence_harvest_timed_out" : undefined,
    ...summaryBlockers,
    ...harvestBlockers,
  ].filter((blocker): blocker is string => typeof blocker === "string"));

  return {
    report,
    blockers,
    adversarialFindings: [
      "copied_ui_manual_performance_payload",
      locomotionProbeSummary?.claimScope === "runtime_probe_only" ? "locomotion_probe:runtime_probe_only" : undefined,
      harvestSummary ? "cdp_manual_evidence_harvest_payload" : undefined,
    ].filter((finding): finding is string => typeof finding === "string"),
    ...(harvestSummary ? { harvestSummary: sanitizeHarvestSummary(harvestSummary) } : {}),
  };
}

function isCopiedManualPerformancePayload(payload: QuestManualPerformancePayload): payload is QuestManualPerformanceCopiedPayload {
  return isRecord(payload) && "manualPerformanceDraft" in payload;
}

function hasCopiedTextPanelMetadataEvidence(value: Record<string, unknown> | undefined): boolean {
  const panels = Array.isArray(value?.panels) ? value.panels.filter(isRecord) : [];
  const panelCount = typeof value?.panelCount === "number" ? value.panelCount : panels.length;

  return value?.source === "window.__openClinXrTextPanelEvidence"
    && panelCount >= 3
    && panels.length >= 3
    && panels.every((panel) => typeof panel.name === "string"
      && typeof panel.lineCount === "number"
      && panel.lineCount > 0
      && panel.readabilityClaim === "metadata_only_requires_foreground_headset_confirmation");
}

function sanitizeHarvestSummary(
  value: Record<string, unknown>,
): QuestManualPerformanceHarvestSummary {
  return {
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.ready === "boolean" ? { ready: value.ready } : {}),
    ...(typeof value.timedOut === "boolean" ? { timedOut: value.timedOut } : {}),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.filter((blocker): blocker is string => typeof blocker === "string")
      : [],
    elapsedWallMs: typeof value.elapsedWallMs === "number" && Number.isFinite(value.elapsedWallMs)
      ? value.elapsedWallMs
      : null,
    signalSnapshot: sanitizeHarvestSignalSnapshot(value.signalSnapshot),
  };
}

function sanitizeHarvestSignalSnapshot(value: unknown): QuestManualPerformanceHarvestSignalSnapshot | null {
  const record = isRecord(value) ? value : undefined;
  if (!record) {
    return null;
  }

  return {
    textPanelMetadataPresent: record.textPanelMetadataPresent === true,
    textPanelCount: finiteNumberOrNull(record.textPanelCount),
    frameStatsFresh: record.frameStatsFresh === true,
    immersiveFramesObserved: finiteNumberOrNull(record.immersiveFramesObserved),
    sampleWindowSize: finiteNumberOrNull(record.sampleWindowSize),
    immersiveFrameReady: record.immersiveFrameReady === true,
    sampleWindowReady: record.sampleWindowReady === true,
    traceSource: stringOrNull(record.traceSource),
    lastTraceTag: stringOrNull(record.lastTraceTag),
    lastTraceLatencyMs: finiteNumberOrNull(record.lastTraceLatencyMs),
    headsetTraceEvidencePresent: record.headsetTraceEvidencePresent === true,
    activeLocomotionSource: stringOrNull(record.activeLocomotionSource),
    locomotionAttempt: stringOrNull(record.locomotionAttempt),
    lastLocomotionAtMs: finiteNumberOrNull(record.lastLocomotionAtMs),
    locomotionDistanceMeters: finiteNumberOrNull(record.locomotionDistanceMeters),
    locomotionTurnRadians: finiteNumberOrNull(record.locomotionTurnRadians),
    locomotionEvidencePresent: record.locomotionEvidencePresent === true,
    locomotionProbeReasonCodes: stringArray(record.locomotionProbeReasonCodes),
    technicalGaps: stringArray(record.technicalGaps),
  };
}

function buildAdversarialFindings(input: {
  report: QuestManualPerformanceReport;
  durationMinutes: number;
  framesObserved: number | null;
  framesObservedValid: boolean;
  heatConcern: boolean | null | undefined;
  traceLatencyProxy: QuestManualPerformanceReport["traceLatencyProxy"];
  locomotionObserved: boolean;
}): string[] {
  const notes = input.report.runContext?.notes ?? "";
  const handTrackingPosture = input.report.experience?.handTrackingPosture ?? "";
  const traceAttempt = input.report.station?.traceInteractionAttempt;
  const locomotionAttempt = input.report.input?.locomotionAttempt;
  const handRepresentationKind = input.report.input?.handRepresentationKind;
  const headsetInputObserved = hasObservedHeadsetInput(input.report.input);
  const primitiveHandRepresentationObserved = handRepresentationKind === "primitive_boxes"
    || handRepresentationKind === "primitive_spheres";
  const primitiveHandModelObserved = primitiveHandRepresentationObserved
    || handTrackingPosture === "optional_feature_with_primitive_hand_model"
    || /series of boxes|not realistic/i.test(notes);
  const handTrackingObserved = headsetInputObserved
    && /hand tracking/i.test(notes);
  const locomotionModeDeclared = typeof input.report.input?.locomotionMode === "string"
    && input.report.input.locomotionMode.trim().length > 0;
  const locomotionEventMissing = typeof input.report.input?.lastLocomotionAtMs !== "number";
  const locomotionSourceDeclared = typeof input.report.input?.activeLocomotionSource === "string"
    && input.report.input.activeLocomotionSource !== "none";
  const locomotionDeltaMissing = !hasMeasurableLocomotionDelta(input.report.input?.locomotionDelta);
  const traceRuntimeEventEvidenceMissing = traceAttempt === "runtime_event_observed"
    && !hasRuntimeTraceEvidence(input.report);
  const handRepresentationKindMismatch = handRepresentationKind === "mesh" && primitiveHandModelObserved
    || primitiveHandRepresentationObserved && !headsetInputObserved;
  const handGestureTimestampWithoutActiveSource = typeof input.report.input?.lastLocomotionAtMs === "number"
    && input.report.input?.xrHandGestureState !== undefined
    && input.report.input.activeLocomotionSource !== "xr_hand_gesture"
    && input.report.input.activeLocomotionSource !== "xr_room_scale"
    && input.report.input.activeLocomotionSource !== "mixed";
  const immersiveWithNoFrameStats = input.report.station?.immersiveSessionStarted === true
    && input.framesObservedValid
    && input.framesObserved === 0;
  const traceLatencyProxy = input.traceLatencyProxy;

  return [
    input.report.setup?.devtoolsScreencastDisabled === false ? "devtools_screencast_enabled_during_run" : undefined,
    input.report.station?.traceInteractionPassed !== true && traceAttempt === undefined
      ? "trace_interaction_attempt_status_missing"
      : undefined,
    isAttemptedTraceWithoutRuntimeEvent(traceAttempt) ? "trace_interaction_attempted_without_runtime_event" : undefined,
    traceRuntimeEventEvidenceMissing ? "trace_attempt_runtime_event_without_trace_evidence" : undefined,
    headsetInputObserved && handRepresentationKind === undefined ? "hand_representation_kind_missing" : undefined,
    handRepresentationKindMismatch ? "hand_representation_kind_mismatch" : undefined,
    primitiveHandModelObserved ? "hand_tracking_uses_primitive_box_model" : undefined,
    primitiveHandModelObserved && handTrackingObserved ? "hand_tracking_observed_without_realistic_hand_meshes" : undefined,
    locomotionModeDeclared && locomotionAttempt === undefined ? "locomotion_attempt_status_missing" : undefined,
    isAttemptedLocomotionWithoutRuntimeEvent(locomotionAttempt) ? "locomotion_attempted_without_runtime_event" : undefined,
    locomotionAttempt === "runtime_event_observed" && !hasObservedLocomotion(input.report.input)
      ? "locomotion_runtime_event_without_threshold_evidence"
      : undefined,
    locomotionModeDeclared && locomotionEventMissing ? "locomotion_mode_declared_without_locomotion_event" : undefined,
    locomotionSourceDeclared && !locomotionEventMissing && locomotionDeltaMissing ? "locomotion_source_without_rig_delta" : undefined,
    handGestureTimestampWithoutActiveSource ? "hand_gesture_locomotion_timestamp_without_active_source" : undefined,
    input.locomotionObserved && notesContradictLocomotion(notes) ? "operator_notes_contradict_locomotion_evidence" : undefined,
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

function isAttemptedTraceWithoutRuntimeEvent(value: QuestTraceInteractionAttempt | undefined): boolean {
  return value === "dom_click_attempted_no_runtime_event"
    || value === "xr_controller_select_attempted_no_runtime_event"
    || value === "xr_hand_select_attempted_no_runtime_event";
}

function isAttemptedLocomotionWithoutRuntimeEvent(value: QuestLocomotionAttempt | undefined): boolean {
  return value === "keyboard_attempted_no_runtime_event"
    || value === "thumbstick_attempted_no_runtime_event"
    || value === "hand_gesture_attempted_no_runtime_event"
    || value === "room_scale_attempted_no_runtime_event"
    || value === "mixed_attempted_no_runtime_event";
}

function hasRuntimeTraceEvidence(report: QuestManualPerformanceReport): boolean {
  const traceLatencyProxy = report.traceLatencyProxy ?? null;
  const traceSourceXrHeadsetSelect = traceLatencyProxy?.source === "xr_controller_select"
    || traceLatencyProxy?.source === "xr_hand_select";
  return report.station?.traceInteractionPassed === true
    && traceSourceXrHeadsetSelect
    && isNonEmptyString(traceLatencyProxy?.lastTraceTag)
    && isPositiveFiniteNumber(traceLatencyProxy?.lastSelectLatencyMs ?? null)
    && isNonNegativeFiniteNumber(traceLatencyProxy?.measuredAtMs ?? null);
}

function questManualNextStepForAdversarialFinding(finding: string): string {
  switch (finding) {
    case "raw_manual_report_without_copied_ui_payload":
      return "Prefer the copied in-app Quest Evidence payload so frame stats, captureSummary, and reproducibility metadata come from the same runtime export.";
    case "copied_ui_manual_performance_payload":
      return "The checker accepted the copied in-app payload; preserve the manualPerformanceDraft and captureSummary fields for auditability.";
    case "cdp_manual_evidence_harvest_payload":
      return "Preserve harvestSummary with the copied payload so CDP harvest readiness remains auditable.";
    case "locomotion_probe:runtime_probe_only":
      return "Preserve captureSummary.locomotionProbeSummary so failed locomotion attempts keep their runtime-probe reason codes.";
    case "devtools_screencast_enabled_during_run":
      return "Rerun with DevTools screencast disabled so headset frame timing is less distorted.";
    case "trace_interaction_attempt_status_missing":
      return "Record station.traceInteractionAttempt so failed trace attempts distinguish not-attempted from attempted-without-runtime-event.";
    case "trace_interaction_attempted_without_runtime_event":
      return "Retry the in-headset trace action and preserve the resulting xr_controller_select or xr_hand_select runtime event.";
    case "trace_attempt_runtime_event_without_trace_evidence":
      return "Reconcile station.traceInteractionAttempt with the same headset trace tag, latency, and measuredAtMs evidence.";
    case "hand_representation_kind_missing":
      return "Record input.handRepresentationKind so hand-tracking quality is auditable without relying on prose notes.";
    case "hand_representation_kind_mismatch":
      return "Reconcile input.handRepresentationKind with observed hand model count, notes, and hand-tracking posture.";
    case "hand_tracking_uses_primitive_box_model":
    case "hand_tracking_observed_without_realistic_hand_meshes":
      return "Replace primitive box hands with an articulated hand model or document why controller-only affordances are acceptable for this station.";
    case "locomotion_attempt_status_missing":
      return "Record input.locomotionAttempt so failed locomotion attempts distinguish not-attempted from attempted-without-runtime-event.";
    case "locomotion_mode_declared_without_locomotion_event":
    case "locomotion_attempted_without_runtime_event":
      return "Retry thumbstick, hand-gesture, or room-scale locomotion and preserve the runtime locomotion event plus rig delta.";
    case "locomotion_runtime_event_without_threshold_evidence":
      return "Re-copy the Quest evidence after locomotion so the runtime event includes lastLocomotionAtMs and measurable locomotionDelta.";
    case "locomotion_source_without_rig_delta":
      return "Record locomotionDelta from the same accepted rig movement event as the active locomotion source.";
    case "hand_gesture_locomotion_timestamp_without_active_source":
      return "Re-copy the Quest evidence after deliberate hand-gesture locomotion is armed and active, or clear the locomotion timestamp.";
    case "operator_notes_contradict_locomotion_evidence":
      return "Reconcile operator locomotion notes with activeLocomotionSource, lastLocomotionAtMs, and locomotionDelta from the same headset run.";
    case "immersive_session_started_but_frame_stats_empty":
      return "Keep the headset foreground for a longer run and verify window.__openClinXrFrameStats increments while immersive mode is active.";
    case "trace_latency_proxy_not_measured":
      return "Capture a trace interaction or leave the proxy section explicitly unmeasured with a note.";
    case "heat_observation_not_recorded":
      return "Record heatConcern as false or true after the worn-headset run.";
    case "short_run_under_reliability_window":
      return "Repeat the run for at least 10 minutes before using it as readiness evidence.";
    case "reproducibility_metadata_missing":
      return "Prefer the copied in-app Quest Evidence payload so URL, user agent, app build, WebXR support, and display context are preserved as audit metadata.";
    case "reproducibility_source_not_browser_runtime":
      return "Re-copy Quest Evidence from the runtime browser so reproducibility.source is browser_runtime.";
    case "reproducibility_url_missing":
      return "Preserve reproducibility.url from the runtime browser location.";
    case "reproducibility_browser_version_missing":
      return "Preserve reproducibility.userAgent plus Oculus Browser or Chrome version hints.";
    case "reproducibility_app_build_missing":
      return "Preserve app package, version, git commit, build time, and build mode in reproducibility.app.";
    case "reproducibility_webxr_support_missing":
      return "Preserve navigator.xr and immersive-vr/immersive-ar support check results in reproducibility.webXr.";
    case "reproducibility_display_context_missing":
      return "Preserve viewport, screen, device-pixel-ratio, and visibility-state values in reproducibility.display.";
    default:
      return `Resolve Quest manual evidence-quality finding: ${finding}.`;
  }
}

function questManualNextStepForBlocker(blocker: string): string {
  if (blocker.startsWith("copied_payload_technical_gap:")) {
    return `Resolve copied payload technical gap: ${blocker.slice("copied_payload_technical_gap:".length)}.`;
  }
  if (blocker.startsWith("copied_payload_locomotion_probe:")) {
    return questManualNextStepForLocomotionProbe(blocker.slice("copied_payload_locomotion_probe:".length));
  }
  if (blocker.startsWith("copied_payload_locomotion_probe_reason_invalid:")) {
    const reason = blocker.slice("copied_payload_locomotion_probe_reason_invalid:".length);
    return `Re-copy the in-app Quest Evidence payload after updating the manual checker to recognize locomotion probe reason ${reason}.`;
  }

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
    case "trace_interaction_attempt_invalid":
      return "Use a supported station.traceInteractionAttempt value from the Quest manual evidence template.";
    case "experience_mode_full_vr_not_recorded":
      return "Record experience.modeId full_vr, requestedSessionMode immersive-vr, and mixedRealityPassthroughImplemented false for this Full VR manual report.";
    case "hand_tracking_posture_not_current_mesh_or_fallback":
      return `Record experience.handTrackingPosture as ${expectedFullVrHandTrackingPosture} so the report reflects the local mesh hand path and primitive fallback.`;
    case "locomotion_posture_not_current_room_scale_contract":
      return `Record experience.locomotionPosture as ${expectedFullVrLocomotionPosture} so the report reflects the current locomotion evidence contract.`;
    case "hand_model_status_invalid":
      return "Use a supported input.handModelStatus value: pending_immersive_session, installed, or failed.";
    case "hand_representation_kind_invalid":
      return "Use a supported input.handRepresentationKind value from the Quest manual evidence template.";
    case "locomotion_attempt_invalid":
      return "Use a supported input.locomotionAttempt value from the Quest manual evidence template.";
    case "hand_or_controller_input_not_observed":
      return "Observe at least one foreground headset hand or controller interaction.";
    case "locomotion_not_observed":
      return "Observe thumbstick, hand-gesture, or room-scale locomotion and record lastLocomotionAtMs.";
    case "operator_notes_contradict_locomotion_evidence":
      return "Reconcile operator locomotion notes with activeLocomotionSource, lastLocomotionAtMs, and locomotionDelta from the same headset run.";
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
      return "Record headset select latency as a positive finite number.";
    case "controller_select_latency_ms_above_150_or_missing":
      return "Record headset select latency at or below 150 ms.";
    case "controller_select_trace_source_not_xr_controller_select":
      return "Record headset trace latency from xr_controller_select or xr_hand_select, not a DOM click or desktop proxy.";
    case "controller_select_trace_tag_missing":
      return "Record the trace tag triggered by the headset controller or deliberate hand-select event.";
    case "controller_select_trace_latency_missing":
      return "Record positive lastSelectLatencyMs from the headset trace event.";
    case "controller_select_trace_measured_at_missing":
      return "Record measuredAtMs for the headset trace event.";
    case "controller_select_latency_mismatch":
      return "Copy headset select latency from the same xr_controller_select or xr_hand_select trace event used for the Trace row.";
    case "trace_latency_proxy_marked_as_production_substitute":
      return "Record a real headset select latency measurement; DOM trace-click latency is supporting evidence only.";
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
    case "copied_payload_text_panel_metadata_missing":
      return "Copy the full in-app Quest Evidence JSON payload, including textPanelEvidence.";
    case "copied_payload_summary_not_ready":
      return "Resolve the copied captureSummary blockers before using the payload as readiness evidence.";
    case "copied_payload_technical_gaps_present":
      return "Resolve the copied captureSummary technical gaps before using the payload as readiness evidence.";
    case "copied_payload_locomotion_probe_scope_invalid":
      return "Re-copy the in-app Quest Evidence payload so captureSummary.locomotionProbeSummary has claimScope runtime_probe_only.";
    case "copied_payload_summary_missing_draft_or_frame_stats":
      return "Copy the in-app Quest Evidence payload after the draft and frame stats are both available.";
    case "frame_stats_stale_or_unsampled":
      return "Keep the headset foreground and copy the evidence only while frameStatsFresh is true.";
    case "manual_evidence_harvest_summary_invalid":
      return "Re-copy the CDP harvester output with a valid harvestSummary object.";
    case "manual_evidence_harvest_not_ready":
    case "manual_evidence_harvest_timed_out":
      return "Rerun the CDP manual evidence harvester after the headset is foregrounded and the missing technical signal is visible.";
    case "locomotion_evidence_missing":
      return "Retry thumbstick, hand-gesture, or room-scale locomotion before harvesting manual evidence.";
    case "headset_trace_latency_missing":
      return "Trigger an xr_controller_select or xr_hand_select trace action before harvesting manual evidence.";
    default:
      return `Resolve Quest manual blocker: ${blocker}.`;
  }
}

function questManualNextStepForLocomotionProbe(reason: string): string {
  switch (reason) {
    case "active_vector_without_rig_delta":
      return "For the copied locomotion probe, preserve the active input vector and measurable rig delta from the same movement frame.";
    case "no_gamepad_sources":
      return "For the copied locomotion probe, use hand tracking deliberately or wake/activate a controller; no gamepad sources were seen.";
    case "gamepad_axes_below_deadzone":
      return "For the copied locomotion probe, move the thumbstick farther past the configured deadzone.";
    case "hand_not_pinching":
      return "For the copied locomotion probe, pinch thumb and index tip together before attempting hand-gesture locomotion.";
    case "hand_arming_dwell":
      return "For the copied locomotion probe, hold the pinch until the gesture arming dwell completes before moving.";
    case "hand_missing_joints":
      return "For the copied locomotion probe, reposition hands so wrist, index-tip, and thumb-tip joints are visible to Quest hand tracking.";
    case "hand_below_deadzone":
      return "For the copied locomotion probe, move the armed hand farther past the gesture deadzone or use room-scale walking.";
    case "hand_turn_cooldown":
      return "For the copied locomotion probe, wait for the turn cooldown before repeating a hand-turn gesture.";
    case "hand_other_locomotion_source_active":
      return "For the copied locomotion probe, retry hand locomotion without another locomotion source active.";
    case "no_xr_input_sources":
      return "For the copied locomotion probe, confirm Quest hand tracking or controllers are visible before attempting movement.";
    case "locomotion_delta_missing":
      return "For the copied locomotion probe, preserve lastLocomotionAtMs plus a measurable locomotionDelta after moving.";
    default:
      return `Resolve copied locomotion probe reason: ${reason}.`;
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

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
  const hasLocomotionDelta = hasMeasurableLocomotionDelta(value?.locomotionDelta);

  return typeof value?.lastLocomotionAtMs === "number"
    && Number.isFinite(value.lastLocomotionAtMs)
    && value.lastLocomotionAtMs >= 0
    && hasLocomotionSource
    && hasLocomotionDelta;
}

function hasMeasurableLocomotionDelta(value: QuestManualLocomotionDelta | undefined): boolean {
  if (!value) {
    return false;
  }
  const distanceMeters = value.distanceMeters;
  const turnRadians = value.turnRadians;
  return (typeof distanceMeters === "number" && Number.isFinite(distanceMeters) && distanceMeters > 0)
    || (typeof turnRadians === "number" && Number.isFinite(turnRadians) && turnRadians > 0);
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
  return value === "dom_click_trace_button" || value === "xr_controller_select" || value === "xr_hand_select";
}

function notesContradictLocomotion(notes: string | undefined): boolean {
  if (!notes) {
    return false;
  }

  return /\bno\s+locomotion\b/i.test(notes)
    || /\bloc(?:o)?motion\s+(?:was\s+)?(?:not|unavailable|absent)\b/i.test(notes)
    || /\bno\s+movement\s+(?:occurred|available|registered)\b/i.test(notes)
    || /\bmovement\s+(?:did\s+not|didn't)\s+(?:occur|register|work)\b/i.test(notes);
}

function buildReproducibilityEvidence(value: QuestManualPerformanceReport["reproducibility"]): {
  satisfiedConditions: string[];
  adversarialFindings: string[];
} {
  if (!value) {
    return {
      satisfiedConditions: [],
      adversarialFindings: ["reproducibility_metadata_missing"],
    };
  }

  const sourceRecorded = value.source === "browser_runtime";
  const urlRecorded = isNonEmptyString(value.url);
  const browserVersionRecorded = isNonEmptyString(value.userAgent)
    && (isNonEmptyString(value.browserVersionHints?.oculusBrowser)
      || isNonEmptyString(value.browserVersionHints?.chrome));
  const appBuildRecorded = isNonEmptyString(value.app?.packageName)
    && isNonEmptyString(value.app?.version)
    && isNonEmptyString(value.app?.gitCommit)
    && isValidIsoDate(value.app?.buildTime)
    && isNonEmptyString(value.app?.mode);
  const webXrSupportRecorded = typeof value.webXr?.navigatorXrPresent === "boolean"
    && typeof value.webXr.immersiveVrSupported === "boolean"
    && typeof value.webXr.immersiveArSupported === "boolean";
  const displayContextRecorded = isPositiveInteger(value.display?.viewportWidth)
    && isPositiveInteger(value.display?.viewportHeight)
    && isPositiveFiniteNumber(value.display?.devicePixelRatio ?? null)
    && isNonEmptyString(value.display?.visibilityState);
  const allMetadataRecorded = sourceRecorded
    && urlRecorded
    && browserVersionRecorded
    && appBuildRecorded
    && webXrSupportRecorded
    && displayContextRecorded;

  return {
    satisfiedConditions: [
      sourceRecorded ? "reproducibility_source_browser_runtime" : undefined,
      urlRecorded ? "reproducibility_url_recorded" : undefined,
      browserVersionRecorded ? "reproducibility_browser_version_recorded" : undefined,
      appBuildRecorded ? "reproducibility_app_build_recorded" : undefined,
      webXrSupportRecorded ? "reproducibility_webxr_support_recorded" : undefined,
      displayContextRecorded ? "reproducibility_display_context_recorded" : undefined,
      allMetadataRecorded ? "reproducibility_metadata_recorded" : undefined,
    ].filter((condition): condition is string => typeof condition === "string"),
    adversarialFindings: [
      sourceRecorded ? undefined : "reproducibility_source_not_browser_runtime",
      urlRecorded ? undefined : "reproducibility_url_missing",
      browserVersionRecorded ? undefined : "reproducibility_browser_version_missing",
      appBuildRecorded ? undefined : "reproducibility_app_build_missing",
      webXrSupportRecorded ? undefined : "reproducibility_webxr_support_missing",
      displayContextRecorded ? undefined : "reproducibility_display_context_missing",
    ].filter((finding): finding is string => typeof finding === "string"),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
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
