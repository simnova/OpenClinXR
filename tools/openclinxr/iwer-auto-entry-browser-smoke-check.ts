import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectMediaArtifact,
  isAllowedRelativeArtifactPath,
} from "./media-artifact-integrity.js";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
};

type SessionEntryStatus = "not_requested" | "unsupported" | "requesting" | "started" | "ended" | "failed";
type SessionEntryOutcome =
  | "not_requested"
  | "unsupported"
  | "request_in_flight"
  | "session_started"
  | "session_ended"
  | "activation_required"
  | "request_failed";

export type IwerAutoEntryBrowserSmokeEvidence = {
  schemaVersion?: string;
  generatedAt?: string;
  localGeneratedAt?: string;
  classification?: {
    lane?: string;
    scope?: string;
    notEvidenceFor?: string[];
  };
  sidecar?: {
    app?: string;
    runtimeUrl?: string;
    devServerPort?: number;
    devCommand?: string;
    queryFlag?: string;
  };
  sessionEntryEvidence?: {
    sessionMode?: "immersive-vr";
    requestedBy?: "iwer_auto_entry_probe";
    autoAttemptEnabled?: boolean;
    outcome?: "session_started" | "unsupported" | "activation_required" | "request_failed";
    appEvidence?: {
      attempts?: number;
      lastStatus?: SessionEntryStatus;
      lastOutcome?: SessionEntryOutcome;
      lastRequestedAtMs?: number;
      lastUpdatedAtMs?: number;
      lastError?: {
        name?: string;
        message?: string;
      } | null;
    };
    pageEvidence?: {
      xrStatusText?: string;
      bodyTextIncludesFullVrStatus?: boolean;
    };
  };
  frameStats?: {
    sampleCount?: number;
    avgFrameMs?: number;
    p95FrameMs?: number;
    maxFrameMs?: number;
    approxFps?: number;
    framesObserved?: number;
    sampleWindowSize?: number;
  };
  inputEvidence?: {
    handModelCount?: number;
    handModelStatus?: string;
    handInputsObserved?: number;
    locomotionMode?: string;
    lastLocomotionAtMs?: number | null;
    rigPosition?: {
      x?: number;
      z?: number;
    };
  };
  bootEvidence?: {
    app?: string;
    events?: Array<{
      phase?: string;
      atMs?: number;
    }>;
  };
  browserEvidence?: {
    title?: string;
    hasCanvas?: boolean;
    consoleErrors?: string[];
    consoleWarnings?: string[];
    consoleIssues?: string[];
  };
  screenshot?: {
    source?: "chrome_devtools_mcp";
    artifact?: string;
    mimeType?: string;
    bytes?: number;
    dimensions?: {
      width?: number;
      height?: number;
    };
    captureCommand?: string;
  };
  blockers?: string[];
};

export type IwerAutoEntryBrowserSmokeReadiness = {
  readyForAutoEntryEvidence: boolean;
  readyForProductionRuntime: false;
  readyForPhysicalQuestClaim: false;
  blockers: string[];
  warnings: string[];
};

export type IwerAutoEntryBrowserSmokeReport = {
  generatedAt: string;
  inputFile?: string;
  evidence: IwerAutoEntryBrowserSmokeEvidence;
  result: IwerAutoEntryBrowserSmokeReadiness;
};

const requiredNotEvidenceFor = [
  "physical_quest_immersive_entry",
  "physical_quest_foreground_frame_pacing",
  "quest_controller_latency",
  "quest_hand_tracking_quality",
  "in_headset_text_readability",
  "thermal_or_battery_behavior",
  "production_runtime_readiness",
];

const requiredBlockers = [
  "iwer_auto_entry_not_physical_quest_evidence",
  "physical_quest_foreground_metrics_still_required",
  "hand_tracking_visuals_remain_primitive",
  "hand_locomotion_not_observed",
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputPath) {
    throw new Error("--input is required");
  }

  const evidence = JSON.parse(await readFile(options.inputPath, "utf8")) as IwerAutoEntryBrowserSmokeEvidence;
  const report = buildIwerAutoEntryBrowserSmokeReport({
    inputFile: options.inputPath,
    evidence,
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.result.readyForAutoEntryEvidence) {
    process.exitCode = 1;
  }
}

export function buildIwerAutoEntryBrowserSmokeReport(input: {
  generatedAt?: string;
  inputFile?: string;
  evidence: IwerAutoEntryBrowserSmokeEvidence;
}): IwerAutoEntryBrowserSmokeReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    evidence: input.evidence,
    result: evaluateIwerAutoEntryBrowserSmokeEvidence(input.evidence),
  };
}

export function evaluateIwerAutoEntryBrowserSmokeEvidence(
  evidence: IwerAutoEntryBrowserSmokeEvidence,
): IwerAutoEntryBrowserSmokeReadiness {
  const notEvidenceFor = evidence.classification?.notEvidenceFor ?? [];
  const screenshot = evidence.screenshot;
  const artifactIntegrity = inspectMediaArtifact(screenshot?.artifact);
  const pngDimensions = artifactIntegrity.pngDimensions;
  const browserEvidence = evidence.browserEvidence ?? {};

  const blockers = [
    evidence.schemaVersion === "openclinxr.iwer-auto-entry-browser-smoke.v1"
      ? undefined
      : "schema_version_not_iwer_auto_entry_browser_smoke_v1",
    evidence.classification?.lane === "iwer_devtools_managed_browser_auto_entry"
      ? undefined
      : "classification_lane_not_iwer_auto_entry",
    evidence.classification?.scope === "sidecar_only_dev_evidence"
      ? undefined
      : "classification_scope_not_sidecar_dev_evidence",
    ...requiredNotEvidenceFor.map((claim) => (
      notEvidenceFor.includes(claim) ? undefined : `missing_not_evidence_for_${claim}`
    )),
    evidence.sidecar?.app === "apps/ui-xr-iwsdk-spike" ? undefined : "sidecar_app_not_recorded",
    isLocalHttpUrl(evidence.sidecar?.runtimeUrl) ? undefined : "runtime_url_not_localhost",
    evidence.sidecar?.runtimeUrl?.includes("iwerAutoEnterVr=true")
      ? undefined
      : "runtime_url_missing_auto_entry_query_flag",
    isValidPort(evidence.sidecar?.devServerPort) ? undefined : "dev_server_port_invalid_or_missing",
    evidence.sidecar?.queryFlag === "iwerAutoEnterVr=true" ? undefined : "query_flag_not_recorded",
    ...sessionEntryBlockers(evidence.sessionEntryEvidence),
    ...frameStatsBlockers(evidence.frameStats),
    evidence.inputEvidence?.handModelCount === 2 ? undefined : "hand_model_count_not_two",
    typeof evidence.inputEvidence?.locomotionMode === "string"
      && evidence.inputEvidence.locomotionMode.length > 0
      ? undefined
      : "locomotion_mode_missing",
    evidence.bootEvidence?.app === "ui-xr-iwsdk-spike" ? undefined : "boot_app_not_recorded",
    evidence.bootEvidence?.events?.some((event) => event.phase === "full_vr_entry_iwer_auto_entry_probe")
      ? undefined
      : "boot_event_missing_auto_entry_probe",
    browserEvidence.title === "OpenClinXR IWSDK Spike" ? undefined : "browser_title_not_recorded",
    browserEvidence.hasCanvas === true ? undefined : "browser_canvas_not_observed",
    (browserEvidence.consoleErrors ?? []).length === 0 ? undefined : "console_errors_observed",
    screenshot?.source === "chrome_devtools_mcp" ? undefined : "screenshot_source_not_chrome_devtools_mcp",
    isAllowedRelativeArtifactPath(screenshot?.artifact, "docs/openclinxr/screenshots/")
      ? undefined
      : "screenshot_artifact_not_under_docs_openclinxr_screenshots",
    artifactIntegrity.exists ? undefined : "screenshot_artifact_file_missing",
    artifactIntegrity.size === undefined || artifactIntegrity.size > 0 ? undefined : "screenshot_artifact_file_empty",
    screenshot?.mimeType === "image/png" ? undefined : "screenshot_mime_type_not_png",
    typeof screenshot?.bytes === "number" && screenshot.bytes > 0 ? undefined : "screenshot_bytes_invalid_or_missing",
    typeof screenshot?.bytes === "number"
      && artifactIntegrity.size !== undefined
      && screenshot.bytes !== artifactIntegrity.size
      ? "screenshot_bytes_do_not_match_file_size"
      : undefined,
    screenshot?.mimeType === "image/png" && artifactIntegrity.exists && !pngDimensions
      ? "screenshot_png_signature_invalid"
      : undefined,
    validPositiveNumber(screenshot?.dimensions?.width) ? undefined : "screenshot_width_invalid_or_missing",
    validPositiveNumber(screenshot?.dimensions?.height) ? undefined : "screenshot_height_invalid_or_missing",
    pngDimensions
      && (
        screenshot?.dimensions?.width !== pngDimensions.width
        || screenshot.dimensions.height !== pngDimensions.height
      )
      ? "screenshot_dimensions_do_not_match_png_header"
      : undefined,
    typeof screenshot?.captureCommand === "string" && screenshot.captureCommand.length > 0
      ? undefined
      : "screenshot_capture_command_missing",
    ...requiredBlockers.map((blocker) => (
      evidence.blockers?.includes(blocker) ? undefined : `required_context_blocker_missing_${blocker}`
    )),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    readyForAutoEntryEvidence: blockers.length === 0,
    readyForProductionRuntime: false,
    readyForPhysicalQuestClaim: false,
    blockers,
    warnings: evidenceWarnings(evidence),
  };
}

function sessionEntryBlockers(
  entry: IwerAutoEntryBrowserSmokeEvidence["sessionEntryEvidence"],
): string[] {
  if (!entry) {
    return ["session_entry_evidence_missing"];
  }

  const appEvidence = entry.appEvidence ?? {};
  const pageEvidence = entry.pageEvidence ?? {};
  return [
    entry.sessionMode === "immersive-vr" ? undefined : "session_mode_not_immersive_vr",
    entry.requestedBy === "iwer_auto_entry_probe" ? undefined : "session_requested_by_not_auto_entry_probe",
    entry.autoAttemptEnabled === true ? undefined : "auto_attempt_not_enabled",
    entry.outcome === "session_started" ? undefined : "session_outcome_not_started",
    (appEvidence.attempts ?? 0) > 0 ? undefined : "session_started_without_app_attempt",
    appEvidence.lastStatus === "started" ? undefined : "session_started_without_app_started_status",
    appEvidence.lastOutcome === "session_started" ? undefined : "session_started_without_app_started_outcome",
    pageEvidence.xrStatusText === "In Full VR" ? undefined : "session_started_without_in_full_vr_status_text",
    pageEvidence.bodyTextIncludesFullVrStatus === true ? undefined : "body_text_missing_full_vr_status",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function frameStatsBlockers(frameStats: IwerAutoEntryBrowserSmokeEvidence["frameStats"]): string[] {
  if (!frameStats) {
    return ["frame_stats_missing"];
  }

  return [
    (frameStats.sampleCount ?? 0) >= 60 ? undefined : "frame_stats_sample_count_too_low",
    validPositiveNumber(frameStats.avgFrameMs) ? undefined : "frame_stats_avg_frame_ms_missing",
    validPositiveNumber(frameStats.p95FrameMs) ? undefined : "frame_stats_p95_frame_ms_missing",
    validPositiveNumber(frameStats.approxFps) ? undefined : "frame_stats_approx_fps_missing",
    (frameStats.framesObserved ?? 0) > 0 ? undefined : "frame_stats_no_frames_observed",
    (frameStats.sampleWindowSize ?? 0) >= 60 ? undefined : "frame_stats_sample_window_too_small",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function evidenceWarnings(evidence: IwerAutoEntryBrowserSmokeEvidence): string[] {
  const warnings = [
    (evidence.browserEvidence?.consoleIssues ?? []).length > 0 ? "console_issue_observed" : undefined,
    (evidence.browserEvidence?.consoleWarnings ?? []).length > 0 ? "console_warning_observed" : undefined,
    evidence.inputEvidence?.handModelStatus === "installed" && (evidence.inputEvidence.handInputsObserved ?? 0) === 0
      ? "hand_models_installed_but_no_hand_inputs_observed"
      : undefined,
    evidence.inputEvidence?.lastLocomotionAtMs === null ? "locomotion_not_observed" : undefined,
  ].filter((warning): warning is string => typeof warning === "string");

  return [...new Set(warnings)];
}

function validPositiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidPort(port: number | undefined): boolean {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

function isLocalHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
