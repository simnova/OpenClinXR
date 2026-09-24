import type { Object3D } from "three";
import { Vector3 } from "three";
import { findStanceChain, solveTwoBoneIK, worldXyz } from "./stance-lock-ik.js";
import type { StanceFoot } from "./stance-lock-mod.js";

/**
 * Split out of `stance-lock-mod.ts` to clear the 500-line file-size budget. Behaviour is
 * unchanged: this is the same `applySettledPostureCorrection`, using the same IK primitives
 * (now in `stance-lock-ik.ts`).
 */

/**
 * Settled posture correction for non-locomotion frames.
 * 
 * During settling and arrived phases, the figure stands still and the stance
 * lock (which requires locomotion > 0) does not run. This leaves the standing
 * foot penetrating the floor. This function applies the SAME two-bone IK solve
 * to lift the stance toe to at or above floorOriginY, without moving the
 * actorSlot Y.
 *
 * This is a NEW call site with its own gate, NOT a deletion of the locomotion
 * gate in applyStanceLockedGroundAdvance. The locomotion gate correctly
 * derives ground advance from a planted foot during walking; a settled figure
 * has no advance to derive.
 *
 * Reuses solveTwoBoneIK which already exists and is why the walking number
 * is 0.001995 m (2.5x margin against 0.005 m limit).
 */
export function applySettledPostureCorrection(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  /** Signed height datum: the named floor frame's plane, in world metres. */
  floorOriginY: number;
  /** Height under which a toe counts as planted. */
  contactBandMeters: number;
}): { corrected: boolean; stanceFoot: StanceFoot | null; toeHeightMeters: { left: number; right: number } } {
  const { actorSlot, leftToe, rightToe, floorOriginY, contactBandMeters } = input;
  actorSlot.updateMatrixWorld(true);

  if (leftToe === null || rightToe === null) {
    return {
      corrected: false,
      stanceFoot: null,
      toeHeightMeters: {
        left: leftToe === null ? Number.NaN : worldXyz(leftToe).y - floorOriginY,
        right: rightToe === null ? Number.NaN : worldXyz(rightToe).y - floorOriginY,
      },
    };
  }

  const left = worldXyz(leftToe);
  const right = worldXyz(rightToe);
  const leftHeight = left.y - floorOriginY;
  const rightHeight = right.y - floorOriginY;
  const leftDown = leftHeight <= contactBandMeters;
  const rightDown = rightHeight <= contactBandMeters;

  let stanceFoot: StanceFoot | null = null;
  if (leftDown && rightDown) stanceFoot = leftHeight <= rightHeight ? "left" : "right";
  else if (leftDown) stanceFoot = "left";
  else if (rightDown) stanceFoot = "right";

  const toeHeightMeters = { left: leftHeight, right: rightHeight };

  if (stanceFoot === null) {
    return { corrected: false, stanceFoot: null, toeHeightMeters };
  }

  // Find the stance leg chain
  const chain = findStanceChain(actorSlot, stanceFoot);
  if (!chain) {
    return { corrected: false, stanceFoot, toeHeightMeters };
  }

  const { hip, knee, heel, toe: toeBone } = chain;
  const toeWorld = stanceFoot === "left" ? left : right;

  // Check if correction is needed
  if (toeWorld.y >= floorOriginY) {
    return { corrected: false, stanceFoot, toeHeightMeters };
  }

  // Y correction via two-bone IK: target toe Y at floorOriginY
  // This is FLEXION (shortening), so the leg bends to lift the toe
  const targetToeY = floorOriginY;
  const heelWorld = worldXyz(heel);
  // heelToToe = toe - heel, so heel = toe - heelToToe
  // For a desired toe position, heelTarget = desiredToe - heelToToe
  const heelToToe = { x: toeWorld.x - heelWorld.x, y: toeWorld.y - heelWorld.y, z: toeWorld.z - heelWorld.z };
  const heelTarget = {
    x: toeWorld.x - heelToToe.x,
    y: targetToeY - heelToToe.y,
    z: toeWorld.z - heelToToe.z,
  };

  // Max extension is upperLen + lowerLen (full extension), not current hip-to-heel distance
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  const hipWorld = new Vector3().setFromMatrixPosition(hip.matrixWorld);
  const kneeWorld = new Vector3().setFromMatrixPosition(knee.matrixWorld);
  const heelWorldPos = new Vector3().setFromMatrixPosition(heel.matrixWorld);
  const upperLen = hipWorld.distanceTo(kneeWorld);
  const lowerLen = kneeWorld.distanceTo(heelWorldPos);
  const maxExtension = upperLen + lowerLen;
  const softening = 0.005; // 5 mm softening zone

  // Solve IK to place heel at heelTarget (which puts toe at targetToeY)
  const ikResult = solveTwoBoneIK(hip, knee, heel, heelTarget, maxExtension, softening, actorSlot);
  if (ikResult) {
    // Apply local rotations to hip and knee only
    // hipDelta is a from-identity delta; compose with current animated hip pose
    hip.quaternion.multiplyQuaternions(hip.quaternion, ikResult.hipDelta);
    // kneeQuat is an absolute local bend; set directly
    knee.quaternion.copy(ikResult.kneeQuat);
    // Update world matrices so subsequent frames see the corrected pose
    hip.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    // Force toe to update
    toeBone.updateMatrixWorld(true);
    return { corrected: true, stanceFoot, toeHeightMeters };
  }

  return { corrected: false, stanceFoot, toeHeightMeters };
}
