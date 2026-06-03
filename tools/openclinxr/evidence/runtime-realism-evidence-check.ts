import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { globFiles } from "../../agent-factory/lib.js";

const defaultOutputPath = `docs/openclinxr/runtime-realism-evidence-check-${new Date().toISOString().slice(0, 10)}.json`;
const rejectedVisualRegressionCueIds = new Set([
  "persistent_gaze_readability_cue",
  "broad_face_material_contrast_patch",
  "floating_eye_focus_overlay_after_dialogue",
]);
const emotionTransitionMsBoundsMs = {
  min: 120,
  max: 1500,
};
const microSaccadeAxisMagnitudeBounds = {
  min: 0,
  max: 0.08,
};
const requiredHumanoidRealismProfileEvidenceIds = [
  "dialogue_viseme_and_gaze_mapping",
  "dialogue_eye_micro_saccade_blink_cue",
  "generated_eyelid_blink_control_cue",
  "emotion_aligned_expression_transition_cue",
];

export const requiredRuntimeRealismSignalIds = [
  "animated_humanoid_runtime_playback",
  "authored_clinical_idle_pose_runtime_cue",
  "visible_mouth_eye_expression_cues",
  "scenario_specific_vr_clinical_panel",
  "dialogue_viseme_and_gaze_mapping",
  "dialogue_eye_micro_saccade_blink_cue",
  "generated_eyelid_blink_control_cue",
  "emotion_aligned_expression_transition_cue",
  "examinee_locomotion_observed",
];

export type RuntimeRealismEvidenceCheckReport = {
  schemaVersion: "openclinxr.runtime-realism-evidence-check.v1";
  generatedAt: string;
  inputFile: string;
  result: {
    status: "realism_evidence_present" | "realism_evidence_blocked";
    blockers: string[];
    passedSignals: string[];
  };
  productionReadinessClaimed: false;
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

type CliOptions = {
  inputPath?: string | undefined;
  outputPath: string;
  validateLatest: boolean;
  validatePath?: string | undefined;
};

async function main(): Promise<void> {
  await runRuntimeRealismEvidenceCheckCli(process.argv.slice(2));
}

export async function runRuntimeRealismEvidenceCheckCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest || options.validatePath) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/runtime-realism-evidence-check-*.json");
    if (!validatePath) throw new Error("Missing runtime realism evidence check report to validate.");
    const validation = validateRuntimeRealismEvidenceCheckReport(JSON.parse(await readFile(validatePath, "utf8")) as unknown);
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  if (!options.inputPath) throw new Error("Missing --input evidence JSON path.");
  const evidence = JSON.parse(await readFile(options.inputPath, "utf8")) as unknown;
  const report = buildRuntimeRealismEvidenceCheckReport({ inputFile: options.inputPath, evidence });
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

export function buildRuntimeRealismEvidenceCheckReport(input: {
  inputFile: string;
  evidence: unknown;
  generatedAt?: string | undefined;
}): RuntimeRealismEvidenceCheckReport {
  const evidence = isRecord(input.evidence) ? input.evidence : {};
  const humanoidRealismProfiles = Array.isArray(evidence.humanoidRealismProfiles)
    ? evidence.humanoidRealismProfiles.filter(isRecord)
    : [];
  const sceneAssets = isRecord(evidence.sceneAssets)
    ? evidence.sceneAssets
    : isRecord(evidence.sceneAssetEvidence)
      ? evidence.sceneAssetEvidence
      : {};
  const humanoidAssets = Array.isArray(sceneAssets.assets)
    ? sceneAssets.assets.filter((asset) => isRecord(asset) && String(asset.assetId ?? "").includes("generated-humanoid-glb"))
    : [];
  const animatedHumanoidCount = humanoidAssets.filter((asset) => isRecord(asset) && asset.animationPlayback === "gltf_animation_clips_playing").length;
  const authoredClinicalIdlePoseCount = humanoidAssets.filter((asset) =>
    isRecord(asset)
    && Array.isArray(asset.affordanceCueIds)
    && asset.affordanceCueIds.map(String).some((cueId) => cueId.endsWith("authored_clinical_idle_pose_clip_cue"))
  ).length;
  const visualCueIds = Array.isArray(sceneAssets.visualFidelityCueIds) ? sceneAssets.visualFidelityCueIds.map(String) : [];
  const textPanelEvidence = isRecord(evidence.textPanelEvidence) ? evidence.textPanelEvidence : {};
  const panels = Array.isArray(textPanelEvidence.panels) ? textPanelEvidence.panels.filter(isRecord) : [];
  const clinicalPanel = panels.find((panel) => String(panel.name ?? "").includes("clinical-panel"));
  const clinicalLines = isRecord(clinicalPanel) && Array.isArray(clinicalPanel.previewLines)
    ? clinicalPanel.previewLines.map(String)
    : [];
  const humanoidSpeech = isRecord(evidence.humanoidSpeech)
    ? evidence.humanoidSpeech
    : isRecord(evidence.humanoidSpeechEvidence)
      ? evidence.humanoidSpeechEvidence
      : isRecord(evidence.speech)
        ? evidence.speech
        : {};
  const captureSummary = isRecord(evidence.captureSummary) ? evidence.captureSummary : {};
  const sceneManifestEvidence = isRecord(evidence.runtimeSceneManifestEvidence) ? evidence.runtimeSceneManifestEvidence : {};
  const visemeCount = Array.isArray(humanoidSpeech.visemeSequence) ? humanoidSpeech.visemeSequence.length : 0;
  const activeVisemeMapped =
    typeof humanoidSpeech.activeViseme === "string" &&
    typeof humanoidSpeech.activePhoneme === "string" &&
    typeof humanoidSpeech.activeMouthOpenness === "number" &&
    Array.isArray(humanoidSpeech.activeExpressionCueIds);
  const activeExpressionCueIds = Array.isArray(humanoidSpeech.activeExpressionCueIds)
    ? humanoidSpeech.activeExpressionCueIds.map(String)
    : [];
  const hasVisibleMouthShapeCue = activeExpressionCueIds.includes("visible_runtime_mouth_shape_cue");
  const hasVisibleEyeFocusCue = activeExpressionCueIds.includes("visible_runtime_eye_focus_cue");
  const hasDialogueEyeMicroSaccadeCue = activeExpressionCueIds.includes("dialogue_eye_micro_saccade_blink_cue")
    && activeExpressionCueIds.includes("generated_eyelid_blink_control_cue");
  const hasEmotionTransitionCue = activeExpressionCueIds.includes("emotion_aligned_expression_transition_cue");
  const eyeMotionMetricsPresent =
    typeof humanoidSpeech.activeEyeBlinkIntensity === "number" &&
    typeof humanoidSpeech.activeEyeMicroSaccadeYaw === "number" &&
    typeof humanoidSpeech.activeEyeMicroSaccadePitch === "number" &&
    humanoidSpeech.activeEyeBlinkIntensity >= 0 &&
    humanoidSpeech.activeEyeBlinkIntensity <= 1 &&
    Math.abs(humanoidSpeech.activeEyeMicroSaccadeYaw) >= microSaccadeAxisMagnitudeBounds.min
    && Math.abs(humanoidSpeech.activeEyeMicroSaccadeYaw) <= microSaccadeAxisMagnitudeBounds.max
    && Math.abs(humanoidSpeech.activeEyeMicroSaccadePitch) >= microSaccadeAxisMagnitudeBounds.min
    && Math.abs(humanoidSpeech.activeEyeMicroSaccadePitch) <= microSaccadeAxisMagnitudeBounds.max;
  const eyeMicroSaccadeBlinkMapped = activeExpressionCueIds.includes("dialogue_eye_micro_saccade_blink_cue")
    && activeExpressionCueIds.includes("generated_eyelid_blink_control_cue");
  const expressionWeights = isRecord(humanoidSpeech.activeExpressionWeights) ? humanoidSpeech.activeExpressionWeights : {};
  const emotionExpressionTransitionMapped = activeExpressionCueIds.includes("emotion_aligned_expression_transition_cue")
    && typeof humanoidSpeech.activeEmotionState === "string"
    && typeof humanoidSpeech.activeExpressionTransitionMs === "number"
    && humanoidSpeech.activeExpressionTransitionMs >= emotionTransitionMsBoundsMs.min
    && humanoidSpeech.activeExpressionTransitionMs <= emotionTransitionMsBoundsMs.max
    && typeof expressionWeights.mouthOpen === "number"
    && typeof expressionWeights.browConcern === "number"
    && typeof expressionWeights.cheekTension === "number";
  const duringMove = isRecord(evidence.duringMove) ? evidence.duringMove : {};
  const duringMoveDelta = isRecord(duringMove.locomotionDelta) ? duringMove.locomotionDelta : {};
  const duringMoveDistance = typeof duringMoveDelta.distanceMeters === "number" ? duringMoveDelta.distanceMeters : 0;
  const examineeLocomotion = isRecord(evidence.examineeLocomotion)
    ? evidence.examineeLocomotion
    : isRecord(evidence.examineeLocomotionEvidence)
      ? evidence.examineeLocomotionEvidence
      : isRecord(evidence.locomotion)
        ? evidence.locomotion
        : {};
  const structuredLocomotionDistance = typeof examineeLocomotion.distanceMeters === "number"
    ? examineeLocomotion.distanceMeters
    : 0;
  const structuredLocomotionSamples = typeof examineeLocomotion.sampleCount === "number"
    ? examineeLocomotion.sampleCount
    : 0;
  const structuredLocomotionCueIds = Array.isArray(examineeLocomotion.pathCueIds)
    ? examineeLocomotion.pathCueIds.map(String)
    : [];
  const structuredLocomotionObserved = structuredLocomotionDistance > 0
    && structuredLocomotionSamples > 0
    && structuredLocomotionCueIds.includes("structured_examinee_locomotion_path_evidence");
  const locomotionPathQuality = isRecord(captureSummary.locomotionPathQuality)
    ? captureSummary.locomotionPathQuality
    : isRecord(evidence.locomotionPathQuality)
      ? evidence.locomotionPathQuality
      : {};
  const locomotionPathSampleCount = isNumber(locomotionPathQuality.sampleCount) ? locomotionPathQuality.sampleCount : 0;
  const locomotionPathDistance = isNumber(locomotionPathQuality.distanceMeters) ? locomotionPathQuality.distanceMeters : 0;
  const locomotionPathTurnRadians = isNumber(locomotionPathQuality.turnRadians) ? locomotionPathQuality.turnRadians : 0;
  const locomotionPathCueIds = Array.isArray(locomotionPathQuality.pathCueIds) ? locomotionPathQuality.pathCueIds.map(String) : [];
  const locomotionPathBlockers = Array.isArray(locomotionPathQuality.blockers) ? locomotionPathQuality.blockers.map(String) : [];
  const locomotionPathHasRealisticShape = locomotionPathSampleCount >= 2
    ? locamotionPathDistanceAndTurnValid(locomotionPathDistance, locomotionPathTurnRadians, locomotionPathCueIds, locomotionPathBlockers)
    : false;
  const movementPanelLine = panels.flatMap((panel) => Array.isArray(panel.previewLines) ? panel.previewLines.map(String) : [])
    .find((line) => line.startsWith("Movement:"));
  const movementPanelIndicatesPath = movementPanelLine?.toLowerCase().includes("path ") === true;
  const allSceneAssets = Array.isArray(sceneAssets.assets) ? sceneAssets.assets : [];
  const medicalEquipmentAssets = allSceneAssets.filter((asset) => {
    const path = String(isRecord(asset) ? asset.assetPath : "");
    const assetId = String(isRecord(asset) ? asset.assetId : "");
    return path.includes("/medical-equipment/") || assetId.includes("_equipment.");
  });
  const hasRuntimeManifestEquipmentEvidence = typeof sceneManifestEvidence.equipmentPlacementCount === "number"
    ? sceneManifestEvidence.equipmentPlacementCount > 0
    : false;
  const equipmentNecessitySignal = medicalEquipmentAssets.length > 0 || hasRuntimeManifestEquipmentEvidence;
  const hasDeclutterCues = visualCueIds.includes("humanoid_interaction_target_decluttered")
    || visualCueIds.includes("room_prop_label_occlusion_reduced");
  const hasDeclutterFraming = sceneAssets.cameraFramingCue === "humanoid_camera_framing_decluttered_three_actor_environment_review";
  const noFallbackClutterIndicators = (typeof sceneAssets.pendingCount === "number" ? sceneAssets.pendingCount === 0 : true)
    && (typeof sceneAssets.failedCount === "number" ? sceneAssets.failedCount === 0 : true)
    && (typeof sceneAssets.fallbackActiveCount === "number" ? sceneAssets.fallbackActiveCount === 0 : true);
  const sceneClutterRemovalSignal = hasDeclutterCues && hasDeclutterFraming && noFallbackClutterIndicators;
  const lipsyncSignal = visemeCount > 1
    && hasDialogueEyeMicroSaccadeCue
    && hasVisibleMouthShapeCue
    && activeVisemeMapped
    && typeof humanoidSpeech.activeMouthOpenness === "number"
    && humanoidSpeech.activeMouthOpenness >= 0.02
    && humanoidSpeech.activeMouthOpenness <= 0.95;
  const eyeGazeSignal = hasDialogueEyeMicroSaccadeCue
    && hasVisibleEyeFocusCue
    && eyeMotionMetricsPresent;
  const expressionTransitionSignal = hasEmotionTransitionCue && emotionExpressionTransitionMapped;
  const locomotionPathRealismSignal = locomotionPathHasRealisticShape
    || (structuredLocomotionObserved && structuredLocomotionSamples >= 2 && movementPanelIndicatesPath);
  const passedSignals = [
    ...(animatedHumanoidCount > 0 ? ["animated_humanoid_runtime_playback"] : []),
    ...(authoredClinicalIdlePoseCount > 0 ? ["authored_clinical_idle_pose_runtime_cue"] : []),
    ...(visualCueIds.includes("visible_runtime_mouth_eye_expression_cues") ? ["visible_mouth_eye_expression_cues"] : []),
    ...(clinicalLines.some((line) => line.startsWith("Scenario:")) && !clinicalLines.some((line) => line.includes("crushing substernal pressure")) ? ["scenario_specific_vr_clinical_panel"] : []),
    ...(visemeCount > 0 && typeof humanoidSpeech.gazeTargetKind === "string" && activeVisemeMapped
      ? ["dialogue_viseme_and_gaze_mapping"]
      : []),
    ...(eyeMicroSaccadeBlinkMapped && eyeMotionMetricsPresent ? ["dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue"] : []),
    ...(emotionExpressionTransitionMapped ? ["emotion_aligned_expression_transition_cue"] : []),
    ...(lipsyncSignal ? ["deterministic_lipsync_and_opening_signal"] : []),
    ...(eyeGazeSignal ? ["deterministic_eye_gaze_readability_signal"] : []),
    ...(expressionTransitionSignal ? ["deterministic_expression_transition_signal"] : []),
    ...(locomotionPathRealismSignal ? ["deterministic_locomotion_path_realism_signal"] : []),
    ...(equipmentNecessitySignal ? ["deterministic_equipment_necessity_signal"] : []),
    ...(sceneClutterRemovalSignal ? ["deterministic_scene_clutter_removal_signal"] : []),
    ...(structuredLocomotionObserved || duringMoveDistance > 0 || movementPanelLine?.includes("path ") ? ["examinee_locomotion_observed"] : []),
  ];
  const blockers = requiredRuntimeRealismSignalIds
    .filter((signal) => !passedSignals.includes(signal))
    .map((signal) => `${signal}_missing`);
  const rejectedCueBlockers = collectStrings(input.evidence)
    .filter((value) => rejectedVisualRegressionCueIds.has(value))
    .map((cueId) => `rejected_visual_regression_cue_present:${cueId}`);
  blockers.push(...Array.from(new Set(rejectedCueBlockers)));
  const profileEvidenceIdsPresent = humanoidRealismProfiles.some((profile) => {
    const profileEvidenceIds = Array.isArray(profile.requiredRealismEvidenceIds)
      ? profile.requiredRealismEvidenceIds.map(String)
      : [];
    return requiredHumanoidRealismProfileEvidenceIds.every((evidenceId) => profileEvidenceIds.includes(evidenceId));
  });
  if (humanoidRealismProfiles.length > 0 && !profileEvidenceIdsPresent) {
    blockers.push("humanoid_realism_profile_evidence_ids_missing");
  }

  return {
    schemaVersion: "openclinxr.runtime-realism-evidence-check.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    result: {
      status: blockers.length === 0 ? "realism_evidence_present" : "realism_evidence_blocked",
      blockers,
      passedSignals,
    },
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

export function validateRuntimeRealismEvidenceCheckReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  if (value.schemaVersion !== "openclinxr.runtime-realism-evidence-check.v1") errors.push("/schemaVersion invalid");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) errors.push("/generatedAt invalid");
  if (typeof value.inputFile !== "string" || value.inputFile.length === 0) errors.push("/inputFile required");
  if (!isRecord(value.result)) errors.push("/result must be object");
  if (isRecord(value.result)) {
    if (!["realism_evidence_present", "realism_evidence_blocked"].includes(String(value.result.status))) errors.push("/result/status invalid");
    if (!Array.isArray(value.result.blockers)) errors.push("/result/blockers must be array");
    if (!Array.isArray(value.result.passedSignals)) errors.push("/result/passedSignals must be array");
    const blockers = Array.isArray(value.result.blockers) ? value.result.blockers.map(String) : [];
    const passedSignals = Array.isArray(value.result.passedSignals) ? value.result.passedSignals.map(String) : [];
    for (const signalId of requiredRuntimeRealismSignalIds) {
      if (!passedSignals.includes(signalId) && !blockers.includes(`${signalId}_missing`)) {
        errors.push(`/result must account for required signal ${signalId}`);
      }
    }
  }
  if (value.productionReadinessClaimed !== false) errors.push("/productionReadinessClaimed must be false");
  if (!Array.isArray(value.notEvidenceFor)) {
    errors.push("/notEvidenceFor must be array");
  } else {
    for (const claim of ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
      if (!value.notEvidenceFor.map(String).includes(claim)) {
        errors.push(`/notEvidenceFor must include ${claim}`);
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { outputPath: defaultOutputPath, validateLatest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.inputPath = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function locamotionPathDistanceAndTurnValid(
  distanceMeters: number,
  turnRadians: number,
  cueIds: string[],
  blockers: string[],
): boolean {
  return distanceMeters > 0
    && distanceMeters <= 4
    && Math.abs(turnRadians) <= 2 * Math.PI
    && cueIds.includes("runtime_locomotion_delta")
    && blockers.length === 0;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
  return [];
}

async function latestPath(pattern: string): Promise<string | null> {
  const matches = await globFiles(pattern);
  if (matches.length === 0) return null;
  const candidates = await Promise.all(matches.map(async (file) => ({
    file,
    mtimeMs: (await stat(file)).mtimeMs,
  })));
  return candidates.sort((left, right) => left.mtimeMs - right.mtimeMs || left.file.localeCompare(right.file)).at(-1)?.file ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
