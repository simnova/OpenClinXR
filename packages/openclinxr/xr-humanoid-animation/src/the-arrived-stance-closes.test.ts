import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

// The approach shape `applyCaseOwnedStanceLock` reads and mutates. It is a plain data
// record, not an opaque handle, so the fixture below builds it directly rather than
// through the (unexported) construction/state helpers — the same way production code
// only ever touches this shape through the one public entrypoint function.
// biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
type Loose = any;

/**
 * HOLD (2026-10-14): once the turn ends, the feet stay where the turn put them.
 * The 2026-10-11 gradual close converged toes toward the walk-start rest snapshot;
 * measured on SC-05 it glided the feet 0.075 m away from the on-target turn-end pose
 * and jumped the slot 0.196 m re-taking its anchor on a plant-foot role swap. The
 * hold freezes per-toe anchors on the first arrived frame and writes no bone pose.
 *
 * Clause (1) pins the no-snapshot fallback by identity (unchanged). Clause (2) pins
 * the hold: a fixture whose turn ends 0.05 m from rest stays where it ended.
 */

function buildLegSide(slot: THREE.Group, side: "L" | "R", hipX: number): Record<string, THREE.Object3D> {
  const bones: Record<string, THREE.Object3D> = {};
  const upper1 = new THREE.Object3D();
  upper1.name = `upperleg01.${side}`;
  upper1.position.set(hipX, 0.95, 0);
  slot.add(upper1);
  const upper2 = new THREE.Object3D();
  upper2.name = `upperleg02.${side}`;
  upper2.position.set(0, -0.05, 0);
  upper1.add(upper2);
  const lower1 = new THREE.Object3D();
  lower1.name = `lowerleg01.${side}`;
  lower1.position.set(0, -0.4, 0);
  upper2.add(lower1);
  const lower2 = new THREE.Object3D();
  lower2.name = `lowerleg02.${side}`;
  lower2.position.set(0, -0.05, 0);
  lower1.add(lower2);
  const foot = new THREE.Object3D();
  foot.name = `foot.${side}`;
  foot.position.set(0, -0.4, 0);
  lower2.add(foot);
  const toe = new THREE.Object3D();
  toe.name = `toe1-1.${side}`;
  toe.position.set(0, -0.03, 0.15);
  foot.add(toe);
  bones["upper1"] = upper1;
  bones["upper2"] = upper2;
  bones["lower1"] = lower1;
  bones["lower2"] = lower2;
  bones["foot"] = foot;
  bones["toe"] = toe;
  return bones;
}

function toeWorld(toe: THREE.Object3D): { x: number; y: number; z: number } {
  const e = toe.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

/**
 * The rest-stance snapshot shape `applyCaseOwnedStanceLock` reads from `approach.restStance`
 * (see `arrival-stance-close-mod.ts`'s `RestStanceSnapshot`), built by reading the rig's own
 * bones directly rather than importing the private capture helper — fixture setup, not the
 * predicate under test.
 */
function snapshotRestStance(
  actorSlot: THREE.Object3D,
  leftChain: THREE.Object3D[],
  rightChain: THREE.Object3D[],
  leftToe: THREE.Object3D,
  rightToe: THREE.Object3D,
): Loose {
  actorSlot.updateMatrixWorld(true);
  const quats: Record<string, { x: number; y: number; z: number; w: number }> = {};
  for (const bone of [...leftChain, ...rightChain]) {
    quats[bone.name] = { x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w };
  }
  const left = toeWorld(leftToe);
  const right = toeWorld(rightToe);
  return {
    quats,
    toeLeft: { x: leftToe.position.x, y: leftToe.position.y, z: leftToe.position.z },
    toeRight: { x: rightToe.position.x, y: rightToe.position.y, z: rightToe.position.z },
    sepXz: Math.hypot(left.x - right.x, left.z - right.z),
    heightLeft: left.y,
    heightRight: right.y,
  };
}

/**
 * FLAT-ST fixture geometry (clauses 3-4). Heel-sole contact in the foot-bone
 * frame, INLINED from the production calibration (NOT imported: this file may
 * only import the public subpath, per the test-import-surface ceiling):
 * tools/openclinxr/evidence/slide-phase/slide-phase-capture.ts HEEL_LOCAL_L/R
 * (lowest-Y posterior-half vertex with dominant foot-joint skin weight in bind
 * pose). If that calibration moves, the setup asserts below fail loudly.
 */
const FLAT_HEEL_LOCAL = {
  L: { x: -0.0022, y: 0.01817, z: 0.06779 },
  R: { x: 0.0022, y: 0.01817, z: 0.06779 },
};
/** Fixture toe offset in the foot-bone frame (see buildLegSide). */
const FLAT_TOE_LOCAL = { x: 0, y: -0.03, z: 0.15 };

/**
 * RIG-AWARE (rig-aware slice): production foot-flatten resolves the
 * heel-contact local from the rig's own rest foot->toe ratio (physician heel
 * x rig ratio). This fixture's toe offset is not physician-proportioned, so
 * the control geometry below is scaled by the same ratio, computed inline
 * from the fixture's own toe offset (this file may only import the public
 * subpath, per the test-import-surface ceiling — no internal import).
 */
const PHYSICIAN_FOOT_TOE_REST_M = 0.1402248740196228;
const FLAT_FOOT_SCALE =
  Math.hypot(FLAT_TOE_LOCAL.x, FLAT_TOE_LOCAL.y, FLAT_TOE_LOCAL.z) / PHYSICIAN_FOOT_TOE_REST_M;
const FLAT_HEEL_SCALED = {
  L: {
    x: FLAT_HEEL_LOCAL.L.x * FLAT_FOOT_SCALE,
    y: FLAT_HEEL_LOCAL.L.y * FLAT_FOOT_SCALE,
    z: FLAT_HEEL_LOCAL.L.z * FLAT_FOOT_SCALE,
  },
  R: {
    x: FLAT_HEEL_LOCAL.R.x * FLAT_FOOT_SCALE,
    y: FLAT_HEEL_LOCAL.R.y * FLAT_FOOT_SCALE,
    z: FLAT_HEEL_LOCAL.R.z * FLAT_FOOT_SCALE,
  },
};

function poseFootWorld(foot: THREE.Object3D, world: THREE.Quaternion): void {
  foot.parent?.updateWorldMatrix(true, false);
  const parentQ = new THREE.Quaternion();
  foot.parent?.getWorldQuaternion(parentQ);
  parentQ.normalize();
  foot.quaternion.copy(parentQ.invert().multiply(world)).normalize();
}

function heelContactOf(foot: THREE.Object3D, side: "L" | "R"): { x: number; y: number; z: number } {
  const local = FLAT_HEEL_SCALED[side];
  foot.updateWorldMatrix(true, false);
  const v = new THREE.Vector3(local.x, local.y, local.z);
  foot.localToWorld(v);
  return { x: v.x, y: v.y, z: v.z };
}

/** Heel-toe XZ distance for a side, from the two bone-frame locals. */
function heelToeDxz(side: "L" | "R"): number {
  const h = FLAT_HEEL_SCALED[side];
  return Math.hypot(h.x - FLAT_TOE_LOCAL.x, h.z - FLAT_TOE_LOCAL.z);
}

/** Foot-world pitch that puts the production contact level with the toe. */
function levelPitch(side: "L" | "R"): number {
  const h = FLAT_HEEL_SCALED[side];
  return -Math.atan2(h.y - FLAT_TOE_LOCAL.y, heelToeDxz(side));
}

/**
 * Absolute foot-world pitch (about the slot-lateral axis) that puts the
 * production contact `heightM` above the toe. Rotations do not add onto the
 * level pose (the contact vector carries its own +Y), so solve from the
 * vector's own angle: y-diff = R·sin(a0 + theta).
 */
function liftPitch(side: "L" | "R", heightM: number): number {
  const h = FLAT_HEEL_SCALED[side];
  const dy = h.y - FLAT_TOE_LOCAL.y;
  const dxz = heelToeDxz(side);
  return Math.asin(heightM / Math.hypot(dy, dxz)) - Math.atan2(dy, dxz);
}

describe("the arrived stance closes to rest", () => {
  it("(1) MECHANISM: an arrived frame leaves the walking-lock state untouched while the settling branch moves the toes", () => {
    const actorSlot = new THREE.Group();
    const left = buildLegSide(actorSlot, "L", -0.1);
    const right = buildLegSide(actorSlot, "R", 0.1);
    const leftToe = left["toe"]!;
    const rightToe = right["toe"]!;
    actorSlot.updateMatrixWorld(true);
    // The lock's own createStanceLockState() shape (stance-lock-mod.ts): a fresh, unpinned lock.
    const lockBefore: Loose = {
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
    };
    const approach = {
      execution: { phase: "arrived", drive: { locomotion: 0 } },
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
      lock: lockBefore,
      lockArmed: true,
      turnStep: {
        // createSettlingStepTurnState()'s shape (settling-step-turn-mod.ts).
        plantFoot: "right",
        stepStartHeadingRadians: 0,
        restLocal: {
          left: { x: 0, y: 0.1, z: -0.2 },
          right: { x: 0, y: 0.1, z: 0.2 },
        },
        plantAnchorXz: null,
        yawPerStepRadians: 0.4,
        opened: false,
        closing: false,
      },
      restStance: null,
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

    applyCaseOwnedStanceLock(approach, 1 / 30);

    // The walking lock never ran: no anchor taken, no correction written.
    expect(approach.lock).toBe(lockBefore);
    expect(approach.lock.anchorWorldXz).toBeNull();
    expect(approach.lock.correctionMeters).toEqual({ x: 0, z: 0 });
    expect(approach.lock.stanceFoot).toBeNull();
  });

  it("(2) arrived frames HOLD the turn-end pose: toes and slot stay where the turn put them", () => {
    const actorSlot = new THREE.Group();
    const left = buildLegSide(actorSlot, "L", -0.1);
    const right = buildLegSide(actorSlot, "R", 0.1);
    const leftToe = left["toe"] as THREE.Object3D;
    const rightToe = right["toe"] as THREE.Object3D;
    const leftChain = [left["upper1"]!, left["upper2"]!, left["lower1"]!, left["lower2"]!, left["foot"]!];
    const rightChain = [right["upper1"]!, right["upper2"]!, right["lower1"]!, right["lower2"]!, right["foot"]!];

    // Rest snapshot in the standing pose, before any stride. The hold never converges
    // toward it — it stays where the turn ended even 0.05 m away from rest.
    const snapshot = snapshotRestStance(actorSlot, leftChain, rightChain, leftToe, rightToe);

    // Turn-end pose: displaced 0.05 m from rest in XZ, as the faded clip leaves it.
    leftToe.position.z -= 0.05;
    rightToe.position.z += 0.0;
    actorSlot.updateMatrixWorld(true);
    const turnEndLeft = toeWorld(leftToe);
    const turnEndRight = toeWorld(rightToe);
    const turnEndSep = Math.hypot(turnEndLeft.x - turnEndRight.x, turnEndLeft.z - turnEndRight.z);

    const approach = {
      execution: { phase: "arrived", drive: { locomotion: 0 } },
      actorSlot,
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
      restStance: snapshot,
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

    let maxToeStep = 0;
    let maxSlotStep = 0;
    actorSlot.updateMatrixWorld(true);
    const slotBefore = { x: actorSlot.position.x, z: actorSlot.position.z };
    const slotPrev = { ...slotBefore };
    for (let frame = 0; frame < 150 && !approach.closeState.done; frame += 1) {
      actorSlot.updateMatrixWorld(true);
      const beforeLeft = toeWorld(leftToe);
      const beforeRight = toeWorld(rightToe);
      applyCaseOwnedStanceLock(approach, 1 / 30);
      actorSlot.updateMatrixWorld(true);
      const afterLeft = toeWorld(leftToe);
      const afterRight = toeWorld(rightToe);
      // Full 3D toe step (the old glide's per-frame travel metric); the slot step is XZ.
      const stepLeft = Math.hypot(afterLeft.x - beforeLeft.x, afterLeft.y - beforeLeft.y, afterLeft.z - beforeLeft.z);
      const stepRight = Math.hypot(afterRight.x - beforeRight.x, afterRight.y - beforeRight.y, afterRight.z - beforeRight.z);
      maxToeStep = Math.max(maxToeStep, stepLeft, stepRight);
      const slotAfter = { x: actorSlot.position.x, z: actorSlot.position.z };
      maxSlotStep = Math.max(
        maxSlotStep,
        Math.hypot(slotAfter.x - slotPrev.x, slotAfter.z - slotPrev.z),
      );
      slotPrev.x = slotAfter.x;
      slotPrev.z = slotAfter.z;
    }

    expect(approach.closeState.done, "hold did not run the 150-frame window").toBe(true);
    // A fixture 0.05 m from rest STAYS where it ended: the old glide would have closed
    // most of that gap toward rest (fails if the glide returns).
    actorSlot.updateMatrixWorld(true);
    const finalLeft = toeWorld(leftToe);
    const finalRight = toeWorld(rightToe);
    expect(
      Math.hypot(finalLeft.x - turnEndLeft.x, finalLeft.z - turnEndLeft.z),
      "left toe glided away from its turn-end spot",
    ).toBeLessThan(0.001);
    expect(
      Math.hypot(finalRight.x - turnEndRight.x, finalRight.z - turnEndRight.z),
      "right toe glided away from its turn-end spot",
    ).toBeLessThan(0.001);
    // The slot does not translate more than 0.001 m per frame (cumulative bound over the
    // window is frame-count × cap, but per-frame is what the gate pins — see maxSlotStep).
    expect(
      Math.hypot(actorSlot.position.x - slotBefore.x, actorSlot.position.z - slotBefore.z),
      "slot translated during the hold",
    ).toBeLessThan(0.001 * 150);
    expect(maxSlotStep, "slot jumped in one frame").toBeLessThanOrEqual(0.001);
    // No leg chain was slerped toward the rest quaternions: separation is the turn-end
    // separation, not the narrower rest column.
    const finalSep = Math.hypot(finalLeft.x - finalRight.x, finalLeft.z - finalRight.z);
    expect(Math.abs(finalSep - turnEndSep), "stance separation changed").toBeLessThan(0.002);
    actorSlot.updateMatrixWorld(true);
    const leftY = (leftToe.matrixWorld.elements[13] ?? 0) as number;
    const rightY = (rightToe.matrixWorld.elements[13] ?? 0) as number;
    expect(leftY, "left toe sank through the floor").toBeGreaterThanOrEqual(-0.005);
    expect(rightY, "right toe sank through the floor").toBeGreaterThanOrEqual(-0.005);
    expect(maxToeStep).toBeLessThanOrEqual(0.01);
  });

  it("(3) FLAT-ST: a 50 mm heel-lifted foot ends flat on arrived frames with the toe pinned", () => {
    const actorSlot = new THREE.Group();
    const left = buildLegSide(actorSlot, "L", -0.1);
    const right = buildLegSide(actorSlot, "R", 0.1);
    const leftToe = left["toe"] as THREE.Object3D;
    const rightToe = right["toe"] as THREE.Object3D;
    const leftFoot = left["foot"] as THREE.Object3D;
    const rightFoot = right["foot"] as THREE.Object3D;
    // Bend the knees so the flatten target is reachable: a dead-straight leg
    // has no extension slack (the runtime arrival is a 38-55 deg crouch).
    (left["lower1"] as THREE.Object3D).rotation.x = 1.0;
    (right["lower1"] as THREE.Object3D).rotation.x = 1.0;
    actorSlot.updateMatrixWorld(true);
    // Heel-sole contact per the production calibration, rig-scaled to this
    // fixture (see FLAT_HEEL_SCALED). Start level, then heel-up 50 mm about
    // the slot-lateral axis (world X).
    for (const [foot, side] of [[leftFoot, "L"], [rightFoot, "R"]] as const) {
      poseFootWorld(
        foot,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), liftPitch(side, 0.05)),
      );
    }
    actorSlot.updateMatrixWorld(true);
    // Seat the slot so both toes rest ~20 mm above the floor datum.
    const seatY = Math.min(toeWorld(leftToe).y, toeWorld(rightToe).y);
    actorSlot.position.y -= seatY - 0.02;
    actorSlot.updateMatrixWorld(true);
    const toeL0 = toeWorld(leftToe);
    const toeR0 = toeWorld(rightToe);
    for (const [foot, side, toe] of [[leftFoot, "L", toeL0], [rightFoot, "R", toeR0]] as const) {
      expect(heelContactOf(foot, side).y - toe.y, "fixture heel is not 50 mm up").toBeGreaterThan(0.049);
      expect(heelContactOf(foot, side).y - toe.y, "fixture heel is not 50 mm up").toBeLessThan(0.051);
    }
    const snapshot = snapshotRestStance(
      actorSlot,
      [left["upper1"]!, left["upper2"]!, left["lower1"]!, left["lower2"]!, left["foot"]!],
      [right["upper1"]!, right["upper2"]!, right["lower1"]!, right["lower2"]!, right["foot"]!],
      leftToe,
      rightToe,
    );
    const approach = {
      execution: { phase: "arrived", drive: { locomotion: 0 } },
      actorSlot,
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
      restStance: snapshot,
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
    let minHeelY = Number.POSITIVE_INFINITY;
    let maxFootDegPerSec = 0;
    const dt = 1 / 30;
    let prevQL = leftFoot.getWorldQuaternion(new THREE.Quaternion());
    let prevQR = rightFoot.getWorldQuaternion(new THREE.Quaternion());
    for (let frame = 0; frame < 150 && !approach.closeState.done; frame += 1) {
      applyCaseOwnedStanceLock(approach, dt);
      actorSlot.updateMatrixWorld(true);
      const qL = leftFoot.getWorldQuaternion(new THREE.Quaternion());
      const qR = rightFoot.getWorldQuaternion(new THREE.Quaternion());
      maxFootDegPerSec = Math.max(
        maxFootDegPerSec,
        (prevQL.angleTo(qL) * 180) / Math.PI / dt,
        (prevQR.angleTo(qR) * 180) / Math.PI / dt,
      );
      prevQL = qL;
      prevQR = qR;
      minToeY = Math.min(minToeY, toeWorld(leftToe).y, toeWorld(rightToe).y);
      minHeelY = Math.min(minHeelY, heelContactOf(leftFoot, "L").y, heelContactOf(rightFoot, "R").y);
    }
    // Heel within 5 mm of the lowest toe the run ever saw; toe stays on target.
    expect(heelContactOf(leftFoot, "L").y - minToeY, "left heel did not flatten").toBeLessThanOrEqual(0.005);
    expect(heelContactOf(rightFoot, "R").y - minToeY, "right heel did not flatten").toBeLessThanOrEqual(0.005);
    const toeL1 = toeWorld(leftToe);
    const toeR1 = toeWorld(rightToe);
    expect(Math.hypot(toeL1.x - toeL0.x, toeL1.z - toeL0.z), "left toe left its target").toBeLessThanOrEqual(0.002);
    expect(Math.hypot(toeR1.x - toeR0.x, toeR1.z - toeR0.z), "right toe left its target").toBeLessThanOrEqual(0.002);
    // No penetration at any point in the run.
    expect(minToeY, "toe sank through the floor").toBeGreaterThanOrEqual(-0.003);
    expect(minHeelY, "heel sank through the floor").toBeGreaterThanOrEqual(-0.003);
    // Ease + 200 deg/s rate cap: never faster.
    expect(maxFootDegPerSec, "foot rotated faster than the 200 deg/s cap").toBeLessThanOrEqual(210);
    for (const joint of [left["upper1"]!, left["lower1"]!, leftFoot, right["upper1"]!, right["lower1"]!, rightFoot] as const) {
      expect(Math.abs(joint.quaternion.length() - 1), "non-unit quaternion written").toBeLessThan(1e-9);
    }
  });

  it("(4) FLAT-ST control: an already-flat foot is untouched by arrived frames", () => {
    const actorSlot = new THREE.Group();
    const left = buildLegSide(actorSlot, "L", -0.1);
    const right = buildLegSide(actorSlot, "R", 0.1);
    const leftToe = left["toe"] as THREE.Object3D;
    const rightToe = right["toe"] as THREE.Object3D;
    (left["lower1"] as THREE.Object3D).rotation.x = 1.0;
    (right["lower1"] as THREE.Object3D).rotation.x = 1.0;
    actorSlot.updateMatrixWorld(true);
    // World-flat feet (no lift): pose the production contact level with the
    // toe (identity locals are world-pitched by the knee bend AND 30 deg off
    // by the production calibration), then the pass must skip, writing
    // nothing. The knee bend tilts the shin, so pose through the parent like
    // clause (3) does.
    const poseFlat = (foot: THREE.Object3D, side: "L" | "R"): void => {
      poseFootWorld(
        foot,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), levelPitch(side)),
      );
    };
    poseFlat(left["foot"] as THREE.Object3D, "L");
    poseFlat(right["foot"] as THREE.Object3D, "R");
    actorSlot.updateMatrixWorld(true);
    for (const [foot, side, toe] of [
      [left["foot"], "L", leftToe],
      [right["foot"], "R", rightToe],
    ] as const) {
      const dy = heelContactOf(foot as THREE.Object3D, side).y - toeWorld(toe as THREE.Object3D).y;
      expect(Math.abs(dy), "control foot is not level").toBeLessThan(0.0005);
    }
    actorSlot.updateMatrixWorld(true);
    // Seat the slot so both toes rest ~20 mm above the floor datum.
    const seatY = Math.min(toeWorld(leftToe).y, toeWorld(rightToe).y);
    actorSlot.position.y -= seatY - 0.02;
    actorSlot.updateMatrixWorld(true);
    const footLQ0 = (left["foot"] as THREE.Object3D).quaternion.clone();
    const footRQ0 = (right["foot"] as THREE.Object3D).quaternion.clone();
    const toeL0 = toeWorld(leftToe);
    const toeR0 = toeWorld(rightToe);
    const snapshot = snapshotRestStance(
      actorSlot,
      [left["upper1"]!, left["upper2"]!, left["lower1"]!, left["lower2"]!, left["foot"]!],
      [right["upper1"]!, right["upper2"]!, right["lower1"]!, right["lower2"]!, right["foot"]!],
      leftToe,
      rightToe,
    );
    const approach = {
      execution: { phase: "arrived", drive: { locomotion: 0 } },
      actorSlot,
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
      restStance: snapshot,
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

    let maxToeStep = 0;
    for (let frame = 0; frame < 20; frame += 1) {
      const beforeL = toeWorld(leftToe);
      const beforeR = toeWorld(rightToe);
      applyCaseOwnedStanceLock(approach, 1 / 30);
      actorSlot.updateMatrixWorld(true);
      const afterL = toeWorld(leftToe);
      const afterR = toeWorld(rightToe);
      maxToeStep = Math.max(
        maxToeStep,
        Math.hypot(afterL.x - beforeL.x, afterL.y - beforeL.y, afterL.z - beforeL.z),
        Math.hypot(afterR.x - beforeR.x, afterR.y - beforeR.y, afterR.z - beforeR.z),
      );
    }
    expect((left["foot"] as THREE.Object3D).quaternion.equals(footLQ0), "flat left foot was rewritten").toBe(true);
    expect((right["foot"] as THREE.Object3D).quaternion.equals(footRQ0), "flat right foot was rewritten").toBe(true);
    expect(maxToeStep, "flat-stance toes moved").toBeLessThanOrEqual(1e-6);
    const toeL1 = toeWorld(leftToe);
    const toeR1 = toeWorld(rightToe);
    expect(Math.hypot(toeL1.x - toeL0.x, toeL1.z - toeL0.z)).toBeLessThanOrEqual(1e-6);
    expect(Math.hypot(toeR1.x - toeR0.x, toeR1.z - toeR0.z)).toBeLessThanOrEqual(1e-6);
  });
});
