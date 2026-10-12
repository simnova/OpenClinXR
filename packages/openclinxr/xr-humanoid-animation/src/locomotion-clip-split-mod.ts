import { AnimationClip, PropertyBinding, type AnimationAction, type AnimationMixer } from "three";

/**
 * Upper/lower split of the locomotion take for the arm-settle fix (physician only, D4).
 *
 * MEASURED CAUSE (`.openclinxr/evidence/arm-settle/control.json`): the mixer output steps
 * 27.7 deg in one frame at the walk->settling switch and 29.1 deg at walk start on
 * upperarm01L, against a 1.44 deg/frame walking median. The clips are clean (max key step
 * 3.6 deg) and the idle hold (13.1 deg from trunk) is not touched. `playLocomotionClip`
 * (`locomotion-clip-playback-mod.ts`) drives the whole body with ONE action whose effective
 * weight follows the LEG rules (full weight from the first frame for the stance lock, reduced
 * settling weight, fade on stop): correct for legs, a snap for arms.
 *
 * THE FIX (D9 deterministic runtime, D1 three.js mixer blending): split the walk clip's tracks
 * into two AnimationClips at load — lower body + root (everything the leg rules need) and upper
 * body — and play both time-synced. The lower action keeps today's weight logic unchanged, so
 * leg/foot/pelvis output is bit-identical to the single-action run; the upper action's weight
 * ramps 0->1 over `LOCOMOTION_UPPER_BODY_BLEND_IN_S` at walk start and 1->0 over
 * `LOCOMOTION_UPPER_BODY_BLEND_OUT_S` when locomotion stops or settling begins.
 *
 * WHY NO RATE LIMITER (rejected approach, orchestrator direction): a per-frame arm clamp slows
 * real gestures and leaves the cut in place. This module contains no clamp: the ramp changes
 * what the mixer is asked for, and three.js blends it.
 *
 * MIXER BASE (directive question, answered by measurement, not assumption): the actor's mixer
 * already plays idle takes underneath (`ClinicalIdleConversation`,
 * `ClinicalExpressionMicroTransition` — the auto-play fallback in
 * xr-asset-loading/src/humanoid-animation.ts plays every non-`openclinxr_retarget_` clip), so at
 * upper weight 0 the arms rest at the idle-take pose, NOT the bind pose. The ramp alone is the
 * blend; no separate idle action is created here.
 */

/** Upper-body blend-in at walk start, in seconds (sim deltaSeconds-driven). */
export const LOCOMOTION_UPPER_BODY_BLEND_IN_S = 0.4;

/** Upper-body blend-out when locomotion stops or settling begins, in seconds. */
export const LOCOMOTION_UPPER_BODY_BLEND_OUT_S = 0.5;

/** Suffixes for the derived split clips. Stable: the mixer caches actions by clip identity. */
export const LOCOMOTION_LOWER_BODY_CLIP_SUFFIX = "__openclinxr_lower_body";
export const LOCOMOTION_UPPER_BODY_CLIP_SUFFIX = "__openclinxr_upper_body";

/** userData key for the upper-body action weight ramp state (`{ current: number }`). */
export const LOCOMOTION_UPPER_WEIGHT_KEY = "openClinXrLocomotionUpperWeight";

/**
 * True when a sanitised (dot-stripped, three.js `PropertyBinding.sanitizeNodeName` style) bone
 * name belongs to the walk clip's UPPER body for the split.
 *
 * DERIVED from the existing locomotion bone knowledge — `LOCOMOTION_MPFB2_BONE_PATTERNS` plus the
 * upper-body classification inside `locomotionOwnedBoneChains`
 * (`locomotion-clip-playback-mod.ts`) — not a new hand list: every prefix here appears there.
 * Two deliberate deltas from the ownership claim, both stated:
 * - `head` is UPPER here (the slice directive lists head tracks in the upper clip). The ownership
 *   claim excludes head so gaze/attention stays with the posture pass — and the posture pass
 *   overwrites head every frame with bind-relative attention anyway, so the clip assignment is
 *   not visible either way.
 * - Face/eye/finger`finger1-1`-style/breast/special tracks match NO locomotion pattern and fall
 *   to LOWER (the everything-else rule), preserving control behaviour for them exactly.
 */
export function isLocomotionUpperBodySanitisedName(
  sanitised: string,
  options?: { includeHead?: boolean },
): boolean {
  if (sanitised.startsWith("clavicle")) return true;
  if (sanitised.startsWith("shoulder01")) return true;
  if (sanitised.startsWith("upperarm0")) return true;
  if (sanitised.startsWith("lowerarm0")) return true;
  if (sanitised.startsWith("wrist")) return true;
  if (sanitised.startsWith("hand")) return true;
  if (sanitised.startsWith("metacarpal")) return true;
  if (sanitised.startsWith("proximal")) return true;
  if (sanitised.startsWith("intermediate")) return true;
  if (sanitised.startsWith("distal")) return true;
  if (sanitised.startsWith("spine0")) return true;
  if (sanitised.startsWith("neck0")) return true;
  if ((options?.includeHead ?? true) && sanitised.startsWith("head")) return true;
  return false;
}

/** Bone (node) name of a track, sanitised for the predicate above. Null when unparseable. */
export function sanitisedTrackNodeName(trackName: string): string | null {
  let nodeName: string | null = null;
  try {
    nodeName = PropertyBinding.parseTrackName(trackName).nodeName ?? null;
  } catch {
    return null;
  }
  if (typeof nodeName !== "string" || nodeName.length === 0) return null;
  return nodeName.replaceAll(".", "");
}

export type SplitLocomotionClip = {
  /** Everything the leg rules need: legs, feet, toes, pelvis, root, plus unclassified tracks. */
  lower: AnimationClip;
  /** Spine-above-pelvis, clavicle, arm, hand, neck, head tracks. */
  upper: AnimationClip;
};

const splitCache = new WeakMap<AnimationClip, SplitLocomotionClip>();

/**
 * Partition a locomotion take's tracks into lower + upper clips. Complete and disjoint by
 * construction: every track lands in exactly one side (unparseable or unclassified tracks go
 * lower, preserving control behaviour). Both clips keep the source duration exactly, so loop
 * wrap matches the source take frame-for-frame. Cached per source clip object.
 */
export function splitLocomotionClip(clip: AnimationClip): SplitLocomotionClip {
  const cached = splitCache.get(clip);
  if (cached) return cached;
  const lowerTracks: AnimationClip["tracks"] = [];
  const upperTracks: AnimationClip["tracks"] = [];
  for (const track of clip.tracks) {
    const sanitised = sanitisedTrackNodeName(track.name);
    if (sanitised !== null && isLocomotionUpperBodySanitisedName(sanitised)) {
      upperTracks.push(track);
    } else {
      lowerTracks.push(track);
    }
  }
  const split: SplitLocomotionClip = {
    lower: new AnimationClip(
      `${clip.name}${LOCOMOTION_LOWER_BODY_CLIP_SUFFIX}`,
      clip.duration,
      lowerTracks,
    ),
    upper: new AnimationClip(
      `${clip.name}${LOCOMOTION_UPPER_BODY_CLIP_SUFFIX}`,
      clip.duration,
      upperTracks,
    ),
  };
  split.lower.duration = clip.duration;
  split.upper.duration = clip.duration;
  splitCache.set(clip, split);
  return split;
}

export type LocomotionSplitActions = {
  /**
   * The ORIGINAL take's action, kept playing at weight 0 as the timekeeper: it advances time
   * with the mixer but (three.js `AnimationAction._update`: `if (weight > 0)` guards the
   * accumulate) contributes nothing, so stance-time readers
   * (`resolveClipStanceForFrame`, `stanceAtActionTime`) keep working untouched and leg output is
   * FP-neutral versus the single-action run.
   */
  keeper: AnimationAction;
  /** Lower-body action: keeps today's leg weight logic unchanged. */
  lower: AnimationAction;
  /** Upper-body action: follows the ramp below. */
  upper: AnimationAction;
  lowerClip: AnimationClip;
  upperClip: AnimationClip;
};

/** The three actions for a locomotion take, creating the split actions on first use. */
export function locomotionSplitActions(
  mixer: AnimationMixer,
  clip: AnimationClip,
): LocomotionSplitActions {
  const { lower, upper } = splitLocomotionClip(clip);
  return {
    keeper: mixer.clipAction(clip),
    lower: mixer.clipAction(lower),
    upper: mixer.clipAction(upper),
    lowerClip: lower,
    upperClip: upper,
  };
}

/** (Re)start all three take actions time-synced; the keeper holds time at weight 0. */
export function startSplitLocomotionActions(split: LocomotionSplitActions): void {
  split.keeper.reset().play();
  split.keeper.setEffectiveWeight(0);
  split.lower.reset().play();
  split.upper.reset().play();
}

/** Park all three take actions. */
export function stopSplitLocomotionActions(split: LocomotionSplitActions): void {
  split.keeper.stop();
  split.lower.stop();
  split.upper.stop();
}

/** One rate for all three actions plus an exact time sync (the stance lock reads the keeper). */
export function applySplitLocomotionTimeScale(
  split: LocomotionSplitActions,
  scaledRate: number,
): void {
  split.keeper.timeScale = scaledRate;
  split.lower.timeScale = scaledRate;
  split.upper.timeScale = scaledRate;
  split.lower.time = split.keeper.time;
  split.upper.time = split.keeper.time;
}

/** Step the upper ramp and apply it; returns the applied weight for evidence records. */
export function applySplitUpperWeight(
  split: LocomotionSplitActions,
  rootUserData: Record<string, unknown>,
  targetWeight: number,
  deltaSeconds: number,
): number {
  const applied = stepLocomotionUpperWeight(rootUserData, targetWeight, deltaSeconds);
  split.upper.setEffectiveWeight(applied);
  return applied;
}

type UpperWeightState = { current: number };

function upperWeightState(rootUserData: Record<string, unknown>): UpperWeightState {
  const existing = rootUserData[LOCOMOTION_UPPER_WEIGHT_KEY] as UpperWeightState | undefined;
  if (existing && typeof existing.current === "number") return existing;
  const created: UpperWeightState = { current: 0 };
  rootUserData[LOCOMOTION_UPPER_WEIGHT_KEY] = created;
  return created;
}

/** Seed the upper ramp (stopping->settling handoff mirrors the leg seed). Single owner of the key. */
export function seedLocomotionUpperWeight(
  root: { userData: Record<string, unknown> },
  value: number,
): void {
  (root.userData as Record<string, unknown>)[LOCOMOTION_UPPER_WEIGHT_KEY] = { current: value };
}

/** Current upper ramp value, 0 when never seeded. */
export function readLocomotionUpperWeight(rootUserData: Record<string, unknown>): number {
  const state = rootUserData[LOCOMOTION_UPPER_WEIGHT_KEY] as UpperWeightState | undefined;
  return state && typeof state.current === "number" ? state.current : 0;
}

/**
 * Step the upper-body action weight toward its target, driven by sim deltaSeconds. Up over
 * `LOCOMOTION_UPPER_BODY_BLEND_IN_S`, down over `LOCOMOTION_UPPER_BODY_BLEND_OUT_S`. Pure ramp,
 * no clamp on any bone: it changes what the mixer is asked for.
 */
export function stepLocomotionUpperWeight(
  rootUserData: Record<string, unknown>,
  targetWeight: number,
  deltaSeconds: number,
): number {
  const state = upperWeightState(rootUserData);
  const clampedTarget = Math.min(1, Math.max(0, targetWeight));
  const rate =
    clampedTarget > state.current
      ? 1 / LOCOMOTION_UPPER_BODY_BLEND_IN_S
      : 1 / LOCOMOTION_UPPER_BODY_BLEND_OUT_S;
  const delta = clampedTarget - state.current;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, rate * deltaSeconds));
  state.current += step;
  state.current = Math.min(1, Math.max(0, state.current));
  if (Math.abs(state.current - clampedTarget) < 1e-9) state.current = clampedTarget;
  return state.current;
}
