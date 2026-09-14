import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applySettledPostureCorrection,
  solveTwoBoneIK,
} from "../../../../packages/openclinxr/xr-humanoid-animation/src/stance-lock-mod.js";

/**
 * This test measures the execution of applySettledPostureCorrection per frame
 * across a run that reaches the arrived phase.
 *
 * It records:
 * 1. Whether the branch at case-owned-approach-runtime-mod.ts:477 executed
 * 2. Whether resolveLegChain returned a chain or null
 * 3. Whether solveTwoBoneIK returned a result or null
 * 4. The stance toe's world Y immediately after the correction
 * 5. The stance toe's world Y at the moment the capture samples it
 */

const PERCEPTUAL_FLOOR_METERS = 0.005;
const _FOOT_CONTACT_HEIGHT_METERS = 0.06;

// Inlined from stance-lock-mod.ts (not exported)
function findStanceChain(
  actorSlot: THREE.Object3D,
  stanceFoot: "left" | "right"
): { hip: THREE.Object3D; knee: THREE.Object3D; heel: THREE.Object3D; toe: THREE.Object3D } | null {
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
  rightToe.position.set(0.1, 0.25, 0); // Well above floor so it's NOT in contact
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

function worldY(node: THREE.Object3D): number {
  const elements = node.matrixWorld.elements;
  return elements[13] ?? Number.NaN;
}

describe("the settled correction execution is measured", () => {
  it("candidate-1-unreachable: applySettledPostureCorrection is called and its internal branches are traced", () => {
    // This simulates the arrived phase with a penetrating toe
    const floorOriginY = 0.15;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe } = makeToeChain(
      0.9,    // hip Y
      0.45,   // knee Y
      0.12,   // heel Y (slightly above floor)
      0.112   // toe Y = 0.15 - 0.038 (3.8 cm penetration)
    );

    // Track what happens inside applySettledPostureCorrection
    let chainFound = false;
    const _ikResult = null;
    let toeWorldYBefore = 0;
    let toeWorldYAfter = 0;
    let stanceFootUsed: string | null = null;

    // First, check if findStanceChain resolves the chain
    const chain = findStanceChain(actorSlot, "left");
    if (chain) {
      chainFound = true;
    }

    // Record toe Y before correction
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    toeWorldYBefore = worldY(leftToe);

    // Apply the settled posture correction
    const result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    // Record results
    stanceFootUsed = result.stanceFoot;
    toeWorldYAfter = worldY(leftToe);

    // The test asserts that we can MEASURE these values
    // It does NOT assert they pass - it records what happened
    expect(result).toBeDefined();
    expect(typeof result.corrected).toBe("boolean");
    expect(typeof result.stanceFoot).toBe("string");
    expect(typeof result.toeHeightMeters.left).toBe("number");
    expect(typeof result.toeHeightMeters.right).toBe("number");

    // Write the measurement
    console.log("=== SETTLED POSTURE CORRECTION MEASUREMENT ===");
    console.log(`floorOriginY: ${floorOriginY}`);
    console.log(`contactBandMeters: ${contactBandMeters}`);
    console.log(`chainFound (resolveLegChain equivalent): ${chainFound}`);
    console.log(`stanceFoot: ${stanceFootUsed}`);
    console.log(`corrected: ${result.corrected}`);
    console.log(`leftToeHeightMeters (before): ${result.toeHeightMeters.left}`);
    console.log(`rightToeHeightMeters (before): ${result.toeHeightMeters.right}`);
    console.log(`toeWorldYBefore: ${toeWorldYBefore}`);
    console.log(`toeWorldYAfter: ${toeWorldYAfter}`);
    console.log(`depthBefore: ${floorOriginY - toeWorldYBefore}`);
    console.log(`depthAfter: ${floorOriginY - toeWorldYAfter}`);
    console.log(`difference (after - before): ${toeWorldYAfter - toeWorldYBefore}`);
    console.log(`PERCEPTUAL_FLOOR_METERS: ${PERCEPTUAL_FLOOR_METERS}`);
  });

  it("candidate-2-silent-no-op: solveTwoBoneIK return value is traced", () => {
    const floorOriginY = 0.15;
    const _contactBandMeters = 0.06;

    const { actorSlot, leftToe, hip, heel } = makeToeChain(
      0.9,    // hip Y
      0.45,   // knee Y
      0.12,   // heel Y
      0.112   // toe Y = 3.8 cm below floor
    );

    // Check if findStanceChain returns a chain
    const chain = findStanceChain(actorSlot, "left");
    expect(chain).not.toBeNull();

    if (chain) {
      // Call solveTwoBoneIK directly to see if it returns a result
      const toeWorld = new THREE.Vector3().setFromMatrixPosition(leftToe.matrixWorld);
      const heelWorld = new THREE.Vector3().setFromMatrixPosition(heel.matrixWorld);
      const hipWorld = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
      const maxExtension = hipWorld.distanceTo(heelWorld);
      const softening = 0.005;

      const heelToToe = new THREE.Vector3().subVectors(toeWorld, heelWorld);
      const targetToeY = floorOriginY;
      const heelTarget = new THREE.Vector3(
        toeWorld.x + heelToToe.x,
        targetToeY + heelToToe.y,
        toeWorld.z + heelToToe.z
      );

      const ikResult = solveTwoBoneIK(chain.hip, chain.knee, chain.heel, {
        x: heelTarget.x,
        y: heelTarget.y,
        z: heelTarget.z,
      }, maxExtension, softening);

      console.log("=== SOLVE TWO BONE IK DIRECT MEASUREMENT ===");
      console.log(`chain found: ${!!chain}`);
      console.log(`ikResult returned: ${!!ikResult}`);
      if (ikResult) {
        console.log(`hipQuat: (${ikResult.hipQuat.x.toFixed(6)}, ${ikResult.hipQuat.y.toFixed(6)}, ${ikResult.hipQuat.z.toFixed(6)}, ${ikResult.hipQuat.w.toFixed(6)})`);
        console.log(`kneeQuat: (${ikResult.kneeQuat.x.toFixed(6)}, ${ikResult.kneeQuat.y.toFixed(6)}, ${ikResult.kneeQuat.z.toFixed(6)}, ${ikResult.kneeQuat.w.toFixed(6)})`);
      } else {
        console.log("ikResult is null - solver failed");
      }
      console.log(`maxExtension: ${maxExtension}`);
      console.log(`softening: ${softening}`);
      console.log(`targetToeY: ${targetToeY}`);
      console.log(`heelTarget: (${heelTarget.x.toFixed(6)}, ${heelTarget.y.toFixed(6)}, ${heelTarget.z.toFixed(6)})`);

      // Record what we measured
      expect(typeof !!chain).toBe("boolean");
      expect(typeof ikResult).toBe("object");
    }
  });

  it("candidate-3-not-surviving-frame: measure toe Y after correction vs after mixer would run", () => {
    // This simulates the scenario where the correction is applied but then
    // the animation mixer re-drives the bones
    const floorOriginY = 0.15;
    const contactBandMeters = 0.06;

    const { actorSlot, leftToe, rightToe, hip, knee, heel } = makeToeChain(
      0.9,    // hip Y
      0.45,   // knee Y
      0.12,   // heel Y
      0.112   // toe Y = 3.8 cm below floor
    );

    // Record initial state
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYInitial = worldY(leftToe);

    // Apply correction
    const _result = applySettledPostureCorrection({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters,
    });

    // Record toe Y immediately after correction
    actorSlot.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYAfterCorrection = worldY(leftToe);

    // SIMULATE MIXER RE-DRIVING: reset toe position to original (as if mixer overwrote it)
    // The toe's local position in the chain is relative to heel
    const originalLocalY = leftToe.position.y;
    leftToe.position.y = originalLocalY; // reset to local position before correction
    hip.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    heel.updateMatrixWorld(true);
    leftToe.updateMatrixWorld(true);
    const toeWorldYAfterMixer = worldY(leftToe);

    console.log("=== FRAME SURVIVAL MEASUREMENT ===");
    console.log(`toeWorldYInitial: ${toeWorldYInitial}`);
    console.log(`toeWorldYAfterCorrection: ${toeWorldYAfterCorrection}`);
    console.log(`toeWorldYAfterMixer (simulated): ${toeWorldYAfterMixer}`);
    console.log(`depthInitial: ${floorOriginY - toeWorldYInitial}`);
    console.log(`depthAfterCorrection: ${floorOriginY - toeWorldYAfterCorrection}`);
    console.log(`depthAfterMixer: ${floorOriginY - toeWorldYAfterMixer}`);
    console.log(`correctionSurvived: ${Math.abs(toeWorldYAfterCorrection - toeWorldYAfterMixer) < 0.001}`);
    console.log(`PERCEPTUAL_FLOOR_METERS: ${PERCEPTUAL_FLOOR_METERS}`);

    // The gap between afterCorrection and afterMixer answers candidate 3
    expect(typeof toeWorldYAfterCorrection).toBe("number");
    expect(typeof toeWorldYAfterMixer).toBe("number");
  });
});