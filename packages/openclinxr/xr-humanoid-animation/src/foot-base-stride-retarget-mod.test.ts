import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { FOOT_BASE_CYCLE_S } from "./foot-base-path-data-mod.js";
import {
  applyFootBaseStep,
  clearFootBaseState,
  footBaseHalfIndex,
  footBaseRowAt,
  readFootBaseState,
} from "./foot-base-stride-retarget-mod.js";
import type { LocomotionStanceLabels } from "./locomotion-stance-labels.js";

function setSearch(search: string | null): void {
  const host = globalThis as unknown as { window?: unknown };
  if (search === null) delete host.window;
  else host.window = { location: { search } };
}

afterEach(() => {
  setSearch(null);
});

function buildLeggedRig(): {
  slot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
} {
  const slot = new THREE.Group();
  const mkSide = (side: "L" | "R"): THREE.Object3D => {
    const x = side === "L" ? 0.09 : -0.09;
    const hip = new THREE.Object3D();
    hip.name = `upperleg01.${side}`;
    hip.position.set(x, 0.78, 0);
    slot.add(hip);
    const upperMid = new THREE.Object3D();
    upperMid.name = `upperleg02.${side}`;
    upperMid.position.set(0, -0.21, 0);
    hip.add(upperMid);
    const knee = new THREE.Object3D();
    knee.name = `lowerleg01.${side}`;
    knee.position.set(0, -0.21, 0);
    upperMid.add(knee);
    const lowerMid = new THREE.Object3D();
    lowerMid.name = `lowerleg02.${side}`;
    lowerMid.position.set(0, -0.21, 0);
    knee.add(lowerMid);
    const heel = new THREE.Object3D();
    heel.name = `foot.${side}`;
    heel.position.set(0, -0.21, 0.02);
    lowerMid.add(heel);
    const toe = new THREE.Object3D();
    toe.name = `toe1-1.${side}`;
    toe.position.set(0, -0.03, 0.12);
    heel.add(toe);
    return toe;
  };
  const leftToe = mkSide("L");
  const rightToe = mkSide("R");
  slot.updateMatrixWorld(true);
  return { slot, leftToe, rightToe };
}

/** Clip labels: left single support, double support, then right single support. */
function stanceLabels(): LocomotionStanceLabels {
  const count = 41;
  const atMs: number[] = [];
  const left: boolean[] = [];
  const right: boolean[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * FOOT_BASE_CYCLE_S;
    atMs.push(t * 1000);
    left.push(t < 0.55);
    right.push(t >= 0.45);
  }
  return {
    clipName: "fixture",
    cycleSeconds: FOOT_BASE_CYCLE_S,
    forward: { x: 0, z: 1 },
    stanceSpeedMetersPerSecond: 1,
    speedToleranceMetersPerSecond: 0.1,
    heightCutMeters: 0.06,
    atMs,
    left,
    right,
  };
}

describe("foot-base stride retarget", () => {
  it("a stance toe stays within 0.001 m of its foothold over its stance window", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    const { slot, leftToe, rightToe } = buildLeggedRig();
    const approach = {
      actorSlot: slot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      footstep: { scale: 0.707, steps: 3, bones: [], lastToeSeparationM: null },
      execution: { phase: "walking", walkSimSubsteps: 0 },
      lockArmed: true,
      start: { x: 0, y: 0, z: 0 },
    };
    const labels = stanceLabels();
    let sawRight = false;
    for (let frame = 0; frame < 140; frame += 1) {
      (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = frame;
      const summary = applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 1.31,
        routeLength: 1.31,
        clip: { labels, actionTimeSeconds: frame * 0.005 },
      });
      expect(summary).not.toBeNull();
      const state = readFootBaseState(approach);
      expect(state).not.toBeNull();
      // The dwell hands over once right persists: pin holds whichever foot is stance.
      if (state!.stance === "right") sawRight = true;
      if (frame < 100) expect(state!.stance).toBe("left");
      slot.updateMatrixWorld(true);
      const toe = state!.stance === "left" ? leftToe : rightToe;
      const e = toe.matrixWorld.elements;
      const fh = state!.foothold[state!.stance];
      expect(Math.hypot((e[12] ?? 0) - fh.x, (e[14] ?? 0) - fh.z)).toBeLessThan(0.001);
    }
    // Right single support starts at action 0.55 (frame ~110); handover is immediate.
    expect(readFootBaseState(approach)?.stance).toBe("right");
    expect(sawRight).toBe(true);
    const worst = readFootBaseState(approach)?.worst ?? null;
    expect(worst).not.toBeNull();
    expect(Number.isFinite(worst?.missM ?? Number.NaN)).toBe(true);
    clearFootBaseState(approach);
  });

  it("no-ops with the flag off and off the 1.31 m route", () => {
    const { slot, leftToe, rightToe } = buildLeggedRig();
    const approach = {
      actorSlot: slot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      footstep: { scale: 0.707, steps: 3, bones: [], lastToeSeparationM: null },
      execution: { phase: "walking", walkSimSubsteps: 0 },
    };
    const labels = stanceLabels();
    setSearch("?footstepPlan=1&fixedClock=1");
    expect(
      applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 1.31,
        routeLength: 1.31,
        clip: { labels, actionTimeSeconds: 0.1 },
      }),
    ).toBeNull();
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    expect(
      applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 2,
        routeLength: 2,
        clip: { labels, actionTimeSeconds: 0.1 },
      }),
    ).toBeNull();
    expect(readFootBaseState(approach)).toBeNull();
  });

  it("row lookup spans liftoff to touchdown and halves count passings", () => {
    const lift = footBaseRowAt("left", 0.64);
    expect(Math.abs(lift.along01)).toBeLessThan(0.05);
    expect(footBaseHalfIndex(0.55, FOOT_BASE_CYCLE_S)).toBe(1);
    expect(footBaseHalfIndex(1.38, FOOT_BASE_CYCLE_S)).toBe(2);
    expect(footBaseHalfIndex(0.55 + FOOT_BASE_CYCLE_S, FOOT_BASE_CYCLE_S)).toBe(3);
  });
});
