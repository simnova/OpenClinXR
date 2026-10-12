/**
 * Slew-limited arm writes for the clinical idle posture pass (2026-10-11 arm-settle).
 *
 * Split out of `clinical-idle-posture.ts` to clear that file's 500-line zone budget.
 * Behaviour lives here; the posture pass calls in.
 */

import type { Object3D } from "three";
import { Quaternion } from "three";

/**
 * Arm release smoothing (2026-10-11 arm-settle): per-pass-call cap, in radians, on TOTAL arm
 * bone motion during the walk-to-idle release.
 *
 * MEASURED in the browser on the physician: the release covered ~87% of the ~35 deg
 * clip-to-idle arm distance in a single settling frame (33.6 deg/frame against a ~2.3
 * deg/frame steady walking arm rate). Two mechanisms compound in one frame: the walk
 * action's own leg-weight fade shifts the mixer output idle-ward, and the owned-crossfade
 * slerp pulls idle-ward on top. Worse, under the fake-clock capture harness several wall
 * rAF ticks run per sim advance, and every tick re-runs this pass, so an uncapped blend
 * converges wall-fast while sim time stands still. Capped at 2.0 deg/call with the
 * repeat-collapse in `writeArmReleaseSlew`, the release spans ~0.6 s of sim time and no
 * sim frame exceeds the walk clip's own steady per-frame arm rate. Arms only: only
 * upper/forearm/hand bones ever reach the capped write; legs are never written by this
 * pass and head attention keeps its exact write.
 */
export const ARM_RELEASE_SLEW_MAX_RAD = (2.0 * Math.PI) / 180;

/** Last blend state per arm bone: the mixer pose seen and the result written. */
export type ArmReleasePrev = {
  mixer: { x: number; y: number; z: number; w: number };
  written: { x: number; y: number; z: number; w: number };
};

const _slewA = new Quaternion();
const _slewB = new Quaternion();

export function armReleaseStore(humanoid: Object3D): Map<string, ArmReleasePrev> {
  const existing = humanoid.userData.openClinXrArmReleasePrev as Map<string, ArmReleasePrev> | undefined;
  if (existing instanceof Map) return existing;
  const created = new Map<string, ArmReleasePrev>();
  humanoid.userData.openClinXrArmReleasePrev = created;
  return created;
}

/**
 * Slew-limited arm write shared by the owned crossfade and the unowned idle paths.
 *
 * Repeat-collapse: when the bone holds either the mixer pose seen at the last blend or the
 * last result written, there is no new frame to blend — this pass's second skeleton
 * traversal over the same Bone objects, or a wall rAF tick with no sim advance under the
 * fake clock — so hold the last result instead of compounding the blend. Otherwise slerp
 * toward the target and cap the TOTAL motion from the last result (defaulting to the entry
 * pose) at ARM_RELEASE_SLEW_MAX_RAD, so neither the crossfade weight ramp nor the walk
 * action's own weight fade can snap the arm in one frame.
 */
export function writeArmReleaseSlew(
  object: Object3D,
  store: Map<string, ArmReleasePrev>,
  key: string,
  targetQuat: Quaternion,
  blendT: number,
  poseTag: string,
): void {
  const cur = object.quaternion;
  const entry = { x: cur.x, y: cur.y, z: cur.z, w: cur.w };
  const prev = store.get(key);
  if (prev !== undefined) {
    _slewA.set(prev.mixer.x, prev.mixer.y, prev.mixer.z, prev.mixer.w);
    _slewB.set(prev.written.x, prev.written.y, prev.written.z, prev.written.w);
    if (cur.equals(_slewA) || cur.equals(_slewB)) {
      object.userData.openClinXrClinicalIdlePosture = poseTag;
      return;
    }
  }
  _slewA.copy(cur).slerp(targetQuat, blendT);
  if (prev !== undefined) {
    // Cap total motion from the last result — but never on first sight (no prev): the
    // load-time call must still land the exact idle pose, matching historical behavior.
    _slewB.set(prev.written.x, prev.written.y, prev.written.z, prev.written.w);
    const step = _slewB.angleTo(_slewA);
    if (step > ARM_RELEASE_SLEW_MAX_RAD && step > 0) {
      _slewB.slerp(_slewA, ARM_RELEASE_SLEW_MAX_RAD / step);
      _slewA.copy(_slewB);
    }
  }
  object.quaternion.copy(_slewA);
  object.rotation.setFromQuaternion(object.quaternion);
  object.userData.openClinXrClinicalIdlePosture = poseTag;
  store.set(key, {
    mixer: entry,
    written: { x: _slewA.x, y: _slewA.y, z: _slewA.z, w: _slewA.w },
  });
}

