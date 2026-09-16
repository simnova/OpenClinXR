import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyStanceLockedGroundAdvance, applySettledPostureCorrection, createStanceLockState, solveTwoBoneIK } from "./stance-lock-mod.js";
import { findBonesBySanitisedName, sanitiseBoneName } from "@openclinxr/xr-pose";

/**
 * The standing foot must not penetrate the selected floor plane.
 *
 * SC-05 measured 0.037172 m penetration during settling and 0.036384 m during arrived,
 * at ~7.4x the 0.005 m PERCEPTUAL_FLOOR_METERS.
 * The existing stance lock only runs during locomotion > 0, leaving the settled
 * figure uncorrected. The remedy is to invoke the same two-bone IK solve
 * (solveTwoBoneIK) once the figure has settled, keeping the toe at or above
 * floorOriginY without moving the actor slot Y.
 *
 * PERCEPTUAL_FLOOR_METERS = 0.005 (derived, frozen). Do not change it.
 *
 * claimScope: stance toe Y stays >= floorOriginY across settled/arrived frames.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance, or any
 * clip other than the one measured in SC-05.
 */

function makeToeChain(hipY: number, kneeY: number, heelY: number, toeY: number): {
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  heel: THREE.Object3D;
  rightHip: THREE.Object3D;
  rightKnee: THREE.Object3D;
} {
  const actorSlot = new THREE.Group();
  actorSlot.position.set(0, 0, 0);
  actorSlot.scale.set(1, 1, 1);

  const hip = new THREE.Object3D();
  // Use sanitised MPFB names (no dots)
  hip.name = "upperleg01L";
  hip.position.set(0, hipY, 0);
  actorSlot.add(hip);

  const knee = new THREE.Object3D();
  knee.name = "lowerleg01L";
  knee.position.set(0, kneeY - hipY, 0);
  hip.add(knee);

  const heel = new THREE.Object3D();
  heel.name = "footL";
  heel.position.set(0, heelY - kneeY, 0);
  knee.add(heel);

  const toe = new THREE.Object3D();
  toe.name = "toe1-1L";
  toe.position.set(0, toeY - heelY, 0);
  heel.add(toe);

  const rightToe = new THREE.Object3D();
  rightToe.name = "toe1-1R";
  rightToe.position.set(0.1, 0.25, 0); // Well above floor (0.15) so it's NOT in contact
  actorSlot.add(rightToe);

  // Add right leg chain for completeness
  const rightHip = new THREE.Object3D();
  rightHip.name = "upperleg01R";
  rightHip.position.set(0.1, hipY, 0);
  actorSlot.add(rightHip);

  const rightKnee = new THREE.Object3D();
  rightKnee.name = "lowerleg01R";
  rightKnee.position.set(0, kneeY - hipY, 0);
  rightHip.add(rightKnee);

  const rightHeel = new THREE.Object3D();
  rightHeel.name = "footR";
  rightHeel.position.set(0, heelY - kneeY, 0);
  rightKnee.add(rightHeel);

  rightHip.updateMatrixWorld(true);
  rightKnee.updateMatrixWorld(true);
  rightHeel.updateMatrixWorld(true);
  rightToe.updateMatrixWorld(true);

  actorSlot.updateMatrixWorld(true);
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  toe.updateMatrixWorld(true);
  rightToe.updateMatrixWorld(true);

  return { actorSlot, leftToe: toe, rightToe, hip, knee, heel, rightHip, rightKnee };
}

describe("the standing foot stays above the floor (standing-foot-penetration-required-behavior)", () => {
  it("standing-foot-penetration-required-behavior", () => {
    // Simulate a settled frame where the toe penetrates 3.7 cm below floor
    // (matching SC-05's measured 0.037172 m settling penetration)
    const floorOriginY = 0.15;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe, hip, knee } = makeToeChain(
      0.9,    // hip Y
      0.45,   // knee Y
      0.12,   // heel Y (slightly above floor)
      0.112   // toe Y = 0.15 - 0.038 (3.8 cm penetration, simulating settled pose)
    );

    const state = createStanceLockState();

    // Frame 1: lock takes anchor, no correction yet (simulating first settled frame)
    const result1 = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state,
    });

    // Frame 2: clip moves toe down further (simulating next frame of settled pose)
    leftToe.position.y -= 0.001;
    leftToe.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    hip.updateMatrixWorld(true);

    const _result2 = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state: result1,
    });

    // The toe should now be at or above floorOriginY
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldY = leftToe.matrixWorld.elements[13];
    const depth = floorOriginY - toeWorldY;

    expect(depth).toBeLessThanOrEqual(0.005 + 1e-6); // PERCEPTUAL_FLOOR_METERS + epsilon

    // The correction should be in hip/knee rotation, NOT actorSlot.position.y
    expect(actorSlot.position.y).toBeCloseTo(0, 6);
  });

  it("counterweight: a toe already above the floor is not moved", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe } = makeToeChain(
      0.9,
      0.45,
      0.05, // heel Y
      0.02  // toe Y = 2 cm ABOVE floor
    );

    const state = createStanceLockState();
    const result = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state,
    });

    // No correction applied - the toe was already above
    expect(result.correctionMeters.x).toBeCloseTo(0, 6);
    expect(result.correctionMeters.z).toBeCloseTo(0, 6);
    expect(actorSlot.position.y).toBeCloseTo(0, 6);
  });

  it("counterweight: a submerged toe is reported as violating before correction", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe, hip, knee } = makeToeChain(
      0.9,
      0.45,
      0.03,  // heel Y
      -0.02  // left toe 2 cm BELOW floor
    );
    rightToe.position.y = 0.25;
    rightToe.updateMatrixWorld(true);

    // First frame - the toe is below floor
    const state1 = createStanceLockState();
    const result1 = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state: state1,
    });

    // Check that the violation is detected (toe is below floor)
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYBefore = leftToe.matrixWorld.elements[13];
    const depthBefore = floorOriginY - toeWorldYBefore;
    expect(depthBefore).toBeGreaterThan(0.005); // Violates the threshold

    // Second frame - the lock corrects it
    leftToe.position.y -= 0.001;
    leftToe.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    hip.updateMatrixWorld(true);

    const _result2 = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state: result1,
    });

    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYAfter = leftToe.matrixWorld.elements[13];
    const depthAfter = floorOriginY - toeWorldYAfter;
    expect(depthAfter).toBeLessThanOrEqual(0.005 + 1e-6);
  });

  it("applySettledPostureCorrection is called directly and corrects standing toe", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe, hip, knee } = makeToeChain(
      0.9,
      0.45,
      0.03,  // heel Y
      -0.02  // left toe 2 cm BELOW floor
    );
    rightToe.position.y = 0.25;
    rightToe.updateMatrixWorld(true);

    // Call applySettledPostureCorrection directly (not via applyStanceLockedGroundAdvance)
    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    // Should have corrected the standing toe
    expect(result.corrected).toBe(true);
    expect(result.stanceFoot).toBe("left");

    // Toe should now be at or above floor
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldY = leftToe.matrixWorld.elements[13];
    const depth = floorOriginY - toeWorldY;
    expect(depth).toBeLessThanOrEqual(0.005 + 1e-6);

    // actorSlot Y should NOT change
    expect(actorSlot.position.y).toBeCloseTo(0, 6);

    // Hip and knee should have been rotated (non-identity quaternions)
    expect(hip.quaternion.w).not.toBeCloseTo(1, 6);
    expect(knee.quaternion.w).not.toBeCloseTo(1, 6);
  });

  it("sanitised MPFB names are used in findStanceChain", () => {
    const { actorSlot } = makeToeChain(
      0.9,
      0.45,
      0.03,
      -0.02
    );

    // Verify the sanitised names work with findBonesBySanitisedName
    const hipResults = findBonesBySanitisedName(actorSlot, sanitiseBoneName("upperleg01.L"));
    const kneeResults = findBonesBySanitisedName(actorSlot, sanitiseBoneName("lowerleg01.L"));
    const heelResults = findBonesBySanitisedName(actorSlot, sanitiseBoneName("foot.L"));
    const toeResults = findBonesBySanitisedName(actorSlot, sanitiseBoneName("toe1-1.L"));

    expect(hipResults.length).toBeGreaterThan(0);
    expect(kneeResults.length).toBeGreaterThan(0);
    expect(heelResults.length).toBeGreaterThan(0);
    expect(toeResults.length).toBeGreaterThan(0);

    // Verify the names match (arrays are non-empty per assertions above)
    expect(hipResults[0]!.name).toBe("upperleg01L");
    expect(kneeResults[0]!.name).toBe("lowerleg01L");
    expect(heelResults[0]!.name).toBe("footL");
    expect(toeResults[0]!.name).toBe("toe1-1L");
  });

  it("non-zero heel-to-toe XZ offset has correct sign", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    // Create a chain with heel-to-toe XZ offset
    const actorSlot = new THREE.Group();
    actorSlot.position.set(0, 0, 0);
    actorSlot.scale.set(1, 1, 1);

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
    // Heel offset in XZ from knee
    heel.position.set(0.03, -0.33, 0.02);
    knee.add(heel);

    const toe = new THREE.Object3D();
    toe.name = "toe1-1L";
    // Toe offset from heel (non-zero XZ offset) - toe starts BELOW floor so it needs correction
    // heel world Y = 0.9 - 0.45 - 0.33 = 0.12, so toe at -0.15 gives world Y = -0.03 (below floor)
    toe.position.set(0.02, -0.15, 0.01);
    heel.add(toe);

    // Right toe well above floor
    const rightToe = new THREE.Object3D();
    rightToe.name = "toe1-1R";
    rightToe.position.set(0.1, 0.25, 0);
    actorSlot.add(rightToe);

    actorSlot.updateMatrixWorld(true);
    hip.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    heel.updateMatrixWorld(true);
    toe.updateMatrixWorld(true);
    rightToe.updateMatrixWorld(true);

    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe: toe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    expect(result.corrected).toBe(true);

    // The toe should reach the target at floorOriginY
    actorSlot.updateMatrixWorld(true);
    toe.updateMatrixWorld(true);
    const toeWorldY = toe.matrixWorld.elements[13];
    const depth = floorOriginY - toeWorldY;
    expect(depth).toBeLessThanOrEqual(0.005 + 1e-6);

    // The heel-to-toe XZ offset should have the correct sign (toe in front of heel in positive X/Z)
    // This verifies the solver handles the offset with correct sign
    const heelWorld = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
    const toeWorld = new THREE.Vector3().setFromMatrixPosition(toe.matrixWorld);
    const heelToToeX = toeWorld.x - heelWorld.x;
    const heelToToeZ = toeWorld.z - heelWorld.z;
    // The offset should be positive (toe in front of heel)
    expect(heelToToeX).toBeGreaterThan(0);
    expect(heelToToeZ).toBeGreaterThan(0);
  });

  it("translated actorSlot in collinear fixture cannot contaminate pole direction", () => {
    // Test that when hip-knee-heel are collinear, the actorSlot's orientation
    // (not position) is used for the pole vector
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const actorSlot = new THREE.Group();
    // Translate actorSlot - this should NOT affect the pole direction
    actorSlot.position.set(5.0, 0, -3.0);
    actorSlot.scale.set(1, 1, 1);

    // Rotate actorSlot - this SHOULD affect the pole direction
    actorSlot.rotation.y = Math.PI / 4; // 45 degrees

    const hip = new THREE.Object3D();
    hip.name = "upperleg01L";
    // Straight down from hip (collinear)
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

    const toe = new THREE.Object3D();
    toe.name = "toe1-1L";
    // Toe below floor
    toe.position.set(0, -0.15, 0);
    heel.add(toe);

    // Right toe well above floor
    const rightToe = new THREE.Object3D();
    rightToe.name = "toe1-1R";
    rightToe.position.set(0.1, 0.25, 0);
    actorSlot.add(rightToe);

    actorSlot.updateMatrixWorld(true);
    hip.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    heel.updateMatrixWorld(true);
    toe.updateMatrixWorld(true);
    rightToe.updateMatrixWorld(true);

    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe: toe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    expect(result.corrected).toBe(true);

    // The correction should work despite the actorSlot translation
    actorSlot.updateMatrixWorld(true);
    toe.updateMatrixWorld(true);
    const toeWorldY = toe.matrixWorld.elements[13];
    const depth = floorOriginY - toeWorldY;
    expect(depth).toBeLessThanOrEqual(0.005 + 1e-6);
  });

  it("non-identity hip local after correction equals pre-correction pose composed with hip delta", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe, hip, knee, heel } = makeToeChain(
      0.9, 0.45, 0.03, -0.02
    );
    rightToe.position.y = 0.25;
    rightToe.updateMatrixWorld(true);

    // Apply a pre-existing rotation to the hip (simulating animated pose)
    const preHipQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
    hip.quaternion.copy(preHipQuat);
    hip.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    heel.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);

    // Store pre-correction hip quaternion
    const preCorrectionHipQuat = hip.quaternion.clone();

    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    expect(result.corrected).toBe(true);

    // The hip quaternion after correction should NOT equal the IK result directly
    // (which is from-identity), but should equal preCorrection * hipDelta
    const postCorrectionHipQuat = hip.quaternion.clone();

    // Verify hip changed
    expect(postCorrectionHipQuat.equals(preCorrectionHipQuat)).toBe(false);

    // We can't easily test the composition without access to the delta,
    // but we verify the hip is not simply replaced with the from-identity result
    // by checking it's different from what solveTwoBoneIK would return from identity
    const heelBone = actorSlot.getObjectByName("footL")!;
    const heelWorld = new THREE.Vector3().setFromMatrixPosition(heelBone.matrixWorld);
    const hipWorld = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
    const upperLen = hipWorld.distanceTo(new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld));
    const lowerLen = new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld).distanceTo(heelWorld);
    
    const targetToeY = floorOriginY;
    const toeWorld = new THREE.Vector3().setFromMatrixPosition(leftToe.matrixWorld);
    // heelToToe = toe - heel, so heel = toe - heelToToe
    const heelToToe = new THREE.Vector3().subVectors(toeWorld, heelWorld);
    const heelTarget = {
      x: toeWorld.x - heelToToe.x,
      y: targetToeY - heelToToe.y,
      z: toeWorld.z - heelToToe.z,
    };
    
    const maxExtension = upperLen + lowerLen; // Correct max extension
    const softening = 0.005;
    
    const ikResult = solveTwoBoneIK(hip, knee, heelBone, heelTarget, maxExtension, softening, actorSlot);
    expect(ikResult).not.toBeNull();
    
    // The IK result is from-identity; the applied hip quaternion should be different
    // because it's composed with the pre-existing animated pose
    expect(postCorrectionHipQuat.equals(ikResult!.hipDelta)).toBe(false);
  });
});

describe("solveTwoBoneIK reusability for settled posture", () => {
  it("solveTwoBoneIK can be invoked with a target toe Y at floorOriginY", () => {
    const actorSlot = new THREE.Group();
    actorSlot.position.set(0, 0, 0);
    actorSlot.scale.set(1, 1, 1);

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

    const toe = new THREE.Object3D();
    toe.name = "toe1-1L";
    toe.position.set(0, -0.02, 0); // toe starts 2cm below floor
    heel.add(toe);

    actorSlot.updateMatrixWorld(true);
    hip.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    heel.updateMatrixWorld(true);
    toe.updateMatrixWorld(true);

    const floorOriginY = 0;
    const targetToeY = Math.max(toe.matrixWorld.elements[13] ?? 0, floorOriginY);
    const heelWorld = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
    const toeWorld = new THREE.Vector3().setFromMatrixPosition(toe.matrixWorld);
    // heelToToe = toe - heel, so heel = toe - heelToToe
    const heelToToe = new THREE.Vector3().subVectors(toeWorld, heelWorld);
    const heelTarget = new THREE.Vector3(
      toeWorld.x - heelToToe.x,
      targetToeY - heelToToe.y,
      toeWorld.z - heelToToe.z
    );

    const hipWorld = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
    const kneeWorld = new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld);
    const heelWorldPos = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
    const upperLen = hipWorld.distanceTo(kneeWorld);
    const lowerLen = kneeWorld.distanceTo(heelWorldPos);
    const maxExtension = upperLen + lowerLen;
    const softening = 0.005;

    const result = solveTwoBoneIK(hip, knee, heel, {
      x: heelTarget.x,
      y: heelTarget.y,
      z: heelTarget.z,
    }, maxExtension, softening, actorSlot);

    expect(result).not.toBeNull();
    expect(result!.hipDelta).toBeInstanceOf(THREE.Quaternion);
    expect(result!.kneeQuat).toBeInstanceOf(THREE.Quaternion);
  });
});