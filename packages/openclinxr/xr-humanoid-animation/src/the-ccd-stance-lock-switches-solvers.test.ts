import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

/**
 * The CCD stance-lock flag (2026-10-11), driven only through the public
 * `applyCaseOwnedStanceLock` path — package tests must not reach past the entrypoint
 * further than the ceiling allows, so this suite routes every assertion through it.
 *
 * Flag off runs the shipped two-bone stance-leg application; flag on drives the same heel
 * target through the reused hinge four-joint solve (intermediates frozen at the clip pose);
 * without a four-joint chain both take the identical fallback.
 */

// biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
type Loose = any;

function buildLeg(withMids: boolean): {
  slot: THREE.Group;
  hip: THREE.Object3D;
  upperMid: THREE.Object3D | null;
  knee: THREE.Object3D;
  heel: THREE.Object3D;
  toe: THREE.Object3D;
} {
  const slot = new THREE.Group();
  slot.name = "slot";
  const mk = (name: string, parent: THREE.Object3D, y: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(0, y, 0);
    parent.add(o);
    return o;
  };
  // Hip height puts the toe at y = 0.05 (inside the 0.06 contact band) either way:
  // four segments of 0.2 with mids, two without.
  const hip = mk("upperleg01L", slot, withMids ? 1.0 : 0.6);
  const upperMid = withMids ? mk("upperleg02L", hip, -0.2) : null;
  const knee = mk("lowerleg01L", withMids && upperMid ? upperMid : hip, -0.2);
  const lowerMid = withMids ? mk("lowerleg02L", knee, -0.2) : null;
  const heel = mk("footL", withMids && lowerMid ? lowerMid : knee, -0.2);
  const toe = mk("toe1-1L", heel, -0.05);
  toe.position.set(0, -0.15, 0.15);
  slot.updateMatrixWorld(true);
  return { slot, hip, upperMid, knee, heel, toe };
}

function runTwoFrames(
  leg: ReturnType<typeof buildLeg>,
  ccdOn: boolean,
): { knee: number[]; upperMid: number[]; hip: number[]; stanceFoot: string | null } {
  const parked = new THREE.Object3D();
  parked.name = "toe1-1R";
  parked.position.set(-0.09, 0.5, 0);
  leg.slot.add(parked);
  const approach: Loose = {
    execution: { phase: "walking", drive: { locomotion: 1 } },
    actorSlot: leg.slot,
    leftToe: leg.toe,
    rightToe: parked,
    floorOriginY: 0,
    contactBandMeters: 0.06,
    lock: {
      stanceFoot: null,
      anchorWorldXz: null,
      windowFrames: 0,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters: { left: Number.NaN, right: Number.NaN },
      doubleSupport: false,
      prevToeWorldXz: null,
      prevSlotXz: null,
      forwardLeft: 0,
      forwardRight: 0,
      labelledStance: null,
    },
    lockArmed: true,
    stanceLabels: null,
    stanceLabelSlot: null,
    ccdStanceLockEnabled: ccdOn,
    start: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 1 },
    intent: { target: { headingRadians: 0 } },
  };
  applyCaseOwnedStanceLock(approach, 1 / 60);
  expect(approach.lock.stanceFoot).toBe("left");
  // Clip advances the stance toe; the continued window runs the leg solve.
  leg.toe.position.z += 0.03;
  leg.slot.updateMatrixWorld(true);
  applyCaseOwnedStanceLock(approach, 1 / 60);
  return {
    knee: [...leg.knee.quaternion.toArray()],
    upperMid: [...(leg.upperMid?.quaternion.toArray() ?? [])],
    hip: [...leg.hip.quaternion.toArray()],
    stanceFoot: approach.lock.stanceFoot,
  };
}

describe("ccd stance-lock flag through the stance lock", () => {
  it("flag off crowns the stance foot and solves the leg", () => {
    const result = runTwoFrames(buildLeg(true), false);
    expect(result.stanceFoot).toBe("left");
    expect(result.hip).not.toEqual([0, 0, 0, 1]);
  });

  it("flag on drives the hinge: intermediates frozen, joint angles differ", () => {
    const on = runTwoFrames(buildLeg(true), true);
    const off = runTwoFrames(buildLeg(true), false);
    expect(on.upperMid).toEqual([0, 0, 0, 1]);
    expect(on.hip).not.toEqual([0, 0, 0, 1]);
    expect(on.knee).not.toEqual(off.knee);
  });

  it("flag on without a four-joint chain matches flag off exactly", () => {
    const on = runTwoFrames(buildLeg(false), true);
    const off = runTwoFrames(buildLeg(false), false);
    expect(on.knee).toEqual(off.knee);
    expect(on.hip).toEqual(off.hip);
  });
});
