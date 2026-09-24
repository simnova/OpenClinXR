import type { Object3D } from "three";
import { MathUtils, Quaternion, Vector3 } from "three";
import { findBonesBySanitisedName, sanitiseBoneName } from "@openclinxr/xr-pose";
import type { StanceFoot, StanceLockState } from "./stance-lock-mod.js";

/**
 * Two-bone IK primitives shared by the walking stance lock (`stance-lock-mod.ts`) and the
 * settled-posture correction (`settled-posture-correction.ts`). Split out of `stance-lock-mod.ts`
 * to clear the 500-line file-size budget; behaviour is unchanged, only the module boundary moved.
 */

export function worldXyz(node: Object3D): { x: number; y: number; z: number } {
  const elements = node.matrixWorld.elements;
  return { x: elements[12] ?? Number.NaN, y: elements[13] ?? Number.NaN, z: elements[14] ?? Number.NaN };
}

/**
 * Find the hip and knee bones for a given stance foot using sanitised MPFB names.
 * Returns null if the chain is incomplete.
 */
export function findStanceChain(
  actorSlot: Object3D,
  stanceFoot: StanceFoot
): { hip: Object3D; knee: Object3D; heel: Object3D; toe: Object3D } | null {
  const side = stanceFoot === "left" ? "L" : "R";
  // MPFB sanitised names (dots removed by PropertyBinding.sanitizeNodeName)
  const hipSanitised = sanitiseBoneName(`upperleg01.${side}`);
  const kneeSanitised = sanitiseBoneName(`lowerleg01.${side}`);
  const heelSanitised = sanitiseBoneName(`foot.${side}`);
  const toeSanitised = sanitiseBoneName(`toe1-1.${side}`);

  const hipResults = findBonesBySanitisedName(actorSlot, hipSanitised);
  const kneeResults = findBonesBySanitisedName(actorSlot, kneeSanitised);
  const heelResults = findBonesBySanitisedName(actorSlot, heelSanitised);
  const toeResults = findBonesBySanitisedName(actorSlot, toeSanitised);

  if (hipResults.length === 0 || kneeResults.length === 0 || heelResults.length === 0 || toeResults.length === 0) {
    return null;
  }
  const hip = hipResults[0];
  const knee = kneeResults[0];
  const heel = heelResults[0];
  const toe = toeResults[0];
  if (!hip || !knee || !heel || !toe) return null;
  return { hip, knee, heel, toe };
}

/**
 * Solve two-bone IK (hip + knee) to place the heel at target.
 * Uses cosine rule for deterministic, closed-form solution.
 * Returns:
 * - hipDelta: a from-identity quaternion (delta) to be COMPOSED with current animated hip pose
 * - kneeQuat: an ABSOLUTE local rotation (well-defined bend) to be SET directly on knee
 */
export function solveTwoBoneIK(
  hip: Object3D,
  knee: Object3D,
  heel: Object3D,
  targetWorld: { x: number; y: number; z: number },
  _maxExtension: number,
  softening: number,
  actorSlot: Object3D
): { hipDelta: Quaternion; kneeQuat: Quaternion } | null {
  // Get world positions
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);

  const hipWorld = new Vector3().setFromMatrixPosition(hip.matrixWorld);
  const kneeWorld = new Vector3().setFromMatrixPosition(knee.matrixWorld);
  const heelWorld = new Vector3().setFromMatrixPosition(heel.matrixWorld);

  const target = new Vector3(targetWorld.x, targetWorld.y, targetWorld.z);

  // Bone lengths (hip->knee, knee->heel)
  const upperLen = hipWorld.distanceTo(kneeWorld);
  const lowerLen = kneeWorld.distanceTo(heelWorld);

  // Vector from hip to target
  const toTarget = target.clone().sub(hipWorld);
  const dist = toTarget.length();

  // Clamp distance to reachable range with softening near max extension
  // Max extension is upperLen + lowerLen (full extension), not current hip-to-heel distance
  const minDist = Math.abs(upperLen - lowerLen);
  const fullExtension = upperLen + lowerLen;
  const maxDist = fullExtension - softening;
  let clampedDist = MathUtils.clamp(dist, minDist, maxDist);

  // If we're in the softening zone, approach exponentially
  if (dist > maxDist - softening && dist < maxDist + softening) {
    const t = (dist - (maxDist - softening)) / (2 * softening);
    clampedDist = MathUtils.lerp(dist, maxDist, t * t * (3 - 2 * t)); // smoothstep
  }

  // Cosine rule for knee INTERNAL angle (angle between upper and lower leg in the triangle)
  // cos(kneeInternal) = (upper^2 + lower^2 - dist^2) / (2 * upper * lower)
  const cosKneeInternal = (upperLen * upperLen + lowerLen * lowerLen - clampedDist * clampedDist) / (2 * upperLen * lowerLen);
  const kneeInternalAngle = Math.acos(MathUtils.clamp(cosKneeInternal, -1, 1));

  // Knee joint bends by the SUPPLEMENT of the internal angle
  // Straight leg: internal = PI, bend = 0. Fully bent: internal = 0, bend = PI.
  const kneeBendAngle = Math.PI - kneeInternalAngle;

  // Cosine rule for hip angle (angle between current upper leg and desired hip->target vector)
  // cos(hip) = (upper^2 + dist^2 - lower^2) / (2 * upper * dist)
  const cosHip = (upperLen * upperLen + clampedDist * clampedDist - lowerLen * lowerLen) / (2 * upperLen * clampedDist);
  const hipAngle = Math.acos(MathUtils.clamp(cosHip, -1, 1));

  // Build rotation axis: perpendicular to the plane containing hip, knee, and target
  // Use a pole vector (character forward) to define the bend plane when collinear
  const hipToKnee = new Vector3().subVectors(kneeWorld, hipWorld).normalize();
  const hipToTarget = toTarget.clone().normalize();

  // Hinge axis = cross(hipToKnee, hipToTarget) - the axis the leg rotates around
  let hingeAxis = new Vector3().crossVectors(hipToKnee, hipToTarget).normalize();

  // If collinear (hinge axis near zero), use caller-supplied actorSlot as direction-only frame
  // This defines the sagittal bend plane (knee bends forward/backward)
  if (hingeAxis.lengthSq() < 1e-6) {
    let poleVector: Vector3;
    if (actorSlot) {
      actorSlot.updateMatrixWorld(true);
      // Use direction-only transform (no translation) - applyQuaternion not applyMatrix4
      poleVector = new Vector3(1, 0, 0).applyQuaternion(actorSlot.quaternion).normalize();
    } else {
      poleVector = new Vector3(1, 0, 0);
    }
    // Hinge axis = cross(legDirection, poleVector) - perpendicular to both
    hingeAxis = new Vector3().crossVectors(hipToKnee, poleVector).normalize();
    // If still degenerate (leg parallel to pole), use up vector
    if (hingeAxis.lengthSq() < 1e-6) {
      hingeAxis = new Vector3().crossVectors(hipToKnee, new Vector3(0, 1, 0)).normalize();
    }
  }

  // Convert world hinge axis to hip local space
  const hipWorldQuat = new Quaternion().setFromRotationMatrix(hip.matrixWorld);
  const hipLocalAxis = hingeAxis.clone().applyQuaternion(hipWorldQuat.clone().invert());

  // Knee rotates around same hinge axis (in knee local space)
  const kneeWorldQuat = new Quaternion().setFromRotationMatrix(knee.matrixWorld);
  const kneeLocalAxis = hingeAxis.clone().applyQuaternion(kneeWorldQuat.clone().invert());

  // Create local rotations
  // Hip delta: rotates by hipAngle around hinge axis (from-identity delta)
  const hipDelta = new Quaternion().setFromAxisAngle(hipLocalAxis, hipAngle);
  // Knee absolute: bends by kneeBendAngle around hinge axis (well-defined absolute local bend)
  const kneeQuat = new Quaternion().setFromAxisAngle(kneeLocalAxis, kneeBendAngle);

  return { hipDelta, kneeQuat };
}

/**
 * Unused by any current caller (kept intact from `stance-lock-mod.ts`, moved here only to clear
 * that file's line budget). `capCorrection`'s no-backward projection on the primary correction path
 * covers the same "never yank the slot backward" property today.
 */

/**
 * Largest slot XZ correction the pin may apply in one frame. With the executor advancing at the
 * clip's own played speed, a correctly crowned planted foot drifts by millimetres per frame and is
 * pinned in full. A larger demand means the lock crowned the wrong foot mid-transfer; applying it
 * dragged the body back 26-50 mm per frame (advance-loss.json), so it is capped instead.
 */
export const MAX_PIN_CORRECTION_METERS = 0.02;
export function capCorrection(
  correction: { x: number; z: number },
  travelUnit: { x: number; z: number } | undefined,
): { x: number; z: number } {
  // Never pull the body backward along the route: the executor owns forward progress, and a
  // backward pin is the lurch. The backward component is dropped; lateral and forward remain.
  let c = correction;
  if (travelUnit !== undefined) {
    const len = Math.hypot(travelUnit.x, travelUnit.z);
    if (len > 0) {
      const ux = travelUnit.x / len;
      const uz = travelUnit.z / len;
      const along = c.x * ux + c.z * uz;
      if (along < 0) c = { x: c.x - along * ux, z: c.z - along * uz };
    }
  }
  const m = Math.hypot(c.x, c.z);
  return m > MAX_PIN_CORRECTION_METERS ? { x: (c.x / m) * MAX_PIN_CORRECTION_METERS, z: (c.z / m) * MAX_PIN_CORRECTION_METERS } : c;
}

/**
 * Rotate the slot's own XZ position around a fixed world anchor by `yawDeltaRadians`, so a point
 * that WAS at the anchor stays there through the rotation — a pivot about that point rather than
 * about the slot's own origin.
 *
 * WHY THIS IS UNCAPPED, unlike `capCorrection` above. A yaw change on `actorSlot` rotates its whole
 * child subtree (every bone, including a planted toe) around the SLOT's origin by construction —
 * that displacement is exact geometry, not an estimate to chase. `capCorrection` exists to bound a
 * HEURISTIC pull toward an anchor built from noisy per-frame clip motion; applying that same cap
 * here only partially cancels a rotation and lets the uncancelled remainder become real slot drift,
 * frame after frame, because the correction is always chasing a target that moved again before it
 * arrived. Measured: an anticipatory heading blend without this produced 0.68 m of SC-05 arrival
 * error over roughly the size of one stride's worth of yaw change — cancel the rotation exactly
 * here, first, and let the SEPARATE clip-motion correction (still capped) handle only genuine
 * walking advance afterward.
 */
export function pivotSlotAroundAnchor(
  actorSlot: Object3D,
  anchor: { x: number; z: number },
  yawDeltaRadians: number,
): void {
  const dx = actorSlot.position.x - anchor.x;
  const dz = actorSlot.position.z - anchor.z;
  const cos = Math.cos(yawDeltaRadians);
  const sin = Math.sin(yawDeltaRadians);
  // Matches THREE's own Y-axis rotation (Matrix4.makeRotationY: x' = x*cos + z*sin,
  // z' = -x*sin + z*cos — the same convention `travelYawForClipForward`'s `atan2(x, z)` heading
  // already assumes), not the textbook XZ-plane rotation matrix, which has the cross-term signs
  // flipped and would pivot the slot the wrong way around the anchor.
  actorSlot.position.x = anchor.x + dx * cos + dz * sin;
  actorSlot.position.z = anchor.z - dx * sin + dz * cos;
}

/**
 * Cancel the planted foot's rotation-induced world displacement for this lock run, exactly,
 * before anything reads a toe position or computes a clip-motion correction. `actorSlot.rotation.y`
 * may have changed since the previous lock run (an anticipatory turn, the settling turn); that
 * rotates the WHOLE child subtree — including a planted toe — about the slot's own origin by
 * construction. Left uncompensated, `capCorrection`'s capped clip-motion correction chases that
 * displacement a few millimetres per frame and never catches up, and the residual becomes real slot
 * drift (measured 0.68 m of SC-05 arrival error from one stride's worth of yaw change).
 * Compensating exactly here turns that same yaw change into a clean pivot about the anchor instead:
 * the slot arcs around the planted foot, which is what a human step-turn does, and the clip-motion
 * correction is left to handle only genuine clip-driven motion, where its cap is a real bound
 * rather than a chase that never lands.
 *
 * Pivots around the toe's LAST MEASURED position (`prevToeWorldXz`), not the window's ideal
 * `anchorWorldXz`. The two usually agree closely, but not exactly — the clip-motion correction is
 * capped, so a stance window that has not yet fully converged onto its anchor leaves a small gap,
 * and pivoting around the IDEAL point instead of the ACTUAL one carries that gap through the
 * rotation instead of cancelling it. `prevToeWorldXz` is exact regardless of that gap.
 */
export function compensateSlotForYawChange(actorSlot: Object3D, state: StanceLockState): void {
  const prevStanceToe =
    state.stanceFoot === "left"
      ? state.prevToeWorldXz?.left
      : state.stanceFoot === "right"
        ? state.prevToeWorldXz?.right
        : undefined;
  if (state.stanceFoot === null || prevStanceToe === undefined || state.prevYawRadians === null) return;
  const yawDeltaRadians = actorSlot.rotation.y - state.prevYawRadians;
  if (yawDeltaRadians === 0) return;
  pivotSlotAroundAnchor(actorSlot, prevStanceToe, yawDeltaRadians);
  actorSlot.updateMatrixWorld(true);
}

/**
 * The slot's current lateral drift from the start-to-target route line, measured so a NEW
 * footfall's anchor can be biased against it. A pivot through a yaw change moves the slot on an
 * arc around the planted foot (see `compensateSlotForYawChange` — correct, and not corrected
 * there), but nothing brings that arc back toward the route on its own. A real turning step-turn
 * corrects course through where the NEXT foot lands, not by sliding the planted one, so the caller
 * applies this only at anchor-capture ("new window") branches, never mid-window.
 */
export function computeFootfallBias(
  slotXz: { x: number; z: number },
  routeStart: { x: number; z: number } | undefined,
  travelUnit: { x: number; z: number } | undefined,
): { x: number; z: number } {
  if (routeStart === undefined || travelUnit === undefined) return { x: 0, z: 0 };
  const unitLength = Math.hypot(travelUnit.x, travelUnit.z);
  if (unitLength === 0) return { x: 0, z: 0 };
  const ux = travelUnit.x / unitLength;
  const uz = travelUnit.z / unitLength;
  const relX = slotXz.x - routeStart.x;
  const relZ = slotXz.z - routeStart.z;
  const along = relX * ux + relZ * uz;
  const projectedX = routeStart.x + along * ux;
  const projectedZ = routeStart.z + along * uz;
  return { x: slotXz.x - projectedX, z: slotXz.z - projectedZ };
}
