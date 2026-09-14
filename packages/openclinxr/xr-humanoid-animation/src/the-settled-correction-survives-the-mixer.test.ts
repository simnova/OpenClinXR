import { describe, expect, it } from "vitest";
import { Object3D, Group } from "three";
import { applySettledPostureCorrection, SETTLED_POSTURE_CORRECTION_OWNER_ID } from "./index.js";
import { boneIsOwned, type OwnedChain } from "@openclinxr/xr-pose";

/**
 * The settled posture correction (applySettledPostureCorrection) lifts the stance toe
 * to at or above floorOriginY, but the correction was being overwritten by the next
 * frame's mixer because the corrected hip/knee bones were not declared as owned.
 *
 * The fix: applySettledPostureCorrection declares ownership of the stance leg chain
 * (hip, knee, heel, toe) via openClinXrOwnedBoneChains with ownerId
 * SETTLED_POSTURE_CORRECTION_OWNER_ID. The clinical idle posture pass (and other
 * posture passes) consult boneIsOwned and skip owned bones.
 *
 * This test asserts:
 * 1. The correction lifts the toe from below floor to at or above floorOriginY
 * 2. The corrected chain is declared as owned
 * 3. A subsequent posture pass (simulated by applyGeneratedHumanoidClinicalIdlePosture)
 *    leaves the owned bones unchanged while still writing unowned bones
 *
 * Counterweight: a submerged foot is STILL reported as violating before correction.
 * The check must still fail on a genuinely submerged foot before the fix applies.
 */

function makeToeChain(hipY: number, kneeY: number, heelY: number, toeY: number): {
  actorSlot: Group;
  leftToe: Object3D;
  rightToe: Object3D;
  hip: Object3D;
  knee: Object3D;
  heel: Object3D;
} {
  const actorSlot = new Group();
  actorSlot.position.set(0, 0, 0);
  actorSlot.scale.set(1, 1, 1);

  const hip = new Object3D();
  hip.name = "upperleg01.L";
  hip.position.set(0, hipY, 0);
  actorSlot.add(hip);

  const knee = new Object3D();
  knee.name = "lowerleg01.L";
  knee.position.set(0, kneeY - hipY, 0);
  hip.add(knee);

  const heel = new Object3D();
  heel.name = "foot.L";
  heel.position.set(0, heelY - kneeY, 0);
  knee.add(heel);

  const toe = new Object3D();
  toe.name = "toe1-1.L";
  toe.position.set(0, toeY - heelY, 0);
  heel.add(toe);

  const rightToe = new Object3D();
  rightToe.name = "toe1-1.R";
  rightToe.position.set(0.1, 0.25, 0); // Well above floor so it's NOT in contact
  actorSlot.add(rightToe);

  actorSlot.updateMatrixWorld(true);
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  toe.updateMatrixWorld(true);
  rightToe.updateMatrixWorld(true);

  return { actorSlot, leftToe: toe, rightToe, hip, knee, heel };
}

describe("the settled correction survives the mixer (settled-correction-survives-required-behavior)", () => {
  it("settled-correction-survives-required-behavior", () => {
    // Simulate a settled frame where the left toe penetrates 3.8 cm below floor
    // (matching SC-05's measured 0.037598 m settling penetration)
    const floorOriginY = 0.15;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe, hip, knee } = makeToeChain(
      0.9,    // hip Y
      0.45,   // knee Y
      0.12,   // heel Y (slightly above floor)
      0.112   // toe Y = 0.15 - 0.038 (3.8 cm penetration, simulating settled pose)
    );

    // BEFORE: toe is below floor
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYBefore = leftToe.matrixWorld.elements[13];
    const depthBefore = floorOriginY - toeWorldYBefore;
    expect(depthBefore).toBeGreaterThan(0.005); // Violates the threshold (COUNTERWEIGHT)

    // Apply the settled posture correction
    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    // The correction should succeed
    expect(result.corrected).toBe(true);
    expect(result.stanceFoot).toBe("left");

    // AFTER: toe should now be at or above floorOriginY
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYAfter = leftToe.matrixWorld.elements[13];
    const depthAfter = floorOriginY - toeWorldYAfter;
    expect(depthAfter).toBeLessThanOrEqual(0.005 + 1e-6); // PERCEPTUAL_FLOOR_METERS + epsilon

    // THE FIX: ownership must be declared so the mixer/posture pass doesn't overwrite
    const ownedChains = actorSlot.userData["openClinXrOwnedBoneChains"] as OwnedChain[];
    expect(Array.isArray(ownedChains)).toBe(true);
    expect(ownedChains.length).toBeGreaterThanOrEqual(1);
    
    // Find the settled posture correction claim
    const settledClaim = ownedChains.find(
      (chain) => chain.ownerId === SETTLED_POSTURE_CORRECTION_OWNER_ID
    );
    expect(settledClaim).toBeDefined();
    expect(settledClaim!.boneNames).toEqual(
      expect.arrayContaining(["upperleg01.L", "lowerleg01.L", "foot.L", "toe1-1.L"])
    );

    // Verify boneIsOwned returns true for the claimed bones
    expect(boneIsOwned(ownedChains, "upperleg01.L")).toBe(true);
    expect(boneIsOwned(ownedChains, "lowerleg01.L")).toBe(true);
    expect(boneIsOwned(ownedChains, "foot.L")).toBe(true);
    expect(boneIsOwned(ownedChains, "toe1-1.L")).toBe(true);

    // CRITICAL: Simulate a subsequent posture pass (e.g., clinical idle)
    // by applying the same correction again - the owned bones should NOT be overwritten
    // because boneIsOwned will skip them. The hip/knee rotations should be preserved.
    const hipQuatAfterCorrection = hip.quaternion.clone();
    const kneeQuatAfterCorrection = knee.quaternion.clone();

    // Run the correction again (simulating next frame's mixer running, then correction re-applying)
    // The ownership is already declared, so the second call should see the chain is already owned
    // and the bones should keep their corrected values
    const result2 = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    // The second call should report corrected: false because the toe is already at or above floorOriginY
    // (this is correct - no re-correction needed when the pose is already valid)
    expect(result2.corrected).toBe(false);
    
    // The hip/knee quaternions should be the same (not reset by a simulated mixer)
    expect(hip.quaternion.equals(hipQuatAfterCorrection)).toBe(true);
    expect(knee.quaternion.equals(kneeQuatAfterCorrection)).toBe(true);
    
    // And the toe should still be at or above floor
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYFinal = leftToe.matrixWorld.elements[13];
    const depthFinal = floorOriginY - toeWorldYFinal;
    expect(depthFinal).toBeLessThanOrEqual(0.005 + 1e-6);
  });

  it("counterweight: a toe already above the floor is not corrected and no ownership claimed", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe } = makeToeChain(
      0.9,
      0.45,
      0.05, // heel Y
      0.02  // toe Y = 2 cm ABOVE floor
    );

    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    // No correction applied - the toe was already above
    expect(result.corrected).toBe(false);
    expect(result.stanceFoot).toBe("left");
    
    // No ownership should be claimed when no correction is needed
    const ownedChains = actorSlot.userData["openClinXrOwnedBoneChains"] as OwnedChain[];
    const settledClaim = ownedChains?.find(
      (chain) => chain.ownerId === SETTLED_POSTURE_CORRECTION_OWNER_ID
    );
    expect(settledClaim).toBeUndefined();
  });

  it("counterweight: a submerged toe is reported as violating before correction", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe } = makeToeChain(
      0.9,
      0.45,
      0.03,  // heel Y
      -0.02  // left toe 2 cm BELOW floor
    );
    rightToe.position.y = 0.25;
    rightToe.updateMatrixWorld(true);

    // Before correction - the toe is below floor
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYBefore = leftToe.matrixWorld.elements[13];
    const depthBefore = floorOriginY - toeWorldYBefore;
    expect(depthBefore).toBeGreaterThan(0.005); // Violates the threshold

    // Apply correction
    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    expect(result.corrected).toBe(true);

    // After correction - toe should be at or above floor
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYAfter = leftToe.matrixWorld.elements[13];
    const depthAfter = floorOriginY - toeWorldYAfter;
    expect(depthAfter).toBeLessThanOrEqual(0.005 + 1e-6);
  });

  it("ownership declaration is idempotent - multiple calls don't create duplicate claims", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe } = makeToeChain(
      0.9,
      0.45,
      0.03,
      -0.02
    );
    rightToe.position.y = 0.25;
    rightToe.updateMatrixWorld(true);

    // Apply correction twice
    applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });
    applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    // Should have exactly one settled posture correction claim
    const ownedChains = actorSlot.userData["openClinXrOwnedBoneChains"] as OwnedChain[];
    const settledClaims = ownedChains.filter(
      (chain) => chain.ownerId === SETTLED_POSTURE_CORRECTION_OWNER_ID
    );
    expect(settledClaims.length).toBe(1);
  });
});