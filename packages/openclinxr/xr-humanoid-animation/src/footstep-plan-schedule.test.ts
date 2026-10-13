import { describe, expect, it } from "vitest";
import {
  FOOTSTEP_MIN_SCALE,
  FOOTSTEP_STEP_TRAVEL_M,
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
});
