import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applySettledPostureCorrection } from "./stance-lock-mod.js";
import { solveSettledDifferential } from "./settled-posture-delta-mod.js";
import { solveTwoBoneIK, worldXyz } from "./stance-lock-ik.js";

/**
 * Arrived-foot-snap slice: the settled solve is applied as the DIFFERENCE
 * from the current pose (hip: solution offset minus current offset on the
 * leg's own side; knee: additional flexion only, twist preserved) instead of
 * the absolute re-pose (full-angle hip rotation + absolute knee set), which
 * teleported a toe 0.34 m horizontally for ~0.06 m of lift on the first
 * post-close frame (flags-off tap: only upperleg01L/lowerleg01L quats change,
 * slot frozen).
 *
 * Contracts pinned here (unit level; the 0.005 m/frame bar itself is proven
 * in the browser capture, where the correction now runs every arrived frame
 * from bent mid-glide poses instead of once from the singular end-state):
 * 1. on a straight leg the differential EQUALS the absolute solve (the
 *    solver's straight-leg assumption holds; standing-penetration behaviour
 *    is unchanged — the other 9 tests in
 *    the-standing-foot-stays-above-the-floor.test.ts cover its purpose);
 * 2. on a twisted crouch the differential moves the toe strictly less than
 *    the absolute solve in one call and converges the depth over frames.
 */

function makeTwistedCrouch(): {
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  heel: THREE.Object3D;
} {
  const actorSlot = new THREE.Group();
  const hip = new THREE.Object3D();
  hip.name = "upperleg01L";
  hip.position.set(0, 0.9, 0);
  actorSlot.add(hip);
  const knee = new THREE.Object3D();
  knee.name = "lowerleg01L";
  // Bent 0.12 m out of the sagittal plane: a twisted crouch, not a straight leg.
  knee.position.set(0.1, -0.42, 0.07);
  hip.add(knee);
  const heel = new THREE.Object3D();
  heel.name = "footL";
  heel.position.set(-0.06, -0.36, -0.03);
  knee.add(heel);
  const toe = new THREE.Object3D();
  toe.name = "toe1-1L";
  // Heel world Y = 0.9 - 0.42 - 0.36 = 0.12; local -0.14 puts the toe 2 cm
  // BELOW the floor so the correction engages.
  toe.position.set(0.02, -0.14, 0.01);
  heel.add(toe);
  const rightToe = new THREE.Object3D();
  rightToe.name = "toe1-1R";
  rightToe.position.set(0.1, 0.25, 0);
  actorSlot.add(rightToe);
  const rightHip = new THREE.Object3D();
  rightHip.name = "upperleg01R";
  rightHip.position.set(0.1, 0.9, 0);
  actorSlot.add(rightHip);
  const rightKnee = new THREE.Object3D();
  rightKnee.name = "lowerleg01R";
  rightKnee.position.set(0, -0.45, 0);
  rightHip.add(rightKnee);
  const rightHeel = new THREE.Object3D();
  rightHeel.name = "footR";
  rightHeel.position.set(0, -0.33, 0);
  rightKnee.add(rightHeel);
  actorSlot.updateMatrixWorld(true);
  return { actorSlot, leftToe: toe, rightToe, hip, knee, heel };
}

function toeDepthY(toe: THREE.Object3D, floorOriginY: number): number {
  toe.updateMatrixWorld(true);
  return floorOriginY - (toe.matrixWorld.elements[13] ?? Number.NaN);
}

describe("the settled solve keeps the bend plane (arrived-foot-snap)", () => {
  it("contrast: the target-plane solve swings the twisted crouch foot wide", () => {
    const { actorSlot, leftToe, hip, knee, heel } = makeTwistedCrouch();
    const floorOriginY = 0;
    actorSlot.updateMatrixWorld(true);
    const before = worldXyz(leftToe);
    // Toe starts below the floor (else the correction would no-op).
    expect(before.y - floorOriginY).toBeLessThan(0);
    const hipW = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
    const kneeW = new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld);
    const heelW = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
    const upperLen = hipW.distanceTo(kneeW);
    const lowerLen = kneeW.distanceTo(heelW);
    const heelToToe = {
      x: before.x - heelW.x,
      y: before.y - heelW.y,
      z: before.z - heelW.z,
    };
    const heelTarget = {
      x: before.x - heelToToe.x,
      y: floorOriginY - heelToToe.y,
      z: before.z - heelToToe.z,
    };
    const raw = solveTwoBoneIK(hip, knee, heel, heelTarget, upperLen + lowerLen, 0.005, actorSlot);
    expect(raw).not.toBeNull();
    hip.quaternion.multiplyQuaternions(hip.quaternion, raw!.hipDelta);
    knee.quaternion.copy(raw!.kneeQuat);
    hip.updateMatrixWorld(true);
    const after = worldXyz(leftToe);
    const swing = Math.hypot(after.x - before.x, after.z - before.z);
    // The old path re-aims the twisted leg: horizontal travel dwarfs the lift.
    expect(swing).toBeGreaterThan(0.02);
  });

  it("the differential moves the twisted crouch toe less and converges", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;
    // Absolute path, one call: the snap magnitude on this rig.
    const absRig = makeTwistedCrouch();
    absRig.actorSlot.updateMatrixWorld(true);
    const absBefore = worldXyz(absRig.leftToe);
    const hipW = new THREE.Vector3().setFromMatrixPosition(absRig.hip.matrixWorld);
    const kneeW = new THREE.Vector3().setFromMatrixPosition(absRig.knee.matrixWorld);
    const heelW = new THREE.Vector3().setFromMatrixPosition(absRig.heel.matrixWorld);
    const heelToToe = {
      x: absBefore.x - heelW.x,
      y: absBefore.y - heelW.y,
      z: absBefore.z - heelW.z,
    };
    const raw = solveTwoBoneIK(
      absRig.hip,
      absRig.knee,
      absRig.heel,
      { x: absBefore.x - heelToToe.x, y: floorOriginY - heelToToe.y, z: absBefore.z - heelToToe.z },
      hipW.distanceTo(kneeW) + kneeW.distanceTo(heelW),
      0.005,
      absRig.actorSlot,
    )!;
    absRig.hip.quaternion.multiplyQuaternions(absRig.hip.quaternion, raw.hipDelta);
    absRig.knee.quaternion.copy(raw.kneeQuat);
    absRig.hip.updateMatrixWorld(true);
    const absAfter = worldXyz(absRig.leftToe);
    const absSwing = Math.hypot(absAfter.x - absBefore.x, absAfter.z - absBefore.z);

    // Differential path, one call: strictly less travel for the same target.
    const { actorSlot, leftToe, rightToe } = makeTwistedCrouch();
    actorSlot.updateMatrixWorld(true);
    const before = worldXyz(leftToe);
    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });
    expect(result.corrected).toBe(true);
    const after = worldXyz(leftToe);
    const swing = Math.hypot(after.x - before.x, after.z - before.z);
    expect(swing).toBeLessThan(absSwing);

    // Repeated calls (one per frame, as the arrived lock does) converge the
    // depth to the floor without moving the slot.
    for (let frame = 0; frame < 60; frame += 1) {
      applySettledPostureCorrection({ actorSlot, leftToe, rightToe, floorOriginY, contactBandMeters });
      if (toeDepthY(leftToe, floorOriginY) <= 0.005 + 1e-6) break;
    }
    expect(toeDepthY(leftToe, floorOriginY)).toBeLessThanOrEqual(0.005 + 1e-6);
    expect(actorSlot.position.y).toBeCloseTo(0, 6);
  });

  it("on a straight leg the differential equals the absolute solve", () => {
    const actorSlot = new THREE.Group();
    const hip = new THREE.Object3D();
    hip.name = "upperleg01L";
    hip.position.set(0, 0.9, 0);
    actorSlot.add(hip);
    const knee = new THREE.Object3D();
    knee.name = "lowerleg01L";
    knee.position.set(0, -0.45, 0);
    hip.add(knee);
    const heel = new THREE.Object3D();
    heel.name = "footL";
    heel.position.set(0, -0.33, 0);
    knee.add(heel);
    actorSlot.updateMatrixWorld(true);
    const heelW = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
    const target = { x: heelW.x, y: heelW.y + 0.02, z: heelW.z };
    const diff = solveSettledDifferential(hip, knee, heel, target, 0.45 + 0.33, 0.005, actorSlot)!;
    const raw = solveTwoBoneIK(hip, knee, heel, target, 0.45 + 0.33, 0.005, actorSlot)!;
    // Same hip rotation (angle 0 between them)...
    expect(diff.hipDelta.angleTo(raw.hipDelta)).toBeLessThan(1e-9);
    // ...and the composed knee equals the absolute knee (identity base).
    const composed = knee.quaternion.clone().multiply(diff.kneeDelta);
    expect(composed.angleTo(raw.kneeQuat)).toBeLessThan(1e-9);
  });
});
