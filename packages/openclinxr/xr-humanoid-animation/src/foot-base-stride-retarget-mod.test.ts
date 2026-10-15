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

  it("no-ops with the flag off and off the 1.31 m route", () => {
    const { slot, leftToe, rightToe } = buildLeggedRig();
    const approach = {
      actorSlot: slot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
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
