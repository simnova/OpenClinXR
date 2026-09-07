import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidActingCueRecord,
  HumanoidAnimationRuntimeContext,
  HumanoidExpressionWeights,
  HumanoidSpeechPlayback,
} from "./types.js";
import type { updateHumanoidEmotionExpression } from "./face-rig.js";

declare global {
  // Window evidence surfaces owned by the app composition root; this package
  // only writes them through the extracted recorder functions below.
  interface Window {
    __openClinXrHumanoidSpeechEvidence?: HumanoidSpeechEvidence;
  }
}

export type MouthGazePoseComparatorEvidenceRecord = {
  // Garment geometry carries separate deforming 3D sleeves (skinned, phenotype
  // garmentLayers) distinct from the body — visible in UI-XR peds real_garment captures.
  source: "window.__openClinXrMouthGazePoseComparatorEvidence";
  captureMode: string;
  comparator: string;
  scenarioId: string;
  actorId: string;
  dialogueText: string;
  traceTag: "work_of_breathing_assessment";
  activeViseme: string;
  activeMouthOpenness: number;
  activeEmotionState: string;
  activeExpressionTransitionMs: number;
  activeExpressionWeights: HumanoidExpressionWeights;
  gazeProbePlayback: string | null;
  activeGazeProbeAnimationClipName: string | null;
  morphTargetAppliedTargetCount: number;
  morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue_with_emotion_transition";
  emotionTransitionCuePresent: boolean;
  visemeTimelineComparatorEvidencePresent: boolean;
  activeDialogueTurnRef?: unknown;
  liveSource?: "live_blueprint_dialogue_emotion_source" | undefined;
  garmentGeometry?: {
    name: string;
    visible: boolean;
    source: string;
    hasVisibleVolume: boolean;
    hasSeamFoldHints: boolean;
    sleeveDeform?: string;
  } | null;
  notEvidenceFor: string[];
};

export type RuntimeHumanoidActingCueEvidenceRecord = {
  source: "window.__openClinXrRuntimeHumanoidActingCueEvidence";
  scenarioId: string;
  actorCount: number;
  activeCueIds: string[];
  actorCues: HumanoidActingCueRecord[];
  notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "animation_quality"];
};

export function recordRuntimeHumanoidActingCueEvidence(
  ctx: { scenarioIdForEvidence: () => string; writeActingCueEvidence?: ((record: Record<string, unknown>) => void) | undefined },
  actorCues: HumanoidActingCueRecord[],
): void {
  const record = {
    source: "window.__openClinXrRuntimeHumanoidActingCueEvidence",
    scenarioId: ctx.scenarioIdForEvidence(),
    actorCount: actorCues.length,
    activeCueIds: Array.from(new Set(actorCues.flatMap((cue) => cue.cueIds))).sort(),
    actorCues,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "animation_quality"],
  };
  ctx.writeActingCueEvidence?.(record);
}

export function writeHumanoidSpeechFrameEvidence(
  ctx: HumanoidAnimationRuntimeContext,
  slot: GeneratedHumanoidAnimationSlot,
  speech: HumanoidSpeechPlayback,
  viseme: string,
  openness: number,
  expressionState: ReturnType<typeof updateHumanoidEmotionExpression>,
  eyeMotion: { blinkIntensity: number; microSaccadeYaw: number; microSaccadePitch: number },
  effWeights: HumanoidExpressionWeights,
  activeDialogueTurnRef: unknown,
  liveSource: "live_blueprint_dialogue_emotion_source" | undefined,
  nowMs: number,
  buildEvidence: (
    actorId: string | null,
    assetId: string | null,
    text: string | null,
    phonemeSequence: string[],
    visemeSequence: string[],
    gazeTarget: { kind: "learner_camera" | "actor"; actorId: string | null } | null,
    emotionContext?: import("./types.js").HumanoidDialogueEmotionContext,
    requirement?: HumanoidSpeechPlayback["actorRuntimeRealismRequirement"],
  ) => HumanoidSpeechEvidence,
  roundWeights: (weights: HumanoidExpressionWeights) => HumanoidExpressionWeights,
): void {
  window.__openClinXrHumanoidSpeechEvidence = {
    ...(window.__openClinXrHumanoidSpeechEvidence ??
      buildEvidence(
        speech.actorId,
        speech.assetId,
        speech.text,
        speech.phonemeSequence,
        speech.visemeSequence,
        { kind: speech.gazeTargetKind, actorId: speech.gazeTargetActorId },
        speech.emotionContext,
        speech.actorRuntimeRealismRequirement,
      )),
    activePhoneme: speech.phonemeSequence[0] ?? "sil",
    activeViseme: viseme,
    activeMouthOpenness: Number(openness.toFixed(3)),
    activeEyeBlinkIntensity: eyeMotion.blinkIntensity,
    activeEyeMicroSaccadeYaw: eyeMotion.microSaccadeYaw,
    activeEyeMicroSaccadePitch: eyeMotion.microSaccadePitch,
    activeEmotionState: expressionState.targetEmotion,
    emotionSource: speech.emotionContext.source,
    scenarioBaselineMood: speech.emotionContext.baselineMood,
    scenarioEmotionCueIds: speech.emotionContext.cueIds,
    activeActorRuntimeRealismRequirement: speech.actorRuntimeRealismRequirement,
    activeExpressionTransitionMs: Number(Math.max(0, nowMs - expressionState.transitionStartedAtMs).toFixed(0)),
    activeExpressionWeights: roundWeights(effWeights),
    activeExpressionCueIds: [
      "visible_runtime_mouth_shape_cue",
      "visible_runtime_eye_focus_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "emotion_aligned_expression_transition_cue",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
    ],
    activeBodyMotionCueIds: [
      "scenario_dialogue_body_lean_cue",
      "idle_breathing_sway_cue",
      "emotion_microstep_weight_shift_cue",
    ],
    activeBodyMotionIntensity: Number((openness + 0.18).toFixed(3)),
    activeBodyMotionMode: "scenario_dialogue_body_motion_runtime",
    activeDialogueTurnRef: activeDialogueTurnRef as HumanoidSpeechEvidence["activeDialogueTurnRef"],
    liveSource,
  };
  void ctx;
  void slot;
}

export function writeMouthGazePoseComparatorEvidence(
  ctx: HumanoidAnimationRuntimeContext,
  slot: GeneratedHumanoidAnimationSlot,
  speech: HumanoidSpeechPlayback,
  viseme: string,
  openness: number,
  expressionState: ReturnType<typeof updateHumanoidEmotionExpression>,
  nowMs: number,
  garmentGeometry: {
    name: string;
    visible: boolean;
    source: string;
    hasVisibleVolume: boolean;
    hasSeamFoldHints: boolean;
    sleeveDeform?: string;
  } | null,
  roundWeights: (weights: HumanoidExpressionWeights) => HumanoidExpressionWeights,
  writeComparatorEvidence?: (record: Record<string, unknown>) => void,
): void {
  const speechEvidence = window.__openClinXrHumanoidSpeechEvidence as unknown as
    | Record<string, unknown>
    | undefined;
  const record = {
    source: "window.__openClinXrMouthGazePoseComparatorEvidence",
    captureMode: ctx.selectedCaptureMode(),
    comparator: ctx.selectedHumanoidSourceComparator() ?? "",
    scenarioId: ctx.comparatorScenarioId(ctx.selectedHumanoidSourceComparator() ?? ""),
    actorId: speech.actorId,
    dialogueText: speech.text,
    traceTag: "work_of_breathing_assessment",
    activeViseme: viseme,
    activeMouthOpenness: Number(openness.toFixed(3)),
    activeEmotionState: expressionState.targetEmotion,
    activeExpressionTransitionMs: Number(Math.max(0, nowMs - expressionState.transitionStartedAtMs).toFixed(0)),
    activeExpressionWeights: roundWeights(expressionState.weights),
    gazeProbePlayback: typeof ctx.animationPlaybackForSlot(slot) === "string"
      && slot.activeGazeProbeAnimationClipName
      ? "gltf_gaze_probe_clip_playing"
      : null,
    activeGazeProbeAnimationClipName: slot.activeGazeProbeAnimationClipName ?? null,
    morphTargetAppliedTargetCount: ctx.morphTargetAppliedTargetCount(slot),
    morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue_with_emotion_transition",
    emotionTransitionCuePresent: ctx.emotionTransitionCuePresent(slot),
    visemeTimelineComparatorEvidencePresent: ctx.visemeTimelineComparatorEvidencePresent(slot),
    activeDialogueTurnRef: speechEvidence?.["activeDialogueTurnRef"],
    liveSource: speechEvidence?.["liveSource"] as "live_blueprint_dialogue_emotion_source" | undefined,
    garmentGeometry,
    notEvidenceFor: [
      "production phoneme timing",
      "validated facial animation",
      "clinical affect scoring",
      "b_plus_visual_realism_gate",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
    ],
  };
  writeComparatorEvidence?.(record);
}
