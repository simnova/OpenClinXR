import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";

type CliOptions = {
  inputPath?: string;
  outputPath: string;
};

export type QuestMixedRealityManualReport = {
  schemaVersion: "openclinxr.quest-mixed-reality-manual.v1" | string;
  generatedAt: string;
  runContext: {
    performedBy: string;
    durationMinutes: number;
    notes?: string;
  };
  experience: {
    modeId: string;
    requestedSessionMode: string;
    entryGate: string;
    mixedRealityPassthroughImplemented: boolean;
  };
  webXr: {
    navigatorXrPresent: boolean;
    immersiveArSupported: boolean | null;
    immersiveArSupportCheckedAtMs: number | null;
    supportError: string | null;
  };
  entry: {
    operatorApproved: boolean;
    physicalUserGestureUsed: boolean;
    sessionStarted: boolean;
    lastOutcome: "not_requested" | "unsupported" | "request_failed" | "session_started" | string;
    lastError: string | null;
  };
  passthrough: {
    observed: boolean;
    transparentBackgroundObserved: boolean;
    blackSkyboxOrFloorAbsent: boolean;
    realRoomRecorded: boolean;
  };
  readability: {
    clinicalTextReadable: boolean;
    panelsReadable: string[];
    occlusionIssues: string[];
  };
  privacySafety: {
    reviewCompleted: boolean;
    roomScanOrRecordingAvoided: boolean;
    bystandersOrPhiVisible: boolean;
    boundaryComfort: "comfortable" | "good" | "mild_discomfort" | "uncomfortable" | "not_run" | string;
  };
  performance: {
    source: string;
    framesObserved: number | null;
    immersiveFramesObserved: number | null;
    avgFps: number | null;
    p95FrameMs: number | null;
  };
  comfort: {
    motionComfort: "comfortable" | "good" | "mild_discomfort" | "uncomfortable" | "not_run" | string;
    heatConcern: boolean | null;
    batteryDropPercent: number | null;
  };
  notEvidenceFor: string[];
};

export type QuestMixedRealityManualCheck = {
  generatedAt: string;
  inputFile: string | null;
  readyToClaimMixedRealityReadiness: boolean;
  readyToClaimFullVrReadiness: false;
  satisfiedConditions: string[];
  blockers: string[];
  notEvidenceFor: string[];
  nextSteps: string[];
};

const requiredNotEvidenceFor = [
  "replacement_for_full_vr",
  "production_quest_readiness",
  "passthrough_privacy_readiness",
  "clinical_room_safety_readiness",
] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = options.inputPath ?? await latestMixedRealityManualReportPath();
  const report = inputPath ? await readJson<QuestMixedRealityManualReport>(inputPath) : undefined;
  const check = buildQuestMixedRealityManualCheck(inputPath, report);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(check, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}; readyToClaimMixedRealityReadiness=${check.readyToClaimMixedRealityReadiness}`);
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    outputPath: ".agent-factory/quest-mixed-reality-manual-report.json",
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

async function latestMixedRealityManualReportPath(): Promise<string | undefined> {
  const files = (await fg("docs/openclinxr/quest-mixed-reality-manual-*.json", { onlyFiles: true }))
    .filter((file) => !file.endsWith("quest-mixed-reality-manual-template.json"))
    .filter((file) => !path.basename(file).startsWith("quest-mixed-reality-manual-check-"))
    .sort();
  return files.at(-1);
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

export function buildQuestMixedRealityManualCheck(
  inputFile: string | undefined,
  report: QuestMixedRealityManualReport | undefined,
): QuestMixedRealityManualCheck {
  if (!report) {
    return {
      generatedAt: new Date().toISOString(),
      inputFile: null,
      readyToClaimMixedRealityReadiness: false,
      readyToClaimFullVrReadiness: false,
      satisfiedConditions: [],
      blockers: ["missing_quest_mixed_reality_manual_report"],
      notEvidenceFor: [...requiredNotEvidenceFor],
      nextSteps: ["Capture a separate Quest Mixed Reality manual report before making MR readiness claims."],
    };
  }

  const blockers = unique([
    report.schemaVersion === "openclinxr.quest-mixed-reality-manual.v1" ? undefined : "schema_version_invalid",
    isValidIsoDate(report.generatedAt) ? undefined : "generated_at_invalid_or_missing",
    report.runContext.performedBy.trim().length > 0 ? undefined : "performed_by_missing",
    report.runContext.durationMinutes >= 10 ? undefined : "duration_under_10_minutes",
    report.experience.modeId === "mixed_reality_passthrough" ? undefined : "mode_not_mixed_reality_passthrough",
    report.experience.requestedSessionMode === "immersive-ar" ? undefined : "requested_session_mode_not_immersive_ar",
    report.experience.entryGate === "mr=approved" ? undefined : "entry_gate_not_mr_approved",
    report.experience.mixedRealityPassthroughImplemented ? undefined : "mixed_reality_passthrough_not_implemented",
    report.webXr.navigatorXrPresent ? undefined : "navigator_xr_missing",
    report.webXr.immersiveArSupported === true ? undefined : "immersive_ar_not_supported",
    report.entry.operatorApproved ? undefined : "operator_gate_not_approved",
    report.entry.physicalUserGestureUsed ? undefined : "physical_user_gesture_missing",
    report.entry.sessionStarted ? undefined : "mixed_reality_session_not_started",
    report.entry.lastOutcome === "session_started" ? undefined : "mixed_reality_last_outcome_not_session_started",
    report.passthrough.observed ? undefined : "passthrough_not_observed",
    report.passthrough.transparentBackgroundObserved ? undefined : "transparent_background_not_observed",
    report.passthrough.blackSkyboxOrFloorAbsent ? undefined : "black_skybox_or_floor_not_cleared",
    report.passthrough.realRoomRecorded ? "real_room_recorded" : undefined,
    report.readability.clinicalTextReadable ? undefined : "clinical_text_not_readable",
    report.readability.panelsReadable.length > 0 ? undefined : "readable_panels_missing",
    report.readability.occlusionIssues.length === 0 ? undefined : "readability_occlusion_issues_present",
    report.privacySafety.reviewCompleted ? undefined : "privacy_safety_review_missing",
    report.privacySafety.roomScanOrRecordingAvoided ? undefined : "room_scan_or_recording_not_avoided",
    report.privacySafety.bystandersOrPhiVisible ? "bystanders_or_phi_visible" : undefined,
    report.privacySafety.boundaryComfort === "comfortable" || report.privacySafety.boundaryComfort === "good"
      ? undefined
      : "boundary_comfort_not_confirmed",
    report.performance.source === "window.__openClinXrFrameStats" ? undefined : "performance_source_not_openclinxr_frame_stats",
    (report.performance.framesObserved ?? 0) >= 600 ? undefined : "frame_sample_under_600_or_missing",
    (report.performance.immersiveFramesObserved ?? 0) >= 600 ? undefined : "immersive_frame_sample_under_600_or_missing",
    (report.performance.avgFps ?? 0) >= 72 ? undefined : "average_fps_under_72_or_missing",
    (report.performance.p95FrameMs ?? Number.POSITIVE_INFINITY) <= 25 ? undefined : "p95_frame_ms_above_25_or_missing",
    report.comfort.motionComfort === "comfortable" || report.comfort.motionComfort === "good"
      ? undefined
      : "motion_comfort_not_confirmed",
    report.comfort.heatConcern === false ? undefined : "heat_concern_not_cleared",
    typeof report.comfort.batteryDropPercent === "number" ? undefined : "battery_drop_not_recorded",
    ...requiredNotEvidenceFor.map((value) => report.notEvidenceFor.includes(value) ? undefined : `not_evidence_for_missing:${value}`),
  ]);
  const satisfiedConditions = [
    report.schemaVersion === "openclinxr.quest-mixed-reality-manual.v1" ? "schema_version_valid" : undefined,
    isValidIsoDate(report.generatedAt) ? "generated_at_valid" : undefined,
    report.runContext.performedBy.trim().length > 0 ? "performed_by_recorded" : undefined,
    report.runContext.durationMinutes >= 10 ? "duration_10_minutes_or_more" : undefined,
    report.experience.modeId === "mixed_reality_passthrough" ? "mode_mixed_reality_passthrough_recorded" : undefined,
    report.experience.requestedSessionMode === "immersive-ar" ? "requested_session_mode_immersive_ar" : undefined,
    report.experience.entryGate === "mr=approved" ? "entry_gate_mr_approved_recorded" : undefined,
    report.experience.mixedRealityPassthroughImplemented ? "mixed_reality_passthrough_implemented" : undefined,
    report.webXr.navigatorXrPresent ? "navigator_xr_present" : undefined,
    report.webXr.immersiveArSupported === true ? "immersive_ar_supported" : undefined,
    report.entry.operatorApproved ? "operator_approved" : undefined,
    report.entry.physicalUserGestureUsed ? "physical_user_gesture_used" : undefined,
    report.entry.sessionStarted ? "mixed_reality_session_started" : undefined,
    report.passthrough.observed ? "passthrough_observed" : undefined,
    report.passthrough.transparentBackgroundObserved ? "transparent_background_observed" : undefined,
    report.passthrough.blackSkyboxOrFloorAbsent ? "black_skybox_or_floor_absent" : undefined,
    report.readability.clinicalTextReadable ? "clinical_text_readable" : undefined,
    report.privacySafety.reviewCompleted ? "privacy_safety_review_completed" : undefined,
    report.privacySafety.roomScanOrRecordingAvoided ? "room_scan_or_recording_avoided" : undefined,
    report.privacySafety.bystandersOrPhiVisible === false ? "bystanders_or_phi_not_visible" : undefined,
    report.performance.source === "window.__openClinXrFrameStats" ? "performance_source_openclinxr_frame_stats" : undefined,
    (report.performance.framesObserved ?? 0) >= 600 ? "frame_sample_600_or_more" : undefined,
    (report.performance.immersiveFramesObserved ?? 0) >= 600 ? "immersive_frame_sample_600_or_more" : undefined,
    (report.performance.avgFps ?? 0) >= 72 ? "average_fps_72_or_higher" : undefined,
    (report.performance.p95FrameMs ?? Number.POSITIVE_INFINITY) <= 25 ? "p95_frame_ms_25_or_lower" : undefined,
    report.comfort.motionComfort === "comfortable" || report.comfort.motionComfort === "good" ? "motion_comfort_confirmed" : undefined,
    report.comfort.heatConcern === false ? "heat_concern_cleared" : undefined,
    typeof report.comfort.batteryDropPercent === "number" ? "battery_drop_recorded" : undefined,
  ].filter((condition): condition is string => typeof condition === "string");

  return {
    generatedAt: new Date().toISOString(),
    inputFile: inputFile ?? null,
    readyToClaimMixedRealityReadiness: blockers.length === 0,
    readyToClaimFullVrReadiness: false,
    satisfiedConditions,
    blockers,
    notEvidenceFor: [...requiredNotEvidenceFor],
    nextSteps: blockers.map(questMixedRealityNextStepForBlocker),
  };
}

function questMixedRealityNextStepForBlocker(blocker: string): string {
  const steps: Record<string, string> = {
    missing_quest_mixed_reality_manual_report: "Capture a separate Quest Mixed Reality manual report before making MR readiness claims.",
    operator_gate_not_approved: "Open the MR sidecar with ?mr=approved and record the operator approval gate.",
    physical_user_gesture_missing: "Use a physical headset gesture to enter immersive-ar; CDP/IWER activation is supporting evidence only.",
    immersive_ar_not_supported: "Confirm immersive-ar support from the Quest Browser runtime before attempting MR.",
    mixed_reality_session_not_started: "Enter Mixed Reality in the headset and confirm the immersive-ar session started.",
    passthrough_not_observed: "Confirm the real-room passthrough view is visible without treating screenshots as privacy proof.",
    privacy_safety_review_missing: "Complete privacy and room-safety review before using MR evidence beyond a local spike.",
  };
  return steps[blocker] ?? `Resolve blocker: ${blocker}`;
}

function isValidIsoDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
