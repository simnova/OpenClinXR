import { describe, expect, it } from "vitest";
import {
  planSteppingTurn,
  STEPPING_TURN_STEP_DURATION_S,
  steppingTurnAt,
} from "./stepping-turn.js";

/**
 * M1-measured walk-start idle toe fore offset, body frame (rest-before-*
 * captures: +0.1166 both toes, runs/routes/flags agree to 4 decimals).
 * Literal here (not the module constant) so this test binds no new public
 * name; the module remains the single owner of the value.
 */
const REST_FORE_M = 0.1166;

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

  it("lands placements body-centered: each swing mirrors its stance across the slot end", () => {
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
    // Spread sanity (no lunges), unchanged.
    const spread = Math.hypot(last.swingToXz.x - last.stanceXz.x, last.swingToXz.z - last.stanceXz.z);
    expect(spread).toBeGreaterThan(0.15);
    expect(spread).toBeLessThan(0.4);
    // Mirror property on every step: goal + stance == 2 * slot end, so the pair
    // centers exactly under the pelvis on every landing. Orientation follows the
    // entry (a fore/aft split reads as a gathered step): squareness is not
    // promised, centering is. (2026-10-11: lateral-square goals left the midpoint
    // 0.209 m off on the SC-05 browser entry — the pelvis-behind-feet lean — while
    // mirror holds it by construction.)
    let slotEach = { x: 0, z: 0 };
    for (const step of plan.steps) {
      const dx = slotEach.x - step.stanceXz.x;
      const dz = slotEach.z - step.stanceXz.z;
      const cos = Math.cos(step.yawRadians);
      const sin = Math.sin(step.yawRadians);
      const slotEnd = {
        x: step.stanceXz.x + dx * cos + dz * sin,
        z: step.stanceXz.z - dx * sin + dz * cos,
      };
      expect(step.swingToXz.x).toBeCloseTo(2 * slotEnd.x - step.stanceXz.x, 9);
      expect(step.swingToXz.z).toBeCloseTo(2 * slotEnd.z - step.stanceXz.z, 9);
      slotEach = slotEnd;
    }
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
    // Pelvis dip: 0 at the entry (hold ramps in), 0.015 swing dip plus the full
    // 0.02 hold once ramped (mid-step here is past the 0.3 s ramp), hold at the end.
    expect(start.pelvisDipM).toBeCloseTo(0, 12);
    expect(mid.pelvisDipM).toBeCloseTo(0.015 + 0.02, 3);
    expect(steppingTurnAt(plan, plan.totalS).pelvisDipM).toBeCloseTo(0.02, 9);
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

  it("lands the final step at its absolute rest offset (not mirrored, not beside)", () => {
    const restSepM = 0.22;
    const plan = planSteppingTurn({
      residualYawRadians: 62.67 * DEG,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: ENTRY_YAW + 62.67 * DEG,
      leftToeXz: LEFT,
      rightToeXz: RIGHT,
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
      entrySlotXz: { x: 0, z: 0 },
      legScale: 1,
      restSepM,
    });
    const [first, last] = plan.steps;
    if (!first || !last) throw new Error("expected 2 steps");
    // Non-final steps land at rest in their OWN end frame (rotations compose,
    // so the foot is still at rest in the final frame): step 0 swings right.
    expect(first.swingFoot).toBe("right");
    const slotEach = { x: 0, z: 0 };
    const cos0 = Math.cos(first.yawRadians);
    const sin0 = Math.sin(first.yawRadians);
    const slotEnd0 = {
      x: first.stanceXz.x + (slotEach.x - first.stanceXz.x) * cos0 + (slotEach.z - first.stanceXz.z) * sin0,
      z: first.stanceXz.z - (slotEach.x - first.stanceXz.x) * sin0 + (slotEach.z - first.stanceXz.z) * cos0,
    };
    const midYaw = ENTRY_YAW + first.yawRadians;
    const midCos = Math.cos(midYaw);
    const midSin = Math.sin(midYaw);
    const firstB = {
      lat: (first.swingToXz.x - slotEnd0.x) * midCos - (first.swingToXz.z - slotEnd0.z) * midSin,
      fore: (first.swingToXz.x - slotEnd0.x) * midSin + (first.swingToXz.z - slotEnd0.z) * midCos,
    };
    expect(firstB.lat).toBeCloseTo(-restSepM / 2, 9);
    expect(firstB.fore).toBeCloseTo(REST_FORE_M, 9);
    // Final landing in the end frame: anatomical-side lateral ±sep/2 and the
    // measured rest fore offset (positive residual ends swinging left).
    const endYaw = ENTRY_YAW + 62.67 * DEG;
    const cos = Math.cos(endYaw);
    const sin = Math.sin(endYaw);
    let slot = { x: 0, z: 0 };
    for (const step of plan.steps) {
      const dx = slot.x - step.stanceXz.x;
      const dz = slot.z - step.stanceXz.z;
      const c = Math.cos(step.yawRadians);
      const s = Math.sin(step.yawRadians);
      slot = {
        x: step.stanceXz.x + dx * c + dz * s,
        z: step.stanceXz.z - dx * s + dz * c,
      };
    }
    const body = (p: { x: number; z: number }): { lat: number; fore: number } => ({
      lat: (p.x - slot.x) * cos - (p.z - slot.z) * sin,
      fore: (p.x - slot.x) * sin + (p.z - slot.z) * cos,
    });
    expect(last.swingFoot).toBe("left");
    const swingB = body(last.swingToXz);
    expect(swingB.lat).toBeCloseTo(restSepM / 2, 9);
    expect(swingB.fore).toBeCloseTo(REST_FORE_M, 9);
  });

  it("keeps the mirror on the final step for an invalid rest separation", () => {
    for (const restSepM of [0, -0.2, null, undefined]) {
      const plan = planSteppingTurn({
        residualYawRadians: 30 * DEG,
        entryYawRadians: ENTRY_YAW,
        targetHeadingRadians: ENTRY_YAW + 30 * DEG,
        leftToeXz: LEFT,
        rightToeXz: RIGHT,
        leftToeY: 0.016,
        rightToeY: 0.016,
        stanceBaselineY: 0.016,
        entrySlotXz: { x: 0, z: 0 },
        legScale: 1,
        restSepM: restSepM ?? null,
      });
      expect(plan.steps.length).toBe(1);
      const only = plan.steps[0];
      if (!only) throw new Error("expected 1 step");
      const cos = Math.cos(only.yawRadians);
      const sin = Math.sin(only.yawRadians);
      const slotEnd = {
        x: only.stanceXz.x + (0 - only.stanceXz.x) * cos + (0 - only.stanceXz.z) * sin,
        z: only.stanceXz.z - (0 - only.stanceXz.x) * sin + (0 - only.stanceXz.z) * cos,
      };
      expect(only.swingToXz.x).toBeCloseTo(2 * slotEnd.x - only.stanceXz.x, 9);
      expect(only.swingToXz.z).toBeCloseTo(2 * slotEnd.z - only.stanceXz.z, 9);
    }
  });

  it("lands a single-step turn at its rest offset too (the one step is the final step)", () => {
    const restSepM = 0.22;
    const plan = planSteppingTurn({
      residualYawRadians: 30 * DEG,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: ENTRY_YAW + 30 * DEG,
      leftToeXz: LEFT,
      rightToeXz: RIGHT,
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
      entrySlotXz: { x: 0, z: 0 },
      legScale: 1,
      restSepM,
    });
    expect(plan.steps.length).toBe(1);
    const only = plan.steps[0];
    if (!only) throw new Error("expected 1 step");
    // Positive residual: the single step swings right.
    expect(only.swingFoot).toBe("right");
    const endYaw = ENTRY_YAW + 30 * DEG;
    const cos = Math.cos(endYaw);
    const sin = Math.sin(endYaw);
    const c = Math.cos(only.yawRadians);
    const s = Math.sin(only.yawRadians);
    const slot = {
      x: only.stanceXz.x + (0 - only.stanceXz.x) * c + (0 - only.stanceXz.z) * s,
      z: only.stanceXz.z - (0 - only.stanceXz.x) * s + (0 - only.stanceXz.z) * c,
    };
    const body = (p: { x: number; z: number }): { lat: number; fore: number } => ({
      lat: (p.x - slot.x) * cos - (p.z - slot.z) * sin,
      fore: (p.x - slot.x) * sin + (p.z - slot.z) * cos,
    });
    const swingB = body(only.swingToXz);
    expect(swingB.lat).toBeCloseTo(-restSepM / 2, 9);
    expect(swingB.fore).toBeCloseTo(REST_FORE_M, 9);
  });

  it("misses the rest fore when the fore offset is dropped (the G5 probe twin)", () => {
    // restForeM = 0 must NOT land on the rest fore: this assertion goes red
    // here exactly when the capture probe (fore → 0 ⇒ G1 red) goes red there.
    const plan = planSteppingTurn({
      residualYawRadians: 30 * DEG,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: ENTRY_YAW + 30 * DEG,
      leftToeXz: LEFT,
      rightToeXz: RIGHT,
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
      entrySlotXz: { x: 0, z: 0 },
      legScale: 1,
      restSepM: 0.22,
      restForeM: 0,
    });
    expect(plan.steps.length).toBe(1);
    const only = plan.steps[0];
    if (!only) throw new Error("expected 1 step");
    const endYaw = ENTRY_YAW + 30 * DEG;
    const cos = Math.cos(endYaw);
    const sin = Math.sin(endYaw);
    const c = Math.cos(only.yawRadians);
    const s = Math.sin(only.yawRadians);
    const slot = {
      x: only.stanceXz.x + (0 - only.stanceXz.x) * c + (0 - only.stanceXz.z) * s,
      z: only.stanceXz.z - (0 - only.stanceXz.x) * s + (0 - only.stanceXz.z) * c,
    };
    const fore =
      (only.swingToXz.x - slot.x) * sin + (only.swingToXz.z - slot.z) * cos;
    expect(fore).toBeCloseTo(0, 9);
    expect(fore).not.toBeCloseTo(REST_FORE_M, 1);
  });
});
