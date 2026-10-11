import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { recaptureStopRestStance } from "./case-owned-approach-runtime.js";

/**
 * After a distance-indexed stop, the arrived close must converge toward the take's own
 * hold pose, not the walk-start rest snapshot: forcing stop-planted feet into walk rest
 * drags the slot ~0.2 m and slides toes ~0.1-0.3 m through the whole arrived phase
 * (stop-takes slide decomposition, all rigs).
 */

function splitHoldStance(): {
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
  restStance: { toeLeft: { x: number; y: number; z: number }; toeRight: { x: number; y: number; z: number }; sepXz: number } | null;
} {
  const actorSlot = new THREE.Group();
  const leftToe = new THREE.Object3D();
  leftToe.position.set(-0.2, 0.05, 0.3);
  const rightToe = new THREE.Object3D();
  rightToe.position.set(0.25, 0.05, -0.2);
  actorSlot.add(leftToe);
  actorSlot.add(rightToe);
  actorSlot.updateMatrixWorld(true);
  return {
    actorSlot,
    leftToe,
    rightToe,
    // Walk-start rest: feet together. The hold above is split 0.67 m.
    restStance: {
      toeLeft: { x: -0.1, y: 0.05, z: 0 },
      toeRight: { x: 0.1, y: 0.05, z: 0 },
      sepXz: 0.2,
    },
  };
}

describe("the stop recaptures rest at settling", () => {
  it("replaces the walk-start rest with the take hold pose", () => {
    const approach = splitHoldStance();
    expect(recaptureStopRestStance(approach as never)).toBe(true);
    const rest = approach.restStance;
    if (!rest) throw new Error("no rest captured");
    expect(rest.toeLeft.x).toBeCloseTo(-0.2, 6);
    expect(rest.toeLeft.z).toBeCloseTo(0.3, 6);
    expect(rest.toeRight.x).toBeCloseTo(0.25, 6);
    expect(rest.toeRight.z).toBeCloseTo(-0.2, 6);
    expect(rest.sepXz).toBeCloseTo(Math.hypot(0.45, 0.5), 6);
  });

  it("leaves an approach with no toes untouched", () => {
    const approach = { ...splitHoldStance(), leftToe: null };
    expect(recaptureStopRestStance(approach as never)).toBe(false);
    expect(approach.restStance?.sepXz).toBeCloseTo(0.2, 6);
  });
});
