import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyFootBaseStep,
  clearFootBaseState,
  FOOT_BASE_CYCLE_S,
  type LocomotionStanceLabels,
  readFootBaseState,
} from "./foot-base.js";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

// biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
type Loose = any;

/**
 * Rig-aware foot geometry, STEP 1 (public-entrypoint route: this package's
 * test-import-surface ceiling forbids new internal test imports, and the
 * slice adds no public exports — so every assertion below goes through the
 * public subpaths `./foot-base.js` and `./case-owned-approach-runtime.js`).
 *
 * - A child-proportioned skeleton yields the 0.674x heel local and k < 1.
 * - The physician skeleton yields identity (k = 1, heel local unchanged).
 *
 * Segment lengths are the shipped GLB bind translations (full precision for
 * the physician identity; the child values that reproduce the capture
 * calibration [-0.00148, 0.01224, 0.04567] = 0.674x uniform).
 */
const PHYSICIAN_SEG = {
  upperMid: 0.08196265995502472,
  knee: 0.3278903067111969,
  lowerMid: 0.2169674187898636,
  heel: 0.22294875979423523,
  toe: 0.1402248740196228,
};

const CHILD_SEG = {
  upperMid: 0.067547,
  knee: 0.237185,
  lowerMid: 0.143223,
  heel: 0.151158,
  toe: 0.094468,
};

/** Physician heel-sole contact, foot-bone frame (production calibration, inlined). */
const PHYSICIAN_HEEL = {
  L: { x: -0.0022, y: 0.01817, z: 0.06779 },
  R: { x: 0.0022, y: 0.01817, z: 0.06779 },
};

/**
 * Child toe offset, foot-bone frame: forward (+Z) of the heel like a real
 * foot — the flatten pass rotates the ankle about the toe assuming the heel
 * sits posterior, so a straight-down peg foot would drive the sign the wrong
 * way. Length matches the GLB child foot->toe (0.094468 m), so the derived
 * footScale is the brief's 0.674x.
 */
const CHILD_TOE_LOCAL = { x: 0, y: -0.02, z: 0.0923265 };

const CHILD_FOOT_SCALE = Math.hypot(CHILD_TOE_LOCAL.x, CHILD_TOE_LOCAL.y, CHILD_TOE_LOCAL.z) / 0.1402248740196228;

/**
 * World-X rotation putting the heel h metres above the toe: rotation about
 * +X maps (y,z) -> (y cosT - z sinT, ...), so with a0 = atan2(dy,dz) and
 * R = hypot, y'(T) = R·sin(a0-T) = h has two branches; take the minimal
 * rotation (the far branch flips the foot end-over-end).
 */
function poseAngleForHeight(dy: number, dz: number, h: number): number {
  const a0 = Math.atan2(dy, dz);
  const R = Math.hypot(dy, dz);
  const s = Math.asin(Math.min(1, Math.max(-1, h / R)));
  const norm = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const c1 = norm(a0 - s);
  const c2 = norm(a0 - (Math.PI - s));
  return Math.abs(c1) <= Math.abs(c2) ? c1 : c2;
}

function buildWalkingRig(seg: typeof PHYSICIAN_SEG): { slot: THREE.Group; leftToe: THREE.Object3D; rightToe: THREE.Object3D } {
  const slot = new THREE.Group();
  const mkSide = (side: "L" | "R"): THREE.Object3D => {
    const x = side === "L" ? 0.09 : -0.09;
    const hip = new THREE.Object3D();
    hip.name = `upperleg01.${side}`;
    hip.position.set(x, 0.8, 0);
    slot.add(hip);
    const upperMid = new THREE.Object3D();
    upperMid.name = `upperleg02.${side}`;
    upperMid.position.set(0, -seg.upperMid, 0);
    hip.add(upperMid);
    const knee = new THREE.Object3D();
    knee.name = `lowerleg01.${side}`;
    knee.position.set(0, -seg.knee, 0);
    upperMid.add(knee);
    const lowerMid = new THREE.Object3D();
    lowerMid.name = `lowerleg02.${side}`;
    lowerMid.position.set(0, -seg.lowerMid, 0);
    knee.add(lowerMid);
    const heel = new THREE.Object3D();
    heel.name = `foot.${side}`;
    heel.position.set(0, -seg.heel, 0);
    lowerMid.add(heel);
    const toe = new THREE.Object3D();
    toe.name = `toe1-1.${side}`;
    toe.position.set(0, -seg.toe, 0);
    heel.add(toe);
    return toe;
  };
  const leftToe = mkSide("L");
  const rightToe = mkSide("R");
  slot.updateMatrixWorld(true);
  return { slot, leftToe, rightToe };
}

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

function setSearch(search: string | null): void {
  const host = globalThis as unknown as { window?: unknown };
  if (search === null) delete host.window;
  else host.window = { location: { search } };
}

afterEach(() => {
  setSearch(null);
});

function stepOnce(slot: THREE.Group, leftToe: THREE.Object3D, rightToe: THREE.Object3D): Loose {
  const approach = {
    actorSlot: slot,
    leftToe,
    rightToe,
    floorOriginY: 0,
    contactBandMeters: 0.06,
    footstep: { scale: 0.8369, steps: 4, bones: [], lastToeSeparationM: null },
    execution: { phase: "walking", walkSimSubsteps: 0 },
    lockArmed: true,
    start: { x: 0, y: 0, z: 0 },
    lock: { stanceFoot: "left" },
  };
  applyFootBaseStep({
    approach: approach as never,
    routeDx: 0,
    routeDz: 2,
    routeLength: 2,
    clip: { labels: stanceLabels(), actionTimeSeconds: 0.6 },
  });
  return approach;
}

describe("rig-aware foot geometry", () => {
  it("derives k = 1 on the physician rig and k < 1 (0.705) on the child rig", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    const phys = buildWalkingRig(PHYSICIAN_SEG);
    const physApproach = stepOnce(phys.slot, phys.leftToe, phys.rightToe);
    expect(readFootBaseState(physApproach)?.rigLengthScale).toBe(1);
    clearFootBaseState(physApproach);

    const child = buildWalkingRig(CHILD_SEG);
    const childApproach = stepOnce(child.slot, child.leftToe, child.rightToe);
    const childK = readFootBaseState(childApproach)?.rigLengthScale;
    expect(childK).not.toBeNull();
    expect(childK as number).toBeLessThan(1);
    expect(childK as number).toBeCloseTo(0.705, 3);
    clearFootBaseState(childApproach);
  });

  it("flattens a child rig to the 0.674x heel local, not the physician heel", () => {
    const slot = new THREE.Group();
    const mkSide = (side: "L" | "R"): Record<string, THREE.Object3D> => {
      const bones: Record<string, THREE.Object3D> = {};
      const hip = new THREE.Object3D();
      hip.name = `upperleg01.${side}`;
      hip.position.set(side === "L" ? -0.1 : 0.1, 0.62, 0);
      slot.add(hip);
      const upperMid = new THREE.Object3D();
      upperMid.name = `upperleg02.${side}`;
      upperMid.position.set(0, -CHILD_SEG.upperMid, 0);
      hip.add(upperMid);
      const knee = new THREE.Object3D();
      knee.name = `lowerleg01.${side}`;
      knee.position.set(0, -CHILD_SEG.knee, 0);
      upperMid.add(knee);
      const lowerMid = new THREE.Object3D();
      lowerMid.name = `lowerleg02.${side}`;
      lowerMid.position.set(0, -CHILD_SEG.lowerMid, 0);
      knee.add(lowerMid);
      const foot = new THREE.Object3D();
      foot.name = `foot.${side}`;
      foot.position.set(0, -CHILD_SEG.heel, 0);
      lowerMid.add(foot);
      const toe = new THREE.Object3D();
      toe.name = `toe1-1.${side}`;
      toe.position.set(CHILD_TOE_LOCAL.x, CHILD_TOE_LOCAL.y, CHILD_TOE_LOCAL.z);
      foot.add(toe);
      bones["upper1"] = hip;
      bones["upper2"] = upperMid;
      bones["lower1"] = knee;
      bones["lower2"] = lowerMid;
      bones["foot"] = foot;
      bones["toe"] = toe;
      return bones;
    };
    const left = mkSide("L");
    const right = mkSide("R");
    const leftToe = left["toe"] as THREE.Object3D;
    const rightToe = right["toe"] as THREE.Object3D;
    const leftFoot = left["foot"] as THREE.Object3D;
    const rightFoot = right["foot"] as THREE.Object3D;
    // Bend the knees so the flatten target is reachable (mirrors the
    // FLAT-ST clause: the runtime arrival is a crouch, not a straight leg).
    (left["lower1"] as THREE.Object3D).rotation.x = 1.0;
    (right["lower1"] as THREE.Object3D).rotation.x = 1.0;
    slot.updateMatrixWorld(true);

    // Inline 0.674x heel (physician literal x child foot->toe ratio): the
    // value production must use, versus the unscaled physician literal it
    // must NOT use.
    const scaledHeel = {
      L: {
        x: PHYSICIAN_HEEL.L.x * CHILD_FOOT_SCALE,
        y: PHYSICIAN_HEEL.L.y * CHILD_FOOT_SCALE,
        z: PHYSICIAN_HEEL.L.z * CHILD_FOOT_SCALE,
      },
      R: {
        x: PHYSICIAN_HEEL.R.x * CHILD_FOOT_SCALE,
        y: PHYSICIAN_HEEL.R.y * CHILD_FOOT_SCALE,
        z: PHYSICIAN_HEEL.R.z * CHILD_FOOT_SCALE,
      },
    };
    expect(scaledHeel.L.x).toBeCloseTo(-0.00148, 4);
    expect(scaledHeel.L.y).toBeCloseTo(0.01224, 4);
    expect(scaledHeel.L.z).toBeCloseTo(0.04567, 4);
    const heelContactOf = (foot: THREE.Object3D, local: { x: number; y: number; z: number }): THREE.Vector3 => {
      foot.updateWorldMatrix(true, false);
      return foot.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
    };
    const toeWorldOf = (toe: THREE.Object3D): THREE.Vector3 => {
      toe.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(toe.matrixWorld);
    };
    // Heel-up 30 mm about the slot-lateral axis (world X), measured with the
    // scaled contact (near branch: the foot stays foot-shaped, not flipped).
    for (const [foot, side] of [[leftFoot, "L"], [rightFoot, "R"]] as const) {
      const h = scaledHeel[side];
      const toeLocal = CHILD_TOE_LOCAL;
      const theta = poseAngleForHeight(h.y - toeLocal.y, h.z - toeLocal.z, 0.03);
      foot.parent?.updateWorldMatrix(true, false);
      const parentQ = new THREE.Quaternion();
      foot.parent?.getWorldQuaternion(parentQ);
      parentQ.normalize();
      foot.quaternion
        .copy(
          parentQ.invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), theta)),
        )
        .normalize();
    }
    slot.updateMatrixWorld(true);
    for (const [foot, side, toe] of [[leftFoot, "L", leftToe], [rightFoot, "R", rightToe]] as const) {
      const lift = heelContactOf(foot as THREE.Object3D, scaledHeel[side]).y - toeWorldOf(toe as THREE.Object3D).y;
      expect(lift, "fixture heel is not 30 mm up").toBeGreaterThan(0.029);
      expect(lift, "fixture heel is not 30 mm up").toBeLessThan(0.031);
    }
    // Seat the slot so both toes rest ~20 mm above the floor datum.
    const seatY = Math.min(toeWorldOf(leftToe).y, toeWorldOf(rightToe).y);
    slot.position.y -= seatY - 0.02;
    slot.updateMatrixWorld(true);
    const toeL0 = toeWorldOf(leftToe);
    const toeR0 = toeWorldOf(rightToe);
    slot.updateMatrixWorld(true);
    const quats: Record<string, { x: number; y: number; z: number; w: number }> = {};
    for (const bone of [left["upper1"]!, left["upper2"]!, left["lower1"]!, left["lower2"]!, leftFoot, right["upper1"]!, right["upper2"]!, right["lower1"]!, right["lower2"]!, rightFoot]) {
      quats[bone.name] = { x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w };
    }
    const approach = {
      execution: { phase: "arrived", drive: { locomotion: 0 } },
      actorSlot: slot,
      leftToe,
      rightToe,
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
      turnStep: {
        plantFoot: "right",
        stepStartHeadingRadians: 0,
        restLocal: null,
        plantAnchorXz: null,
        yawPerStepRadians: 0.4,
        opened: false,
        closing: false,
      },
      restStance: {
        quats,
        toeLeft: { x: leftToe.position.x, y: leftToe.position.y, z: leftToe.position.z },
        toeRight: { x: rightToe.position.x, y: rightToe.position.y, z: rightToe.position.z },
        sepXz: Math.hypot(toeL0.x - toeR0.x, toeL0.z - toeR0.z),
        heightLeft: toeL0.y,
        heightRight: toeR0.y,
      },
      closeState: {
        leftAnchorXz: null,
        rightAnchorXz: null,
        done: false,
        framesRun: 0,
        plantFoot: null,
        swingSegmentFoot: null,
        swingSegmentStartDistance: 0,
      },
      intent: { target: { headingRadians: 0 } },
    } as unknown as Loose;

    let minToeY = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 150 && !approach.closeState.done; frame += 1) {
      applyCaseOwnedStanceLock(approach, 1 / 30);
      slot.updateMatrixWorld(true);
      minToeY = Math.min(minToeY, toeWorldOf(leftToe).y, toeWorldOf(rightToe).y);
    }
    // Converged to the SCALED contact: production used the 0.674x heel.
    for (const [foot, side] of [[leftFoot, "L"], [rightFoot, "R"]] as const) {
      const residual = heelContactOf(foot as THREE.Object3D, scaledHeel[side]).y - minToeY;
      expect(residual, `${side} heel did not flatten to the 0.674x contact`).toBeLessThanOrEqual(0.003);
    }
    // ...and NOT to the unscaled physician heel: that contact still rides
    // ~6 mm high (foot-scale gap 0.326 x heel height), which is exactly the
    // pre-slice child defect shape.
    for (const [foot, side] of [[leftFoot, "L"], [rightFoot, "R"]] as const) {
      const stale =
        heelContactOf(foot as THREE.Object3D, side === "L" ? PHYSICIAN_HEEL.L : PHYSICIAN_HEEL.R).y - minToeY;
      expect(stale, `${side} converged to the physician heel instead`).toBeGreaterThan(0.004);
    }
    // Toes stayed pinned throughout.
    const toeL1 = toeWorldOf(leftToe);
    const toeR1 = toeWorldOf(rightToe);
    expect(Math.hypot(toeL1.x - toeL0.x, toeL1.z - toeL0.z), "left toe left its target").toBeLessThanOrEqual(0.002);
    expect(Math.hypot(toeR1.x - toeR0.x, toeR1.z - toeR0.z), "right toe left its target").toBeLessThanOrEqual(0.002);
  });

  it("leaves a flat physician rig untouched (heel local unchanged)", () => {
    const slot = new THREE.Group();
    const mkSide = (side: "L" | "R"): Record<string, THREE.Object3D> => {
      const bones: Record<string, THREE.Object3D> = {};
      const hip = new THREE.Object3D();
      hip.name = `upperleg01.${side}`;
      hip.position.set(side === "L" ? -0.1 : 0.1, 0.9, 0);
      slot.add(hip);
      const upperMid = new THREE.Object3D();
      upperMid.name = `upperleg02.${side}`;
      upperMid.position.set(0, -PHYSICIAN_SEG.upperMid, 0);
      hip.add(upperMid);
      const knee = new THREE.Object3D();
      knee.name = `lowerleg01.${side}`;
      knee.position.set(0, -PHYSICIAN_SEG.knee, 0);
      upperMid.add(knee);
      const lowerMid = new THREE.Object3D();
      lowerMid.name = `lowerleg02.${side}`;
      lowerMid.position.set(0, -PHYSICIAN_SEG.lowerMid, 0);
      knee.add(lowerMid);
      const foot = new THREE.Object3D();
      foot.name = `foot.${side}`;
      foot.position.set(0, -PHYSICIAN_SEG.heel, 0);
      lowerMid.add(foot);
      const toe = new THREE.Object3D();
      toe.name = `toe1-1.${side}`;
      toe.position.set(0, -PHYSICIAN_SEG.toe, 0);
      foot.add(toe);
      bones["lower1"] = knee;
      bones["foot"] = foot;
      bones["toe"] = toe;
      return bones;
    };
    const left = mkSide("L");
    const right = mkSide("R");
    const leftToe = left["toe"] as THREE.Object3D;
    const rightToe = right["toe"] as THREE.Object3D;
    const leftFoot = left["foot"] as THREE.Object3D;
    const rightFoot = right["foot"] as THREE.Object3D;
    (left["lower1"] as THREE.Object3D).rotation.x = 1.0;
    (right["lower1"] as THREE.Object3D).rotation.x = 1.0;
    slot.updateMatrixWorld(true);
    // Pose the legacy physician contact level with the toe, inline.
    const toeWorldOf = (toe: THREE.Object3D): THREE.Vector3 => {
      toe.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(toe.matrixWorld);
    };
    for (const [foot, side] of [[leftFoot, "L"], [rightFoot, "R"]] as const) {
      const h = side === "L" ? PHYSICIAN_HEEL.L : PHYSICIAN_HEEL.R;
      const toeLocal = { x: 0, y: -PHYSICIAN_SEG.toe, z: 0 };
      // Level: heel-up h = 0 (near branch).
      const level = poseAngleForHeight(h.y - toeLocal.y, h.z - toeLocal.z, 0);
      foot.parent?.updateWorldMatrix(true, false);
      const parentQ = new THREE.Quaternion();
      foot.parent?.getWorldQuaternion(parentQ);
      parentQ.normalize();
      foot.quaternion
        .copy(parentQ.invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), level)))
        .normalize();
    }
    slot.updateMatrixWorld(true);
    const heelContactOf = (foot: THREE.Object3D, local: { x: number; y: number; z: number }): THREE.Vector3 => {
      foot.updateWorldMatrix(true, false);
      return foot.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
    };
    for (const [foot, side, toe] of [[leftFoot, "L", leftToe], [rightFoot, "R", rightToe]] as const) {
      const h = side === "L" ? PHYSICIAN_HEEL.L : PHYSICIAN_HEEL.R;
      const dy = heelContactOf(foot as THREE.Object3D, h).y - toeWorldOf(toe as THREE.Object3D).y;
      expect(Math.abs(dy), "control foot is not level").toBeLessThan(0.0005);
    }
    const seatY = Math.min(toeWorldOf(leftToe).y, toeWorldOf(rightToe).y);
    slot.position.y -= seatY - 0.02;
    slot.updateMatrixWorld(true);
    const footLQ0 = leftFoot.quaternion.clone();
    const footRQ0 = rightFoot.quaternion.clone();
    const snapL = toeWorldOf(leftToe);
    const snapR = toeWorldOf(rightToe);
    const snapQuats: Record<string, { x: number; y: number; z: number; w: number }> = {};
    for (const bone of [leftFoot, rightFoot]) {
      snapQuats[bone.name] = { x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w };
    }
    const approach = {
      execution: { phase: "arrived", drive: { locomotion: 0 } },
      actorSlot: slot,
      leftToe,
      rightToe,
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
      turnStep: {
        plantFoot: "right",
        stepStartHeadingRadians: 0,
        restLocal: null,
        plantAnchorXz: null,
        yawPerStepRadians: 0.4,
        opened: false,
        closing: false,
      },
      restStance: {
        quats: snapQuats,
        toeLeft: { x: leftToe.position.x, y: leftToe.position.y, z: leftToe.position.z },
        toeRight: { x: rightToe.position.x, y: rightToe.position.y, z: rightToe.position.z },
        sepXz: Math.hypot(snapL.x - snapR.x, snapL.z - snapR.z),
        heightLeft: snapL.y,
        heightRight: snapR.y,
      },
      closeState: {
        leftAnchorXz: null,
        rightAnchorXz: null,
        done: false,
        framesRun: 0,
        plantFoot: null,
        swingSegmentFoot: null,
        swingSegmentStartDistance: 0,
      },
      intent: { target: { headingRadians: 0 } },
    } as unknown as Loose;
    for (let frame = 0; frame < 20; frame += 1) {
      applyCaseOwnedStanceLock(approach, 1 / 30);
      slot.updateMatrixWorld(true);
    }
    // Untouched: the identity rig takes the legacy default-constant path.
    expect(leftFoot.quaternion.equals(footLQ0), "flat physician left foot was rewritten").toBe(true);
    expect(rightFoot.quaternion.equals(footRQ0), "flat physician right foot was rewritten").toBe(true);
  });
});
