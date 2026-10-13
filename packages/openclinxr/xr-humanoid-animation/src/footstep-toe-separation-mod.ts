/**
 * Footstep-plan toe separation (exit-phase-per-foot M2, 2026-10-13).
 *
 * Reads only: the route-axis R-L toe separation from the toe worlds as
 * they stand (at advance time that is the previous substep's post pose —
 * the same one-substep discipline as the clip-time read). The frame module
 * diffs consecutive substeps for the sign flip; the executor owns the exit.
 * Null when either toe is missing or the route is degenerate (no exit
 * event then; the phase target stays the terminator). Default OFF with the
 * plan flag: the caller gates, this module only measures.
 */

import type { Object3D } from "three";

/** Route-axis (right-minus-left) toe separation in metres; null without toe data. */
export function readFootstepToeSeparationM(input: {
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  startX: number;
  startZ: number;
  targetX: number;
  targetZ: number;
}): number | null {
  const { leftToe, rightToe } = input;
  if (leftToe === null || rightToe === null) return null;
  const dx = input.targetX - input.startX;
  const dz = input.targetZ - input.startZ;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return null;
  leftToe.updateWorldMatrix(true, false);
  rightToe.updateWorldMatrix(true, false);
  const left = leftToe.matrixWorld.elements;
  const right = rightToe.matrixWorld.elements;
  const unitX = dx / length;
  const unitZ = dz / length;
  return ((right[12] ?? 0) - (left[12] ?? 0)) * unitX + ((right[14] ?? 0) - (left[14] ?? 0)) * unitZ;
}
