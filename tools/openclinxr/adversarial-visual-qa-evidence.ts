import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { globFiles } from "../agent-factory/lib.js";
import {
  inspectMediaArtifact,
  isAllowedRelativeArtifactPath,
} from "./media-artifact-integrity.js";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
  validateLatest: boolean;
};

export type AdversarialVisualQaSource =
  | "browser"
  | "desktop_browser"
  | "iwer"
  | "iwer_emulation"
  | "quest_cdp"
  | "human_headset"
  | "human_worn_headset";

export type AdversarialVisualQaMedia = {
  source?: AdversarialVisualQaSource;
  artifactType?: "screenshot" | "video";
  artifact?: string;
  mimeType?: string;
  bytes?: number;
  dimensions?: {
    width?: number;
    height?: number;
  };
  runtimeUrl?: string;
  route?: string;
  scenarioId?: string;
  xrMode?: string;
  captureCommand?: string;
};

export type AdversarialVisualQaEvidence = {
  schemaVersion?: string;
  media?: AdversarialVisualQaMedia[];
  notes?: string[];
  notEvidenceFor?: string[];
  allowedClaims?: string[];
};

export type AdversarialVisualQaEvidenceReadiness = {
  readyForAdversarialVisualQaSupport: boolean;
  readyForProductionRuntime: false;
  readyForPhysicalQuestClaim: false;
  blockers: string[];
};

export type AdversarialVisualQaEvidenceReport = {
  generatedAt: string;
  inputFile?: string;
  evidence: AdversarialVisualQaEvidence;
  result: AdversarialVisualQaEvidenceReadiness;
};

const allowedSources: AdversarialVisualQaSource[] = [
  "browser",
  "desktop_browser",
  "iwer",
  "iwer_emulation",
  "quest_cdp",
  "human_headset",
  "human_worn_headset",
];

const requiredNotEvidenceFor = [
  "physical_quest_foreground_frame_pacing",
  "quest_controller_latency",
  "quest_hand_tracking_quality",
  "in_headset_text_readability",
  "thermal_or_battery_behavior",
  "production_runtime_readiness",
];

const unsafeAutomatedClaims = new Set([
  "physical_quest_readiness",
  "physical_quest_foreground_frame_pacing",
  "quest_controller_latency",
  "quest_hand_tracking_quality",
  "in_headset_text_readability",
  "thermal_or_battery_behavior",
  "production_runtime_readiness",
  "production_quest_readiness",
]);

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest) {
    const inputPath = await latestAdversarialVisualQaEvidencePath();
    if (!inputPath) {
      throw new Error("Missing adversarial visual QA evidence to validate.");
    }
    const report = await readAdversarialVisualQaEvidenceReport(inputPath);
    if (report.result.readyForAdversarialVisualQaSupport) {
      console.log(`Validated ${inputPath}`);
      return;
    }

    for (const blocker of report.result.blockers) {
      console.error(blocker);
    }
    process.exitCode = 1;
    return;
  }

  if (!options.inputPath) {
    throw new Error("--input is required");
  }

  const report = await readAdversarialVisualQaEvidenceReport(options.inputPath);
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.result.readyForAdversarialVisualQaSupport) {
    process.exitCode = 1;
  }
}

async function readAdversarialVisualQaEvidenceReport(inputPath: string): Promise<AdversarialVisualQaEvidenceReport> {
  const evidence = JSON.parse(await readFile(inputPath, "utf8")) as AdversarialVisualQaEvidence;
  return buildAdversarialVisualQaEvidenceReport({
    inputFile: inputPath,
    evidence,
  });
}

async function latestAdversarialVisualQaEvidencePath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/adversarial-visual-qa-evidence-*.json");
  return files.sort().at(-1);
}

export function buildAdversarialVisualQaEvidenceReport(input: {
  generatedAt?: string;
  inputFile?: string;
  evidence: AdversarialVisualQaEvidence;
}): AdversarialVisualQaEvidenceReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    evidence: input.evidence,
    result: evaluateAdversarialVisualQaEvidence(input.evidence),
  };
}

export function evaluateAdversarialVisualQaEvidence(
  evidence: AdversarialVisualQaEvidence,
): AdversarialVisualQaEvidenceReadiness {
  const media = evidence.media ?? [];
  const notes = evidence.notes ?? [];
  const allowedClaims = evidence.allowedClaims ?? [];
  const notEvidenceFor = evidence.notEvidenceFor ?? [];
  const hasAutomatedSource = media.some((item) => item.source !== "human_headset" && item.source !== "human_worn_headset");
  const hasHumanHeadsetSource = media.some((item) => item.source === "human_headset" || item.source === "human_worn_headset");

  const blockers = [
    evidence.schemaVersion === "openclinxr.adversarial-visual-qa-evidence.v1"
      ? undefined
      : "schema_version_not_adversarial_visual_qa_v1",
    media.length > 0 ? undefined : "media_missing",
    ...media.flatMap((item, index) => mediaBlockers(item, index)),
    ...requiredNotEvidenceFor.map((claim) => (
      notEvidenceFor.includes(claim) ? undefined : `missing_not_evidence_for_${claim}`
    )),
    ...allowedClaims.map((claim) => (
      unsafeAutomatedClaims.has(claim) ? `unsafe_allowed_claim:${claim}` : undefined
    )),
    ...limitationNoteBlockers(notes, { hasAutomatedSource, hasHumanHeadsetSource }),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    readyForAdversarialVisualQaSupport: blockers.length === 0,
    readyForProductionRuntime: false,
    readyForPhysicalQuestClaim: false,
    blockers,
  };
}

function mediaBlockers(media: AdversarialVisualQaMedia, index: number): string[] {
  const prefix = `media[${index}]`;
  const artifact = media.artifact;
  const dimensions = media.dimensions ?? {};
  const artifactIntegrity = inspectMediaArtifact(artifact);
  const fileSize = artifactIntegrity.size;
  const pngDimensions = artifactIntegrity.pngDimensions;
  const screenshotPng = media.artifactType === "screenshot" && media.mimeType === "image/png";

  return [
    media.source && allowedSources.includes(media.source) ? undefined : `${prefix}.source_invalid_or_missing`,
    media.artifactType === "screenshot" || media.artifactType === "video"
      ? undefined
      : `${prefix}.artifact_type_invalid_or_missing`,
    artifact && isAllowedArtifactPath(artifact, media.artifactType)
      ? undefined
      : `${prefix}.artifact_not_under_allowed_media_dir`,
    mimeTypeMatchesArtifactType(media.mimeType, media.artifactType) ? undefined : `${prefix}.mime_type_invalid_for_artifact_type`,
    artifact ? undefined : `${prefix}.artifact_missing`,
    artifactIntegrity.exists ? undefined : `${prefix}.artifact_file_missing`,
    fileSize === undefined || fileSize > 0 ? undefined : `${prefix}.artifact_file_empty`,
    typeof media.bytes === "number" && media.bytes > 0 ? undefined : `${prefix}.artifact_bytes_invalid_or_missing`,
    typeof media.bytes === "number" && fileSize !== undefined && media.bytes !== fileSize
      ? `${prefix}.artifact_bytes_do_not_match_file_size`
      : undefined,
    media.artifactType === "screenshot" && !(typeof dimensions.width === "number" && dimensions.width > 0)
      ? `${prefix}.artifact_width_invalid_or_missing`
      : undefined,
    media.artifactType === "screenshot" && !(typeof dimensions.height === "number" && dimensions.height > 0)
      ? `${prefix}.artifact_height_invalid_or_missing`
      : undefined,
    screenshotPng && artifactIntegrity.exists && !pngDimensions ? `${prefix}.artifact_png_signature_invalid` : undefined,
    screenshotPng && pngDimensions
      && (dimensions.width !== pngDimensions.width || dimensions.height !== pngDimensions.height)
      ? `${prefix}.artifact_dimensions_do_not_match_png_header`
      : undefined,
    typeof media.runtimeUrl === "string" && media.runtimeUrl.trim().length > 0
      ? undefined
      : `${prefix}.runtime_url_missing`,
    media.route?.startsWith("/") ? undefined : `${prefix}.route_invalid_or_missing`,
    typeof media.scenarioId === "string" && media.scenarioId.trim().length > 0
      ? undefined
      : `${prefix}.scenario_id_missing`,
    typeof media.xrMode === "string" && media.xrMode.trim().length > 0 ? undefined : `${prefix}.xr_mode_missing`,
    typeof media.captureCommand === "string" && media.captureCommand.trim().length > 0
      ? undefined
      : `${prefix}.capture_command_missing`,
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function isAllowedArtifactPath(artifact: string, artifactType: AdversarialVisualQaMedia["artifactType"]): boolean {
  if (artifactType === "screenshot") {
    return isAllowedRelativeArtifactPath(artifact, "docs/openclinxr/screenshots/");
  }
  if (artifactType === "video") {
    return isAllowedRelativeArtifactPath(artifact, "docs/openclinxr/videos/");
  }
  return false;
}

function mimeTypeMatchesArtifactType(
  mimeType: string | undefined,
  artifactType: AdversarialVisualQaMedia["artifactType"],
): boolean {
  if (artifactType === "screenshot") {
    return mimeType === "image/png";
  }
  if (artifactType === "video") {
    return typeof mimeType === "string" && mimeType.startsWith("video/");
  }
  return false;
}

function limitationNoteBlockers(
  notes: string[],
  sourceKinds: { hasAutomatedSource: boolean; hasHumanHeadsetSource: boolean },
): string[] {
  const text = notes.join(" ").toLowerCase();
  const automatedBlockers = sourceKinds.hasAutomatedSource
    ? [
        text.includes("not physical") ? undefined : "missing_limit_note:not_physical",
        text.includes("not quest") || text.includes("not a headset")
          ? undefined
          : "missing_limit_note:not_quest_or_headset",
        text.includes("emulation only") || text.includes("cdp only") || text.includes("browser only")
          ? undefined
          : "missing_limit_note:source_scope_only",
        text.includes("manual headset") || text.includes("manual quest")
          ? undefined
          : "missing_limit_note:manual_headset_required",
      ]
    : [];
  const humanHeadsetBlockers = sourceKinds.hasHumanHeadsetSource
    ? [
        text.includes("visual qa") || text.includes("visual iteration")
          ? undefined
          : "missing_limit_note:visual_qa_only",
        text.includes("readiness remains separate") || text.includes("readiness is separate")
          ? undefined
          : "missing_limit_note:physical_readiness_separate",
        text.includes("manual headset") || text.includes("manual quest")
          ? undefined
          : "missing_limit_note:manual_headset_required",
      ]
    : [];

  return [...automatedBlockers, ...humanHeadsetBlockers]
    .filter((blocker): blocker is string => typeof blocker === "string");
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
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
