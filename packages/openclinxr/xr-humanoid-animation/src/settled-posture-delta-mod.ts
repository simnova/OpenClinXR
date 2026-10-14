import type { Object3D } from "three";
import { Quaternion, Vector3 } from "three";
import { solveTwoBoneIK } from "./stance-lock-ik.js";

/**
 * Differential application of the settled two-bone solve (arrived-foot-snap).
 *
 * `solveTwoBoneIK` derives the solution triangle assuming the leg starts
 * STRAIGHT along the target line: its hip delta rotates the upper leg by the
 * solution's full hip angle, and its knee quat is an absolute bend. From the
 * arrival close's converged crouch the upper leg already sits ~12° off the
 * target line with a bent, twisted knee, so the full-angle rotation overshoots
 * into a new plane and the absolute knee discards the twist — measured, a
 * 0.34 m horizontal toe teleport for ~0.06 m of lift (flags off: only
 * upperleg01L/lowerleg01L quats change, slot frozen).
 *
 * This keeps the solver's triangle (same hinge, same angles) but applies the
 * DIFFERENCE from the current pose: the hip rotates by (solution offset minus
 * current offset) staying on its own side, and the knee composes only the
 * additional flexion, preserving its current twist. When the solver's
 * straight-leg assumption holds (current offsets ~0, identity joints) both
 * differences equal the full solution, so the standing-penetration fixtures
 * behave bit-identically to the absolute path.
 */
export function solveSettledDifferential(
  hip: Object3D,
  knee: Object3D,
  heel: Object3D,
  targetWorld: { x: number; y: number; z: number },
  maxExtension: number,
  softening: number,
  actorSlot: Object3D,
): { hipDelta: Quaternion; kneeDelta: Quaternion } | null {
  const solved = solveTwoBoneIK(hip, knee, heel, targetWorld, maxExtension, softening, actorSlot);
  if (solved === null) return null;

  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  const hipWorld = new Vector3().setFromMatrixPosition(hip.matrixWorld);
  const kneeWorld = new Vector3().setFromMatrixPosition(knee.matrixWorld);
  const heelWorld = new Vector3().setFromMatrixPosition(heel.matrixWorld);
  const upperLen = hipWorld.distanceTo(kneeWorld);
  const lowerLen = kneeWorld.distanceTo(heelWorld);

  // Solution angles recovered from the solved quats.
  const hipAxis = new Vector3(solved.hipDelta.x, solved.hipDelta.y, solved.hipDelta.z);
  if (hipAxis.lengthSq() < 1e-12) {
    return {
      hipDelta: solved.hipDelta.clone(),
      kneeDelta: new Quaternion(),
    };
  }
  hipAxis.normalize();
  const hipAngle = 2 * Math.acos(Math.min(1, Math.abs(solved.hipDelta.w)));
  const kneeAxis = new Vector3(solved.kneeQuat.x, solved.kneeQuat.y, solved.kneeQuat.z);
  const kneeAxisLen = kneeAxis.length();
  const solutionBend = kneeAxisLen < 1e-12 ? 0 : 2 * Math.acos(Math.min(1, Math.abs(solved.kneeQuat.w)));

  // Current signed offset of the upper leg from the target line, about the
  // WORLD hinge: the solved delta axis is hip-local, so transform it out.
  // (Composing below stays local, which is the correct frame for the delta.)
  const hipWorldQuat = new Quaternion().setFromRotationMatrix(hip.matrixWorld);
  const worldHinge = hipAxis.clone().applyQuaternion(hipWorldQuat).normalize();
  const upperDir = new Vector3().subVectors(kneeWorld, hipWorld).normalize();
  const targetDir = new Vector3(targetWorld.x - hipWorld.x, targetWorld.y - hipWorld.y, targetWorld.z - hipWorld.z).normalize();
  const cross = new Vector3().crossVectors(upperDir, targetDir);
  const currentOffset = Math.atan2(cross.dot(worldHinge), upperDir.dot(targetDir));

  // Stay on the leg's own side at the solution's magnitude; from straight,
  // currentOffset is 0 and this is the solver's own rotation, exactly.
  const straightEps = 1e-6;
  const targetOffset = Math.abs(currentOffset) < straightEps ? hipAngle : Math.sign(currentOffset) * hipAngle;
  const hipDelta = new Quaternion().setFromAxisAngle(hipAxis, targetOffset - currentOffset).normalize();

  // Current flexion from the cosine rule on the current reach; the knee takes
  // only the additional bend. From straight, currentBend is 0 and composing
  // this delta onto the current joint equals the absolute solution exactly.
  const currentReach = hipWorld.distanceTo(heelWorld);
  const cosCurrent =
    upperLen <= 0 || lowerLen <= 0
      ? 1
      : (upperLen * upperLen + lowerLen * lowerLen - currentReach * currentReach) / (2 * upperLen * lowerLen);
  const currentBend = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosCurrent)));
  const bendDelta = solutionBend - currentBend;
  const kneeDelta =
    kneeAxisLen < 1e-12 || Math.abs(bendDelta) < 1e-12
      ? new Quaternion()
      : new Quaternion().setFromAxisAngle(kneeAxis.clone().normalize(), bendDelta).normalize();

  return { hipDelta, kneeDelta };
}
