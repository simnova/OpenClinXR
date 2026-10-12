/**
 * Post-pass arm-motion governor (2026-10-11 arm-settle).
 *
 * The walk-end arm release snapped ~30 deg in one frame with continuous clip, time and
 * weight inputs, and the snap lands on the idle-map pose, so the posture pass is the only
 * writer that can produce it — yet every in-pass blend is small. Rather than chase the
 * exact compounding, this governor bounds the OBSERVABLE: after all per-frame writers
 * have run, no arm bone may move more than 3.5 deg from its last governed pose. Repeat
 * calls with an unchanged bone hold instead of compounding, so blend progress tracks sim
 * frames, not wall ticks. First sight lands exact, preserving load-time behavior.
 * Legs, spine, neck and head never enter: legs belong to the stance lock, head to gaze.
 */

import type { Object3D } from "three";
import { Quaternion } from "three";
import { sanitiseBoneName } from "./pose-bone-runtime.js";

export const ARM_GOVERNOR_MAX_STEP_RAD = (3.5 * Math.PI) / 180;

type ArmGovernorPrev = { x: number; y: number; z: number; w: number };

const _govA = new Quaternion();
const _govB = new Quaternion();

function armGovernorStore(humanoid: Object3D): Map<string, ArmGovernorPrev> {
  const existing = humanoid.userData.openClinXrArmGovernorPrev as
    | Map<string, ArmGovernorPrev>
    | undefined;
  if (existing instanceof Map) return existing;
  const created = new Map<string, ArmGovernorPrev>();
  humanoid.userData.openClinXrArmGovernorPrev = created;
  return created;
}

/** Arm bones on every shipped rail (upper/forearm/hand, including mixamorig names). */
function isGovernedArmBone(sanitised: string): boolean {
  return /arm|hand|wrist/i.test(sanitised);
}

/**
 * Bound one bone's total per-pass motion against its last governed pose. No-op when the
 * bone already holds the last governed pose (repeat call); exact on first sight.
 */
function governOneBone(
  object: Object3D,
  store: Map<string, ArmGovernorPrev>,
  key: string,
): void {
  const cur = object.quaternion;
  const prev = store.get(key);
  if (prev !== undefined) {
    _govA.set(prev.x, prev.y, prev.z, prev.w);
    if (cur.equals(_govA)) return;
    const step = _govA.angleTo(cur);
    if (step > ARM_GOVERNOR_MAX_STEP_RAD) {
      _govB.copy(_govA).slerp(cur, ARM_GOVERNOR_MAX_STEP_RAD / step);
      object.quaternion.copy(_govB);
      object.rotation.setFromQuaternion(object.quaternion);
    }
  }
  store.set(key, { x: object.quaternion.x, y: object.quaternion.y, z: object.quaternion.z, w: object.quaternion.w });
}

/** Run the governor over every arm bone of the humanoid. Call once per pass, last. */
export function governArmReleaseMotion(humanoid: Object3D): void {
  const store = armGovernorStore(humanoid);
  humanoid.traverse((object) => {
    const key = sanitiseBoneName(object.name);
    if (!isGovernedArmBone(key)) return;
    governOneBone(object, store, key);
  });
}
