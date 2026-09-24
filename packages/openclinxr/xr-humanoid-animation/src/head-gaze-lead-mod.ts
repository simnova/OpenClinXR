import type { Object3D } from "three";

/**
 * Head-leads-the-turn: during the bedside approach's anticipatory and settling turns, the head
 * yaws toward the target heading AHEAD of the torso/pelvis/feet, bounded to a natural neck range.
 * Turn sequence head -> trunk -> pelvis -> feet is the measured human pattern (Hollands et al.
 * 2004, gaze-anticipated turning): the eyes and head commit to the new heading first, the body
 * follows.
 *
 * WRITES A DELTA, NOT AN ABSOLUTE POSE. This runs after the frame's mixer/posture pass has already
 * written the head bone's local rotation for this frame (idle sway, attention-system pitch) — the
 * same "write after pose" ordering `applyCaseOwnedStanceLock` already uses for the stance lock and
 * the settling turn. Composing a yaw delta on top preserves whatever that pass wrote; overwriting
 * the bone's rotation outright would silently undo it.
 *
 * claimScope: head-bone local yaw during the bedside approach's walking and settling phases.
 * notEvidenceFor: eye/gaze behaviour, anatomical neck limits beyond the bounded yaw, or realism.
 */

/** ~45 deg. A natural maximum neck yaw relative to the torso before the trunk must turn instead. */
export const HEAD_GAZE_LEAD_MAX_YAW_RADIANS = (45 * Math.PI) / 180;

function shortestYawDelta(fromRadians: number, toRadians: number): number {
  return Math.atan2(Math.sin(toRadians - fromRadians), Math.cos(toRadians - fromRadians));
}

function findHeadBone(actorSlot: Object3D): Object3D | null {
  let found: Object3D | null = null;
  actorSlot.traverse((node) => {
    if (found !== null) return;
    if (typeof node.name === "string" && node.name.replaceAll(".", "") === "head") found = node;
  });
  return found;
}

/**
 * Add a bounded yaw lead to the head bone for this frame. Returns null when the rig carries no
 * head bone, so a caller can tell "led" from "nothing to lead" rather than guessing from a silent
 * no-op.
 */
export function applyHeadGazeLeadYaw(input: {
  actorSlot: Object3D;
  /** The body's own current yaw (the slot's, or another reference the caller already holds). */
  bodyHeadingRadians: number;
  targetHeadingRadians: number;
  maxHeadYawRadians?: number;
}): { headLocalYawDeltaRadians: number } | null {
  const head = findHeadBone(input.actorSlot);
  if (head === null) return null;
  const maxYaw = input.maxHeadYawRadians ?? HEAD_GAZE_LEAD_MAX_YAW_RADIANS;
  const desired = shortestYawDelta(input.bodyHeadingRadians, input.targetHeadingRadians);
  const bounded = Math.max(-maxYaw, Math.min(maxYaw, desired));
  head.rotation.set(head.rotation.x, head.rotation.y + bounded, head.rotation.z, head.rotation.order);
  head.quaternion.setFromEuler(head.rotation);
  return { headLocalYawDeltaRadians: bounded };
}
