import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";
import {
  applyFootstepPlanStep,
  captureFootstepRest,
} from "./footstep-plan.js";

// biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
type Loose = any;

const DT = 1 / 60;

function quat(x: number, y: number, z: number, w: number): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w).normalize();
}

/** One leg bone under a slot, named like the rig (dots kept). */
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

/** Twist about local X (the blend's flexion axis), test-local. */
function twistX(q: THREE.Quaternion): THREE.Quaternion {
  const n = Math.hypot(q.x, q.w) || 1;
  return new THREE.Quaternion(q.x / n, 0, 0, q.w / n);
}

describe("footstep-plan amplitude blend", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("s=0 returns standing flexion with clip-true yaw/roll, s=1 the clip pose, norms hold", () => {
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    const slot = new THREE.Group();
    const rest = quat(0, 0, 0, 1);
    // Off-X clip deliberately: the creep M2 flexion-only blend keeps yaw/roll clip-true.
    const clip = quat(0.3, 0.1, 0.05, 1);
    const leg = bone(slot, "upperleg01.L", clip);
    const approach: Loose = {
      execution: { phase: "walking" },
      actorSlot: slot,
      footstep: { scale: 0, steps: 3, bones: [{ bone: leg, rest: { x: rest.x, y: rest.y, z: rest.z, w: rest.w } }] },
    };
    applyFootstepPlanStep({ approach, routeDx: 0, routeDz: 1, routeLength: 1.31 });
    // Flexion reaches standing exactly; yaw/roll stay at the clip (lateral preserved, not standing).
    expect(angleDeg(twistX(leg.quaternion), twistX(rest))).toBeLessThan(1e-6);
    expect(angleDeg(leg.quaternion, rest)).toBeGreaterThan(1);
    expect(angleDeg(leg.quaternion, clip)).toBeLessThan(angleDeg(clip, rest));
    // X-only clip: no off-X exists, so s=0 is exactly standing (old pin, unchanged).
    const clipX = quat(0.3, 0, 0, 1);
    leg.quaternion.copy(clipX);
    applyFootstepPlanStep({ approach, routeDx: 0, routeDz: 1, routeLength: 1.31 });
    expect(angleDeg(leg.quaternion, rest)).toBeLessThan(1e-6);
    approach.footstep.scale = 1;
    leg.quaternion.copy(clip);
    applyFootstepPlanStep({ approach, routeDx: 0, routeDz: 1, routeLength: 1.31 });
    expect(angleDeg(leg.quaternion, clip)).toBeLessThan(1e-6);
    approach.footstep.scale = 0.5;
    leg.quaternion.copy(clipX);
    applyFootstepPlanStep({ approach, routeDx: 0, routeDz: 1, routeLength: 1.31 });
    expect(angleDeg(leg.quaternion, rest)).toBeCloseTo(angleDeg(clipX, rest) / 2, 0);
    expect(Math.abs(leg.quaternion.length() - 1)).toBeLessThan(1e-4);
  });

  it("no-ops without the flag, without state, or off the walking phase", () => {
    const slot = new THREE.Group();
    const clip = quat(0.3, 0.1, 0.05, 1);
    const leg = bone(slot, "upperleg01.L", clip);
    const state = {
      scale: 0,
      steps: 3,
      bones: [{ bone: leg, rest: { x: 0, y: 0, z: 0, w: 1 } }],
    };
    const before = leg.quaternion.clone();
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "" } };
    const walking: Loose = { execution: { phase: "walking" }, actorSlot: slot, footstep: state };
    const settling: Loose = { execution: { phase: "settling" }, actorSlot: slot, footstep: state };
    const stateless: Loose = { execution: { phase: "walking" }, actorSlot: slot, footstep: null };
    applyFootstepPlanStep({ approach: walking, routeDx: 0, routeDz: 1, routeLength: 1.31 });
    expect(leg.quaternion.equals(before)).toBe(true);
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    applyFootstepPlanStep({ approach: settling, routeDx: 0, routeDz: 1, routeLength: 1.31 });
    expect(leg.quaternion.equals(before)).toBe(true);
    applyFootstepPlanStep({ approach: stateless, routeDx: 0, routeDz: 1, routeLength: 1.31 });
    expect(leg.quaternion.equals(before)).toBe(true);
  });

  it("capture clears state without the flag and resolves scale with it", () => {
    const slot = new THREE.Group();
    bone(slot, "upperleg01.L", quat(0, 0, 0, 1));
    const approach: Loose = {
      actorSlot: slot,
      leftToe: null,
      rightToe: null,
      target: { x: 0, z: 1.31 },
      start: { x: 0, z: 0 },
      restStance: { quats: { "upperleg01.L": { x: 0, y: 0, z: 0, w: 1 } } },
      footstep: { scale: 1, steps: 9, bones: [] },
    };
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "" } };
    captureFootstepRest(approach);
    expect(approach.footstep).toBeNull();
    (globalThis as unknown as { window?: unknown }).window = { location: { search: "?footstepPlan=1" } };
    captureFootstepRest(approach);
    expect(approach.footstep.scale).toBeCloseTo(0.707, 3);
    expect(approach.footstep.steps).toBe(3);
    expect(approach.footstep.bones.length).toBe(1);
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
        scale: 0,
        steps: 3,
        bones: [{ bone: legL, rest: { x: rest.x, y: rest.y, z: rest.z, w: rest.w } }],
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
