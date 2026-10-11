import type { Object3D } from "three";
import { Vector3 } from "three";
import { solveTwoBoneIK } from "./stance-lock-ik.js";
import type { StanceFoot } from "./stance-lock-mod.js";
import { findSteppingLegChain, solveSteppingLegHinge } from "./stepping-turn-leg-ik-mod.js";

/**
 * Stance-leg IK application behind the default-off `ccdStanceLockEnabled` flag (2026-10-11).
 *
 * OFF (default): the shipped two-bone solve (`solveTwoBoneIK` + hip post-multiply / knee copy),
 * moved here verbatim from `stance-lock-mod.ts` — behaviour unchanged, only the module moved.
 * ON: the hinge-constrained four-joint solve reused from `stepping-turn-leg-ik-mod.js` (no
 * duplicated solver): pole is the slot's own facing so knees bow forward, intermediates keep the
 * clip's pose (`midRestQuats: null`). Falls back to the two-bone path when the rig carries no
 * four-joint chain (headless marker rigs), so flag-on is identical to flag-off there.
 * `recordMiss` reports the heel-target miss in metres in both paths (the fallback records
 * the two-bone miss); it is read-only measurement, never a correction input.
 */
export function applyStanceLegSolve(input: {
  actorSlot: Object3D;
  stanceFoot: StanceFoot;
  hip: Object3D;
  knee: Object3D;
  heel: Object3D;
  toeBone: Object3D;
  heelTargetWorld: { x: number; y: number; z: number };
  ccdStanceLockEnabled?: boolean | undefined;
  recordMiss?: ((missM: number | null) => void) | undefined;
}): void {
  const { actorSlot, hip, knee, heel, toeBone } = input;
  if (input.ccdStanceLockEnabled === true) {
    const stepping = findSteppingLegChain(actorSlot, input.stanceFoot);
    if (stepping !== null) {
      const yaw = actorSlot.rotation.y;
      const result = solveSteppingLegHinge({
        chain: stepping,
        heelTargetWorld: input.heelTargetWorld,
        poleWorld: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) },
        midRestQuats: null,
      });
      hip.updateMatrixWorld(true);
      knee.updateMatrixWorld(true);
      toeBone.updateMatrixWorld(true);
      input.recordMiss?.(result.missM);
      return;
    }
    // No four-joint chain (headless marker rigs): fall through to the two-bone path below,
    // which records its own miss — flag-on stays identical to flag-off there.
  }
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
  const ikResult = solveTwoBoneIK(hip, knee, heel, input.heelTargetWorld, maxExtension, softening, actorSlot);
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
  } else {
    // Fallback: if IK fails, at least clamp the slot Y to not move
    // But the requirement is to NOT move actorSlot Y
  }
  heel.updateMatrixWorld(true);
  const missM = new Vector3()
    .setFromMatrixPosition(heel.matrixWorld)
    .distanceTo(
      new Vector3(input.heelTargetWorld.x, input.heelTargetWorld.y, input.heelTargetWorld.z),
    );
  input.recordMiss?.(missM);
}
