import {
  inspectMediaArtifact,
  isAllowedRelativeArtifactPath,
} from "./media-artifact-integrity.js";

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
