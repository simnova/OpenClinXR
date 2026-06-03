import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AssetGenerationCapabilityId,
  EncounterGenerationWorkOrderTargetKind,
} from "../../../packages/openclinxr/capability-gateway/src/index.js";
import { globFiles } from "../../agent-factory/lib.js";
import { requiredRuntimeRealismSignalIds } from "./runtime-realism-evidence-check.js";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
  validateLatest: boolean;
};

export type VisualQaCaptureSource =
  | "desktop_browser"
  | "quest_cdp"
  | "iwer_emulation"
  | "human_worn_headset";

export type VisualQaReviewStatus = "pass" | "concern" | "blocked" | "not_assessed";
export type HumanoidVisualAnalysisCheckId =
  | "face_visibility"
  | "mouth_movement_readability"
  | "eye_blink_micro_saccade_readability"
  | "gaze_target_alignment"
  | "emotion_expression_transition_readability"
  | "locomotion_path_realism"
  | "pose_naturalness"
  | "hand_arm_naturalness";

export type VisualQaEvidence = {
  schemaVersion?: string;
  visualQaFocus?: "general_scene_review" | "humanoid_realism";
  humanoidRealismSignalIds?: string[];
  visualRegressionCueIds?: string[];
  humanoidVisualAnalysis?: Partial<Record<HumanoidVisualAnalysisCheckId, {
    status?: VisualQaReviewStatus;
    notes?: string[];
  }>>;
  capture?: {
    source?: VisualQaCaptureSource;
    artifactType?: "screenshot" | "video";
    artifact?: string;
    mimeType?: string;
    dimensions?: {
      width?: number;
      height?: number;
    };
    durationMs?: number;
    frameCount?: number;
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

export type VisualQaRemediationEvidenceArtifact = {
  capturedAt?: string;
  scenarioId?: string;
  station?: string;
  captureMode?: string;
  artifactType?: "video";
  video?: string;
  linkedVisualQaGate?: string;
  runtimeSignalsObserved?: string[];
  reviewFocus?: HumanoidVisualAnalysisCheckId[];
  notes?: string[];
};

export type VisualQaReviewCheckId =
  | "clinical_scene_fidelity"
  | "actor_equipment_realism"
  | "equipment_necessity"
  | "scene_clutter_removal"
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
  remediationWorkOrderRefs?: VisualQaRemediationWorkOrderRef[];
};

export type VisualQaRemediationWorkOrderRef = {
  schemaVersion: "openclinxr.visual-qa-remediation-work-order-ref.v1";
  scenarioId: string;
  sourceEvidenceRef: string;
  blockerId: string;
  targetKind: EncounterGenerationWorkOrderTargetKind;
  capabilityId: AssetGenerationCapabilityId;
  workOrderRef: string;
  status: "planned_metadata_only";
  recommendedWorkerAction: string;
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type VisualQaRemediationCategory =
  | "gaze"
  | "mouth_viseme"
  | "expression_transition"
  | "locomotion_pose"
  | "clutter_equipment"
  | "mesh_readability"
  | "feedback_closure";

export type VisualQaLoopReadinessRemediationInput = {
  category: VisualQaRemediationCategory;
  blockerIds: string[];
  targetKinds: EncounterGenerationWorkOrderTargetKind[];
  capabilityIds: AssetGenerationCapabilityId[];
  workOrderRefs: string[];
  recommendedWorkerActions: string[];
};

export type VisualQaLoopReadinessSummary = {
  schemaVersion: "openclinxr.visual-qa-loop-readiness.v1";
  scenarioId: string;
  sourceEvidenceRef: string;
  sourceReadyForAdversarialVisualQa: boolean;
  readyForAutomatedRemediationLoop: boolean;
  evidenceCanDriveRemediationWithoutLiveHeadsetCapture: true;
  remediationInputCount: number;
  remediationInputs: VisualQaLoopReadinessRemediationInput[];
  unresolvedBlockers: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
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
  "equipment_necessity",
  "scene_clutter_removal",
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

const rejectedVisualRegressionCueIds = new Set([
  "persistent_gaze_readability_cue",
  "floating_eye_focus_overlay_after_dialogue",
  "broad_face_material_contrast_patch",
]);

const visualQaRelevantHumanoidRealismSignalIds = requiredRuntimeRealismSignalIds.filter((signalId) => (
  signalId !== "scenario_specific_vr_clinical_panel"
  && signalId !== "examinee_locomotion_observed"
));

const requiredHumanoidVisualAnalysisChecks: HumanoidVisualAnalysisCheckId[] = [
  "face_visibility",
  "mouth_movement_readability",
  "eye_blink_micro_saccade_readability",
  "gaze_target_alignment",
  "emotion_expression_transition_readability",
  "locomotion_path_realism",
  "pose_naturalness",
  "hand_arm_naturalness",
];

const strictHumanoidVisualChecksForAAA: HumanoidVisualAnalysisCheckId[] = [
  "mouth_movement_readability",
  "eye_blink_micro_saccade_readability",
  "gaze_target_alignment",
  "emotion_expression_transition_readability",
  "locomotion_path_realism",
  "pose_naturalness",
  "hand_arm_naturalness",
];

const realismMetadataPassRequiredCheckIds: VisualQaReviewCheckId[] = [
  "equipment_necessity",
  "scene_clutter_removal",
];

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest) {
    const report = await latestPassingVisualQaEvidenceReport();
    if (!report) {
      throw new Error("Missing passing visual QA evidence to validate.");
    }
    console.log(`Validated ${report.inputFile}`);
    return;
  }

  if (!options.inputPath) {
    throw new Error("--input is required");
  }

  const report = await readVisualQaEvidenceReport(options.inputPath);
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

async function readVisualQaEvidenceReport(inputPath: string): Promise<VisualQaEvidenceReport> {
  const evidence = normalizeVisualQaEvidenceInput(JSON.parse(await readFile(inputPath, "utf8")) as unknown);
  return buildVisualQaEvidenceReport({
    inputFile: inputPath,
    evidence,
  });
}

async function latestPassingVisualQaEvidenceReport(): Promise<VisualQaEvidenceReport | undefined> {
  const files = await globFiles("docs/openclinxr/visual-qa-evidence-*.json");
  const candidates = (await Promise.all(files.map(async (file) => {
    try {
      const report = await readVisualQaEvidenceReport(file);
      return {
        file,
        report,
        generatedAtMs: evidenceGeneratedAtMs(report.evidence),
      };
    } catch {
      return undefined;
    }
  }))).filter((candidate): candidate is {
    file: string;
    report: VisualQaEvidenceReport;
    generatedAtMs: number;
  } => candidate !== undefined && candidate.report.result.readyForAdversarialVisualQa);

  return candidates
    .sort((left, right) => {
      const timeDelta = normalizeTimestamp(left.generatedAtMs) - normalizeTimestamp(right.generatedAtMs);
      return timeDelta === 0 ? left.file.localeCompare(right.file) : timeDelta;
    })
    .at(-1)?.report;
}

export function buildVisualQaEvidenceReport(input: {
  generatedAt?: string;
  inputFile?: string;
  evidence: VisualQaEvidence;
}): VisualQaEvidenceReport {
  const report: VisualQaEvidenceReport = {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    evidence: input.evidence,
    result: evaluateVisualQaEvidence(input.evidence),
  };

  if (isNormalizedVisualQaRemediationEvidence(input.evidence)) {
    return {
      ...report,
      remediationWorkOrderRefs: buildVisualQaRemediationWorkOrderRefs(report),
    };
  }

  return report;
}

export function normalizeVisualQaEvidenceInput(value: unknown): VisualQaEvidence {
  if (isVisualQaEvidence(value)) {
    return value;
  }
  if (isVisualQaRemediationEvidenceArtifact(value)) {
    return visualQaEvidenceFromRemediationArtifact(value);
  }
  return value as VisualQaEvidence;
}

function isNormalizedVisualQaRemediationEvidence(evidence: VisualQaEvidence): boolean {
  return evidence.visualQaFocus === "humanoid_realism"
    && evidence.capture?.source === "desktop_browser"
    && evidence.capture?.artifactType === "video"
    && evidence.capture?.xrMode === "desktop_remediation_artifact_not_physical_quest"
    && typeof evidence.capture?.captureCommand === "string"
    && evidence.capture.captureCommand.includes("remediation")
    && evidence.claimBoundaries?.allowedClaims?.includes("adversarial_visual_iteration_artifact") === true;
}

export function buildVisualQaRemediationWorkOrderRefs(
  report: VisualQaEvidenceReport,
): VisualQaRemediationWorkOrderRef[] {
  const scenarioId = report.evidence.capture?.scenarioId?.trim() || "unknown_scenario";
  const sourceEvidenceRef = report.inputFile ?? report.evidence.capture?.artifact ?? `visual-qa-evidence://${scenarioId}/inline`;
  return report.result.blockers.map((blockerId) => {
    const target = remediationTargetForBlocker(blockerId);
    return {
      schemaVersion: "openclinxr.visual-qa-remediation-work-order-ref.v1",
      scenarioId,
      sourceEvidenceRef,
      blockerId,
      targetKind: target.targetKind,
      capabilityId: target.capabilityId,
      workOrderRef: `encounter-generation-work-order://${scenarioId}/${target.targetKind}/${safeWorkOrderSegment(blockerId)}`,
      status: "planned_metadata_only",
      recommendedWorkerAction: target.recommendedWorkerAction,
      notEvidenceFor: [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    };
  });
}

export function buildVisualQaLoopReadinessSummary(
  report: VisualQaEvidenceReport,
): VisualQaLoopReadinessSummary {
  const scenarioId = report.evidence.capture?.scenarioId?.trim() || "unknown_scenario";
  const sourceEvidenceRef = report.inputFile ?? report.evidence.capture?.artifact ?? `visual-qa-evidence://${scenarioId}/inline`;
  const remediationRefs = report.remediationWorkOrderRefs ?? buildVisualQaRemediationWorkOrderRefs(report);
  const remediationInputs = remediationRefs.reduce<VisualQaLoopReadinessRemediationInput[]>((inputs, ref) => {
    const category = remediationCategoryForBlocker(ref.blockerId);
    const existing = inputs.find((input) => input.category === category);
    if (existing) {
      existing.blockerIds = uniqueValues([...existing.blockerIds, ref.blockerId]);
      existing.targetKinds = uniqueValues([...existing.targetKinds, ref.targetKind]);
      existing.capabilityIds = uniqueValues([...existing.capabilityIds, ref.capabilityId]);
      existing.workOrderRefs = uniqueValues([...existing.workOrderRefs, ref.workOrderRef]);
      existing.recommendedWorkerActions = uniqueValues([...existing.recommendedWorkerActions, ref.recommendedWorkerAction]);
      return inputs;
    }
    inputs.push({
      category,
      blockerIds: [ref.blockerId],
      targetKinds: [ref.targetKind],
      capabilityIds: [ref.capabilityId],
      workOrderRefs: [ref.workOrderRef],
      recommendedWorkerActions: [ref.recommendedWorkerAction],
    });
    return inputs;
  }, []);

  return {
    schemaVersion: "openclinxr.visual-qa-loop-readiness.v1",
    scenarioId,
    sourceEvidenceRef,
    sourceReadyForAdversarialVisualQa: report.result.readyForAdversarialVisualQa,
    readyForAutomatedRemediationLoop: remediationInputs.length > 0,
    evidenceCanDriveRemediationWithoutLiveHeadsetCapture: true,
    remediationInputCount: remediationInputs.length,
    remediationInputs,
    unresolvedBlockers: [...report.result.blockers],
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
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
  const artifactSize = artifact && existsSync(artifact) ? statSync(artifact).size : 0;
  const reviewChecks = evidence.adversarialReview?.checks ?? {};
  const notEvidenceFor = evidence.claimBoundaries?.notEvidenceFor ?? [];
  const allowedClaims = evidence.claimBoundaries?.allowedClaims ?? [];
  const humanoidRealismSignalIds = evidence.humanoidRealismSignalIds ?? [];
  const visualRegressionCueIds = evidence.visualRegressionCueIds ?? [];
  const humanoidVisualAnalysis = evidence.humanoidVisualAnalysis ?? {};
  const nonHumanSource = source !== "human_worn_headset";
  const requiresHumanoidRealismSignals = evidence.visualQaFocus === "humanoid_realism";

  const blockers = [
    evidence.schemaVersion === "openclinxr.visual-qa-evidence.v1" ? undefined : "schema_version_not_visual_qa_v1",
    source && allowedCaptureSources.includes(source) ? undefined : "capture_source_invalid_or_missing",
    capture.artifactType === "screenshot" || capture.artifactType === "video" ? undefined : "artifact_type_not_screenshot_or_video",
    artifact?.startsWith("docs/openclinxr/screenshots/") || artifact?.startsWith("docs/openclinxr/videos/") ? undefined : "artifact_not_under_docs_openclinxr_visual_evidence",
    isSupportedVisualQaMimeType(capture.artifactType, capture.mimeType) ? undefined : "artifact_mime_type_not_supported",
    isVisualQaArtifactExtensionConsistent(artifact, capture.artifactType, capture.mimeType) ? undefined : "artifact_extension_mime_type_mismatch",
    artifact && existsSync(artifact) ? undefined : "artifact_file_missing",
    artifactSize > 0 ? undefined : "artifact_file_empty",
    capture.artifactType !== "video" || artifactSize >= 1024 ? undefined : "video_artifact_too_small_for_temporal_review",
    capture.artifactType !== "video" || (typeof capture.durationMs === "number" && capture.durationMs >= 1000)
      ? undefined
      : "video_duration_too_short_for_temporal_review",
    capture.artifactType !== "video" || (typeof capture.frameCount === "number" && capture.frameCount >= 12)
      ? undefined
      : "video_frame_count_too_low_for_temporal_review",
    capture.artifactType !== "video" || hasPlausibleTemporalFrameRate(capture.durationMs, capture.frameCount)
      ? undefined
      : "video_frame_rate_not_plausible_for_temporal_review",
    typeof dimensions.width === "number" && dimensions.width > 0 ? undefined : "artifact_width_invalid_or_missing",
    typeof dimensions.height === "number" && dimensions.height > 0 ? undefined : "artifact_height_invalid_or_missing",
    capture.artifactType === "video" || (pngDimensions && dimensions.width === pngDimensions.width && dimensions.height === pngDimensions.height)
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
    ...visualRegressionCueIds.map((cueId) => (
      rejectedVisualRegressionCueIds.has(cueId) ? `rejected_visual_regression_cue_present:${cueId}` : undefined
    )),
    ...visualQaRelevantHumanoidRealismSignalIds.map((signalId) => (
      requiresHumanoidRealismSignals && !humanoidRealismSignalIds.includes(signalId)
        ? `humanoid_realism_signal_missing:${signalId}`
        : undefined
    )),
    ...requiredHumanoidVisualAnalysisChecks.flatMap((checkId) => (
      requiresHumanoidRealismSignals
        ? humanoidVisualAnalysisBlockers(
          checkId,
          humanoidVisualAnalysis[checkId],
          capture.artifactType,
          requiresHumanoidRealismSignals,
        )
        : []
    )),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    readyForAdversarialVisualQa: blockers.length === 0,
    readyForProductionRuntime: false,
    readyForPhysicalQuestClaim: false,
    blockers,
  };
}

function remediationTargetForBlocker(blockerId: string): {
  targetKind: EncounterGenerationWorkOrderTargetKind;
  capabilityId: AssetGenerationCapabilityId;
  recommendedWorkerAction: string;
} {
  if (
    blockerId.includes("mouth_movement_readability")
    || blockerId.includes("gaze_target_alignment")
    || blockerId.includes("eye_blink_micro_saccade_readability")
    || blockerId.includes("emotion_expression_transition_readability")
    || blockerId.includes("dialogue_viseme_and_gaze_mapping")
  ) {
    return {
      targetKind: "facial_lipsync_gaze_animation",
      capabilityId: "animation-generation",
      recommendedWorkerAction: "Regenerate or refine facial, viseme, gaze, blink, and emotion-transition animation tracks from the encounter dialogue and affect timeline.",
    };
  }
  if (
    blockerId.includes("pose_naturalness")
    || blockerId.includes("hand_arm_naturalness")
    || blockerId.includes("locomotion_path_realism")
    || blockerId.includes("authored_clinical_idle_pose_runtime_cue")
    || blockerId.includes("animated_humanoid_runtime_playback")
  ) {
    return {
      targetKind: "role_idle_animation_glb",
      capabilityId: "animation-generation",
      recommendedWorkerAction: "Regenerate role-specific clinical idle, hand, arm, posture, and locomotion clips that match the scenario blocking.",
    };
  }
  if (
    blockerId.includes("face_visibility")
    || blockerId.includes("visible_mouth_eye_expression_cues")
  ) {
    return {
      targetKind: "role_specific_humanoid_glb",
      capabilityId: "character-generation",
      recommendedWorkerAction: "Regenerate the role-specific humanoid mesh, head, clothing, and material setup so face, eyes, mouth, and role identity are readable.",
    };
  }
  if (
    blockerId.includes("clinical_scene_fidelity")
    || blockerId.includes("actor_equipment_realism")
    || blockerId.includes("equipment_necessity")
    || blockerId.includes("scene_clutter_removal")
    || blockerId.includes("occlusion_scale")
  ) {
    return {
      targetKind: "medical_equipment_glb",
      capabilityId: "medical-equipment-generation",
      recommendedWorkerAction: "Regenerate semantic ED equipment and room props with anchored placement, scale, cable/tube logic, and clinical affordances.",
    };
  }
  return {
    targetKind: "visual_feedback_closure",
    capabilityId: "asset-bake",
    recommendedWorkerAction: "Attach the blocker to the adversarial visual-feedback closure pass and keep it open until new screenshot or video evidence resolves it.",
  };
}

function remediationCategoryForBlocker(blockerId: string): VisualQaRemediationCategory {
  if (blockerId.includes("gaze") || blockerId.includes("eye_blink") || blockerId.includes("micro_saccade") || blockerId.includes("eyelid")) {
    return "gaze";
  }
  if (blockerId.includes("mouth") || blockerId.includes("viseme") || blockerId.includes("lip")) {
    return "mouth_viseme";
  }
  if (blockerId.includes("emotion_expression") || blockerId.includes("expression_transition")) {
    return "expression_transition";
  }
  if (blockerId.includes("locomotion") || blockerId.includes("pose") || blockerId.includes("hand_arm") || blockerId.includes("clinical_idle")) {
    return "locomotion_pose";
  }
  if (blockerId.includes("equipment") || blockerId.includes("clutter") || blockerId.includes("clinical_scene") || blockerId.includes("occlusion_scale")) {
    return "clutter_equipment";
  }
  if (blockerId.includes("face_visibility") || blockerId.includes("visible_mouth_eye_expression_cues")) {
    return "mesh_readability";
  }
  return "feedback_closure";
}

function visualQaEvidenceFromRemediationArtifact(artifact: VisualQaRemediationEvidenceArtifact): VisualQaEvidence {
  const video = artifact.video ?? "";
  return {
    schemaVersion: "openclinxr.visual-qa-evidence.v1",
    visualQaFocus: "humanoid_realism",
    humanoidRealismSignalIds: artifact.runtimeSignalsObserved ?? [],
    capture: {
      source: "desktop_browser",
      artifactType: "video",
      artifact: video,
      mimeType: video.endsWith(".mp4") ? "video/mp4" : "video/webm",
      dimensions: { width: 1280, height: 720 },
      durationMs: 0,
      frameCount: 0,
      runtimeUrl: "http://127.0.0.1:5183/",
      route: "/",
      scenarioId: artifact.scenarioId,
      xrMode: "desktop_remediation_artifact_not_physical_quest",
      captureCommand: artifact.captureMode ?? "desktop-remediation-artifact",
    },
    humanoidVisualAnalysis: humanoidVisualAnalysisFromRemediationArtifact(artifact),
    adversarialReview: {
      reviewers: [...requiredReviewers],
      checks: {
        clinical_scene_fidelity: { status: "concern", notes: artifact.notes ?? ["Desktop remediation artifact needs adversarial clinical-fidelity review."] },
        actor_equipment_realism: { status: "concern", notes: ["Desktop remediation artifact is a review input, not asset realism proof."] },
        equipment_necessity: { status: "pass", notes: ["This remediation pass is focused on humanoid face, mouth, gaze, and posture rather than adding scene clutter."] },
        scene_clutter_removal: { status: "pass", notes: ["No new runtime scene clutter is introduced by this remediation artifact."] },
        ui_readability: { status: "concern", notes: ["Desktop artifact can guide remediation but does not prove headset readability."] },
        interaction_affordances: { status: "concern", notes: ["Desktop remediation artifact does not prove controller, hand, or learner interaction affordances."] },
        occlusion_scale: { status: "concern", notes: ["Desktop remediation artifact does not prove physical scale or occlusion in a worn headset."] },
        evidence_limits: { status: "pass", notes: ["Evidence is desktop remediation input only and must not be used for Quest, learner, production, clinical, or scoring readiness claims."] },
      },
    },
    claimBoundaries: {
      notEvidenceFor: [...requiredNotEvidenceFor],
      allowedClaims: ["adversarial_visual_iteration_artifact"],
    },
  };
}

function humanoidVisualAnalysisFromRemediationArtifact(
  artifact: VisualQaRemediationEvidenceArtifact,
): NonNullable<VisualQaEvidence["humanoidVisualAnalysis"]> {
  const reviewFocus = new Set(artifact.reviewFocus ?? []);
  const analysis = Object.fromEntries(requiredHumanoidVisualAnalysisChecks.map((checkId) => [
    checkId,
    {
      status: reviewFocus.has(checkId) ? "blocked" : "concern",
      notes: [reviewFocus.has(checkId)
        ? `Desktop remediation artifact flags ${checkId} for next worker remediation.`
        : `Desktop remediation artifact does not close ${checkId}; keep it under review.`],
    },
  ])) as NonNullable<VisualQaEvidence["humanoidVisualAnalysis"]>;
  return analysis;
}

function isVisualQaEvidence(value: unknown): value is VisualQaEvidence {
  return isRecord(value) && value.schemaVersion === "openclinxr.visual-qa-evidence.v1";
}

function isVisualQaRemediationEvidenceArtifact(value: unknown): value is VisualQaRemediationEvidenceArtifact {
  return isRecord(value)
    && value.artifactType === "video"
    && typeof value.video === "string"
    && Array.isArray(value.reviewFocus)
    && Array.isArray(value.runtimeSignalsObserved);
}

function safeWorkOrderSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "visual_qa_blocker";
}

function humanoidVisualAnalysisBlockers(
  checkId: HumanoidVisualAnalysisCheckId,
  check: { status?: VisualQaReviewStatus; notes?: string[] } | undefined,
  artifactType?: "screenshot" | "video",
  requiresHumanoidRealismSignals = false,
): string[] {
  if (!check) {
    return [`humanoid_visual_analysis_missing:${checkId}`];
  }
  const isCriticalForAAA = strictHumanoidVisualChecksForAAA.includes(checkId);
  return [
    check.status && check.status !== "not_assessed" ? undefined : `humanoid_visual_analysis_status_not_assessed:${checkId}`,
    requiresHumanoidRealismSignals && isCriticalForAAA && check.status !== "pass"
      ? `humanoid_visual_analysis_strict_pass_required:${checkId}`
      : undefined,
    Array.isArray(check.notes) && check.notes.some((note) => note.trim().length > 0)
      ? undefined
      : `humanoid_visual_analysis_missing_notes:${checkId}`,
    check.status === "blocked" ? `humanoid_visual_analysis_blocked:${checkId}` : undefined,
    checkId === "eye_blink_micro_saccade_readability" && check.status === "pass" && artifactType !== "video"
      ? "humanoid_visual_analysis_temporal_pass_requires_video:eye_blink_micro_saccade_readability"
      : undefined,
    checkId === "emotion_expression_transition_readability" && check.status === "pass" && artifactType !== "video"
      ? "humanoid_visual_analysis_temporal_pass_requires_video:emotion_expression_transition_readability"
      : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function reviewCheckBlockers(
  checkId: VisualQaReviewCheckId,
  check: { status?: VisualQaReviewStatus; notes?: string[] } | undefined,
): string[] {
  if (!check) {
    return [`review_check_missing:${checkId}`];
  }
  return [
    realismMetadataPassRequiredCheckIds.includes(checkId) && check.status !== "pass"
      ? `review_check_pass_required_for_realism_metadata:${checkId}`
      : undefined,
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

function isSupportedVisualQaMimeType(artifactType: "screenshot" | "video" | undefined, mimeType: string | undefined): boolean {
  if (artifactType === "screenshot") {
    return mimeType === "image/png";
  }
  if (artifactType === "video") {
    return mimeType === "video/mp4" || mimeType === "video/webm";
  }
  return false;
}

function isVisualQaArtifactExtensionConsistent(
  artifact: string | undefined,
  artifactType: "screenshot" | "video" | undefined,
  mimeType: string | undefined,
): boolean {
  if (!artifact || !artifactType || !mimeType) {
    return false;
  }
  if (artifactType === "screenshot") {
    return mimeType === "image/png" && artifact.endsWith(".png");
  }
  if (artifactType === "video") {
    return (mimeType === "video/webm" && artifact.endsWith(".webm")) || (mimeType === "video/mp4" && artifact.endsWith(".mp4"));
  }
  return false;
}

function hasPlausibleTemporalFrameRate(durationMs: number | undefined, frameCount: number | undefined): boolean {
  if (typeof durationMs !== "number" || typeof frameCount !== "number" || durationMs <= 0) {
    return false;
  }
  const framesPerSecond = frameCount / (durationMs / 1000);
  return framesPerSecond >= 6 && framesPerSecond <= 120;
}

function evidenceGeneratedAtMs(evidence: VisualQaEvidence): number {
  const generatedAt = (evidence as { generatedAt?: unknown }).generatedAt;
  return typeof generatedAt === "string" ? Date.parse(generatedAt) : Number.NaN;
}

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
