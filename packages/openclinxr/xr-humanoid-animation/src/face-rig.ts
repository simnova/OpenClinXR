import { Mesh, Vector3 } from "three";
import type { Group } from "three";
import {
  applyBlinkClosureToRoot,
  collectResolvedMorphTargets,
  expressionWeightsForEmotion,
  MOUTH_OPEN_CAP,
  resolveMorphIndex,
} from "@openclinxr/xr-dialogue";
import type { SpeechSlotLike } from "@openclinxr/xr-dialogue";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidEmotionExpressionState,
  HumanoidExpressionEmotion,
  HumanoidExpressionWeights,
  HumanoidEyeMotionMetrics,
  HumanoidSpeechPlayback,
} from "./types.js";

export function lerpHumanoidAnimation(from: number, to: number, alpha: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, alpha));
}

export function normalizeHumanoidAnimationAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function clampDialogueFacingYaw(value: number): number {
  return Math.min(0.42, Math.max(-0.42, value));
}

export function roundHumanoidExpressionWeights(weights: HumanoidExpressionWeights): HumanoidExpressionWeights {
  return {
    mouthOpen: Number(weights.mouthOpen.toFixed(3)),
    browConcern: Number(weights.browConcern.toFixed(3)),
    cheekTension: Number(weights.cheekTension.toFixed(3)),
  };
}

export function visemeOpenness(viseme: string): number {
  const openness: Record<string, number> = {
    rest: 0,
    closed: 0.08,
    teeth: 0.2,
    rounded: 0.34,
    wide: 0.46,
    mid: 0.52,
    open: 0.78,
  };
  return openness[viseme] ?? 0.35;
}

export function computeAffectRampIntensity(
  elapsedMs: number,
  durationMs: number,
  timeline: { intensity?: unknown; onsetMs?: unknown; transitionMs?: unknown; decayMs?: unknown } | null | undefined,
): number {
  if (!timeline || typeof timeline.intensity !== "number") return 0;
  const peak = Math.max(0, Math.min(1, timeline.intensity));
  const onset = Number(timeline.onsetMs ?? 0);
  const trans = Number(timeline.transitionMs ?? 500);
  const dec = Number(timeline.decayMs ?? 700);
  if (elapsedMs < onset) return 0;
  const rampEnd = onset + trans;
  if (elapsedMs < rampEnd) {
    const t = (elapsedMs - onset) / Math.max(1, trans);
    return peak * Math.min(1, Math.max(0, t));
  }
  const decayStart = Math.max(rampEnd, durationMs - dec);
  if (elapsedMs < decayStart) return peak;
  const d = (elapsedMs - decayStart) / Math.max(1, dec);
  return peak * Math.max(0, 1 - d);
}

export function computeHumanoidEyeMotionMetrics(speech: HumanoidSpeechPlayback, nowMs: number): HumanoidEyeMotionMetrics {
  const elapsedMs = Math.max(0, nowMs - speech.startedAtMs);
  const microSaccadeYaw = Math.sin(elapsedMs / 173) * 0.018 + Math.sin(elapsedMs / 421) * 0.011;
  const microSaccadePitch = Math.sin(elapsedMs / 229) * 0.012;
  const blinkPhase = elapsedMs % 4300;
  const blinkWindow = blinkPhase > 3940 && blinkPhase < 4140 ? (blinkPhase - 3940) / 200 : 0;
  const blinkIntensity = blinkWindow > 0 ? Math.sin(Math.PI * blinkWindow) : 0;
  return {
    blinkIntensity: Number(blinkIntensity.toFixed(3)),
    microSaccadeYaw: Number(microSaccadeYaw.toFixed(3)),
    microSaccadePitch: Number(microSaccadePitch.toFixed(3)),
  };
}

export function createHumanoidEmotionExpressionState(options?: { deterministicClock?: boolean }): HumanoidEmotionExpressionState {
  const weights = expressionWeightsForEmotion("neutral");
  return {
    currentEmotion: "neutral",
    targetEmotion: "neutral",
    weights: { ...weights },
    targetWeights: { ...weights },
    transitionStartedAtMs: options?.deterministicClock === true ? 0 : performance.now(),
    transitionDurationMs: 850,
  };
}

export function startHumanoidEmotionTransition(
  slot: GeneratedHumanoidAnimationSlot,
  emotion: HumanoidExpressionEmotion,
  nowMs: number,
): void {
  if (slot.emotionExpression.targetEmotion === emotion) {
    return;
  }
  slot.emotionExpression.currentEmotion = slot.emotionExpression.targetEmotion;
  slot.emotionExpression.targetEmotion = emotion;
  slot.emotionExpression.targetWeights = expressionWeightsForEmotion(emotion);
  slot.emotionExpression.transitionStartedAtMs = nowMs;
  slot.emotionExpression.transitionDurationMs = emotion === "pain" || emotion === "anxious" ? 650 : 950;
}

export function updateHumanoidEmotionExpression(
  slot: GeneratedHumanoidAnimationSlot,
  nowMs: number,
): HumanoidEmotionExpressionState {
  const state = slot.emotionExpression;
  const progress = Math.min(1, Math.max(0, (nowMs - state.transitionStartedAtMs) / state.transitionDurationMs));
  const eased = progress * progress * (3 - 2 * progress);
  state.weights = {
    mouthOpen: lerpHumanoidAnimation(state.weights.mouthOpen, state.targetWeights.mouthOpen, eased * 0.34),
    browConcern: lerpHumanoidAnimation(state.weights.browConcern, state.targetWeights.browConcern, eased * 0.34),
    cheekTension: lerpHumanoidAnimation(state.weights.cheekTension, state.targetWeights.cheekTension, eased * 0.34),
  };
  slot.root.userData["openClinXrEmotionExpressionTransitionCue"] = {
    currentEmotion: state.currentEmotion,
    targetEmotion: state.targetEmotion,
    transitionProgress: Number(progress.toFixed(3)),
    transitionDurationMs: state.transitionDurationMs,
    weights: roundHumanoidExpressionWeights(state.weights),
    cueIds: ["emotion_aligned_expression_transition_cue", "visible_runtime_eyebrow_jaw_cheek_cue"],
    notEvidenceFor: "validated affect recognition, clinical scoring, or production facial animation quality",
  };
  return state;
}

type RigControlBase = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
};

function ensureRigControlBase(control: NonNullable<ReturnType<Group["getObjectByName"]>>): RigControlBase {
  const existing = control.userData["openClinXrRigControlBaseTransform"];
  if (
    existing
    && typeof existing === "object"
    && "position" in existing
    && "rotation" in existing
    && "scale" in existing
  ) {
    return existing as RigControlBase;
  }
  const base = {
    position: { x: control.position.x, y: control.position.y, z: control.position.z },
    rotation: { x: control.rotation.x, y: control.rotation.y, z: control.rotation.z },
    scale: { x: control.scale.x, y: control.scale.y, z: control.scale.z },
  };
  control.userData["openClinXrRigControlBaseTransform"] = base;
  return base;
}

export function offsetHumanoidRigControl(
  control: ReturnType<Group["getObjectByName"]>,
  x: number,
  y: number,
  z: number,
): void {
  if (!control) {
    return;
  }
  const base = ensureRigControlBase(control);
  control.position.set(base.position.x + x, base.position.y + y, base.position.z + z);
}

export function rotateHumanoidRigControl(
  control: ReturnType<Group["getObjectByName"]>,
  x: number,
  y: number,
  z: number,
): void {
  if (!control) {
    return;
  }
  const base = ensureRigControlBase(control);
  control.rotation.set(base.rotation.x + x, base.rotation.y + y, base.rotation.z + z);
}

export function scaleHumanoidRigControl(
  control: ReturnType<Group["getObjectByName"]>,
  x: number,
  y: number,
  z: number,
): void {
  if (!control) {
    return;
  }
  const base = ensureRigControlBase(control);
  control.scale.set(base.scale.x * x, base.scale.y * y, base.scale.z * z);
}

export function resetHumanoidFaceRigControls(slot: GeneratedHumanoidAnimationSlot): void {
  offsetHumanoidRigControl(slot.root.getObjectByName("openclinxr_upper_lip_sync_control"), 0, 0, 0);
  offsetHumanoidRigControl(slot.root.getObjectByName("openclinxr_lower_lip_sync_control"), 0, 0, 0);
  for (const controlName of ["openclinxr_left_eye_gaze_control", "openclinxr_right_eye_gaze_control"]) {
    const control = slot.root.getObjectByName(controlName);
    rotateHumanoidRigControl(control, 0, 0, 0);
    scaleHumanoidRigControl(control, 1, 1, 1);
  }
  for (const controlName of ["openclinxr_left_upper_eyelid_blink_control", "openclinxr_right_upper_eyelid_blink_control"]) {
    const control = slot.root.getObjectByName(controlName);
    offsetHumanoidRigControl(control, 0, 0, 0);
    scaleHumanoidRigControl(control, 1, 1, 1);
  }
}

export function applyHumanoidMorphTargetCue(
  slot: GeneratedHumanoidAnimationSlot,
  openness: number,
  viseme: string,
  expressionWeights: HumanoidExpressionWeights,
  applyNamedVisemes: (slot: SpeechSlotLike, nowMs: number) => { activeTargetName: string | null },
): void {
  let applied = 0;
  const resolvedTargets: Record<string, string | null> = {
    openclinxr_mouth_open: null,
    openclinxr_brow_concern: null,
    openclinxr_cheek_tension: null,
  };
  slot.root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.morphTargetDictionary || !object.morphTargetInfluences) {
      return;
    }
    collectResolvedMorphTargets(object.morphTargetDictionary, resolvedTargets);
    const mouthOpenIndex = resolveMorphIndex(object.morphTargetDictionary, "openclinxr_mouth_open");
    const browConcernIndex = resolveMorphIndex(object.morphTargetDictionary, "openclinxr_brow_concern");
    const cheekTensionIndex = resolveMorphIndex(object.morphTargetDictionary, "openclinxr_cheek_tension");
    if (typeof mouthOpenIndex === "number") {
      const influences = object.morphTargetInfluences;
      influences[mouthOpenIndex] = Math.min(MOUTH_OPEN_CAP, Math.max(0, openness + expressionWeights.mouthOpen * 0.18));
      applied++;
    }
    if (typeof browConcernIndex === "number") {
      const influences = object.morphTargetInfluences;
      influences[browConcernIndex] = Math.min(0.95, Math.max(0, expressionWeights.browConcern + (viseme === "rest" ? 0 : 0.05)));
      applied++;
    }
    if (typeof cheekTensionIndex === "number") {
      const influences = object.morphTargetInfluences;
      influences[cheekTensionIndex] = Math.min(0.95, Math.max(0, expressionWeights.cheekTension + openness * 0.22));
      applied++;
    }
  });
  const named = applyNamedVisemes(slot, performance.now());
  if (named.activeTargetName) applied += 1;
  slot.root.userData["openClinXrMorphTargetRuntimeCue"] = {
    currentViseme: named.activeTargetName ?? viseme,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionWeights: roundHumanoidExpressionWeights(expressionWeights),
    appliedTargetCount: applied,
    resolvedTargets,
    targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension", ...(named.activeTargetName ? [named.activeTargetName] : [])],
    cueIds: ["dialogue_viseme_and_gaze_mapping", "visible_runtime_mouth_shape_cue", "emotion_aligned_expression_transition_cue", "named_viseme_morph_drive"],
    notEvidenceFor: "production phoneme timing, validated facial animation, or clinical affect scoring",
  };
}

export function applyHumanoidFaceRigControls(
  slot: GeneratedHumanoidAnimationSlot,
  openness: number,
  viseme: string,
  speech: HumanoidSpeechPlayback,
  camera: import("three").PerspectiveCamera,
  eyeMotion: HumanoidEyeMotionMetrics,
  expressionWeights: HumanoidExpressionWeights,
  resolveGazeTargetWorld: (speech: HumanoidSpeechPlayback, camera: import("three").PerspectiveCamera) => Vector3,
  applyMorphTargetCue: (slot: GeneratedHumanoidAnimationSlot, openness: number, viseme: string, weights: HumanoidExpressionWeights) => void,
): void {
  const upperLip = slot.root.getObjectByName("openclinxr_upper_lip_sync_control");
  const lowerLip = slot.root.getObjectByName("openclinxr_lower_lip_sync_control");
  const leftEye = slot.root.getObjectByName("openclinxr_left_eye_gaze_control");
  const rightEye = slot.root.getObjectByName("openclinxr_right_eye_gaze_control");
  const leftUpperEyelid = slot.root.getObjectByName("openclinxr_left_upper_eyelid_blink_control");
  const rightUpperEyelid = slot.root.getObjectByName("openclinxr_right_upper_eyelid_blink_control");

  offsetHumanoidRigControl(upperLip, 0, openness * 0.006, openness * 0.004);
  offsetHumanoidRigControl(lowerLip, 0, -openness * 0.024, openness * 0.01);
  applyMorphTargetCue(slot, openness, viseme, expressionWeights);

  const gazeOrigin = new Vector3(0, 1.57, 0.29);
  const targetWorld = resolveGazeTargetWorld(speech, camera);
  const targetLocal = slot.root.worldToLocal(targetWorld.clone());
  const offset = targetLocal.sub(gazeOrigin).clampLength(0.35, 1.15);
  const horizontal = Math.max(0.001, Math.hypot(offset.x, offset.z));
  const yaw = Math.atan2(offset.x, -offset.z) * 0.35;
  const pitch = -Math.atan2(offset.y, horizontal) * 0.28;
  const { blinkIntensity, microSaccadeYaw, microSaccadePitch } = eyeMotion;
  rotateHumanoidRigControl(leftEye, pitch + microSaccadePitch, yaw + microSaccadeYaw, 0);
  rotateHumanoidRigControl(rightEye, pitch + microSaccadePitch * 0.92, yaw + microSaccadeYaw * 0.9, 0);
  scaleHumanoidRigControl(leftEye, 1, 1 - blinkIntensity * 0.72, 1 + blinkIntensity * 0.08);
  scaleHumanoidRigControl(rightEye, 1, 1 - blinkIntensity * 0.72, 1 + blinkIntensity * 0.08);
  offsetHumanoidRigControl(leftUpperEyelid, 0, -blinkIntensity * 0.002, -blinkIntensity * 0.012);
  offsetHumanoidRigControl(rightUpperEyelid, 0, -blinkIntensity * 0.002, -blinkIntensity * 0.012);
  scaleHumanoidRigControl(leftUpperEyelid, 1, 1 + blinkIntensity * 1.8, 1);
  scaleHumanoidRigControl(rightUpperEyelid, 1, 1 + blinkIntensity * 1.8, 1);
  applyBlinkClosureToRoot(slot.root, blinkIntensity);

  slot.root.userData["openClinXrFaceRigRuntimeCue"] = {
    currentViseme: viseme,
    currentEmotion: speech.emotion,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionWeights: roundHumanoidExpressionWeights(expressionWeights),
    activeControlNames: [
      "openclinxr_upper_lip_sync_control",
      "openclinxr_lower_lip_sync_control",
      "openclinxr_left_eye_gaze_control",
      "openclinxr_right_eye_gaze_control",
      "openclinxr_left_upper_eyelid_blink_control",
      "openclinxr_right_upper_eyelid_blink_control",
    ],
    blinkIntensity: Number(blinkIntensity.toFixed(3)),
    microSaccadeYaw: Number(microSaccadeYaw.toFixed(3)),
    microSaccadePitch: Number(microSaccadePitch.toFixed(3)),
    cueIds: ["dialogue_viseme_and_gaze_mapping", "face_lip_eye_rig_contract_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
    notEvidenceFor: "production facial animation quality or validated phoneme timing",
  };
}
