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
  performance?: {
    source?: string;
    framesObserved?: number | null;
    sampleWindowSize?: number | null;
    avgFps?: number | null;
    p95FrameMs?: number | null;
    minimumObservedFps?: number | null;
  };
  comfort?: {
    motionComfort?: "comfortable" | "mild_discomfort" | "uncomfortable" | "not_run";
    heatConcern?: boolean;
    batteryDropPercent?: number | null;
  };
};

export type QuestManualPerformanceCheck = {
  generatedAt: string;
  inputFile: string | null;
  readyToClaimFramePacing: boolean;
  satisfiedConditions: string[];
  blockers: string[];
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
  const batteryDropPercentValid = isPercentInRange(batteryDropPercent);
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
    report.comfort?.motionComfort === "comfortable" ? undefined : "motion_comfort_not_confirmed",
    report.comfort?.heatConcern === false ? undefined : "heat_concern_not_cleared",
    typeof batteryDropPercent === "number" && !batteryDropPercentValid ? "battery_drop_not_finite_range_0_to_100" : undefined,
    batteryDropPercent === null ? "battery_drop_not_recorded" : undefined,
    batteryDropPercentValid && batteryDropPercent > 20 ? "battery_drop_above_20" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

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
      report.performance?.source === "window.__openClinXrFrameStats" ? "performance_source_openclinxr_frame_stats" : undefined,
      framesObservedValid && framesObserved >= 600 ? "frame_sample_600_or_more" : undefined,
      sampleWindowWithinObservedFrames && sampleWindowSize >= 120 ? "rolling_frame_window_120_or_more" : undefined,
      avgFpsPlausible && avgFps >= 72 ? "average_fps_72_or_higher" : undefined,
      minimumObservedFpsPlausible && minimumFpsAtOrBelowAverage && minimumObservedFps >= 60 ? "minimum_fps_60_or_higher" : undefined,
      p95FrameMsValid && p95FrameMs <= 25 ? "p95_frame_ms_25_or_lower" : undefined,
      batteryDropPercentValid && batteryDropPercent <= 20 ? "battery_drop_recorded_under_20" : undefined,
    ].filter((condition): condition is string => typeof condition === "string"),
    blockers,
  };
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
