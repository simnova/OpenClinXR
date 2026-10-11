import { describe, expect, it } from "vitest";
import {
  planSteppingTurn,
  STEPPING_TURN_STEP_DURATION_S,
  steppingTurnAt,
} from "./stepping-turn-plan-mod.js";

const DEG = Math.PI / 180;
const ENTRY_YAW = (117.33 * Math.PI) / 180;
const TARGET_YAW = ENTRY_YAW + 62.67 * DEG;
const LEFT = { x: -0.1, z: 0 };
const RIGHT = { x: 0.1, z: 0 };

function planFor(residualDeg: number, leftY = 0.016, rightY = 0.016) {
  return planSteppingTurn({
    residualYawRadians: residualDeg * DEG,
    entryYawRadians: ENTRY_YAW,
    targetHeadingRadians: ENTRY_YAW + residualDeg * DEG,
    leftToeXz: LEFT,
    rightToeXz: RIGHT,
    leftToeY: leftY,
    rightToeY: rightY,
    stanceBaselineY: 0.016,
    entrySlotXz: { x: 0, z: 0 },
    legScale: 1,
  });
}

describe("the stepping-turn plan", () => {
  it("plans 2 steps for the 62.67 deg SC-05 residual (and for <= 90 deg)", () => {
    expect(planFor(62.67).steps.length).toBe(2);
    expect(planFor(90).steps.length).toBe(2);
    expect(planFor(1).steps.length).toBe(1);
    expect(planFor(91).steps.length).toBe(3);
    expect(planFor(135).steps.length).toBe(3);
  });

  it("swings the inner foot first and alternates (right-first for a positive residual)", () => {
    const plan = planFor(62.67);
    expect(plan.steps[0]?.swingFoot).toBe("right");
    expect(plan.steps[0]?.stanceFoot).toBe("left");
    expect(plan.steps[1]?.swingFoot).toBe("left");
    expect(plan.steps[1]?.stanceFoot).toBe("right");
    const mirrored = planFor(-62.67);
    expect(mirrored.steps[0]?.swingFoot).toBe("left");
    expect(mirrored.steps[1]?.swingFoot).toBe("right");
  });

  it("lands exactly on the target heading (last step takes the remainder)", () => {
    for (const residual of [62.67, 90, 91, 30, -62.67, 7.5]) {
      const plan = planFor(residual);
      const total = plan.steps.reduce((sum, s) => sum + s.yawRadians, 0);
      expect(total).toBeCloseTo(residual * DEG, 12);
      const end = steppingTurnAt(plan, plan.totalS);
      expect(end.yawRadians).toBeCloseTo(ENTRY_YAW + residual * DEG, 9);
      expect(end.done).toBe(true);
    }
  });

  it("pins each stance foot for its step and chains steps foot-to-foot", () => {
    const plan = planFor(62.67);
    const [first, second] = plan.steps;
    if (!first || !second) throw new Error("expected 2 steps");
    // Stance fixed within the step: evaluator agrees at both ends (the exact
    // boundary instant already belongs to the next step, so sample just inside).
    expect(steppingTurnAt(plan, 0).stanceToe.x).toBeCloseTo(first.stanceXz.x, 12);
    expect(steppingTurnAt(plan, first.durationS - 1e-4).stanceToe.x).toBeCloseTo(first.stanceXz.x, 9);
    // Step 2 pivots about step 1's placement.
    expect(second.stanceXz.x).toBeCloseTo(first.swingToXz.x, 12);
    expect(second.stanceXz.z).toBeCloseTo(first.swingToXz.z, 12);
    expect(second.swingFromXz.x).toBeCloseTo(first.stanceXz.x, 12);
  });

  it("lands placements body-centered: pair under the predicted slot, square, shoulder width", () => {
    const plan = planFor(62.67);
    const last = plan.steps[plan.steps.length - 1];
    if (!last) throw new Error("expected steps");
    // Predicted slot at hold: rigid arcs about each stance (stance-pin closed form).
    let slot = { x: 0, z: 0 };
    for (const step of plan.steps) {
      const dx = slot.x - step.stanceXz.x;
      const dz = slot.z - step.stanceXz.z;
      const cos = Math.cos(step.yawRadians);
      const sin = Math.sin(step.yawRadians);
      slot = {
        x: step.stanceXz.x + dx * cos + dz * sin,
        z: step.stanceXz.z - dx * sin + dz * cos,
      };
    }
    const pairMid = {
      x: (last.stanceXz.x + last.swingToXz.x) / 2,
      z: (last.stanceXz.z + last.swingToXz.z) / 2,
    };
    expect(Math.hypot(pairMid.x - slot.x, pairMid.z - slot.z)).toBeLessThan(0.03);
    // Shoulder width and square to the final heading.
    const spread = Math.hypot(last.swingToXz.x - last.stanceXz.x, last.swingToXz.z - last.stanceXz.z);
    expect(spread).toBeGreaterThan(0.15);
    expect(spread).toBeLessThan(0.4);
    const targetYaw = ENTRY_YAW + 62.67 * DEG;
    const facing = { x: Math.sin(targetYaw), z: Math.cos(targetYaw) };
    const inter = {
      x: last.swingToXz.x - last.stanceXz.x,
      z: last.swingToXz.z - last.stanceXz.z,
    };
    const along = Math.abs(inter.x * facing.x + inter.z * facing.z) / Math.max(1e-9, spread);
    expect(along).toBeLessThan(0.35);
  });

  it("ends every swing exactly on its placement", () => {
    const wide = planSteppingTurn({
      residualYawRadians: 62.67 * DEG,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: TARGET_YAW,
      leftToeXz: { x: -0.25, z: 0.2 },
      rightToeXz: { x: 0.25, z: -0.2 },
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
      entrySlotXz: { x: 0, z: 0 },
      legScale: 1,
    });
    for (const step of wide.steps) {
      // Just inside the step's end the evaluated swing sits on the planned placement
      // (the next step's stance for step 0): no boundary teleport.
      const end = steppingTurnAt(wide, step.startS + step.durationS - 1e-4);
      expect(end.swingToe.x).toBeCloseTo(step.swingToXz.x, 2);
      expect(end.swingToe.z).toBeCloseTo(step.swingToXz.z, 2);
    }
  });

  it("times each step at 0.7 s and lifts the swing foot mid-step", () => {
    const plan = planFor(62.67);
    expect(plan.totalS).toBeCloseTo(1.4, 12);
    for (const step of plan.steps) expect(step.durationS).toBe(STEPPING_TURN_STEP_DURATION_S);
    const mid = steppingTurnAt(plan, STEPPING_TURN_STEP_DURATION_S / 2);
    expect(mid.swingToe.y).toBeGreaterThanOrEqual(0.016 + 0.02);
    expect(mid.u).toBeCloseTo(0.5, 12);
    const start = steppingTurnAt(plan, 0);
    expect(start.swingToe.y).toBeCloseTo(0.016, 12);
    expect(start.stanceToe.y).toBeCloseTo(0.016, 12);
    // Pelvis dip: 0 at placements, 0.015 peak mid-step.
    expect(start.pelvisDipM).toBeCloseTo(0, 12);
    expect(mid.pelvisDipM).toBeCloseTo(0.015, 3);
    expect(steppingTurnAt(plan, plan.totalS).pelvisDipM).toBeCloseTo(0, 9);
  });

  it("hands Y off continuously: step 0 keeps live heights, later steps continue them", () => {
    // Right foot (first swing for a positive residual) lifts from 0.05, left pins at 0.02.
    const plan = planFor(62.67, 0.02, 0.05);
    const [first, second] = plan.steps;
    if (!first || !second) throw new Error("expected 2 steps");
    expect(first.swingFromY).toBeCloseTo(0.05, 12);
    expect(first.stanceY).toBeCloseTo(0.02, 12);
    // Step 1's swing foot was step 0's stance: it leaves from the baseline the morphed
    // stance hold ended at (not the live height the hold started at).
    expect(second.swingFromY).toBeCloseTo(0.016, 12);
    // Step 1's stance foot was step 0's swing: holds what it landed at (baseline).
    expect(second.stanceY).toBeCloseTo(0.016, 12);
    // Step 0's stance morphs live -> baseline across the step (plants, no snap).
    expect(steppingTurnAt(plan, 0).stanceToe.y).toBeCloseTo(0.02, 12);
    expect(steppingTurnAt(plan, first.durationS - 1e-4).stanceToe.y).toBeCloseTo(0.016, 2);
    // Evaluator continuous across the boundary for both feet.
    const before = steppingTurnAt(plan, first.durationS - 1e-4);
    const after = steppingTurnAt(plan, first.durationS + 1e-4);
    const beforeYs = [before.stanceToe.y, before.swingToe.y].sort((a, b) => a - b);
    const afterYs = [after.stanceToe.y, after.swingToe.y].sort((a, b) => a - b);
    for (let i = 0; i < 2; i += 1) {
      expect(afterYs[i]).toBeCloseTo(beforeYs[i] ?? 0, 2);
    }
  });

  it("plans a single step for a 30 deg residual", () => {
    expect(planFor(30).steps.length).toBe(1);
  });
});
