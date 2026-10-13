import { describe, expect, it } from "vitest";
import {
  parseFootstepPlanEnabled,
  parseFootstepRouteMeters,
} from "./footstep-plan-query-flag-mod.js";

describe("footstep-plan query flags", () => {
  it("opts in only on exactly footstepPlan=1", () => {
    expect(parseFootstepPlanEnabled("?footstepPlan=1")).toBe(true);
    expect(parseFootstepPlanEnabled("")).toBe(false);
    expect(parseFootstepPlanEnabled("?footstepPlan=0")).toBe(false);
    expect(parseFootstepPlanEnabled("?footstepPlan=1&noStanceLock=1")).toBe(true);
  });

  it("honors only the 2.0 m second route", () => {
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=2")).toBe(2);
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=2.0")).toBe(2);
    expect(parseFootstepRouteMeters("?footstepPlan=1")).toBeNull();
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=3")).toBeNull();
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=6")).toBeNull();
  });
});
