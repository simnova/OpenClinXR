import {
  CLINICIAN_WALK_SPEED_MPS,
  FOOT_CONTACT_HEIGHT_METERS,
} from "@openclinxr/asset-registry/approach-executor";
import type { OwnedChain } from "@openclinxr/xr-pose";
import { sampleLocomotionStanceTrack } from "./case-owned-approach-frame-mod.js";
import { measureStanceGroundAdvance } from "./case-owned-approach-runtime-mod.js";
import { resolveLocomotionStanceLabels } from "./locomotion-stance-labels.js";
import { resolveHipBone } from "./resolve-hip-bone.js";
import { resolveToeBones } from "./resolve-toe-bones.js";
import type { GeneratedHumanoidAnimationSlot } from "./types.js";

/**
 * Play this actor's retargeted locomotion take, if it has one, instead of sliding its root.
 *
 * Returns false when there is nothing to play, and the caller then does what it always did.
 *
 * THE CLIP CLAIMS THE LEG CHAIN. `openClinXrOwnedBoneChains` is the existing seam by which a motion
 * executor tells the posture pass to leave bones alone.
 *
 * THE CLAIM WAS THE WRONG SHAPE AND THEREFORE INERT, measured on the unchanged tree at 86dc0300.
 * This file wrote a `string[]` of chain CATEGORIES (`["upperleg", "lowerleg", …]`) while the reader,
 * `clinical-idle-posture.ts:263-265`, filters for `{ownerId, boneNames}` objects and drops anything
 * whose `boneNames` is not an array. The owned set was therefore always empty and `boneIsOwned`
 * never returned true. It is repaired here because a seam that silently claims nothing is worse
 * than no seam: the next executor to rely on it inherits a guarantee that does not hold.
 *
 * WHAT THE REPAIR DOES NOT FIX, stated so nobody reads more into it. The posture pass this claim
 * addresses resolves its rotation map through `ARM_JOINT_ALIASES` — fourteen entries, none of them
 * leg, foot, toe, pelvis, hip, knee or ankle — so it writes ARM bones only. The claim protected
 * nothing because nothing needed protecting: a displayed-walk run measured a driven left-toe span
 * of 1.089 m against a drive-off control of 0.0385 m, which could not happen if the legs were being
 * rewritten. This is a correct-and-inert defect repaired, not the cause of any failure.
 *
 * The drive scalar gates PLAYBACK, not speed. The ACTION's own rate is a separate
 * quantity and it IS rescaled here — and that does not reintroduce the sliding the
 * stance lock exists to remove. The old warning held only for a constant ground
 * advance, where a faster clip against a fixed advance drags its feet. Here the
 * advance is DERIVED from the planted foot every frame (`applyStanceLockedGroundAdvance`
 * pins the stance toe and the slot keeps whatever the foot allowed): scaling clip time
 * scales the stance foot's travel and the body's advance together, so the pinned toe
 * stays pinned by construction. Verified, not assumed: the foot-plant video capture's
 * per-window holdSlideMeters median is compared before and after the rescale.
 *
 * ## CHANGED 2026-09-23: Extended claim to upper body (clavicle, shoulder01, upperarm01/02,
 * lowerarm01/02, wrist, hand/finger bones, spine01-05, neck01-03). Replaced category
 * substring matching with explicit per-rail regex patterns anchored at start of sanitised name.
 * Added crossfade weight (ramp 0→1 over LOCOMOTION_CROSSFADE_DURATION_S on start, 1→0 on stop).
 * On stop: fade action weight from 1 to 0 over fade duration instead of pausing at frame 0.
 * Leg claim stays until fade completes. Head is NOT claimed (gaze/attention stays with posture).
 */
/**
 * Standard gravitational acceleration, m/s^2. The one physical constant the gait rule needs.
 */
export const GRAVITY_MPS2 = 9.81;

/**
 * Dimensionless walking speed (Alexander 1976): Fr = v^2 / (g * L), L the leg length (hip height).
 * A calm walk sits around Fr 0.2-0.25 across body sizes — this is WHY a Froude-derived target
 * scales down for a shorter leg automatically, rather than by a hand-picked per-actor multiplier.
 * Chosen at the low end of that band on purpose: the coupling below (timeScale = target /
 * measured-clip-speed, then the stance lock re-derives the body's actual advance from the planted
 * foot every frame) means the PRESCRIBED target and the CAPTURED walking speed are not the same
 * number — the capture in `docs/openclinxr/progress-log` measured a physician prescribed 1.1 m/s
 * land at a captured 0.739 m/s, roughly two-thirds. A higher Fr would prescribe a faster target and
 * likely land closer to a comfortable adult pace after that same attenuation; 0.2 is the
 * conservative starting point this constant records, calibrated against a real capture rather than
 * asserted.
 */
export const CALM_WALK_FROUDE_NUMBER = 0.2;

/** v = sqrt(Fr * g * L). Zero or negative leg length returns 0 (unmeasurable, not a divide fault). */
export function froudeWalkSpeedMetersPerSecond(
  legLengthMeters: number,
  froude: number = CALM_WALK_FROUDE_NUMBER,
): number {
  if (!(legLengthMeters > 0)) return 0;
  return Math.sqrt(froude * GRAVITY_MPS2 * legLengthMeters);
}

/**
 * This actor's own leg length, in meters, for the Froude rule above.
 *
 * Measured as the hip bone's PEAK height above the floor across one full cycle of its own bound
 * walk clip — sampled with the same `sampleLocomotionStanceTrack` calibration mixer the stance
 * measurement below uses, so it costs no new machinery and reads the SAME rig the clip will
 * actually play on (a child's shorter thigh+shin, not an adult constant). Peak rather than the
 * first sampled frame: the hip dips slightly during double support, and its peak during
 * single-support stance is closest to standing leg length. Null when the rig carries no hip bone
 * this package's naming table knows (`resolve-hip-bone.ts`) or the clip cannot be sampled — the
 * caller falls back to the fixed constant rather than dividing by an unmeasured length.
 */
export function measureActorLegLengthMeters(slot: GeneratedHumanoidAnimationSlot): number | null {
  const hips = resolveHipBone(slot.root);
  const hip = hips.left ?? hips.right;
  if (hip === null) return null;
  const sampled = sampleLocomotionStanceTrack(slot, {
    toe: hip,
    sampleCount: 48,
    referenceFrame: slot.actorSlot ?? slot.root,
  });
  if (sampled === null || sampled.samples.length === 0) return null;
  const peak = Math.max(...sampled.samples.map((sample) => sample.position.y));
  return peak > 0 ? peak : null;
}

/**
 * The walk action's playback rate, DERIVED from the bound clip — never fitted.
 *
 * The executor prescribes the route at this actor's OWN Froude-derived target speed (leg-length
 * scaled — see `measureActorLegLengthMeters` / `froudeWalkSpeedMetersPerSecond` above; falls back
 * to the fixed `CLINICIAN_WALK_SPEED_MPS` only when this actor's leg length cannot be measured)
 * while the stance lock derives the body's actual advance from the planted foot, so the ground
 * speed that shows up is the CLIP's own stance speed. The grafted `Walk` take walks at a raw
 * ~0.4-0.9 m/s depending on the actor's own stride (72 steps/min against general gait literature's
 * ~100-120 for typical adults), which the fixed 1.1 m/s target used to stretch or compress by a
 * different factor per body regardless of whether that body could naturally cover ground that
 * fast. The rate that reunites clip and target is `target / clipGroundSpeed`, where the
 * denominator is the clip's stance-foot travel per cycle over its cycle duration, measured off the
 * bound clip at timeScale 1 — the same stance-window measurement the approach producer trusts
 * (`sampleLocomotionStanceTrack` plus `measureStanceGroundAdvance`), computed once and stored on
 * the slot.
 */
export type LocomotionClipSpeedMeasurement = {
  clipName: string;
  /** Stance-foot ground speed at timeScale 1, in m/s, measured off the bound clip. */
  groundSpeedMetersPerSecond: number;
  cycleSeconds: number;
  /** This actor's own leg length in meters, or null when it could not be measured. */
  legLengthMeters: number | null;
  /** The Froude-derived (or fallback-constant) target this timeScale was chosen to hit. */
  targetSpeedMetersPerSecond: number;
  /** `targetSpeedMetersPerSecond / groundSpeedMetersPerSecond`; 1 when unmeasurable. */
  timeScale: number;
};

export function resolveLocomotionClipTimeScale(
  slot: GeneratedHumanoidAnimationSlot,
): LocomotionClipSpeedMeasurement | null {
  const clipName = slot.locomotionClipName;
  if (!clipName) return null;
  const clip = slot.responseClips?.find((candidate: { name: string }) => candidate.name === clipName);
  if (!clip) return null;
  const rootUserData = slot.root.userData as Record<string, unknown>;
  const cached = rootUserData["openClinXrLocomotionClipSpeed"] as
    | LocomotionClipSpeedMeasurement
    | undefined;
  if (cached && cached.clipName === clipName && cached.cycleSeconds === clip.duration) return cached;
  const toes = resolveToeBones(slot.root);
  const toe = toes.left ?? toes.right;
  if (toe === null) return null;
  const sampled = sampleLocomotionStanceTrack(slot, {
    toe,
    sampleCount: 48,
    referenceFrame: slot.actorSlot ?? slot.root,
  });
  if (sampled === null) return null;
  const advance = measureStanceGroundAdvance(sampled.samples, {
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    floorOriginY: 0,
  });
  const groundSpeed = advance.metersPerSecond;
  const legLengthMeters = measureActorLegLengthMeters(slot);
  const targetSpeedMetersPerSecond =
    legLengthMeters !== null ? froudeWalkSpeedMetersPerSecond(legLengthMeters) : CLINICIAN_WALK_SPEED_MPS;
  const measurement: LocomotionClipSpeedMeasurement = {
    clipName,
    groundSpeedMetersPerSecond: groundSpeed,
    cycleSeconds: sampled.cycleSeconds,
    legLengthMeters,
    targetSpeedMetersPerSecond,
    timeScale: groundSpeed > 0 ? targetSpeedMetersPerSecond / groundSpeed : 1,
  };
  rootUserData["openClinXrLocomotionClipSpeed"] = measurement;
  return measurement;
}

export function playLocomotionClip(
  slot: GeneratedHumanoidAnimationSlot,
  locomotion: number,
  deltaSeconds: number,
  /**
   * Multiplies the derived rate. 1 for the normal walk; the settling-phase clip-driven turn
   * (`clip-driven-settling-turn-mod.ts`) passes ~0.5 so the clip keeps stepping — and the stance
   * lock keeps a real contact window to pivot about — without covering ground, since the executor
   * prescribes zero forward advance for that phase.
   */
  timeScaleFactor: number = 1,
  /**
   * Target leg-chain effective weight, in (0, 1]. 1 for the normal walk (unchanged behaviour); the
   * settling-phase clip-driven turn passes a reduced value (~0.35-0.5) to shrink stride amplitude —
   * see the ramp note at its call site below.
   */
  legWeightTarget: number = 1,
): boolean {
  const clipName = slot.locomotionClipName;
  const mixer = slot.mixer;
  if (!clipName || !mixer) return false;
  const clip = slot.responseClips?.find((candidate: { name: string }) => candidate.name === clipName);
  if (!clip) return false;
  const action = mixer.clipAction(clip);
  const rootUserData = slot.root.userData as Record<string, unknown>;

  // Persist crossfade state on the root userData
  if (rootUserData["openClinXrLocomotionCrossfade"] === undefined) {
    rootUserData["openClinXrLocomotionCrossfade"] = { weight: 0, targetWeight: 0 };
  }
  const crossfadeState = rootUserData["openClinXrLocomotionCrossfade"] as { weight: number; targetWeight: number };

  if (locomotion <= 0) {
    // Stopping: fade out the action weight and crossfade weight
    if (action.isRunning() || crossfadeState.weight > 0) {
      // Ramp crossfade weight from 1 to 0
      crossfadeState.targetWeight = 0;
      const fadeRate = 1 / LOCOMOTION_CROSSFADE_DURATION_S; // per second
      crossfadeState.weight = Math.max(0, crossfadeState.weight - fadeRate * deltaSeconds);

      // Fade the action's effective weight FROM WHEREVER IT ACTUALLY WAS, not from
      // `crossfadeState.weight` (the SEPARATE upper-body ownership tracker, which stays near 1
      // through a whole walk regardless of `legWeightTarget`). Reading that here instead of the
      // leg-weight ramp's own state snapped the action's weight from a reduced settling value
      // (e.g. 0.4) back toward ~1 on the very first stopping frame — the same one-frame stance-toe
      // jump the "FULL clip weight from the first frame" comment above already warns about,
      // encountered again from the opposite direction. Kept as the same ramp state and rate as the
      // walking branch's leg-weight ramp, fading toward 0 instead of `legWeightTarget`.
      const legWeightState = (rootUserData["openClinXrLocomotionLegWeight"] ??= { current: 1 }) as {
        current: number;
      };
      legWeightState.current = Math.max(0, legWeightState.current - fadeRate * deltaSeconds);

      // Fade the action's effective weight
      if (action.isRunning()) {
        action.setEffectiveWeight(legWeightState.current);
        if (legWeightState.current <= 0) {
          action.stop();
        }
      }

      // Keep leg claim while fading (weight > 0 means still blending)
      const chains = locomotionOwnedBoneChains(slot, crossfadeState.weight);
      rootUserData["openClinXrOwnedBoneChains"] = chains;
      rootUserData["openClinXrLocomotionClipPlayback"] = {
        clipName,
        playing: legWeightState.current > 0,
        timeSeconds: action.time,
        mode: "retargeted_clip_drives_legs_fading_upper_body",
        crossfadeWeight: crossfadeState.weight,
        notEvidenceFor: "gait realism, clinical plausibility, or Quest readiness",
      };
      return true;
    }

    // Fully stopped
    rootUserData["openClinXrOwnedBoneChains"] = [];
    rootUserData["openClinXrLocomotionClipPlayback"] = {
      clipName,
      playing: false,
      settledOn: "faded_to_idle",
    };
    crossfadeState.weight = 0;
    crossfadeState.targetWeight = 0;
    (rootUserData["openClinXrLocomotionLegWeight"] as { current: number } | undefined) ??= { current: 0 };
    (rootUserData["openClinXrLocomotionLegWeight"] as { current: number }).current = 0;
    return true;
  }

  // Walking: start or continue
  if (!action.isRunning()) {
    action.reset().play();
    // FULL clip weight from the first frame. The crossfade below governs ONLY the
    // upper-body ownership blend (read by the posture pass); the leg pose the stance
    // lock pins must be the clip's own pose immediately. Snapping the action's weight
    // from 0 flies a planted toe from its idle spot toward its clip pose (the probe's
    // toe x travels 0→0.09 while in contact), and the lock reads that ramp as stance
    // travel and drags the body sideways — measured 73 mm of lateral arrival error. So
    // a FRESH start always resets the leg-weight ramp state to 1 here, and the ramp
    // below (which runs every frame, started or continuing) applies it: a brand new
    // walk still gets full weight on its first posed frame, exactly as before.
    (rootUserData["openClinXrLocomotionLegWeight"] as { current: number } | undefined) ??= { current: 1 };
    (rootUserData["openClinXrLocomotionLegWeight"] as { current: number }).current = 1;
    crossfadeState.weight = 0;
    crossfadeState.targetWeight = 1;
  }

  // THE LEG WEIGHT RAMP, separate from the upper-body crossfade above. `action.setEffectiveWeight`
  // on a single action blends the animated pose toward the BOUND (pre-play) pose in proportion to
  // (1 - weight) — three.js's own PropertyMixer accumulation — so holding the leg chain at a
  // reduced weight during settling SHRINKS the clip's stride amplitude around that bound pose
  // instead of translating anything: the settling turn's own steps get shorter, not the body.
  // Ramped (never snapped) toward `legWeightTarget` at a fixed rate so a weight CHANGE (1 -> a
  // settling target, or back) does not itself register as a one-frame stance-toe jump.
  const legWeightState = (rootUserData["openClinXrLocomotionLegWeight"] ??= { current: 1 }) as {
    current: number;
  };
  const legWeightRampPerSecond = 1 / LOCOMOTION_LEG_WEIGHT_RAMP_DURATION_S;
  const legWeightDelta = legWeightTarget - legWeightState.current;
  const legWeightStep =
    Math.sign(legWeightDelta) * Math.min(Math.abs(legWeightDelta), legWeightRampPerSecond * deltaSeconds);
  legWeightState.current += legWeightStep;
  action.setEffectiveWeight(legWeightState.current);

  // DERIVED rate, re-applied every walking frame so nothing downstream can
  // silently return the action to 1: the clip's own stance speed scaled to the
  // executor's planned speed (`resolveLocomotionClipTimeScale`).
  const speedMeasurement = resolveLocomotionClipTimeScale(slot);
  if (speedMeasurement !== null) action.timeScale = speedMeasurement.timeScale * timeScaleFactor;
  // Cached on `slot.root.userData["openClinXrLocomotionStanceLabels"]` (resolveLocomotionStanceLabels's
  // own memoisation, keyed by clip name + duration), the same publish-on-userData pattern as the
  // speed measurement above — the clip's own stance labels published where a consumer (the stance
  // lock, SC-05's runtime evidence) can read them without a second, unexported entrypoint.
  resolveLocomotionStanceLabels(slot);

  // Ramp the UPPER-BODY ownership weight from 0 to 1. The action itself stays at
  // full weight throughout the walk; see above.
  if (crossfadeState.weight < 1) {
    const fadeRate = 1 / LOCOMOTION_CROSSFADE_DURATION_S;
    crossfadeState.weight = Math.min(1, crossfadeState.weight + fadeRate * deltaSeconds);
  }

  // Claim bones with current crossfade weight
  const chains = locomotionOwnedBoneChains(slot, crossfadeState.weight);
  rootUserData["openClinXrOwnedBoneChains"] = chains;
  rootUserData["openClinXrLocomotionClipPlayback"] = {
    clipName,
    playing: true,
    timeSeconds: action.time,
    mode: "retargeted_clip_drives_full_body_with_crossfade",
    crossfadeWeight: crossfadeState.weight,
    timeScale: speedMeasurement?.timeScale ?? 1,
    measuredClipGroundSpeedMps: speedMeasurement?.groundSpeedMetersPerSecond ?? 0,
    notEvidenceFor: "gait realism, clinical plausibility, or Quest readiness",
  };
  return true;
}

/** Crossfade duration in seconds for upper-body blend in/out. */
export const LOCOMOTION_CROSSFADE_DURATION_S = 0.3;

/** Ramp duration for `legWeightTarget` changes (`playLocomotionClip`'s leg-weight ramp). */
export const LOCOMOTION_LEG_WEIGHT_RAMP_DURATION_S = 0.3;

/**
 * Explicit per-rail bone name patterns for MPFB2 rig, anchored at start of sanitised name.
 * These are the bones the locomotion clip drives on the MPFB physician rig.
 * Head is NOT included (gaze/attention stays with posture pass).
 * Patterns use ^ to match start of sanitised name (dots stripped by sanitiseBoneName).
 * Sanitised names have NO dots (e.g., "upperleg01.L" -> "upperleg01L").
 */
const LOCOMOTION_MPFB2_BONE_PATTERNS = [
  // Legs (existing)
  /^upperleg0[12][LR]$/,
  /^lowerleg0[12][LR]$/,
  /^foot[LR]$/,
  /^toe1-1[LR]$/,
  /^pelvis$/,
  /^root$/,
  // Upper body (NEW) — clip drives these
  /^clavicle[LR]$/,
  /^shoulder01[LR]$/,
  /^upperarm0[12][LR]$/,
  /^lowerarm0[12][LR]$/,
  /^wrist[LR]$/,
  /^hand[LR]$/,
  // Finger bones (if present)
  /^metacarpal\d+[LR]$/,
  /^proximal\d+[LR]$/,
  /^intermediate\d+[LR]$/,
  /^distal\d+[LR]$/,
  // Spine
  /^spine0[1-5]$/,
  // Neck
  /^neck0[1-3]$/,
] as const;

/** Who claims the chain. `chain-ownership.ts`: two executors must not claim the same bone. */
export const LOCOMOTION_CHAIN_OWNER_ID = "openclinxr.locomotion-clip-playback";

/**
 * The claim, as `OwnedChain[]` carrying the bone names THIS actor's skeleton actually has.
 *
 * "OWNERSHIP IS DECLARED, NEVER INFERRED" (`chain-ownership.ts`). The patterns above are resolved
 * against the rig's real bone names once, here, and what is stored is the resolved list — so a
 * renamed chain drops out of the claim rather than being captured by a pattern at read time.
 *
 * @param crossfadeWeight Optional blend weight in [0,1] for upper-body crossfade. Default 1.
 */
export function locomotionOwnedBoneChains(
  slot: GeneratedHumanoidAnimationSlot,
  crossfadeWeight: number = 1,
): OwnedChain[] {
  const boneNames: string[] = [];
  const upperBodyBoneNames: string[] = [];

  slot.root.traverse((node) => {
    const name = node.name;
    if (typeof name !== "string" || name.length === 0) return;
    const sanitised = name.replaceAll(".", "");
    // Check against explicit MPFB2 patterns
    for (const pattern of LOCOMOTION_MPFB2_BONE_PATTERNS) {
      if (pattern.test(sanitised)) {
        boneNames.push(name);
        // Track upper-body bones for weight assignment
        if (
          sanitised.startsWith("clavicle") ||
          sanitised.startsWith("shoulder01") ||
          sanitised.startsWith("upperarm0") ||
          sanitised.startsWith("lowerarm0") ||
          sanitised.startsWith("wrist") ||
          sanitised.startsWith("hand") ||
          sanitised.startsWith("metacarpal") ||
          sanitised.startsWith("proximal") ||
          sanitised.startsWith("intermediate") ||
          sanitised.startsWith("distal") ||
          sanitised.startsWith("spine0") ||
          sanitised.startsWith("neck0")
        ) {
          upperBodyBoneNames.push(name);
        }
        break;
      }
    }
  });

  // Split into leg chain (weight=1 always) and upper-body chain (weight=crossfadeWeight)
  const legBoneNames = boneNames.filter((n) => !upperBodyBoneNames.includes(n));
  const chains: OwnedChain[] = [];

  if (legBoneNames.length > 0) {
    chains.push({ ownerId: LOCOMOTION_CHAIN_OWNER_ID, boneNames: legBoneNames, weight: 1 });
  }
  if (upperBodyBoneNames.length > 0) {
    chains.push({ ownerId: LOCOMOTION_CHAIN_OWNER_ID, boneNames: upperBodyBoneNames, weight: crossfadeWeight });
  }
  return chains;
}