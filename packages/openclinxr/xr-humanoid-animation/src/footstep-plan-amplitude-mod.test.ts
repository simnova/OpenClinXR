import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";
import {
  advanceFootstepPlan,
  applyFootstepPlanStep,
  captureFootstepRest,
  footstepRouteExtensionForTest,
} from "./footstep-plan-amplitude-mod.js";
import { FOOTSTEP_START_PHASE_S } from "./footstep-plan-schedule.js";

// biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
type Loose = any;

const DT = 1 / 60;

function quat(x: number, y: number, z: number, w: number): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w).normalize();
}

/** One bone under a slot, named like the rig (dots kept). */
function bone(slot: THREE.Group, name: string, q: THREE.Quaternion): THREE.Object3D {
  const b = new THREE.Object3D();
  b.name = name;
  b.quaternion.copy(q);
  slot.add(b);
  return b;
}

function angleDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

/** Approach carrying canned action times (static lift timetable, no mixer). */
function clockedApproach(slot: THREE.Group, times: Array<number | null>): Loose {
  let call = 0;
  return {
    execution: { phase: "walking" },
    actorSlot: slot,
    stanceLabelSlot: null,
    __times: times,
    __call: () => call++,
  };
}

describe("footstep-plan amplitude blend", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("blends each leg by its own held scale (s=0 rest, s=1 clip, norms hold)", () => {
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    const slot = new THREE.Group();
    const rest = quat(0, 0, 0, 1);
    const clip = quat(0.3, 0.1, 0.05, 1);
    const legL = bone(slot, "upperleg01.L", clip);
    const legR = bone(slot, "upperleg01.R", clip);
    const restOf = () => ({ x: rest.x, y: rest.y, z: rest.z, w: rest.w });
    const approach: Loose = {
      execution: { phase: "walking" },
      actorSlot: slot,
      footstep: {
        legs: {
          left: { scales: [1], atS: [0.4], idx: 0, current: 0 },
          right: { scales: [1], atS: [0.4], idx: 0, current: 1 },
        },
        pelvisScale: 1,
        bones: [
          { bone: legL, rest: restOf(), side: "left" },
          { bone: legR, rest: restOf(), side: "right" },
        ],
        clipElapsed: 0,
        prevActionTime: 0,
        clipSpan: 9,
        steps: 6,
      },
    };
    applyFootstepPlanStep({ approach });
    expect(angleDeg(legL.quaternion, rest)).toBeLessThan(1e-6);
    expect(angleDeg(legR.quaternion, clip)).toBeLessThan(1e-6);
    expect(Math.abs(legL.quaternion.length() - 1)).toBeLessThan(1e-4);
    expect(Math.abs(legR.quaternion.length() - 1)).toBeLessThan(1e-4);
  });

  it("no-ops without the flag, without state, or off the walking phase", () => {
    const slot = new THREE.Group();
    const clip = quat(0.3, 0.1, 0.05, 1);
    const leg = bone(slot, "upperleg01.L", clip);
    const state = {
      legs: {
        left: { scales: [1], atS: [0.4], idx: 0, current: 0 },
        right: { scales: [1], atS: [0.4], idx: 0, current: 0 },
      },
      pelvisScale: 1,
      bones: [{ bone: leg, rest: { x: 0, y: 0, z: 0, w: 1 }, side: "left" }],
      clipElapsed: 0,
      prevActionTime: 0,
      clipSpan: 9,
      steps: 6,
    };
    const before = leg.quaternion.clone();
    const walking: Loose = { execution: { phase: "walking" }, actorSlot: slot, footstep: state };
    const settling: Loose = { execution: { phase: "settling" }, actorSlot: slot, footstep: state };
    const stateless: Loose = { execution: { phase: "walking" }, actorSlot: slot, footstep: null };
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "" } };
    applyFootstepPlanStep({ approach: walking });
    expect(leg.quaternion.equals(before)).toBe(true);
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    applyFootstepPlanStep({ approach: settling });
    expect(leg.quaternion.equals(before)).toBe(true);
    applyFootstepPlanStep({ approach: stateless });
    expect(leg.quaternion.equals(before)).toBe(true);
  });

  it("capture resolves the per-leg timetable and pelvis scale, clears without the flag", () => {
    const slot = new THREE.Group();
    bone(slot, "upperleg01.L", quat(0, 0, 0, 1));
    bone(slot, "pelvis", quat(0, 0, 0, 1));
    const leftToe = new THREE.Object3D();
    leftToe.name = "toe1-1L";
    leftToe.position.set(0.09, 0.01, 0);
    slot.add(leftToe);
    const approach: Loose = {
      actorSlot: slot,
      leftToe,
      rightToe: null,
      target: { x: 0, z: 1.31 },
      start: { x: 0, z: 0 },
      restStance: {
        quats: { "upperleg01.L": { x: 0, y: 0, z: 0, w: 1 } },
        toeLeft: { x: 0.09, y: 0.005, z: 0 },
        toeRight: { x: -0.09, y: 0.005, z: 0 },
      },
      footstep: null,
    };
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "" } };
    captureFootstepRest(approach);
    expect(approach.footstep).toBeNull();
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    captureFootstepRest(approach);
    expect(approach.footstep.legs.left.scales[0]).toBe(1);
    expect(approach.footstep.legs.left.atS[0]).toBeCloseTo(0.419, 3);
    expect(approach.footstep.legs.right.scales[0]).toBe(1);
    expect(approach.footstep.pelvisScale).toBe(1);
    expect(approach.footstep.steps).toBe(6);
    expect(approach.footstep.bones.length).toBe(3);
    expect(approach.footstep.bones.map((b: Loose) => b.side).sort()).toEqual(["left", "left", "pelvis"]);
    const toeEntry = approach.footstep.bones.find((b: Loose) => b.restLocal !== null && b.restLocal !== undefined);
    expect(toeEntry.restLocal).toEqual({ x: 0.09, y: 0.005, z: 0 });
  });

  it("lerps toe locals home by the same scale (positions land standing at 0)", () => {
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    const slot = new THREE.Group();
    const toe = new THREE.Object3D();
    toe.name = "toe1-1L";
    toe.position.set(0.2, 0.1, 0.3);
    slot.add(toe);
    const approach: Loose = {
      execution: { phase: "walking" },
      actorSlot: slot,
      footstep: {
        legs: {
          left: { scales: [1], atS: [0.4], idx: 0, current: 0 },
          right: { scales: [1], atS: [0.4], idx: 0, current: 0 },
        },
        pelvisScale: 1,
        bones: [{
          bone: toe,
          rest: { x: 0, y: 0, z: 0, w: 1 },
          side: "left",
          restLocal: { x: 0.09, y: 0.005, z: 0 },
        }],
        clipElapsed: 0,
        prevActionTime: 0,
        clipSpan: 9,
        steps: 6,
      },
    };
    applyFootstepPlanStep({ approach });
    expect(toe.position.x).toBeCloseTo(0.09, 9);
    expect(toe.position.y).toBeCloseTo(0.005, 9);
    approach.footstep.legs.left.current = 1;
    toe.position.set(0.2, 0.1, 0.3);
    applyFootstepPlanStep({ approach });
    expect(toe.position.x).toBeCloseTo(0.2, 9);
    expect(toe.position.y).toBeCloseTo(0.1, 9);
  });

  it("route extension gate: only flag plus exactly 2", () => {
    expect(footstepRouteExtensionForTest("?footstepPlan=1&footstepRouteM=2")).toBe(2);
    expect(footstepRouteExtensionForTest("?footstepPlan=1")).toBeNull();
    expect(footstepRouteExtensionForTest("?footstepRouteM=2")).toBeNull();
    expect(footstepRouteExtensionForTest("?footstepPlan=1&footstepRouteM=6")).toBeNull();
  });
});

describe("footstep-plan through the public walking entrypoint", () => {
  beforeEach(() => {
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("implies the closed loop and blends the legs post-pose", () => {
    const actorSlot = new THREE.Group();
    const legL = bone(actorSlot, "upperleg01.L", quat(0.3, 0, 0, 1));
    const leftToe = new THREE.Object3D();
    leftToe.name = "toe1-1L";
    leftToe.position.set(0.09, 0.5, 0);
    actorSlot.add(leftToe);
    const rightToe = new THREE.Object3D();
    rightToe.name = "toe1-1R";
    rightToe.position.set(-0.09, 0.5, 0);
    actorSlot.add(rightToe);
    actorSlot.updateMatrixWorld(true);
    const rest = quat(0, 0, 0, 1);
    const approach: Loose = {
      execution: { phase: "walking", drive: { locomotion: 1 }, travelledMeters: 0 },
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
      walkSpeedMetersPerSecond: 1.1,
      lock: {
        stanceFoot: null, anchorWorldXz: null, windowFrames: 0,
        correctionMeters: { x: 0, z: 0 },
        toeHeightMeters: { left: Number.NaN, right: Number.NaN },
        doubleSupport: false, prevToeWorldXz: null, prevSlotXz: null,
        forwardLeft: 0, forwardRight: 0, labelledStance: null,
      },
      lockArmed: true,
      closedLoop: null,
      footstep: {
        legs: {
          left: { scales: [1], atS: [0.4], idx: 0, current: 0 },
          right: { scales: [1], atS: [0.4], idx: 0, current: 0 },
        },
        pelvisScale: 1,
        bones: [{ bone: legL, rest: { x: rest.x, y: rest.y, z: rest.z, w: rest.w }, side: "left" }],
        clipElapsed: 0,
        prevActionTime: 0,
        clipSpan: 9,
        steps: 6,
      },
      stanceLabels: null,
      stanceLabelSlot: null,
      start: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 1.31 },
      intent: { target: { headingRadians: 0 } },
    };
    const before = angleDeg(legL.quaternion, rest);
    expect(before).toBeGreaterThan(1);
    applyCaseOwnedStanceLock(approach, DT);
    // Blend engaged at scale 0 through the tail: the leg is at standing now.
    expect(angleDeg(legL.quaternion, rest)).toBeLessThan(1e-6);
    // Closed loop implied by the plan flag alone (no closedLoopWalk flag set).
    expect(approach.closedLoop).not.toBeNull();
  });
});

describe("footstep-plan clock", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  /** Action time puppeteered per call; labels pre-seeded so no sampling runs. */
  function clockedState(actionTimes: { value: number }): Loose {
    const slot = new THREE.Group();
    return {
      execution: { phase: "walking" },
      actorSlot: slot,
      stanceLabels: { cycleSeconds: 1.708, atMs: [], left: [], right: [] },
      stanceLabelSlot: {
        mixer: { existingAction: () => ({ time: actionTimes.value }) },
        locomotionClipName: "walk",
        responseClips: [{ name: "walk" }],
        root: {},
        actorSlot: slot,
      },
      footstep: {
        legs: {
          left: { scales: [0.8], atS: [0.419], idx: 0, current: 0 },
          right: { scales: [0.9], atS: [1.114], idx: 0, current: 0 },
        },
        pelvisScale: 1,
        bones: [],
        clipElapsed: 0,
        prevActionTime: null,
        clipSpan: 9,
        steps: 6,
      },
    };
  }

  it("bootstraps, then adopts each leg scale as elapsed crosses its lift-off", () => {
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    const actionTimes = { value: FOOTSTEP_START_PHASE_S + 0.01 };
    const approach: Loose = clockedState(actionTimes);
    advanceFootstepPlan(approach);
    expect(approach.footstep.prevActionTime).toBeCloseTo(FOOTSTEP_START_PHASE_S + 0.01, 9);
    expect(approach.footstep.clipElapsed).toBeCloseTo(0.01, 9);
    expect(approach.footstep.legs.left.current).toBe(0);
    // Cross the left lift (elapsed 0.419): left adopts, right holds.
    actionTimes.value = FOOTSTEP_START_PHASE_S + 0.43;
    advanceFootstepPlan(approach);
    expect(approach.footstep.legs.left.current).toBe(0.8);
    expect(approach.footstep.legs.left.idx).toBe(1);
    expect(approach.footstep.legs.right.current).toBe(0);
    expect(approach.footstep.clipElapsed).toBeCloseTo(0.43, 9);
    // Cross the right lift (elapsed 1.114): right adopts too.
    actionTimes.value = FOOTSTEP_START_PHASE_S + 1.2;
    advanceFootstepPlan(approach);
    expect(approach.footstep.legs.right.current).toBe(0.9);
    expect(approach.footstep.clipElapsed).toBeCloseTo(1.2, 9);
  });

  it("unwraps the action-time loop seam forward", () => {
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    const actionTimes = { value: 1.7 };
    const approach: Loose = clockedState(actionTimes);
    advanceFootstepPlan(approach);
    const before = approach.footstep.clipElapsed;
    actionTimes.value = 0.02;
    advanceFootstepPlan(approach);
    // Wrapped forward by ~0.028 clip-s (1.7 -> 1.708 -> 0.02), never backward.
    expect(approach.footstep.clipElapsed - before).toBeCloseTo(0.028, 2);
  });

  it("stands down without the flag or without an action", () => {
    const actionTimes = { value: FOOTSTEP_START_PHASE_S + 0.5 };
    const approach: Loose = clockedState(actionTimes);
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "" } };
    advanceFootstepPlan(approach);
    expect(approach.footstep.prevActionTime).toBeNull();
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    approach.stanceLabelSlot = null;
    advanceFootstepPlan(approach);
    expect(approach.footstep.prevActionTime).toBeNull();
  });
});
