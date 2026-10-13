import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { solveSteppingLegHinge } from "./stepping-turn.js";

// Input and chain types derived from the public entrypoint, never imported
// from the implementation module (public-api lists names bound outside only).
type SolveInput = Parameters<typeof solveSteppingLegHinge>[0];
type Chain = SolveInput["chain"];

function buildScaledChain(): { slot: THREE.Group; chain: Chain } {
  const slot = new THREE.Group();
  slot.scale.setScalar(0.86);
  slot.position.set(0, 0.9, 0);
  slot.rotation.y = 0.4;
  // Non-uniform ancestor scale mirrors the runtime breathing scale: rotation
  // through it shears descendant world matrices, so getWorldQuaternion comes
  // back non-unit (0.99995..1.00034 measured in the SC-05 turn) and the
  // pre-fix parent-frame conversion lost norm every solve.
  const root = new THREE.Object3D();
  root.scale.set(0.862, 0.872, 0.862);
  slot.add(root);
  const hip = new THREE.Object3D();
  hip.position.set(0.09, -0.08, 0);
  root.add(hip);
  const upperMid = new THREE.Object3D();
  upperMid.position.set(0, -0.21, 0);
  hip.add(upperMid);
  const knee = new THREE.Object3D();
  knee.position.set(0, -0.21, 0);
  upperMid.add(knee);
  const lowerMid = new THREE.Object3D();
  lowerMid.position.set(0, -0.21, 0);
  knee.add(lowerMid);
  const heel = new THREE.Object3D();
  heel.position.set(0, -0.21, 0.02);
  lowerMid.add(heel);
  const toe = new THREE.Object3D();
  toe.position.set(0, -0.03, 0.12);
  heel.add(toe);
  slot.updateMatrixWorld(true);
  return { slot, chain: { hip, upperMid, knee, lowerMid, heel, toe } };
}

function normOf(q: { x: number; y: number; z: number; w: number }): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

describe("stepping-turn leg quaternion norm", () => {
  it("300 consecutive solves on a 0.86-scaled chain leave every joint within 1e-9 of unit norm", () => {
    const { chain } = buildScaledChain();
    // Seed the worst norm observed in the wild: the end-of-solve guard must
    // repair incoming drift, not just avoid adding to it.
    chain.hip.quaternion.set(0.3, 0.4, 0.1, 0.65);
    expect(normOf(chain.hip.quaternion)).toBeLessThan(0.87);
    const poleWorld = { x: Math.sin(0.4), y: 0, z: Math.cos(0.4) };
    let lastMissM = Number.NaN;
    for (let i = 0; i < 300; i += 1) {
      const a = 0.4 + i * 0.01;
      const result = solveSteppingLegHinge({
        chain,
        heelTargetWorld: { x: Math.sin(a) * 0.5, y: 0.05, z: Math.cos(a) * 0.5 },
        poleWorld,
        midRestQuats: null,
      });
      lastMissM = result.missM;
    }
    for (const joint of [chain.hip, chain.upperMid, chain.knee, chain.lowerMid] as const) {
      expect(Math.abs(normOf(joint.quaternion) - 1)).toBeLessThan(1e-9);
    }
    expect(lastMissM).toBeLessThan(0.5);
  });
});
