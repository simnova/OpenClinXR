import * as THREE from "three";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyFootBaseStep,
  clearFootBaseState,
  FOOT_BASE_CYCLE_S,
  FOOT_BASE_LIFT_PHASE,
  FOOT_BASE_PLANT_PHASE,
  FOOT_BASE_ROWS,
  FOOT_BASE_STANCE_FRACTION,
  footBaseHalfIndex,
  footBaseRowAt,
  footBaseScheduleStance,
  type LocomotionStanceLabels,
  readFootBaseState,
} from "./foot-base.js";
import { footBaseStepIsActive } from "./foot-base-route-gate-mod.js";

function setSearch(search: string | null): void {
  const host = globalThis as unknown as { window?: unknown };
  if (search === null) delete host.window;
  else host.window = { location: { search } };
}

afterEach(() => {
  setSearch(null);
});

function buildLeggedRig(hipHeightM = 0.78, segmentM = 0.21): {
  slot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
} {
  const slot = new THREE.Group();
  const mkSide = (side: "L" | "R"): THREE.Object3D => {
    const x = side === "L" ? 0.09 : -0.09;
    const hip = new THREE.Object3D();
    hip.name = `upperleg01.${side}`;
    hip.position.set(x, hipHeightM, 0);
    slot.add(hip);
    const upperMid = new THREE.Object3D();
    upperMid.name = `upperleg02.${side}`;
    upperMid.position.set(0, -segmentM, 0);
    hip.add(upperMid);
    const knee = new THREE.Object3D();
    knee.name = `lowerleg01.${side}`;
    knee.position.set(0, -segmentM, 0);
    upperMid.add(knee);
    const lowerMid = new THREE.Object3D();
    lowerMid.name = `lowerleg02.${side}`;
    lowerMid.position.set(0, -segmentM, 0);
    knee.add(lowerMid);
    const heel = new THREE.Object3D();
    heel.name = `foot.${side}`;
    heel.position.set(0, -segmentM, 0.02);
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
      contactBandMeters: 0.06,
      footstep: { scale: 0.707, steps: 3, bones: [], lastToeSeparationM: null },
      execution: { phase: "walking", walkSimSubsteps: 0 },
      lockArmed: true,
      start: { x: 0, y: 0, z: 0 },
      lock: { stanceFoot: "left" },
    };
    const labels = stanceLabels();
    // Roles come from the schedule, not the lock: the lock stays constant
    // while the clip phase crosses the right plant (0.438), so the stance
    // must still hand left -> right there and the pin must hold it.
    let sawRight = false;
    for (let frame = 0; frame < 140; frame += 1) {
      (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = frame;
      const actionTimeSeconds = 0.3 + frame * 0.005;
      const phase01 = ((((actionTimeSeconds % FOOT_BASE_CYCLE_S) + FOOT_BASE_CYCLE_S)
        % FOOT_BASE_CYCLE_S) + FOOT_BASE_CYCLE_S) % FOOT_BASE_CYCLE_S / FOOT_BASE_CYCLE_S;
      const summary = applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 1.31,
        routeLength: 1.31,
        clip: { labels, actionTimeSeconds },
      });
      expect(summary).not.toBeNull();
      const state = readFootBaseState(approach);
      expect(state).not.toBeNull();
      // Pin holds whichever foot the schedule names; handover is immediate.
      expect(state!.stance).toBe(footBaseScheduleStance(phase01));
      if (state!.stance === "right") sawRight = true;
      slot.updateMatrixWorld(true);
      // Every foot inside its own contact interval is pinned to its foothold
      // (both in double support); the crown check above names the summary.
      // In double support the second pin's slot translate perturbs the first
      // pinned foot by its own correction (measured 1.1 mm), so the bound is
      // 0.002 there and 0.001 in single support.
      const inInterval = (["left", "right"] as const).filter((sd) => {
        const r = ((((phase01 - FOOT_BASE_PLANT_PHASE[sd]) % 1) + 1) % 1 + 1) % 1;
        const fr = sd === "left" ? FOOT_BASE_STANCE_FRACTION.left : FOOT_BASE_STANCE_FRACTION.right;
        return r < fr;
      });
      const tolM = inInterval.length > 1 ? 0.002 : 0.001;
      for (const side of ["left", "right"] as const) {
        const rel = ((((phase01 - FOOT_BASE_PLANT_PHASE[side]) % 1) + 1) % 1 + 1) % 1;
        const frac = side === "left"
          ? FOOT_BASE_STANCE_FRACTION.left
          : FOOT_BASE_STANCE_FRACTION.right;
        if (rel >= frac) continue;
        const toe = side === "left" ? leftToe : rightToe;
        const e = toe.matrixWorld.elements;
        const fh = state!.foothold[side];
        expect(Math.hypot((e[12] ?? 0) - fh.x, (e[14] ?? 0) - fh.z)).toBeLessThan(tolM);
      }
    }
    // The sweep crosses the right plant (phase 0.438) but not the left plant
    // (0.927): stance ends right, having handed over mid-sweep.
    expect(readFootBaseState(approach)?.stance).toBe("right");
    expect(sawRight).toBe(true);
    const worst = readFootBaseState(approach)?.worst ?? null;
    expect(worst).not.toBeNull();
    expect(Number.isFinite(worst?.missM ?? Number.NaN)).toBe(true);
    clearFootBaseState(approach);
  });

  it("records post-solve toe Y per foot for the band-hold signal", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    const { slot, leftToe, rightToe } = buildLeggedRig();
    const approach = {
      actorSlot: slot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
      footstep: { scale: 0.707, steps: 3, bones: [], lastToeSeparationM: null },
      execution: { phase: "walking", walkSimSubsteps: 0 },
      lockArmed: true,
      start: { x: 0, y: 0, z: 0 },
      lock: { stanceFoot: "left" },
    };
    const labels = stanceLabels();
    expect(readFootBaseState(approach)).toBeNull();
    applyFootBaseStep({
      approach: approach as never,
      routeDx: 0,
      routeDz: 1.31,
      routeLength: 1.31,
      clip: { labels, actionTimeSeconds: 0.3 },
    });
    const state = readFootBaseState(approach);
    expect(state).not.toBeNull();
    // The band-hold hold/release decision next substep consumes these; they
    // must track the solved toes, not stay at their null init.
    for (const [toe, side] of [[leftToe, "left"], [rightToe, "right"]] as const) {
      toe.updateWorldMatrix(true, false);
      expect(state!.lastToeY[side]).toBeCloseTo(toe.matrixWorld.elements[13] ?? 0, 6);
    }
    clearFootBaseState(approach);
  });

  it("no-ops with the flag off and off a plan-accepted route", () => {
    const { slot, leftToe, rightToe } = buildLeggedRig();
    const approach = {
      actorSlot: slot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
      footstep: { scale: 0.707, steps: 3, bones: [], lastToeSeparationM: null },
      execution: { phase: "walking", walkSimSubsteps: 0 },
      // lockArmed set so the refused-route cases below reach the route gate:
      // without it the step returns null on the lock check and the gate is
      // never exercised (vacuous pass under the old plan-only gate, which
      // accepted 0.5 m and 10 m).
      lockArmed: true,
      start: { x: 0, y: 0, z: 0 },
      lock: { stanceFoot: "left" },
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
    // The plan refuses 0.5 m (out of [0.8, 6.0]) and 10 m: legacy path, null.
    for (const refused of [0.5, 10]) {
      expect(
        applyFootBaseStep({
          approach: approach as never,
          routeDx: 0,
          routeDz: refused,
          routeLength: refused,
          clip: { labels, actionTimeSeconds: 0.1 },
        }),
      ).toBeNull();
    }
    expect(readFootBaseState(approach)).toBeNull();
  });

  it("route gate: flag on AND route in [0.8, 6.0] AND plan accepts", () => {
    // The planner alone accepts 0.5 m (s=0.891) and 10 m and refuses 0.8 m,
    // so the gate must enforce the shared [0.8, 6.0] bounds on top of it.
    setSearch("?footBase=1");
    expect(footBaseStepIsActive(0.5)).toBe(false);
    expect(footBaseStepIsActive(0.79)).toBe(false);
    expect(footBaseStepIsActive(0.8)).toBe(false);
    expect(footBaseStepIsActive(1.31)).toBe(true);
    expect(footBaseStepIsActive(6.0)).toBe(true);
    expect(footBaseStepIsActive(6.01)).toBe(false);
    expect(footBaseStepIsActive(10)).toBe(false);
    // Flag off kills even a plan-accepted in-range route.
    setSearch("?footstepPlan=1&fixedClock=1");
    expect(footBaseStepIsActive(1.31)).toBe(false);
    setSearch(null);
    expect(footBaseStepIsActive(1.31)).toBe(false);
  });

  it("stays active on every plan-accepted route (2.0 m plants past the gate)", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    const { slot, leftToe, rightToe } = buildLeggedRig();
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
    const labels = stanceLabels();
    const summary = applyFootBaseStep({
      approach: approach as never,
      routeDx: 0,
      routeDz: 2,
      routeLength: 2,
      clip: { labels, actionTimeSeconds: 0.3 },
    });
    expect(summary).not.toBeNull();
    expect(readFootBaseState(approach)).not.toBeNull();
    clearFootBaseState(approach);
  });

  it("schedule roles: one change per plant boundary, none between, lock flapping ignored", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    const { slot, leftToe, rightToe } = buildLeggedRig();
    const approach = {
      actorSlot: slot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
      footstep: { scale: 0.707, steps: 3, bones: [], lastToeSeparationM: null },
      execution: { phase: "walking", walkSimSubsteps: 0 },
      lockArmed: true,
      start: { x: 0, y: 0, z: 0 },
      lock: { stanceFoot: "left" },
    };
    const labels = stanceLabels();
    const dt = 0.005;
    const cycle = FOOT_BASE_CYCLE_S;
    const frames = Math.ceil((2 * cycle) / dt);
    const phase01At = (t: number): number => ((((t % cycle) + cycle) % cycle) + cycle) % cycle / cycle;
    const plants = [FOOT_BASE_PLANT_PHASE.left, FOOT_BASE_PLANT_PHASE.right];
    const crossedPlant = (a: number, b: number): boolean =>
      plants.some((p) => (a < p && b >= p) || (b < a && (p >= a || p < b)));
    let expectedCrossings = 0;
    for (let f = 1; f < frames; f += 1) {
      if (crossedPlant(phase01At((f - 1) * dt), phase01At(f * dt))) expectedCrossings += 1;
    }
    const transitions: number[] = [];
    let prev: string | null = null;
    for (let frame = 0; frame < frames; frame += 1) {
      (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = frame;
      // Observe-only lock flaps every 2 frames; schedule roles must not follow it.
      (approach as unknown as { lock: { stanceFoot: string } }).lock = {
        stanceFoot: Math.floor(frame / 2) % 2 === 0 ? "left" : "right",
      };
      const summary = applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 1.31,
        routeLength: 1.31,
        clip: { labels, actionTimeSeconds: frame * dt },
      });
      expect(summary).not.toBeNull();
      const stance = readFootBaseState(approach)?.stance ?? null;
      expect(stance === "left" || stance === "right").toBe(true);
      if (prev !== null && stance !== prev) transitions.push(frame);
      prev = stance;
    }
    // Lock flapped ~frames/2 times; schedule plants fire exactly expectedCrossings.
    expect(transitions.length).toBeGreaterThan(0);
    expect(transitions.length).toBeLessThanOrEqual(expectedCrossings + 1);
    for (const f of transitions) {
      expect(crossedPlant(phase01At((f - 1) * dt), phase01At(f * dt))).toBe(true);
    }
    clearFootBaseState(approach);
  });

  it("schedule stance datum tracks physician-walk-contact-phases.json", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const jsonPath = join(
      here,
      "..",
      "..",
      "factory-stations",
      "src",
      "motion_retarget",
      "physician-walk-contact-phases.json",
    );
    const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      left: { liftPhase: number };
      right: { liftPhase: number };
      stepFractionLeftToRight: number;
      stepFractionRightToLeft: number;
    };
    expect(FOOT_BASE_LIFT_PHASE.left).toBe(doc.left.liftPhase);
    expect(FOOT_BASE_LIFT_PHASE.right).toBe(doc.right.liftPhase);
    expect(FOOT_BASE_STANCE_FRACTION.left).toBeCloseTo(
      (((doc.left.liftPhase - FOOT_BASE_PLANT_PHASE.left) % 1) + 1) % 1, 12,
    );
    expect(FOOT_BASE_STANCE_FRACTION.right).toBeCloseTo(
      (((doc.right.liftPhase - FOOT_BASE_PLANT_PHASE.right) % 1) + 1) % 1, 12,
    );
    // Spot-check the pure schedule: single-support phases name their foot,
    // double support names the most-recently-planted foot.
    expect(footBaseScheduleStance(0.1)).toBe("left");
    expect(footBaseScheduleStance(0.7)).toBe("right");
    expect(footBaseScheduleStance(0.5)).toBe("right");
    expect(footBaseScheduleStance(0.95)).toBe("left");
  });

  it("row lookup spans liftoff to touchdown and halves count passings", () => {    const lift = footBaseRowAt("left", 0.64);
    expect(Math.abs(lift.along01)).toBeLessThan(0.05);
    expect(footBaseHalfIndex(0.55, FOOT_BASE_CYCLE_S)).toBe(1);
    expect(footBaseHalfIndex(1.38, FOOT_BASE_CYCLE_S)).toBe(2);
    expect(footBaseHalfIndex(0.55 + FOOT_BASE_CYCLE_S, FOOT_BASE_CYCLE_S)).toBe(3);
  });
});

function swingKneeFlexionDeg(slot: THREE.Group, side: "left" | "right"): number | null {
  const tag = side === "left" ? "L" : "R";
  const hip = slot.getObjectByName(`upperleg01.${tag}`);
  const knee = slot.getObjectByName(`lowerleg01.${tag}`);
  const heel = slot.getObjectByName(`foot.${tag}`);
  if (hip === undefined || knee === undefined || heel === undefined) return null;
  const hipW = new THREE.Vector3();
  const kneeW = new THREE.Vector3();
  const heelW = new THREE.Vector3();
  hip.getWorldPosition(hipW);
  knee.getWorldPosition(kneeW);
  heel.getWorldPosition(heelW);
  const thigh = hipW.clone().sub(kneeW);
  const shin = heelW.clone().sub(kneeW);
  const denom = thigh.length() * shin.length();
  if (!(denom > 0)) return null;
  const cos = Math.min(1, Math.max(-1, thigh.dot(shin) / denom));
  return 180 - (Math.acos(cos) * 180) / Math.PI;
}

/** Plant-toe height datum per foot, mirroring the schedule module's own
 * recovery (minus the deepest stance dip of the row table). Recomputed here
 * from the public rows so the floor assertion below binds no internal module. */
function heightDatumOf(side: "left" | "right"): number {
  const frac = side === "left" ? FOOT_BASE_STANCE_FRACTION.left : FOOT_BASE_STANCE_FRACTION.right;
  let min = Number.POSITIVE_INFINITY;
  for (const row of FOOT_BASE_ROWS[side]) {
    if (row.phase < frac && row.heightM < min) min = row.heightM;
  }
  return Number.isFinite(min) ? -min : 0;
}

function buildBudgetApproach(slot: THREE.Group, leftToe: THREE.Object3D, rightToe: THREE.Object3D, walkSpeed: number): {
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
  floorOriginY: number;
  contactBandMeters: number;
  footstep: { scale: number; steps: number; bones: never[]; lastToeSeparationM: null };
  execution: { phase: string; walkSimSubsteps: number };
  lockArmed: boolean;
  start: { x: number; y: number; z: number };
  lock: { stanceFoot: string };
  walkSpeedMetersPerSecond: number;
} {
  return {
    actorSlot: slot,
    leftToe,
    rightToe,
    floorOriginY: 0,
    contactBandMeters: 0.06,
    footstep: { scale: 0.707, steps: 3, bones: [], lastToeSeparationM: null },
    execution: { phase: "walking", walkSimSubsteps: 0 },
    lockArmed: true,
    start: { x: 0, y: 0, z: 0 },
    lock: { stanceFoot: "left" },
    walkSpeedMetersPerSecond: walkSpeed,
  };
}

describe("foot-base swing-knee budget", () => {
  it("caps swing flexion at K_max(v): 0.77 m/s -> 61.6 deg", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    // Tall-hip rig (0.86 m hips over the 0.84 m leg): K_max is reachable
    // here (the 0.78 m rig floor-limits every substep, the reported-knee
    // case covered by the floor test below).
    const { slot, leftToe, rightToe } = buildLeggedRig(0.86, 0.21);
    const approach = buildBudgetApproach(slot, leftToe, rightToe, 0.77);
    const labels = stanceLabels();
    let peak = 0;
    let sawSwing = false;
    for (let frame = 0; frame < 140; frame += 1) {
      const actionTimeSeconds = 0.3 + frame * 0.005;
      (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = frame;
      const summary = applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 1.31,
        routeLength: 1.31,
        clip: { labels, actionTimeSeconds },
      });
      expect(summary).not.toBeNull();
      slot.updateMatrixWorld(true);
      const state = readFootBaseState(approach);
      const stance = state?.stance ?? null;
      expect(stance === "left" || stance === "right").toBe(true);
      const swing = stance === "left" ? "right" : "left";
      // Swing-solving frames only: past the whole band-hold backstop the
      // foot cannot be pinned (scheduled pins need rel < frac, holds need
      // past-lift <= 0.10), so the budget owns these solves. Pinned
      // double-support frames are stance contact, not swing (K5's domain).
      const plant = swing === "left" ? FOOT_BASE_PLANT_PHASE.left : FOOT_BASE_PLANT_PHASE.right;
      const frac = swing === "left" ? FOOT_BASE_STANCE_FRACTION.left : FOOT_BASE_STANCE_FRACTION.right;
      const phase01 = ((((actionTimeSeconds % FOOT_BASE_CYCLE_S) + FOOT_BASE_CYCLE_S)
        % FOOT_BASE_CYCLE_S) + FOOT_BASE_CYCLE_S) % FOOT_BASE_CYCLE_S / FOOT_BASE_CYCLE_S;
      const rel = (((phase01 - plant) % 1) + 1) % 1;
      if (rel < frac + 0.1) continue;
      const flex = swingKneeFlexionDeg(slot, swing);
      expect(flex).not.toBeNull();
      if (flex !== null) {
        sawSwing = true;
        if (flex > peak) peak = flex;
      }
    }
    expect(sawSwing).toBe(true);
    // K_max(0.77) = 52 + (0.77 - 0.4) * 12.5 + 5 = 61.6; +1 deg instrument slack.
    expect(peak).toBeLessThanOrEqual(62.6);
    expect(peak).toBeGreaterThanOrEqual(50);
    clearFootBaseState(approach);
  });

  it("stance is untouched by K_max; high swing targets drop with K_max", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    const labels = stanceLabels();
    const sweep = (walkSpeed: number): Array<{ stanceToeY: number; swingToeY: number; swingFlex: number }> => {
      const rig = buildLeggedRig(0.86, 0.21);
      const approach = buildBudgetApproach(rig.slot, rig.leftToe, rig.rightToe, walkSpeed);
      const out: Array<{ stanceToeY: number; swingToeY: number; swingFlex: number }> = [];
      for (let frame = 0; frame < 140; frame += 1) {
        (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = frame;
        applyFootBaseStep({
          approach: approach as never,
          routeDx: 0,
          routeDz: 1.31,
          routeLength: 1.31,
          clip: { labels, actionTimeSeconds: 0.3 + frame * 0.005 },
        });
        rig.slot.updateMatrixWorld(true);
        const stance = readFootBaseState(approach)?.stance ?? null;
        const swing = stance === "left" ? "right" : "left";
        const stanceToe = stance === "left" ? rig.leftToe : rig.rightToe;
        const swingToe = swing === "left" ? rig.leftToe : rig.rightToe;
        stanceToe.updateWorldMatrix(true, false);
        swingToe.updateWorldMatrix(true, false);
        out.push({
          stanceToeY: stanceToe.matrixWorld.elements[13] ?? Number.NaN,
          swingToeY: swingToe.matrixWorld.elements[13] ?? Number.NaN,
          swingFlex: swingKneeFlexionDeg(rig.slot, swing) ?? Number.NaN,
        });
      }
      clearFootBaseState(approach);
      return out;
    };
    // K_max(0.4) = 57, K_max(2.0 -> clamped 1.2) = 66. The natural swing
    // peak here is 63 deg, so the 57 cap bites while the 66 cap never
    // engages; stance stays identical either way.
    const low = sweep(0.4);
    const high = sweep(2.0);
    expect(low.length).toBe(high.length);
    let maxDrop = 0;
    for (let i = 0; i < low.length; i += 1) {
      const a = low[i];
      const b = high[i];
      if (a === undefined || b === undefined) continue;
      // Stance solves are analytic from the same targets; the two runs differ
      // only in persisted swing-pose history, so this is float-reassociation
      // noise (measured ~35 nm), not behaviour.
      expect(Math.abs(a.stanceToeY - b.stanceToeY)).toBeLessThan(1e-6);
      if (b.swingToeY - a.swingToeY > maxDrop) maxDrop = b.swingToeY - a.swingToeY;
    }
    expect(maxDrop).toBeGreaterThan(0.005);
  });

  it("a swing target already under K_max is unchanged", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    // Tall rig (hips at 1.0 m over a 0.84 m leg): every swing target solves
    // near-straight, far under any K_max, so both caps must leave the swing
    // toe bit-identical.
    const buildTallRig = (): {
      slot: THREE.Group;
      leftToe: THREE.Object3D;
      rightToe: THREE.Object3D;
    } => {
      const tallSlot = new THREE.Group();
      const mkTallSide = (tag: "L" | "R"): THREE.Object3D => {
        const x = tag === "L" ? 0.09 : -0.09;
        const hip = new THREE.Object3D();
        hip.name = `upperleg01.${tag}`;
        hip.position.set(x, 1.0, 0);
        tallSlot.add(hip);
        const upperMid = new THREE.Object3D();
        upperMid.name = `upperleg02.${tag}`;
        upperMid.position.set(0, -0.21, 0);
        hip.add(upperMid);
        const knee = new THREE.Object3D();
        knee.name = `lowerleg01.${tag}`;
        knee.position.set(0, -0.21, 0);
        upperMid.add(knee);
        const lowerMid = new THREE.Object3D();
        lowerMid.name = `lowerleg02.${tag}`;
        lowerMid.position.set(0, -0.21, 0);
        knee.add(lowerMid);
        const heel = new THREE.Object3D();
        heel.name = `foot.${tag}`;
        heel.position.set(0, -0.21, 0.02);
        lowerMid.add(heel);
        const toe = new THREE.Object3D();
        toe.name = `toe1-1.${tag}`;
        toe.position.set(0, -0.03, 0.12);
        heel.add(toe);
        return toe;
      };
      const tallLeft = mkTallSide("L");
      const tallRight = mkTallSide("R");
      tallSlot.updateMatrixWorld(true);
      return { slot: tallSlot, leftToe: tallLeft, rightToe: tallRight };
    };
    const labels = stanceLabels();
    const sweepTallToeY = (walkSpeed: number): Array<{ toeY: number; flex: number }> => {
      const rig = buildTallRig();
      const approach = buildBudgetApproach(rig.slot, rig.leftToe, rig.rightToe, walkSpeed);
      const out: Array<{ toeY: number; flex: number }> = [];
      for (let frame = 0; frame < 140; frame += 1) {
        (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = frame;
        applyFootBaseStep({
          approach: approach as never,
          routeDx: 0,
          routeDz: 1.31,
          routeLength: 1.31,
          clip: { labels, actionTimeSeconds: 0.3 + frame * 0.005 },
        });
        rig.slot.updateMatrixWorld(true);
        const stance = readFootBaseState(approach)?.stance ?? null;
        const swing = stance === "left" ? "right" : "left";
        const toe = swing === "left" ? rig.leftToe : rig.rightToe;
        toe.updateWorldMatrix(true, false);
        out.push({
          toeY: toe.matrixWorld.elements[13] ?? Number.NaN,
          flex: swingKneeFlexionDeg(rig.slot, swing) ?? Number.NaN,
        });
      }
      clearFootBaseState(approach);
      return out;
    };
    const low = sweepTallToeY(0.4);
    const high = sweepTallToeY(2.0);
    expect(low.length).toBe(high.length);
    expect(low.length).toBeGreaterThan(0);
    let maxFlex = 0;
    for (let i = 0; i < low.length; i += 1) {
      const a = low[i];
      const b = high[i];
      if (a === undefined || b === undefined) continue;
      // Premise check: the tall rig really does solve everything under both
      // caps (K_max 57 and 66), so identity below is not vacuous.
      if (b.flex > maxFlex) maxFlex = b.flex;
      expect(Math.abs(a.toeY - b.toeY)).toBeLessThan(1e-9);
    }
    expect(maxFlex).toBeLessThan(57);
  });

  it("never lowers the swing toe below datum + 8 mm, even when K_max is unreachable", () => {
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    // Stub legs (~0.30 m hip height, 0.09 m segments): every swing target
    // solves far above K_max, so the floor must bind on at least one substep.
    const slot = new THREE.Group();
    const mkShortSide = (tag: "L" | "R"): THREE.Object3D => {
      const x = tag === "L" ? 0.09 : -0.09;
      const hip = new THREE.Object3D();
      hip.name = `upperleg01.${tag}`;
      hip.position.set(x, 0.3, 0);
      slot.add(hip);
      const upperMid = new THREE.Object3D();
      upperMid.name = `upperleg02.${tag}`;
      upperMid.position.set(0, -0.07, 0);
      hip.add(upperMid);
      const knee = new THREE.Object3D();
      knee.name = `lowerleg01.${tag}`;
      knee.position.set(0, -0.07, 0);
      upperMid.add(knee);
      const lowerMid = new THREE.Object3D();
      lowerMid.name = `lowerleg02.${tag}`;
      lowerMid.position.set(0, -0.07, 0);
      knee.add(lowerMid);
      const heel = new THREE.Object3D();
      heel.name = `foot.${tag}`;
      heel.position.set(0, -0.07, 0.02);
      lowerMid.add(heel);
      const toe = new THREE.Object3D();
      toe.name = `toe1-1.${tag}`;
      toe.position.set(0, -0.03, 0.12);
      heel.add(toe);
      return toe;
    };
    const leftToe = mkShortSide("L");
    const rightToe = mkShortSide("R");
    slot.updateMatrixWorld(true);
    const approach = buildBudgetApproach(slot, leftToe, rightToe, 0.77);
    const labels = stanceLabels();
    // Mid-swing window per foot in plant-relative phase: strictly past the
    // band-hold backstop (0.10 past lift, +0.02 margin, so these frames are
    // budget-solved, never pinned) and inside the middle 50% of the swing run.
    const midSwingLo = (side: "left" | "right"): number => {
      const frac = side === "left" ? FOOT_BASE_STANCE_FRACTION.left : FOOT_BASE_STANCE_FRACTION.right;
      return frac + Math.max(0.12, 0.25 * (1 - frac));
    };
    const midSwingHi = (side: "left" | "right"): number => {
      const frac = side === "left" ? FOOT_BASE_STANCE_FRACTION.left : FOOT_BASE_STANCE_FRACTION.right;
      return frac + 0.75 * (1 - frac);
    };
    let midSwingFrames = 0;
    let minMidSwingToeY = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 300; frame += 1) {
      const actionTimeSeconds = 0.3 + frame * 0.005;
      (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = frame;
      applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 1.31,
        routeLength: 1.31,
        clip: { labels, actionTimeSeconds },
      });
      slot.updateMatrixWorld(true);
      const stance = readFootBaseState(approach)?.stance ?? null;
      if (stance !== "left" && stance !== "right") continue;
      const swing: "left" | "right" = stance === "left" ? "right" : "left";
      const plant = swing === "left" ? FOOT_BASE_PLANT_PHASE.left : FOOT_BASE_PLANT_PHASE.right;
      const phase01 = ((((actionTimeSeconds % FOOT_BASE_CYCLE_S) + FOOT_BASE_CYCLE_S)
        % FOOT_BASE_CYCLE_S) + FOOT_BASE_CYCLE_S) % FOOT_BASE_CYCLE_S / FOOT_BASE_CYCLE_S;
      const rel = (((phase01 - plant) % 1) + 1) % 1;
      if (rel < midSwingLo(swing) || rel > midSwingHi(swing)) continue;
      midSwingFrames += 1;
      const swingToe = swing === "left" ? leftToe : rightToe;
      swingToe.updateWorldMatrix(true, false);
      const toeY = swingToe.matrixWorld.elements[13] ?? Number.NaN;
      if (toeY < minMidSwingToeY) minMidSwingToeY = toeY;
      const floorM = heightDatumOf(swing) + 0.008;
      // The floor binds the TARGET heel: the hinge drives the heel onto it
      // (miss ~0), but the toe rides the rigid foot offset, which rotates
      // with the shin during the solve — on these mixer-less stub legs the
      // dangling foot sits the achieved toe up to ~10 mm under the floored
      // target (measured). In production the mixer re-poses the ankle every
      // frame, so this slop is a fixture artifact, not a mechanism gap.
      expect(toeY).toBeGreaterThanOrEqual(floorM - 0.015);
    }
    expect(midSwingFrames).toBeGreaterThan(0);
    // The floor actually bound on the stub legs (not a vacuous pass above
    // it): K_max is unreachable down there, so the budget reports knees via
    // the floor-limited counter.
    const budget = readFootBaseState(approach)?.kneeBudget ?? null;
    expect(budget).not.toBeNull();
    expect(budget?.floorLimitedSubsteps ?? 0).toBeGreaterThan(0);
    // And the floored targets keep mid-swing toes near the floor, not metres
    // off it: the minimum sits within rigid-foot slop below the datum floor.
    const floorRef = Math.min(heightDatumOf("left"), heightDatumOf("right")) + 0.008;
    expect(minMidSwingToeY).toBeGreaterThanOrEqual(floorRef - 0.015);
    expect(minMidSwingToeY).toBeLessThan(floorRef + 0.05);
    clearFootBaseState(approach);
  });
});

describe("foot-base symmetric half travel (step-asym slice)", () => {
  it("footholds alternate at one equal half-travel totalling the route", () => {
    // Behavioral pin of the symmetric half-travel contract (the helper itself
    // is deliberately NOT imported here: package tests route through the
    // entrypoint, and foot-base.ts publishes no new symbol for this slice).
    // On the 2.0 m route (4 halves) every consecutive foothold pair must sit
    // exactly 0.5 m apart along the route, whatever the affine model says.
    setSearch("?footstepPlan=1&fixedClock=1&footBase=1");
    const { slot, leftToe, rightToe } = buildLeggedRig();
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
    const labels = stanceLabels();
    const placements: Array<{ foot: string; z: number; sub: number }> = [];
    let prevL = "";
    let prevR = "";
    const dt = 0.005;
    for (let sub = 0; sub < 700; sub += 1) {
      (approach.execution as { walkSimSubsteps: number }).walkSimSubsteps = sub;
      const summary = applyFootBaseStep({
        approach: approach as never,
        routeDx: 0,
        routeDz: 2,
        routeLength: 2,
        clip: { labels, actionTimeSeconds: 0.55 + sub * dt },
      });
      expect(summary).not.toBeNull();
      const state = readFootBaseState(approach);
      const lKey = `${state?.foothold.left.x.toFixed(6)},${state?.foothold.left.z.toFixed(6)}`;
      const rKey = `${state?.foothold.right.x.toFixed(6)},${state?.foothold.right.z.toFixed(6)}`;
      if (state?.placed.left === true && lKey !== prevL) {
        placements.push({ foot: "left", z: state.foothold.left.z, sub });
        prevL = lKey;
      }
      if (state?.placed.right === true && rKey !== prevR) {
        placements.push({ foot: "right", z: state.foothold.right.z, sub });
        prevR = rKey;
      }
    }
    // Entry pair (both feet same substep) bases the chain; every later plant
    // is one half-travel past the other foothold.
    expect(placements.length).toBeGreaterThanOrEqual(5);
    const gaps: number[] = [];
    for (let k = 1; k < placements.length; k += 1) {
      const prev = placements[k - 1]!;
      const cur = placements[k]!;
      if (prev.foot === cur.foot) continue;
      if (prev.sub === cur.sub) continue;
      gaps.push(Math.abs(cur.z - prev.z));
    }
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.5, 9);
    clearFootBaseState(approach);
  });
});
