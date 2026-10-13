import { describe, expect, it } from "vitest";
import {
  FOOTSTEP_MIN_SCALE,
  FOOTSTEP_STEP_TRAVEL_M,
  FOOTSTEP_SWING_FLOOR_SCALE,
  planFootsteps,
} from "./footstep-plan-schedule.js";

describe("footstep-plan schedule", () => {
  it("plans SC-05 1.31 m as freeze + two full middles + shortfall + close", () => {
    const plan = planFootsteps(1.31);
    if ("refused" in plan) throw new Error(`refused 1.31 m: ${plan.reason}`);
    expect(plan.halves.map((h) => h.foot)).toEqual(["right", "left", "right", "left", "right", "left"]);
    expect(plan.halves.map((h) => h.scale)[0]).toBe(0);
    expect(plan.halves.map((h) => h.scale).slice(1, 3)).toEqual([1, 1]);
    expect(plan.halves[3]!.scale).toBeCloseTo(0.4169, 3);
    expect(plan.halves.slice(4).map((h) => h.scale)).toEqual([0, 0]);
    const round3 = (values: number[]): number[] => values.map((v) => Math.round(v * 1000) / 1000);
    expect(plan.legs.left.map((a) => a.scale)).toEqual([1, plan.halves[3]!.scale, 0]);
    expect(round3(plan.legs.left.map((a) => a.atS))).toEqual([0.419, 2.127, 3.835]);
    expect(plan.legs.right.map((a) => a.scale)).toEqual([1, 0]);
    expect(round3(plan.legs.right.map((a) => a.atS))).toEqual([1.114, 2.822]);
    expect(plan.clipSpanS).toBeCloseTo(4.335, 2);
    expect(plan.plannedTravelM).toBeCloseTo(1.31, 9);
  });

  it("plans the 2.0 m route with three full middles", () => {
    const plan = planFootsteps(2.0);
    if ("refused" in plan) throw new Error(`refused 2.0 m: ${plan.reason}`);
    expect(plan.halves.length).toBe(7);
    expect(plan.halves.map((h) => h.scale).slice(1, 4)).toEqual([1, 1, 1]);
    expect(plan.halves[4]!.scale).toBeCloseTo(0.5794, 3);
    expect(plan.halves[4]!.scale).toBeGreaterThanOrEqual(FOOTSTEP_SWING_FLOOR_SCALE);
    expect(plan.legs.left.map((a) => a.scale)).toEqual([1, 1, 0]);
    expect(plan.legs.right[0]!.scale).toBe(1);
    expect(plan.legs.right[1]!.scale).toBeCloseTo(0.5794, 3);
    expect(plan.legs.right[2]!.scale).toBe(0);
    expect(plan.clipSpanS).toBeCloseTo(5.03, 2);
    expect(plan.plannedTravelM).toBeCloseTo(2.0, 9);
  });

  it("uses the committed scale-1 step travel, not a per-route fit", () => {
    expect(FOOTSTEP_STEP_TRAVEL_M).toBeCloseTo(0.5935, 4);
  });

  it("feeds a sub-floor last step from the middles, conserving travel", () => {
    const plan = planFootsteps(0.5);
    if ("refused" in plan) throw new Error(`refused 0.5 m: ${plan.reason}`);
    expect(plan.halves.map((h) => h.scale)[0]).toBe(0);
    expect(plan.halves[1]!.scale).toBeCloseTo(0.7241, 3);
    expect(plan.halves[1]!.scale).toBeGreaterThanOrEqual(FOOTSTEP_MIN_SCALE);
    expect(plan.halves[2]!.scale).toBeCloseTo(0.27, 3);
    expect(plan.legs.left[0]!.scale).toBeCloseTo(0.7241, 3);
    expect(plan.legs.right[0]!.scale).toBeCloseTo(0.27, 3);
    expect(plan.plannedTravelM).toBeCloseTo(0.5, 9);
  });

  it("refuses a route that leaves nothing but a sub-floor stub", () => {
    const plan = planFootsteps(0.01);
    if (!("refused" in plan)) throw new Error("planned a 1 cm route");
    expect(plan.reason).toMatch(/swing floor/);
  });

  it("refuses non-positive route lengths", () => {
    for (const route of [0, -1.31]) {
      const plan = planFootsteps(route);
      if (!("refused" in plan)) throw new Error(`planned ${route} m`);
    }
  });
});
