import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyClipDrivenSettlingTurn,
  createClipDrivenSettlingTurnState,
} from "./case-owned-approach-runtime.js";

/**
 * After a completed stop with no meaningful residual yaw, the walk clip's continued
 * steps are spurious: pinning them drags the slot 0.15-0.22 m and slides toes through
 * all of settling/arrived while arrival never converges (stop-takes slide
 * decomposition, all rigs). The pin/lift apparatus must stand down on the post-stop
 * path; walk-only settling is untouched.
 */

function alternatingLabels(): {
  labels: {
    clipName: string;
    cycleSeconds: number;
    forward: { x: number; z: number };
    stanceSpeedMetersPerSecond: number;
    speedToleranceMetersPerSecond: number;
    heightCutMeters: number;
    atMs: number[];
    left: boolean[];
    right: boolean[];
  };
} {
  return {
    labels: {
      clipName: "walk",
      cycleSeconds: 1.0,
      forward: { x: 0, z: 1 },
      stanceSpeedMetersPerSecond: 1,
      speedToleranceMetersPerSecond: 1,
      heightCutMeters: 1,
      atMs: [0, 500],
      left: [true, false],
      right: [false, true],
    },
  };
}

function rig(): {
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
} {
  const actorSlot = new THREE.Group();
  actorSlot.position.set(2, 0, 3);
  const leftToe = new THREE.Object3D();
  leftToe.position.set(-0.2, 0.05, 0.1);
  const rightToe = new THREE.Object3D();
  rightToe.position.set(0.2, 0.05, -0.1);
  actorSlot.add(leftToe);
  actorSlot.add(rightToe);
  actorSlot.updateMatrixWorld(true);
  return { actorSlot, leftToe, rightToe };
}

function runTurn(postStop: boolean): { slotX: number; slotZ: number; leftWeight: number; rightWeight: number } {
  const { actorSlot, leftToe, rightToe } = rig();
  const { labels } = alternatingLabels();
  let state = createClipDrivenSettlingTurnState();
  for (let frame = 0; frame < 20; frame += 1) {
    state = applyClipDrivenSettlingTurn({
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
      targetHeadingRadians: actorSlot.rotation.y,
      deltaSeconds: 1 / 60,
      clipCycleSeconds: 1.0,
      timeScaleFactor: 1,
      clipStance: { labels, actionTimeSeconds: frame * 0.5 },
      state,
      postStop,
    });
  }
  return { slotX: actorSlot.position.x, slotZ: actorSlot.position.z, leftWeight: state.pin.left.weight, rightWeight: state.pin.right.weight };
}

describe("the settling turn stands down after a stop", () => {
  it("leaves slot and pin untouched when post-stop with no residual yaw", () => {
    const after = runTurn(true);
    expect(after.slotX).toBe(2);
    expect(after.slotZ).toBe(3);
    expect(after.leftWeight).toBe(0);
    expect(after.rightWeight).toBe(0);
  });

  it("still pins on the walk-only path", () => {
    const after = runTurn(false);
    expect(after.leftWeight + after.rightWeight).toBeGreaterThan(0);
  });
});
