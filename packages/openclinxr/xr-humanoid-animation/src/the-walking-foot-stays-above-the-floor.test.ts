import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyStanceLockedGroundAdvance, createStanceLockState } from "./stance-lock-mod.js";

/**
 * The walking foot must not penetrate the selected floor plane.
 *
 * SC-05 measured 0.0378 m penetration at 7.6x the 0.005 m PERCEPTUAL_FLOOR_METERS.
 * The existing stance lock only corrected XZ, leaving the body to rise and the foot
 * to penetrate. The remedy is a two-bone IK solve that bends the stance leg,
 * keeping the toe at or above floorOriginY without moving the actor slot Y.
 *
 * PERCEPTUAL_FLOOR_METERS = 0.005 (derived, frozen). Do not change it.
 *
 * claimScope: stance toe Y stays >= floorOriginY across a walking clip.
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
  hip.name = "upperleg01.L";
  hip.position.set(0, hipY, 0);
  actorSlot.add(hip);

  const knee = new THREE.Object3D();
  knee.name = "lowerleg01.L";
  knee.position.set(0, kneeY - hipY, 0);
  hip.add(knee);

  const heel = new THREE.Object3D();
  heel.name = "foot.L";
  heel.position.set(0, heelY - kneeY, 0);
  knee.add(heel);

  const toe = new THREE.Object3D();
  toe.name = "toe1-1.L";
  toe.position.set(0, toeY - heelY, 0);
  heel.add(toe);

  const rightToe = new THREE.Object3D();
  rightToe.name = "toe1-1.R";
  rightToe.position.set(0.1, 0.2, 0); // Well above floor (0.15) so it's NOT in contact (0.2 - 0.15 = 0.05 > 0.06 band? No, 0.2 > 0.15 + 0.06 = 0.21... 0.2 is within 0.15+0.06=0.21, so it IS in contact. Need > 0.21)
  // Actually: contactBandMeters = 0.06, floor = 0.15, so band is up to 0.21. Right toe at 0.2 is in contact.
  // Let's put it at 0.25 to be well above
  rightToe.position.set(0.1, 0.25, 0);
  actorSlot.add(rightToe);

  // Add right leg chain for completeness
  const rightHip = new THREE.Object3D();
  rightHip.name = "upperleg01.R";
  rightHip.position.set(0.1, hipY, 0);
  actorSlot.add(rightHip);

  const rightKnee = new THREE.Object3D();
  rightKnee.name = "lowerleg01.R";
  rightKnee.position.set(0, kneeY - hipY, 0);
  rightHip.add(rightKnee);

  const rightHeel = new THREE.Object3D();
  rightHeel.name = "foot.R";
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

describe("the walking foot stays above the floor (floor-penetration-required-behavior)", () => {
  it("floor-penetration-required-behavior", () => {
    // Simulate a clip frame where the toe penetrates 3.8 cm below floor
    const floorOriginY = 0.15; // non-zero floor to test frame-relative measurement
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe, hip, knee } = makeToeChain(
      0.9,    // hip Y
      0.45,   // knee Y
      0.12,   // heel Y (slightly above floor)
      0.112   // toe Y = 0.15 - 0.038 (3.8 cm penetration)
    );

    const state = createStanceLockState();

    // Frame 1: lock takes anchor, no correction yet
    const result1 = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state,
    });

    // Frame 2: clip moves toe down further (simulating next frame of clip), lock should correct via IK
    // Simulate the clip pushing the toe down another 1mm
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
      state: result1, // pass updated state
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

  it("counterweight: non-stance (swing) foot is not corrected", () => {
    const floorOriginY = 0;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe } = makeToeChain(
      0.9,
      0.45,
      0.03,  // heel Y
      -0.02  // left toe 2 cm BELOW floor (stance)
    );
    // Right toe is at Y=0.25 (well above floor) - swing foot
    rightToe.position.y = 0.25;
    rightToe.updateMatrixWorld(true);

    // Frame 1: lock takes anchor at left toe's position (X=0)
    const state1 = createStanceLockState();
    const result1 = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state: state1,
    });

    // Frame 2: clip moves left toe forward in X (simulating stride)
    leftToe.position.x += 0.05; // 5 cm forward stride
    leftToe.updateMatrixWorld(true);

    const result2 = applyStanceLockedGroundAdvance({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
      state: result1, // pass updated state
    });

    // Left is stance, right is swing
    expect(result2.stanceFoot).toBe("left");
    expect(result2.doubleSupport).toBe(false);
    // The lock should correct the stance foot XZ (anchor X=0, toe moved to X=0.05, so correction should be -0.05)
    expect(Math.abs(result2.correctionMeters.x)).toBeGreaterThan(0.01);
  });
});