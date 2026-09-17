import { resolveMorphTarget } from "@openclinxr/asset-registry";
import { Mesh, Vector3 } from "three";
import type { Group } from "three";
import {
  applyBlinkClosureToRoot,
  collectResolvedMorphTargets,
  expressionWeightsForEmotion,
  MOUTH_OPEN_CAP,
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


/**
 * Mean resting inter-blink interval, ms.
 *
 * The original clock used 4,300 ms, which measures 13.5 blinks/min — BELOW the 15-20/min
 * resting range for spontaneous human blinking. 3,400 ms measures 17.6/min, mid-range.
 */
const BLINK_MEAN_INTERVAL_MS = 3400;
/** Lid closure duration, ms. Unchanged. */
const BLINK_CLOSURE_MS = 200;

/**
 * Inter-blink interval for the nth blink since speech start.
 *
 * The original clock was `elapsedMs % 4300` — a metronome. Spontaneous human blinking at rest is
 * 15-20/min with intervals scattered roughly 2-6 s; a perfectly regular blink is one of the most
 * reliable tells that a face is synthetic. This spreads the interval over [0.58, 1.42] x the mean
 * (2,108-4,692 ms), giving a measured 17.6 blinks/min inside the 15-20 resting range while
 * removing the regularity.
 *
 * DETERMINISTIC by construction: the jitter is a hash of the blink INDEX, not a PRNG and not
 * wall-clock, so an evidence capture reproduces frame for frame. No seed, no state, no
 * Math.random.
 */
function blinkIntervalMs(index: number): number {
  const hashed = Math.sin((index + 1) * 12.9898) * 43758.5453;
  const fraction = hashed - Math.floor(hashed);
  return BLINK_MEAN_INTERVAL_MS * (0.62 + fraction * 0.76);
}

/** Lid-closure intensity in [0,1] at `elapsedMs`, over the irregular blink schedule. */
function blinkIntensityAt(elapsedMs: number): number {
  let cursor = 0;
  for (let index = 0; index < 100000; index++) {
    const interval = blinkIntervalMs(index);
    if (elapsedMs < cursor + interval) {
      const closureStart = cursor + interval - BLINK_CLOSURE_MS;
      if (elapsedMs <= closureStart) return 0;
      return Math.sin(Math.PI * ((elapsedMs - closureStart) / BLINK_CLOSURE_MS));
    }
    cursor += interval;
  }
  return 0;
}

export function computeHumanoidEyeMotionMetrics(speech: HumanoidSpeechPlayback, nowMs: number): HumanoidEyeMotionMetrics {
  const elapsedMs = Math.max(0, nowMs - speech.startedAtMs);
  const microSaccadeYaw = Math.sin(elapsedMs / 173) * 0.018 + Math.sin(elapsedMs / 421) * 0.011;
  const microSaccadePitch = Math.sin(elapsedMs / 229) * 0.012;
  const blinkIntensity = blinkIntensityAt(elapsedMs);
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


/**
 * Blink a humanoid that is NOT speaking.
 *
 * DEFECT (measured 2026-09-16, 1,321-frame capture): `updateHumanoidSpeechCue` returns early
 * whenever `slot.activeSpeech` is undefined, and that return happens BEFORE
 * `applyHumanoidFaceRigControls` — the only caller of the lid-closure applier. Across 883 silent
 * frames (~8.7 s) blink intensity was 0 on every one, where a 3.4 s mean interval predicts two or
 * three blinks. A humanoid standing quietly never blinked, which is among the strongest tells that
 * a face is synthetic, and it affects every actor not currently holding the floor.
 *
 * The rest clock is slot-local and starts when the slot first falls silent, so a figure does not
 * blink the instant speech ends and the schedule stays deterministic per slot.
 */
export function applyHumanoidRestBlink(slot: GeneratedHumanoidAnimationSlot, nowMs: number): number {
  const bag = slot as unknown as Record<string, unknown>;
  if (typeof bag["_restBlinkOriginMs"] !== "number") bag["_restBlinkOriginMs"] = nowMs;
  const originMs = bag["_restBlinkOriginMs"] as number;
  const blinkIntensity = blinkIntensityAt(Math.max(0, nowMs - originMs));
  const leftUpperEyelid = slot.root.getObjectByName("openclinxr_left_upper_eyelid_blink_control");
  const rightUpperEyelid = slot.root.getObjectByName("openclinxr_right_upper_eyelid_blink_control");
  offsetHumanoidRigControl(leftUpperEyelid, 0, -blinkIntensity * 0.002, -blinkIntensity * 0.012);
  offsetHumanoidRigControl(rightUpperEyelid, 0, -blinkIntensity * 0.002, -blinkIntensity * 0.012);
  scaleHumanoidRigControl(leftUpperEyelid, 1, 1 + blinkIntensity * 1.8, 1);
  scaleHumanoidRigControl(rightUpperEyelid, 1, 1 + blinkIntensity * 1.8, 1);
  applyBlinkClosureToRoot(slot.root, blinkIntensity);
  return blinkIntensity;
}


/** One FACS target and the share of the canonical weight it carries. */
type FacsTargetWeight = { readonly target: string; readonly scale: number };

/**
 * MULTI-TARGET expression groups.
 *
 * The shared 1:1 resolver returns ONE name, so `openclinxr_brow_concern` drove
 * "eyebrows-left-inner-up" alone — an authored emotion moved half a face — and
 * `openclinxr_cheek_tension` resolved to null because no cheek target ships, so that channel
 * moved nothing at all. Measured on mpfb-gown-adult-patient.glb (47 target names).
 *
 * This lives HERE, not in @openclinxr/asset-registry, because that package's public surface is
 * frozen under the PSR reduction programme (review group psr-01d) and this is its only consumer.
 *
 * ANATOMY, not convenience: concern is FACS AU1 (inner brow raiser) bilaterally plus AU4 (brow
 * lowerer) at 0.45 so it reads as worry rather than anger. "Cheek tension" has no cheek target on
 * this topology; the honest carriers are AU7 (lid tightener, eye-*-slit) and the nose compressor.
 */
const MPFB_FACS_EXPRESSION_GROUPS: Readonly<Record<string, readonly FacsTargetWeight[]>> = {
  openclinxr_brow_concern: [
    { target: "eyebrows-left-inner-up", scale: 1 },
    { target: "eyebrows-right-inner-up", scale: 1 },
    { target: "eyebrows-left-down", scale: 0.45 },
    { target: "eyebrows-right-down", scale: 0.45 },
  ],
  openclinxr_cheek_tension: [
    { target: "eye-left-slit", scale: 0.85 },
    { target: "eye-right-slit", scale: 0.85 },
    { target: "nose-compression-uncompress", scale: 0.4 },
  ],
  openclinxr_mouth_open: [{ target: "mouth-open", scale: 1 }],
};

/**
 * Every target a canonical expression name should drive on a given body.
 *
 * Identity wins first, so the Anny rail (which carries the canonical spellings) still drives
 * exactly one target. Falls back to the shared published resolver, which handles case variants
 * and the FACS alias map. Empty array when nothing honest resolves — never a fabricated name.
 */
function resolveMorphTargetGroup(
  canonicalName: string,
  availableNames: ReadonlySet<string>,
): readonly FacsTargetWeight[] {
  if (availableNames.has(canonicalName)) return [{ target: canonicalName, scale: 1 }];
  const group = MPFB_FACS_EXPRESSION_GROUPS[canonicalName];
  if (group !== undefined) {
    const present = group.filter((entry) => availableNames.has(entry.target));
    if (present.length > 0) return present;
  }
  const direct = resolveMorphTarget(canonicalName, availableNames);
  return direct === null ? [] : [{ target: direct, scale: 1 }];
}

export function applyHumanoidMorphTargetCue(
  slot: GeneratedHumanoidAnimationSlot,
  openness: number,
  viseme: string,
  expressionWeights: HumanoidExpressionWeights,
  applyNamedVisemes: (slot: SpeechSlotLike, nowMs: number) => { activeTargetName: string | null },
): void {
  let applied = 0;
  const drivenTargetNames = new Set<string>();
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
    const dict = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    const availableNames = new Set(Object.keys(dict));
    // MULTI-TARGET drive. The 1:1 resolver sent brow concern to the LEFT inner brow alone and
    // cheek tension to nothing at all, so an authored emotion moved half a face or none of it.
    // resolveMorphTargetGroup keeps identity-first (the Anny rail still drives one target) and
    // only fans out on bodies that carry the FACS names.
    const driveGroup = (canonical: string, value: number, cap: number): void => {
      for (const { target, scale } of resolveMorphTargetGroup(canonical, availableNames)) {
        const index = dict[target];
        if (typeof index !== "number" || !Number.isInteger(index)) continue;
        if (index < 0 || index >= influences.length) continue;
        influences[index] = Math.min(cap, Math.max(0, value * scale));
        applied++;
        drivenTargetNames.add(target);
      }
    };
    driveGroup("openclinxr_mouth_open", openness + expressionWeights.mouthOpen * 0.18, MOUTH_OPEN_CAP);
    driveGroup("openclinxr_brow_concern", expressionWeights.browConcern + (viseme === "rest" ? 0 : 0.05), 0.95);
    driveGroup("openclinxr_cheek_tension", expressionWeights.cheekTension + openness * 0.22, 0.95);
  });
  const named = applyNamedVisemes(slot, performance.now());
  if (named.activeTargetName) applied += 1;
  slot.root.userData["openClinXrMorphTargetRuntimeCue"] = {
    currentViseme: named.activeTargetName ?? viseme,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionWeights: roundHumanoidExpressionWeights(expressionWeights),
    appliedTargetCount: applied,
    resolvedTargets,
    drivenTargetNames: [...drivenTargetNames].sort(),
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
