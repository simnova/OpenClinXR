import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { beginSteppingTurn, STEPPING_TURN_REST_FORE_OFFSET_M } from "./stepping-turn.js";

const DEG = Math.PI / 180;

function rig() {
  const actorSlot = new THREE.Group();
  actorSlot.position.set(0, 0.9, 0);
  actorSlot.rotation.y = 0;
  const leftToe = new THREE.Object3D();
  leftToe.position.set(-0.1, 0.016, 0);
  actorSlot.add(leftToe);
  const rightToe = new THREE.Object3D();
  rightToe.position.set(0.1, 0.016, 0);
  actorSlot.add(rightToe);
  actorSlot.updateMatrixWorld(true);
  return { actorSlot, leftToe, rightToe };
}

function beginWithFlag(search: string | null) {
  if (search === null) {
    delete (globalThis as unknown as { window?: unknown }).window;
  } else {
    (globalThis as unknown as { window?: unknown }).window = { location: { search } };
  }
  const { actorSlot, leftToe, rightToe } = rig();
  const state = beginSteppingTurn({
    actorSlot,
    leftToe,
    rightToe,
    targetHeadingRadians: 30 * DEG,
    floorOriginY: 0,
    baselineYOverride: 0.016,
    restSepXzM: 0.22,
  });
  if (!state) throw new Error("expected a plan");
  return state.plan;
}

describe("stepping-turn execution rest gate", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("keeps the mirror plan without ?footstepPlan=1", () => {
    const plan = beginWithFlag("");
    const only = plan.steps[0];
    if (!only) throw new Error("expected 1 step");
    const cos = Math.cos(only.yawRadians);
    const sin = Math.sin(only.yawRadians);
    const slotEnd = {
      x: only.stanceXz.x + (0 - only.stanceXz.x) * cos + (0 - only.stanceXz.z) * sin,
      z: only.stanceXz.z - (0 - only.stanceXz.x) * sin + (0 - only.stanceXz.z) * cos,
    };
    expect(only.swingToXz.x).toBeCloseTo(2 * slotEnd.x - only.stanceXz.x, 9);
    expect(only.swingToXz.z).toBeCloseTo(2 * slotEnd.z - only.stanceXz.z, 9);
  });

  it("lands each foot at its rest offset with ?footstepPlan=1", () => {
    const plan = beginWithFlag("?footstepPlan=1");
    const only = plan.steps[0];
    if (!only) throw new Error("expected 1 step");
    // Positive residual: the single step swings right.
    expect(only.swingFoot).toBe("right");
    const endYaw = 30 * DEG;
    const cos = Math.cos(endYaw);
    const sin = Math.sin(endYaw);
    const c = Math.cos(only.yawRadians);
    const s = Math.sin(only.yawRadians);
    const slot = {
      x: only.stanceXz.x + (0 - only.stanceXz.x) * c + (0 - only.stanceXz.z) * s,
      z: only.stanceXz.z - (0 - only.stanceXz.x) * s + (0 - only.stanceXz.z) * c,
    };
    const body = (p: { x: number; z: number }) => ({
      lat: (p.x - slot.x) * cos - (p.z - slot.z) * sin,
      fore: (p.x - slot.x) * sin + (p.z - slot.z) * cos,
    });
    const swingB = body(only.swingToXz);
    expect(swingB.lat).toBeCloseTo(-0.22 / 2, 9);
    expect(swingB.fore).toBeCloseTo(STEPPING_TURN_REST_FORE_OFFSET_M, 9);
  });
});
