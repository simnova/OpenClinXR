import type { Object3D } from "three";
import { MathUtils, Quaternion } from "three";
import { worldXyz } from "./stance-lock-ik.js";

/**
 * Shared revert-on-divergence guard for every caller that blends a two-bone IK solve
 * (`solveTwoBoneIkForXzPin`, `stance-toe-xz-pin-mod.ts`) into a leg's hip+knee. ONE helper, not a
 * per-call copy — MEASURED 2026-09-25 (coordinator direction, fourth pass) that a per-call copy is
 * exactly how this gets missed: `applyStanceToeXzPin` had its own inline guard; `applySwingFootLiftAssist`
 * (146fc9181) called the SAME shared solve with NONE, and on the real-clip peds-child capture (the
 * physician's walk clip does not manifest this the same way) the swing-lift call produced a 0.29 m
 * one-frame toe flight-and-recover with `reachReleased: false` throughout — the solve's own
 * "FALLBACK AXIS branch" flip (`solveTwoBoneIkForXzPin`'s own header), landing on a caller with no
 * guard to catch it.
 *
 * LEG-LENGTH SCALED THRESHOLD, not the physician's own fixed 0.08 m
 * (`STANCE_TOE_PIN_DIVERGENCE_METERS`, the constant this replaces). MEASURED on the real-clip
 * peds-child capture: `applyStanceToeXzPin`'s OWN existing guard did not catch several 0.12-0.18 m
 * one-frame steps in the stance pin either, because a fixed 0.08 m threshold calibrated for the
 * physician's ~0.55 m leg is proportionally loose on the child's ~0.39 m leg — an error that is a
 * large fraction of a short leg's own reach can still read as "under 0.08 m" in absolute terms.
 * `DIVERGENCE_FRACTION_OF_LEG_LENGTH` is fixed to reproduce the physician's own already-proven
 * 0.08 m at the physician's own measured leg length (`0.08 / 0.5508`), so the physician's behaviour
 * is unchanged by this refactor; a shorter or longer leg gets the same PROPORTIONAL tolerance
 * instead of the same absolute one.
 */
export const DIVERGENCE_FRACTION_OF_LEG_LENGTH = 0.08 / 0.5508;
/** Floor: below this, the position solve's own 5 mm softening zone already dominates the error
 * budget, so a smaller threshold would revert legitimate near-target convergence. */
export const DIVERGENCE_MIN_METERS = 0.03;
/** Ceiling: the physician's own already-proven 0.08 m, so no rig gets a LOOSER guard than the one
 * this threshold is calibrated from — only shorter legs get tighter. */
export const DIVERGENCE_MAX_METERS = 0.08;

export function divergenceThresholdMeters(legLengthMeters: number): number {
  return MathUtils.clamp(
    legLengthMeters * DIVERGENCE_FRACTION_OF_LEG_LENGTH,
    DIVERGENCE_MIN_METERS,
    DIVERGENCE_MAX_METERS,
  );
}

/**
 * Blend a solved `{hipDelta, kneeQuat}` into `hip`/`knee` by `weight`, then — ONLY at near-full
 * weight (`w >= 0.9`, same threshold `applyStanceToeXzPin` always used: at partial weight the
 * target is deliberately only partly reached, so a gap there is the ramp working as designed, not
 * a wrong-branch solve) — measure the ACHIEVED toe XZ against `intendedToeXz` and revert to the
 * PRE-BLEND quaternions if it diverged beyond `divergenceThresholdMeters(legLengthMeters)`.
 *
 * `intendedToeXz` is caller-supplied because callers target different things: the stance pin's
 * intended point is its fixed footfall anchor; the swing-lift assist's intended point is the toe's
 * OWN pre-solve XZ (it only means to change Y, not XZ — see that function's own header).
 */
export function applyGuardedTwoBoneBlend(input: {
  hip: Object3D;
  knee: Object3D;
  toe: Object3D;
  ikResult: { hipDelta: Quaternion; kneeQuat: Quaternion };
  weight: number;
  intendedToeXz: { x: number; z: number };
  legLengthMeters: number;
}): { applied: boolean; diverged: boolean } {
  const { hip, knee, toe, ikResult, intendedToeXz, legLengthMeters } = input;
  const w = MathUtils.clamp(input.weight, 0, 1);
  const savedHipQuat = hip.quaternion.clone();
  const savedKneeQuat = knee.quaternion.clone();
  const blendedHipDelta = new Quaternion().identity().slerp(ikResult.hipDelta, w);
  hip.quaternion.multiplyQuaternions(hip.quaternion, blendedHipDelta);
  knee.quaternion.slerp(ikResult.kneeQuat, w);
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  toe.updateMatrixWorld(true);

  if (w >= 0.9) {
    const achieved = worldXyz(toe);
    const errorMeters = Math.hypot(achieved.x - intendedToeXz.x, achieved.z - intendedToeXz.z);
    if (errorMeters > divergenceThresholdMeters(legLengthMeters)) {
      hip.quaternion.copy(savedHipQuat);
      knee.quaternion.copy(savedKneeQuat);
      hip.updateMatrixWorld(true);
      knee.updateMatrixWorld(true);
      toe.updateMatrixWorld(true);
      return { applied: false, diverged: true };
    }
  }
  return { applied: true, diverged: false };
}
