import { MathUtils, type Object3D, Quaternion, Vector3 } from "three";
import { findStanceChain, worldXyz } from "./stance-lock-ik.js";
import type { StanceFoot } from "./stance-lock-mod.js";

/**
 * Split out of `clip-driven-settling-turn-mod.ts` to clear that file's 500-line zone budget
 * (`file-size-budgets.test.ts`) — behaviour unchanged, only the module boundary moved, same
 * pattern `stance-lock-ik.ts`'s own header describes for its own split out of `stance-lock-mod.ts`.
 * Everything below is the toe-XZ pin: the two-bone IK solve and its reach guard.
 *
 * ORIENTATION HOLD, TRIED AND REVERTED. A prior revision of this file also held the stance
 * heel/ankle bone's WORLD rotation fixed at its footfall value, on the hypothesis (confirmed in
 * an isolated single-footfall/parent-yaw unit test) that the position-only pin below leaves the
 * ankle's orientation free to sweep the heel-to-toe offset. MEASURED on the real capture
 * (`pnpm asset:motion:foot-plant-video`, same scenario both times): the orientation hold made
 * plantedSlideM WORSE, not better — 0.126 m (position-only) -> 0.171-0.176 m (with the hold,
 * across two independent runs) — and floorPenetrationM worse too (-0.0066 -> -0.0148). The
 * isolated unit test does not reproduce the multi-footfall, both-legs-alternating dynamics of a
 * real settling turn, and whatever interaction makes the hold net-negative there is NOT
 * DETERMINED — a plausible mechanism (the toe bone's own clip-driven local rotation, uncontrolled
 * by this pin, invalidates the "heel-to-toe offset rotates rigidly with the heel" assumption the
 * hold depends on) is recorded here for a follow-up slice, not treated as settled. Reverted rather
 * than shipped: `agents/rules/PROTO_VERIFY_DELEGATION.md`'s standing rule is that a result which
 * would overturn a proven measurement gets re-run, and this one WAS re-run (twice) and held.
 */

export function worldXz(node: Object3D): { x: number; z: number } {
  node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  return { x: e[12] ?? Number.NaN, z: e[14] ?? Number.NaN };
}

/**
 * Frames over which the toe-XZ pin's IK weight ramps 0->1 (footfall) or 1->0 (liftoff). Frame
 * count, not seconds: the brief asks for "2-3 frames" of blend regardless of capture fps, and a
 * fixed step per call is simpler than a duration threaded through every caller.
 */
export const STANCE_TOE_PIN_RAMP_FRAMES = 3;
export const STANCE_TOE_PIN_RAMP_STEP = 1 / STANCE_TOE_PIN_RAMP_FRAMES;

/**
 * Fraction of full leg extension (thigh + shin) beyond which the pin releases rather than reach.
 *
 * MEASURED, not the brief's literal 0.98: a real capture (`.openclinxr/evidence/foot-plant-video/
 * foot-plant-video.json`, the shipped physician's own proportions) put 242 of 254 pin attempts in
 * the 98.1-103.6% band (median 100.9%) — a near-straight standing leg's OWN natural resting
 * hip-to-toe distance, not a genuine unreachable target. `hip-to-heel = thigh+shin` only at EXACT
 * collinearity, and near that point the distance is quadratically insensitive to knee angle (a few
 * degrees of natural flex barely shortens it), so ANY hard cut below ~104% releases a normally-
 * standing leg on nearly every frame — confirmed: at 0.98 the pin applied on only 12 of 254
 * attempts, and `plantedSlideM` improved only 0.191 -> 0.125 m against a 0.02 m target. 1.05 clears
 * the whole measured natural-stance band with room to spare while still releasing for a genuinely
 * unreachable target (the counterweight test's 2 m body translation against a ~0.3 m leg is ~7x
 * over, nowhere near this margin) — `solveTwoBoneIkForXzPin`'s own softening (5 mm) handles the
 * remaining few centimetres near true full extension gracefully rather than this guard refusing it.
 */
const STANCE_TOE_PIN_MAX_REACH_FRACTION = 1.05;

/**
 * DIVERGENCE GUARD (measured 2026-09-25, turn-jump investigation). `reachDist > maxReach` only
 * catches a target genuinely BEYOND leg reach; it stays FALSE when the target is reachable but the
 * shared cosine-rule solve's hinge-axis choice (`solveTwoBoneIkForXzPin`'s own header on the
 * FALLBACK AXIS branch) flips to a geometrically-valid-but-WRONG branch — which happens near full
 * leg extension, exactly where `hip->knee` and `hip->target` go near-collinear
 * (`hingeAxis.lengthSq() < 1e-6`). The settling pivot sweeps the hip through the fixed anchor's
 * direction over its whole phase, so this collinearity is crossed in the ordinary course of a turn,
 * not only in a contrived case. MEASURED on the real capture
 * (`.openclinxr/evidence/foot-plant-video/foot-plant-video.json`, sample 79): right knee flexion
 * dropped 9.5 -> 6.8 deg (near-straight) exactly the frame the toe jumped 0.18 m off a FIXED,
 * unchanged anchor at weight 1 — `reachReleased` was `false` every frame in that window; the pin's
 * own debug anchor/weight fields (added for this investigation) never moved.
 *
 * NOT a rewrite of the shared solver — that is explicitly out of scope (this file's own header
 * records two prior rewrite attempts and why they were reverted; the FALLBACK AXIS branch is
 * documented, not touched here). This instead measures whether the solve actually achieved what it
 * targeted, the same "measure, don't assume" `reachDist` already applies BEFORE solving, just
 * checked AFTER. The floor is well above the ~0.03-0.045 m residual the closed-loop position solve
 * already carries at full weight even when it IS on the right branch (this file's own REMAINING
 * DEFECT note), and well below the ~0.18-0.21 m this defect produces.
 */
const STANCE_TOE_PIN_DIVERGENCE_METERS = 0.08;

export type FootPinState = {
  /** The toe's world XZ when this foot became stance, held fixed until liftoff clears it. */
  anchorXz: { x: number; z: number } | null;
  /** 0..1 IK blend weight, ramping over `STANCE_TOE_PIN_RAMP_FRAMES` frames each way. */
  weight: number;
};

export const IDLE_FOOT_PIN_STATE: FootPinState = { anchorXz: null, weight: 0 };

/**
 * `solveTwoBoneIK` (`stance-lock-ik.ts`) applies its hip rotation as `axisAngle(hipLocalAxis,
 * hipAngle)`, treating the cosine-rule vertex angle `hipAngle` as a rotation AMOUNT measured FROM
 * the CURRENT hip->knee direction. That is only correct when the current hip->knee direction
 * already coincides with hip->target (the walking lock's own callers: a purely-Y toe lift, or an
 * XZ nudge capped at 0.02 m — both near-collinear, taking the function's OWN degenerate/fallback
 * branch). For a genuinely off-axis target — exactly what pinning a toe's XZ against an ongoing
 * clip-driven leg rotation needs — `hipAngle` must instead be measured FROM the FIXED
 * hip->target direction: MEASURED, a bare reproduction (hip at origin, a two-unit chain, target at
 * (1.9,0,0), 90 deg off the chain's resting axis) placed the shared function's "heel" at
 * (1.13,-1.53,0) against that target — off by more than half the chain's own length; rotating by
 * `currentAngleBetweenKneeAndTarget - hipAngle` instead lands within floating-point of it.
 *
 * KEPT LOCAL, NOT FIXED IN `stance-lock-ik.ts`. `solveTwoBoneIK` is shared with the WALKING stance
 * lock (`stance-lock-mod.ts`); correcting the shared function measurably changed WALKING-phase
 * output too — `tools/openclinxr/evidence/foot-plant/foot-plant-video-capture.ts`'s own
 * walking-frame toe screen-span framing check dropped from 0.313 to 0.279 (threshold 0.30) — for a
 * slice scoped to the settling turn only ("the body pivot and footfall-bias drift correction stay
 * as they are"). A local copy, corrected from the start, keeps that walking-phase behaviour
 * untouched while giving the toe-XZ pin below a solve that is actually right for its off-axis
 * targets. `stance-lock-ik.ts`'s own latent bug is unresolved outside the settling turn.
 */
function solveTwoBoneIkForXzPin(
  hip: Object3D,
  knee: Object3D,
  heel: Object3D,
  targetWorld: { x: number; y: number; z: number },
  softening: number,
  actorSlot: Object3D,
): { hipDelta: Quaternion; kneeQuat: Quaternion } {
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);

  const hipWorld = new Vector3().setFromMatrixPosition(hip.matrixWorld);
  const kneeWorld = new Vector3().setFromMatrixPosition(knee.matrixWorld);
  const heelWorld = new Vector3().setFromMatrixPosition(heel.matrixWorld);
  const target = new Vector3(targetWorld.x, targetWorld.y, targetWorld.z);

  const upperLen = hipWorld.distanceTo(kneeWorld);
  const lowerLen = kneeWorld.distanceTo(heelWorld);

  const toTarget = target.clone().sub(hipWorld);
  const dist = toTarget.length();
  const minDist = Math.abs(upperLen - lowerLen);
  const fullExtension = upperLen + lowerLen;
  const maxDist = fullExtension - softening;
  let clampedDist = MathUtils.clamp(dist, minDist, maxDist);
  if (dist > maxDist - softening && dist < maxDist + softening) {
    const t = (dist - (maxDist - softening)) / (2 * softening);
    clampedDist = MathUtils.lerp(dist, maxDist, t * t * (3 - 2 * t));
  }

  const cosKneeInternal =
    (upperLen * upperLen + lowerLen * lowerLen - clampedDist * clampedDist) / (2 * upperLen * lowerLen);
  const kneeInternalAngle = Math.acos(MathUtils.clamp(cosKneeInternal, -1, 1));
  const kneeBendAngle = Math.PI - kneeInternalAngle;

  const cosHip = (upperLen * upperLen + clampedDist * clampedDist - lowerLen * lowerLen) / (2 * upperLen * clampedDist);
  const hipAngle = Math.acos(MathUtils.clamp(cosHip, -1, 1));

  const hipToKnee = new Vector3().subVectors(kneeWorld, hipWorld).normalize();
  const hipToTarget = toTarget.clone().normalize();
  let hingeAxis = new Vector3().crossVectors(hipToKnee, hipToTarget).normalize();
  let usedFallbackAxis = false;
  if (hingeAxis.lengthSq() < 1e-6) {
    usedFallbackAxis = true;
    actorSlot.updateMatrixWorld(true);
    const poleVector = new Vector3(1, 0, 0).applyQuaternion(actorSlot.quaternion).normalize();
    hingeAxis = new Vector3().crossVectors(hipToKnee, poleVector).normalize();
    if (hingeAxis.lengthSq() < 1e-6) {
      hingeAxis = new Vector3().crossVectors(hipToKnee, new Vector3(0, 1, 0)).normalize();
    }
  }

  const hipWorldQuat = new Quaternion().setFromRotationMatrix(hip.matrixWorld);
  const hipLocalAxis = hingeAxis.clone().applyQuaternion(hipWorldQuat.clone().invert());
  // Knee's absolute local value is expressed relative to its PARENT (the hip), not to knee's own
  // current world orientation — the same axis conversion as the hip's, reused.
  const kneeLocalAxis = hipLocalAxis.clone();

  // See this function's own header: rotate FROM the target direction, not from the current knee
  // direction, unless the fallback (already-collinear) axis was used, where they coincide.
  const currentAngleBetweenKneeAndTarget = Math.acos(MathUtils.clamp(hipToKnee.dot(hipToTarget), -1, 1));
  const hipRotationAmount = usedFallbackAxis ? hipAngle : currentAngleBetweenKneeAndTarget - hipAngle;

  const hipDelta = new Quaternion().setFromAxisAngle(hipLocalAxis, hipRotationAmount);
  const kneeQuat = new Quaternion().setFromAxisAngle(kneeLocalAxis, kneeBendAngle);
  return { hipDelta, kneeQuat };
}

/**
 * Hold a labelled-planted toe at the XZ position it had when it became stance ("footfall"), using
 * a two-bone leg IK solve (`solveTwoBoneIkForXzPin`, above). REPLACES the old Y-only
 * `liftSubmergedStanceToe`: the walk clip's own stance phase still encodes forward-gait joint
 * motion even while this module's pivot holds the SLOT still (see this module's own header) —
 * measured on the shipped physician, the labelled-planted toe sat 0.002-0.013 m off the floor yet
 * moved 0.8-4.1 cm per frame, entirely from the clip carrying the leg bones through their own gait
 * cycle in body space. A Y-only lift does not touch XZ and cannot correct this; solving for a
 * target that holds toe XZ fixed at the anchor (and Y at the floor) does.
 *
 * BLENDED, not snapped: the caller ramps `weight` in/out over a few frames around footfall and
 * liftoff, so the frame the label flips is not a pop from the clip's own pose straight to the
 * pinned one. `hipDelta` (a from-identity delta) is scaled by slerping identity toward it by
 * `weight`; `kneeQuat` (an absolute bend) is applied by slerping the knee's current quaternion
 * toward it by `weight` — at `weight === 1` both reduce to the same direct application.
 *
 * RELEASED, not hyperextended, when the anchor is beyond the leg's reach: the hip-to-target
 * distance is checked against `STANCE_TOE_PIN_MAX_REACH_FRACTION * (thigh + shin)` BEFORE solving,
 * whose own softening only approaches the reach limit asymptotically and would otherwise still
 * pull the knee toward lock every such frame. Returns `reachReleased: true` on that path so the
 * caller can count it.
 *
 * REMAINING DEFECT (not fixed here — see this file's own header). MEASURED, position-only:
 * plantedSlideM 0.191 -> 0.126 m against a 0.02 m target — real, but short of the target, and the
 * pixel grade still shows the shoe visibly shifting. A stance heel/ankle-orientation hold was
 * tried and reverted; see the header above for the measurement that reverted it.
 */
export function applyStanceToeXzPin(input: {
  actorSlot: Object3D;
  stanceFoot: StanceFoot;
  anchorXz: { x: number; z: number };
  floorOriginY: number;
  weight: number;
}): { applied: boolean; reachReleased: boolean } {
  if (input.weight <= 0) return { applied: false, reachReleased: false };
  const chain = findStanceChain(input.actorSlot, input.stanceFoot);
  if (chain === null) return { applied: false, reachReleased: false };
  const { hip, knee, heel, toe } = chain;
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  toe.updateMatrixWorld(true);
  const hipWorld = new Vector3().setFromMatrixPosition(hip.matrixWorld);
  const kneeWorld = new Vector3().setFromMatrixPosition(knee.matrixWorld);
  const heelWorld = new Vector3().setFromMatrixPosition(heel.matrixWorld);
  const toeWorld = worldXyz(toe);
  const upperLen = hipWorld.distanceTo(kneeWorld);
  const lowerLen = kneeWorld.distanceTo(heelWorld);

  // Heel target from the desired toe position, preserving the foot's own CURRENT heel-to-toe
  // offset — the same closed-loop construction the position-only pin used. MEASURED: switching
  // this to the fixed footfall offset (`anchorHeelToToeWorld`) made plantedSlideM WORSE (0.126 ->
  // 0.176 m on the same capture) — it turns the position solve open-loop, so any small mismatch
  // between the anchor-time offset and the floor-relative target it is combined with never
  // self-corrects. The orientation hold below is what fixes the sweep; the position solve stays
  // closed-loop exactly as before.
  const heelToToe = { x: toeWorld.x - heelWorld.x, y: toeWorld.y - heelWorld.y, z: toeWorld.z - heelWorld.z };
  const targetToeY = input.floorOriginY;
  const heelTarget = {
    x: input.anchorXz.x - heelToToe.x,
    y: targetToeY - heelToToe.y,
    z: input.anchorXz.z - heelToToe.z,
  };

  const maxReach = STANCE_TOE_PIN_MAX_REACH_FRACTION * (upperLen + lowerLen);
  const reachDist = hipWorld.distanceTo(new Vector3(heelTarget.x, heelTarget.y, heelTarget.z));
  if (reachDist > maxReach) return { applied: false, reachReleased: true };

  const softening = 0.005;
  const ikResult = solveTwoBoneIkForXzPin(hip, knee, heel, heelTarget, softening, input.actorSlot);

  const w = Math.max(0, Math.min(1, input.weight));
  const savedHipQuat = hip.quaternion.clone();
  const savedKneeQuat = knee.quaternion.clone();
  const blendedHipDelta = new Quaternion().identity().slerp(ikResult.hipDelta, w);
  hip.quaternion.multiplyQuaternions(hip.quaternion, blendedHipDelta);
  knee.quaternion.slerp(ikResult.kneeQuat, w);
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  toe.updateMatrixWorld(true);

  // See `STANCE_TOE_PIN_DIVERGENCE_METERS`'s own header. Checked only at near-full weight: at
  // partial weight (footfall/liftoff ramp) the target is deliberately only partly reached, so a
  // large gap there is the ramp working as designed, not a wrong-branch solve.
  if (w >= 0.9) {
    const achieved = worldXz(toe);
    const errorMeters = Math.hypot(achieved.x - input.anchorXz.x, achieved.z - input.anchorXz.z);
    if (errorMeters > STANCE_TOE_PIN_DIVERGENCE_METERS) {
      hip.quaternion.copy(savedHipQuat);
      knee.quaternion.copy(savedKneeQuat);
      hip.updateMatrixWorld(true);
      knee.updateMatrixWorld(true);
      toe.updateMatrixWorld(true);
      return { applied: false, reachReleased: true };
    }
  }
  return { applied: true, reachReleased: false };
}
