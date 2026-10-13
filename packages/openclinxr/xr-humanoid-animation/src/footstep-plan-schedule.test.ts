import { describe, expect, it } from "vitest";
import {
  FOOTSTEP_MIN_SCALE,
  FOOTSTEP_STEP_TRAVEL_M,
  halfCycleTravelMeters,
  planFootsteps,
} from "./footstep-plan-schedule.js";

describe("footstep-plan schedule", () => {
  it("plans SC-05 1.31 m as 3 whole steps at one scale >= 0.7", () => {
    const plan = planFootsteps(1.31);
    if ("refused" in plan) throw new Error(`refused 1.31 m: ${plan.reason}`);
    expect(plan.steps).toBe(3);
    expect(plan.scale).toBeGreaterThanOrEqual(FOOTSTEP_MIN_SCALE);
    expect(plan.scale).toBeLessThanOrEqual(1);
    expect(plan.scale).toBeCloseTo(0.7357, 3);
    expect(plan.plannedTravelM).toBeCloseTo(1.31, 9);
  });

  it("plans the 2.0 m route as 4 whole steps at one scale >= 0.7", () => {
    const plan = planFootsteps(2.0);
    if ("refused" in plan) throw new Error(`refused 2.0 m: ${plan.reason}`);
    expect(plan.steps).toBe(4);
    expect(plan.scale).toBeGreaterThanOrEqual(FOOTSTEP_MIN_SCALE);
    expect(plan.scale).toBeLessThanOrEqual(1);
    expect(plan.scale).toBeCloseTo(0.8425, 3);
    expect(plan.plannedTravelM).toBeCloseTo(2.0, 9);
  });

  it("uses the committed scale-1 step travel, not a per-route fit", () => {
    expect(FOOTSTEP_STEP_TRAVEL_M).toBeCloseTo(0.5935, 4);
    for (const route of [1.31, 2.0]) {
      const plan = planFootsteps(route);
      if ("refused" in plan) throw new Error(`refused ${route} m`);
      expect(plan.plannedTravelM / (plan.steps * FOOTSTEP_STEP_TRAVEL_M)).toBeCloseTo(plan.scale, 12);
    }
  });

  it("refuses a short route that would need a middle step under 0.7", () => {
    const plan = planFootsteps(0.7);
    if (!("refused" in plan)) throw new Error(`planned 0.7 m at scale ${plan.scale}`);
    expect(plan.reason).toMatch(/under 0\.7/);
  });

  it("refuses non-positive route lengths", () => {
    for (const route of [0, -1.31]) {
      const plan = planFootsteps(route);
      if (!("refused" in plan)) throw new Error(`planned ${route} m`);
    }
  });

  it("half-cycle travel is linear in scale from the committed table", () => {
    expect(halfCycleTravelMeters(1)).toBeCloseTo(FOOTSTEP_STEP_TRAVEL_M, 12);
    expect(halfCycleTravelMeters(0)).toBe(0);
    const plan = planFootsteps(1.31);
    if ("refused" in plan) throw new Error(`refused 1.31 m: ${plan.reason}`);
    // k x halfCycleTravel(s) === route by construction.
    expect(plan.steps * halfCycleTravelMeters(plan.scale)).toBeCloseTo(1.31, 9);
  });

  it("D1 check: D1's 0.486 m half maps to effective scale 0.8189 on the table", () => {
    // D1 (s2-lead2 frames 12/28) measured one half-cycle at 0.486 m. The
    // table maps that half to scale 0.486 / 0.5935 = 0.8189, against A's
    // nominal 0.7357 (table prediction 0.4366 m): +11% excess on that half.
    // Fresh-tree s2c-a (n=3, scale 0.7334 certain) confirms the split: odd
    // halves 0.430 m match the table, even halves 0.481 m match D1. This
    // test pins the mapping so a table change breaks loudly; it does not
    // fit the plan to either half (plan stays table-linear).
    expect(halfCycleTravelMeters(0.486 / FOOTSTEP_STEP_TRAVEL_M)).toBeCloseTo(0.486, 9);
    const nominal = planFootsteps(1.31);
    if ("refused" in nominal) throw new Error(`refused 1.31 m: ${nominal.reason}`);
    expect(halfCycleTravelMeters(nominal.scale)).toBeCloseTo(0.4366, 3);
  });
});
