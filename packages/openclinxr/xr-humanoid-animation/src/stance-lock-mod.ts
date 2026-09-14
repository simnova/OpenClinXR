import type { Object3D } from "three";
import * as THREE from "three";

/**
 * The stance constraint SC-00 named as the remedy, applied to the actor slot rather than the root.
 *
 * THE MEASUREMENT THIS ANSWERS. `sc-00.md` graded the shipped `openclinxr_retarget_walk_formal_cc0`
 * on the shipped physician bytes at the executor's 1.1 m/s advance and recorded `toe1-1.L` worst
 * frame 0.04008 m against a 0.005 m allowance — 8.0x over — and `toe1-1.R` at 0.10018 m, 20.0x
 * over. It also measured that the RETIRED CMU clip would have failed, at 3.6x, and concluded: "no
 * locomotion clip this pipeline has produced meets the plant threshold, and SC-05's remedy is a
 * stance constraint — foot-lock IK or equivalent — not a different clip."
 *
 * THE EQUIVALENT, AND WHY IT IS THIS ONE. A planted foot does not translate; therefore the ground
 * advance during stance is not free, it is DICTATED by the foot. So the consumer derives its
 * advance from the planted foot instead of from a constant: each frame the stance toe is measured
 * in world space and the whole actor slot is translated by whatever puts it back on its anchor.
 * This is root motion taken from the foot, which is what a foot lock IS. It reaches zero slide for
 * the pinned foot by construction, and `sc-00.md` says so explicitly — "A foot-locked stance is
 * pinned to the world by construction and reaches zero slide, so the threshold is achievable rather
 * than utopian."
 *
 * WHY THE SLOT AND NOT THE ROOT. `animation-loop.ts` assigns `root.position.y` and `root.position.x`
 * from load-time bases every frame unconditionally, and `root.position.z` under the drive branch, so
 * any per-frame root write is overwritten inside the same frame. Nothing writes `actorSlot.position`
 * per frame anywhere in `packages` or `apps`. The slot is the uncontested seam.
 *
 * WHAT IS AND IS NOT PINNED BY CONSTRUCTION, because a metric that cannot fail is not a gate:
 *
 *  - PINNED: the single stance foot, within one contact window. Zero by construction.
 *  - NOT PINNED: the other foot during double support — one frame of the 42-frame shipped cycle,
 *    where both toes sit inside the contact band. It slides by exactly this frame's correction.
 *  - NOT PINNED: window transitions. When the stance foot changes, the anchor is re-taken and no
 *    correction is applied, so the seam frame carries whatever the clip does.
 *  - NOT AFFECTED AT ALL: arrival error, settled heading, stopped-observation root travel, swept
 *    collision and limb integrity. The lock moves the body, so it can only make arrival WORSE.
 *
 * SC-05 REMEDY: two-bone IK solve on the stance leg (hip + knee) to keep the toe at or above
 * floorOriginY. The slot XZ correction remains for ground advance; Y is solved by leg flexion,
 * NOT by moving the actorSlot Y. This is FLEXION (shortening the chain), not extension.
 *
 * claimScope: the world XZ of one named stance toe is held constant across a contact window;
 * stance toe Y never goes more than PERCEPTUAL_FLOOR_METERS below floorOriginY.
 * notEvidenceFor: gait realism, clinical plausibility, or that the clip's stride is right.
 */

export type StanceFoot = "left" | "right";

export type StanceLockState = {
  /** Which foot is currently carrying the body, or null when neither toe is in the band. */
  stanceFoot: StanceFoot | null;
  /** World XZ the stance toe is pinned to, taken on the first frame of the window. */
  anchorWorldXz: { x: number; z: number } | null;
  /** How many consecutive frames the current window has run. */
  windowFrames: number;
  /** This frame's applied correction, in metres. Zero on a window seam. */
  correctionMeters: { x: number; z: number };
  /** Both toes' signed height above the floor frame this frame, for the record. */
  toeHeightMeters: { left: number; right: number };
  /** True when both toes were inside the band: the frame the other foot is NOT pinned. */
  doubleSupport: boolean;
};

export function createStanceLockState(): StanceLockState {
  return {
    stanceFoot: null,
    anchorWorldXz: null,
    windowFrames: 0,
    correctionMeters: { x: 0, z: 0 },
    toeHeightMeters: { left: Number.NaN, right: Number.NaN },
    doubleSupport: false,
  };
}

function worldXyz(node: Object3D): { x: number; y: number; z: number } {
  const elements = node.matrixWorld.elements;
  return { x: elements[12] ?? Number.NaN, y: elements[13] ?? Number.NaN, z: elements[14] ?? Number.NaN };
}

/**
 * Find the hip and knee bones for a given stance foot.
 * Returns null if the chain is incomplete.
 */
function findStanceChain(
  actorSlot: Object3D,
  stanceFoot: StanceFoot
): { hip: Object3D; knee: Object3D; heel: Object3D; toe: Object3D } | null {
  const side = stanceFoot === "left" ? "L" : "R";
  const hipName = `upperleg01.${side}`;
  const kneeName = `lowerleg01.${side}`;
  const heelName = `foot.${side}`;
  const toeName = `toe1-1.${side}`;

  const hip = actorSlot.getObjectByName(hipName);
  const knee = actorSlot.getObjectByName(kneeName);
  const heel = actorSlot.getObjectByName(heelName);
  const toe = actorSlot.getObjectByName(toeName);

  if (!hip || !knee || !heel || !toe) return null;
  return { hip, knee, heel, toe };
}

/**
 * Solve two-bone IK (hip + knee) to place the heel at target.
 * Uses cosine rule for deterministic, closed-form solution.
 * Returns the local rotation quaternions for hip and knee.
 */
export function solveTwoBoneIK(
  hip: Object3D,
  knee: Object3D,
  heel: Object3D,
  targetWorld: { x: number; y: number; z: number },
  maxExtension: number,
  softening: number
): { hipQuat: THREE.Quaternion; kneeQuat: THREE.Quaternion } | null {
  // Get world positions
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);

  const hipWorld = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
  const kneeWorld = new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld);
  const heelWorld = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);

  const target = new THREE.Vector3(targetWorld.x, targetWorld.y, targetWorld.z);

  // Bone lengths (hip->knee, knee->heel)
  const upperLen = hipWorld.distanceTo(kneeWorld);
  const lowerLen = kneeWorld.distanceTo(heelWorld);

  // Vector from hip to target
  const toTarget = target.clone().sub(hipWorld);
  const dist = toTarget.length();

  // Clamp distance to reachable range with softening near max extension
  const minDist = Math.abs(upperLen - lowerLen);
  const maxDist = maxExtension - softening;
  let clampedDist = THREE.MathUtils.clamp(dist, minDist, maxDist);

  // If we're in the softening zone, approach exponentially
  if (dist > maxDist - softening && dist < maxDist + softening) {
    const t = (dist - (maxDist - softening)) / (2 * softening);
    clampedDist = THREE.MathUtils.lerp(dist, maxDist, t * t * (3 - 2 * t)); // smoothstep
  }

  // Cosine rule for knee INTERNAL angle (angle between upper and lower leg in the triangle)
  // cos(kneeInternal) = (upper^2 + lower^2 - dist^2) / (2 * upper * lower)
  const cosKneeInternal = (upperLen * upperLen + lowerLen * lowerLen - clampedDist * clampedDist) / (2 * upperLen * lowerLen);
  const kneeInternalAngle = Math.acos(THREE.MathUtils.clamp(cosKneeInternal, -1, 1));

  // Knee joint bends by the SUPPLEMENT of the internal angle
  // Straight leg: internal = PI, bend = 0. Fully bent: internal = 0, bend = PI.
  const kneeBendAngle = Math.PI - kneeInternalAngle;

  // Cosine rule for hip angle (angle between current upper leg and desired hip->target vector)
  // cos(hip) = (upper^2 + dist^2 - lower^2) / (2 * upper * dist)
  const cosHip = (upperLen * upperLen + clampedDist * clampedDist - lowerLen * lowerLen) / (2 * upperLen * clampedDist);
  const hipAngle = Math.acos(THREE.MathUtils.clamp(cosHip, -1, 1));

  // Build rotation axis: perpendicular to the plane containing hip, knee, and target
  // Use a pole vector (character forward) to define the bend plane when collinear
  const hipToKnee = new THREE.Vector3().subVectors(kneeWorld, hipWorld).normalize();
  const hipToTarget = toTarget.clone().normalize();

  // Hinge axis = cross(hipToKnee, hipToTarget) - the axis the leg rotates around
  let hingeAxis = new THREE.Vector3().crossVectors(hipToKnee, hipToTarget).normalize();

  // If collinear (hinge axis near zero), use character's right vector as pole
  // This defines the sagittal bend plane (knee bends forward/backward)
  if (hingeAxis.lengthSq() < 1e-6) {
    // Get actorSlot's world right vector (X axis) as pole
    const actorSlot = hip.parent;
    let poleVector: THREE.Vector3;
    if (actorSlot) {
      actorSlot.updateMatrixWorld(true);
      poleVector = new THREE.Vector3(1, 0, 0).applyMatrix4(actorSlot.matrixWorld).normalize();
    } else {
      poleVector = new THREE.Vector3(1, 0, 0);
    }
    // Hinge axis = cross(legDirection, poleVector) - perpendicular to both
    hingeAxis = new THREE.Vector3().crossVectors(hipToKnee, poleVector).normalize();
    // If still degenerate (leg parallel to pole), use up vector
    if (hingeAxis.lengthSq() < 1e-6) {
      hingeAxis = new THREE.Vector3().crossVectors(hipToKnee, new THREE.Vector3(0, 1, 0)).normalize();
    }
  }

  // Convert world hinge axis to hip local space
  const hipWorldQuat = new THREE.Quaternion().setFromRotationMatrix(hip.matrixWorld);
  const hipLocalAxis = hingeAxis.clone().applyQuaternion(hipWorldQuat.clone().invert());

  // Knee rotates around same hinge axis (in knee local space)
  const kneeWorldQuat = new THREE.Quaternion().setFromRotationMatrix(knee.matrixWorld);
  const kneeLocalAxis = hingeAxis.clone().applyQuaternion(kneeWorldQuat.clone().invert());

  // Create local rotations
  // Hip rotates by hipAngle around hinge axis
  const hipQuat = new THREE.Quaternion().setFromAxisAngle(hipLocalAxis, hipAngle);
  // Knee bends by kneeBendAngle around hinge axis (supplement of internal angle)
  const kneeQuat = new THREE.Quaternion().setFromAxisAngle(kneeLocalAxis, kneeBendAngle);

  return { hipQuat, kneeQuat };
}

/**
 * Pin the stance toe and return the state.
 *
 * The caller supplies the two toe objects rather than a rig-name lookup: bone names differ between
 * rails and a lookup that guesses is the pattern-matching `chain-ownership.ts` refuses. A null toe
 * means the rig does not carry that bone, and the lock then does nothing and says so through
 * `stanceFoot: null` rather than pinning a body part it could not find.
 */
export function applyStanceLockedGroundAdvance(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  /** Signed height datum: the named floor frame's plane, in world metres. */
  floorOriginY: number;
  /** Height under which a toe counts as planted. The runtime's own FOOT_CONTACT_HEIGHT_METERS. */
  contactBandMeters: number;
  state: StanceLockState;
}): StanceLockState {
  const { actorSlot, leftToe, rightToe, state } = input;
  actorSlot.updateMatrixWorld(true);
  if (leftToe === null || rightToe === null) {
    return {
      ...createStanceLockState(),
      toeHeightMeters: {
        left: leftToe === null ? Number.NaN : worldXyz(leftToe).y - input.floorOriginY,
        right: rightToe === null ? Number.NaN : worldXyz(rightToe).y - input.floorOriginY,
      },
    };
  }
  const left = worldXyz(leftToe);
  const right = worldXyz(rightToe);
  const leftHeight = left.y - input.floorOriginY;
  const rightHeight = right.y - input.floorOriginY;
  const leftDown = leftHeight <= input.contactBandMeters;
  const rightDown = rightHeight <= input.contactBandMeters;

  // IN DOUBLE SUPPORT THE LOWER TOE CARRIES THE BODY. Hysteresis on the previous stance foot was
  // the first rule here and it is wrong for any gait without a flight phase: a foot that has begun
  // to swing is still inside the 0.06 m band for several frames, and keeping it as the stance foot
  // pins a toe that is deliberately moving forward — which drags the whole body backwards. Measured
  // on a 0.5 m-stride probe gait at 60 Hz, that produced a 0.228 m worst-frame displacement on
  // `toe1-1.L`, 45x the allowance, in the frames right after each stance change. The lower toe is
  // the one bearing weight, and it is the one that must not move.
  let stanceFoot: StanceFoot | null = null;
  if (leftDown && rightDown) stanceFoot = leftHeight <= rightHeight ? "left" : "right";
  else if (leftDown) stanceFoot = "left";
  else if (rightDown) stanceFoot = "right";

  const toeHeightMeters = { left: leftHeight, right: rightHeight };
  const doubleSupport = leftDown && rightDown;
  if (stanceFoot === null) {
    return {
      stanceFoot: null,
      anchorWorldXz: null,
      windowFrames: 0,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters,
      doubleSupport,
    };
  }

  // Find the stance leg chain (hip, knee, heel, toe)
  const chain = findStanceChain(actorSlot, stanceFoot);
  if (!chain) {
    // Fallback to XZ-only correction if chain not found
    const toe = stanceFoot === "left" ? left : right;
    const anchor = state.stanceFoot === stanceFoot ? state.anchorWorldXz : null;
    if (anchor === null) {
      return {
        stanceFoot,
        anchorWorldXz: { x: toe.x, z: toe.z },
        windowFrames: 1,
        correctionMeters: { x: 0, z: 0 },
        toeHeightMeters,
        doubleSupport,
      };
    }
    const correctionMeters = { x: anchor.x - toe.x, z: anchor.z - toe.z };
    actorSlot.position.x += correctionMeters.x;
    actorSlot.position.z += correctionMeters.z;
    actorSlot.updateMatrixWorld(true);
    return {
      stanceFoot,
      anchorWorldXz: anchor,
      windowFrames: state.windowFrames + 1,
      correctionMeters,
      toeHeightMeters,
      doubleSupport,
    };
  }

  const { hip, knee, heel, toe: toeBone } = chain;
  const toeWorld = stanceFoot === "left" ? left : right;

  const anchor = state.stanceFoot === stanceFoot ? state.anchorWorldXz : null;
  if (anchor === null) {
    // A NEW window: take the anchor where the clip actually put the foot and apply nothing.
    return {
      stanceFoot,
      anchorWorldXz: { x: toeWorld.x, z: toeWorld.z },
      windowFrames: 1,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters,
      doubleSupport,
    };
  }

  // XZ correction for ground advance (slot translates to keep toe XZ anchored)
  const correctionMeters = { x: anchor.x - toeWorld.x, z: anchor.z - toeWorld.z };
  actorSlot.position.x += correctionMeters.x;
  actorSlot.position.z += correctionMeters.z;
  actorSlot.updateMatrixWorld(true);

  // Y correction via two-bone IK: target toe Y at max(current toe Y, floorOriginY)
  // This is FLEXION (shortening), so the leg bends to lift the toe
  const targetToeY = Math.max(toeWorld.y, input.floorOriginY);
  const heelWorld = worldXyz(heel);
  const heelToToe = { x: toeWorld.x - heelWorld.x, y: toeWorld.y - heelWorld.y, z: toeWorld.z - heelWorld.z };
  const heelTarget = {
    x: anchor.x + heelToToe.x,
    y: targetToeY + heelToToe.y,
    z: anchor.z + heelToToe.z,
  };

  // Current hip->heel distance (max extension for softening)
  hip.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  const hipWorld = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
  const heelWorldPos = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
  const maxExtension = hipWorld.distanceTo(heelWorldPos);
  const softening = 0.005; // 5 mm softening zone

  // Solve IK to place heel at heelTarget (which puts toe at targetToeY)
  const ikResult = solveTwoBoneIK(hip, knee, heel, heelTarget, maxExtension, softening);
  if (ikResult) {
    // Apply local rotations to hip and knee only
    hip.quaternion.copy(ikResult.hipQuat);
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

  return {
    stanceFoot,
    anchorWorldXz: anchor,
    windowFrames: state.windowFrames + 1,
    correctionMeters,
    toeHeightMeters,
    doubleSupport,
  };
}

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
  const heelToToe = { x: toeWorld.x - heelWorld.x, y: toeWorld.y - heelWorld.y, z: toeWorld.z - heelWorld.z };
  const heelTarget = {
    x: toeWorld.x + heelToToe.x, // keep XZ at current toe position
    y: targetToeY + heelToToe.y,
    z: toeWorld.z + heelToToe.z,
  };

  // Current hip->heel distance (max extension for softening)
  hip.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  const hipWorld = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
  const heelWorldPos = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
  const maxExtension = hipWorld.distanceTo(heelWorldPos);
  const softening = 0.005; // 5 mm softening zone

  // Solve IK to place heel at heelTarget (which puts toe at targetToeY)
  const ikResult = solveTwoBoneIK(hip, knee, heel, heelTarget, maxExtension, softening);
  if (ikResult) {
    // Apply local rotations to hip and knee only
    hip.quaternion.copy(ikResult.hipQuat);
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
