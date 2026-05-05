import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
};

export type VisualQaCaptureSource =
  | "desktop_browser"
  | "quest_cdp"
  | "iwer_emulation"
  | "human_worn_headset";

export type VisualQaReviewStatus = "pass" | "concern" | "blocked" | "not_assessed";

export type VisualQaEvidence = {
  schemaVersion?: string;
  capture?: {
    source?: VisualQaCaptureSource;
    artifactType?: "screenshot" | "video";
    artifact?: string;
    mimeType?: string;
    dimensions?: {
      width?: number;
      height?: number;
    };
    runtimeUrl?: string;
    route?: string;
    scenarioId?: string;
    xrMode?: string;
    cameraPose?: string;
    captureCommand?: string;
  };
  adversarialReview?: {
    reviewers?: string[];
    checks?: Partial<Record<VisualQaReviewCheckId, {
      status?: VisualQaReviewStatus;
      notes?: string[];
    }>>;
  };
  claimBoundaries?: {
    notEvidenceFor?: string[];
    allowedClaims?: string[];
  };
};

export type VisualQaReviewCheckId =
  | "clinical_scene_fidelity"
  | "actor_equipment_realism"
  | "ui_readability"
  | "interaction_affordances"
  | "occlusion_scale"
  | "evidence_limits";

export type VisualQaEvidenceReadiness = {
  readyForAdversarialVisualQa: boolean;
  readyForProductionRuntime: false;
  readyForPhysicalQuestClaim: false;
  blockers: string[];
};

export type VisualQaEvidenceReport = {
  generatedAt: string;
  inputFile?: string;
  evidence: VisualQaEvidence;
  result: VisualQaEvidenceReadiness;
};

const allowedCaptureSources: VisualQaCaptureSource[] = [
  "desktop_browser",
  "quest_cdp",
  "iwer_emulation",
  "human_worn_headset",
];

const requiredReviewers = [
  "test-automation-lead",
  "ux-friction-critic",
  "clinical-safety-critic",
  "xr-systems-architect",
  "asset-pipeline-lead",
];

const requiredReviewChecks: VisualQaReviewCheckId[] = [
  "clinical_scene_fidelity",
  "actor_equipment_realism",
  "ui_readability",
  "interaction_affordances",
  "occlusion_scale",
  "evidence_limits",
];

const requiredNotEvidenceFor = [
  "physical_quest_foreground_frame_pacing",
  "quest_controller_latency",
  "quest_hand_tracking_quality",
  "in_headset_text_readability",
  "thermal_or_battery_behavior",
  "production_runtime_readiness",
];

const unsafeNonHumanClaims = new Set([
  "physical_quest_foreground_frame_pacing",
  "quest_controller_latency",
  "quest_hand_tracking_quality",
  "in_headset_text_readability",
  "thermal_or_battery_behavior",
  "production_runtime_readiness",
  "production_quest_readiness",
]);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputPath) {
    throw new Error("--input is required");
  }

  const evidence = JSON.parse(await readFile(options.inputPath, "utf8")) as VisualQaEvidence;
  const report = buildVisualQaEvidenceReport({
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

  if (!report.result.readyForAdversarialVisualQa) {
    process.exitCode = 1;
  }
}

export function buildVisualQaEvidenceReport(input: {
  generatedAt?: string;
  inputFile?: string;
  evidence: VisualQaEvidence;
}): VisualQaEvidenceReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    evidence: input.evidence,
    result: evaluateVisualQaEvidence(input.evidence),
  };
}

export function evaluateVisualQaEvidence(evidence: VisualQaEvidence): VisualQaEvidenceReadiness {
  const capture = evidence.capture ?? {};
  const artifact = capture.artifact;
  const source = capture.source;
  const dimensions = capture.dimensions ?? {};
  const pngDimensions = artifact && capture.mimeType === "image/png" && existsSync(artifact)
    ? readPngDimensions(artifact)
    : undefined;
  const reviewChecks = evidence.adversarialReview?.checks ?? {};
  const notEvidenceFor = evidence.claimBoundaries?.notEvidenceFor ?? [];
  const allowedClaims = evidence.claimBoundaries?.allowedClaims ?? [];
  const nonHumanSource = source !== "human_worn_headset";

  const blockers = [
    evidence.schemaVersion === "openclinxr.visual-qa-evidence.v1" ? undefined : "schema_version_not_visual_qa_v1",
    source && allowedCaptureSources.includes(source) ? undefined : "capture_source_invalid_or_missing",
    capture.artifactType === "screenshot" ? undefined : "artifact_type_not_screenshot",
    artifact?.startsWith("docs/openclinxr/screenshots/") ? undefined : "artifact_not_under_docs_openclinxr_screenshots",
    capture.mimeType === "image/png" ? undefined : "artifact_mime_type_not_png",
    artifact && existsSync(artifact) ? undefined : "artifact_file_missing",
    artifact && existsSync(artifact) && statSync(artifact).size > 0 ? undefined : "artifact_file_empty",
    typeof dimensions.width === "number" && dimensions.width > 0 ? undefined : "artifact_width_invalid_or_missing",
    typeof dimensions.height === "number" && dimensions.height > 0 ? undefined : "artifact_height_invalid_or_missing",
    pngDimensions && dimensions.width === pngDimensions.width && dimensions.height === pngDimensions.height
      ? undefined
      : "artifact_dimensions_do_not_match_png_header",
    isLocalHttpUrl(capture.runtimeUrl) ? undefined : "runtime_url_not_localhost",
    capture.route?.startsWith("/") ? undefined : "route_invalid_or_missing",
    typeof capture.scenarioId === "string" && capture.scenarioId.trim().length > 0 ? undefined : "scenario_id_missing",
    typeof capture.xrMode === "string" && capture.xrMode.trim().length > 0 ? undefined : "xr_mode_missing",
    typeof capture.captureCommand === "string" && capture.captureCommand.trim().length > 0 ? undefined : "capture_command_missing",
    ...requiredReviewers.map((reviewer) => (
      evidence.adversarialReview?.reviewers?.includes(reviewer) ? undefined : `reviewer_missing:${reviewer}`
    )),
    ...requiredReviewChecks.flatMap((checkId) => reviewCheckBlockers(checkId, reviewChecks[checkId])),
    ...requiredNotEvidenceFor.map((claim) => (
      notEvidenceFor.includes(claim) ? undefined : `missing_not_evidence_for_${claim}`
    )),
    ...allowedClaims.map((claim) => (
      nonHumanSource && unsafeNonHumanClaims.has(claim) ? `unsafe_allowed_claim:${claim}` : undefined
    )),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    readyForAdversarialVisualQa: blockers.length === 0,
    readyForProductionRuntime: false,
    readyForPhysicalQuestClaim: false,
    blockers,
  };
}

function reviewCheckBlockers(
  checkId: VisualQaReviewCheckId,
  check: { status?: VisualQaReviewStatus; notes?: string[] } | undefined,
): string[] {
  if (!check) {
    return [`review_check_missing:${checkId}`];
  }
  return [
    check.status && check.status !== "not_assessed" ? undefined : `review_check_status_not_assessed:${checkId}`,
    Array.isArray(check.notes) && check.notes.some((note) => note.trim().length > 0)
      ? undefined
      : `review_check_missing_notes:${checkId}`,
    check.status === "blocked" ? `review_check_blocked:${checkId}` : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function readPngDimensions(filePath: string): { width: number; height: number } | undefined {
  const bytes = readFileSync(filePath);
  const pngSignature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== pngSignature) {
    return undefined;
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
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
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
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
