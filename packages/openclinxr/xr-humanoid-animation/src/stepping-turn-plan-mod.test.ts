import { describe, expect, it } from "vitest";
import {
  planSteppingTurn,
  STEPPING_TURN_MAX_STEP_YAW_RADIANS,
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

  it("rotates placements about the stance foot, gathering a wide split to shoulder width", () => {
    const plan = planFor(62.67);
    const [first, second] = plan.steps;
    if (!first || !second) throw new Error("expected 2 steps");
    // Entry split is 0.2 m here (LEFT/RIGHT fixtures), under shoulder width: pure rotation.
    for (const step of plan.steps) {
      const before = Math.hypot(step.swingFromXz.x - step.stanceXz.x, step.swingFromXz.z - step.stanceXz.z);
      const after = Math.hypot(step.swingToXz.x - step.stanceXz.x, step.swingToXz.z - step.stanceXz.z);
      expect(after).toBeCloseTo(before, 12);
      expect(Math.abs(step.yawRadians)).toBeLessThanOrEqual(STEPPING_TURN_MAX_STEP_YAW_RADIANS + 1e-9);
    }
    // A mid-stride entry split (0.5 m) gathers to shoulder width instead of pivoting wide.
    const wide = planSteppingTurn({
      residualYawRadians: 62.67 * DEG,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: TARGET_YAW,
      leftToeXz: { x: -0.25, z: 0.2 },
      rightToeXz: { x: 0.25, z: -0.2 },
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
    });
    for (const step of wide.steps) {
      const after = Math.hypot(step.swingToXz.x - step.stanceXz.x, step.swingToXz.z - step.stanceXz.z);
      expect(after).toBeLessThanOrEqual(0.3 + 1e-9);
    }
    expect(first.swingToXz.x).toBeDefined();
    expect(second.stanceXz.x).toBeCloseTo(first.swingToXz.x, 12);
  });

  it("ends every swing exactly on its placement, including gathered ones", () => {
    const wide = planSteppingTurn({
      residualYawRadians: 62.67 * DEG,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: TARGET_YAW,
      leftToeXz: { x: -0.25, z: 0.2 },
      rightToeXz: { x: 0.25, z: -0.2 },
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
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
  });

  it("hands Y off continuously: step 0 keeps live heights, later steps continue them", () => {
    // Right foot (first swing for a positive residual) lifts from 0.05, left pins at 0.02.
    const plan = planFor(62.67, 0.02, 0.05);
    const [first, second] = plan.steps;
    if (!first || !second) throw new Error("expected 2 steps");
    expect(first.swingFromY).toBeCloseTo(0.05, 12);
    expect(first.stanceY).toBeCloseTo(0.02, 12);
    // Step 1's swing foot was step 0's stance: leaves from the hold it just left.
    expect(second.swingFromY).toBeCloseTo(first.stanceY, 12);
    // Step 1's stance foot was step 0's swing: holds what it landed at (baseline).
    expect(second.stanceY).toBeCloseTo(0.016, 12);
    // Evaluator continuous across the boundary for both feet.
    const before = steppingTurnAt(plan, first.durationS - 1e-4);
    const after = steppingTurnAt(plan, first.durationS + 1e-4);
    const beforeYs = [before.stanceToe.y, before.swingToe.y].sort((a, b) => a - b);
    const afterYs = [after.stanceToe.y, after.swingToe.y].sort((a, b) => a - b);
    for (let i = 0; i < 2; i += 1) {
      expect(afterYs[i]).toBeCloseTo(beforeYs[i] ?? 0, 2);
    }
  });
});
