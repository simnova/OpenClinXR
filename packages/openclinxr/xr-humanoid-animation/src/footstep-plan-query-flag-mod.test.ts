import { describe, expect, it } from "vitest";
import {
  parseFootstepPlanEnabled,
  parseFootstepRouteMeters,
} from "./footstep-plan.js";

describe("footstep-plan query flags", () => {
  it("opts out only on exactly footstepPlan=0", () => {
    expect(parseFootstepPlanEnabled("?footstepPlan=1")).toBe(true);
    expect(parseFootstepPlanEnabled("")).toBe(true);
    expect(parseFootstepPlanEnabled("?footstepPlan=0")).toBe(false);
    expect(parseFootstepPlanEnabled("?footstepPlan=1&noStanceLock=1")).toBe(true);
    expect(parseFootstepPlanEnabled("?footstepPlan=0&noStanceLock=1")).toBe(false);
  });

  it("honors any route in [0.8, 6.0] m", () => {
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=2")).toBe(2);
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=2.0")).toBe(2);
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=0.8")).toBe(0.8);
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=6")).toBe(6);
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=3.25")).toBe(3.25);
    expect(parseFootstepRouteMeters("?footstepPlan=1")).toBeNull();
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=0.79")).toBeNull();
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=6.01")).toBeNull();
    expect(parseFootstepRouteMeters("?footstepPlan=1&footstepRouteM=nope")).toBeNull();
  });

  it("route extension gate: flag plus a route in range", () => {
    // Node-testable composition of the two parsers: the runtime gate twin
    // (footstepRouteExtensionForTest, kept off the public surface) is
    // flag-enabled && routeM in [0.8, 6.0], so these cases pin it here.
    const gated = (search: string): number | null =>
      parseFootstepPlanEnabled(search) ? parseFootstepRouteMeters(search) : null;
    expect(gated("?footstepPlan=1&footstepRouteM=2")).toBe(2);
    expect(gated("?footstepPlan=1&footstepRouteM=4.5")).toBe(4.5);
    expect(gated("?footstepPlan=1")).toBeNull();
    expect(gated("?footstepPlan=0&footstepRouteM=2")).toBeNull(); // default-flip: opt-out restores inert route (evidence: .openclinxr/evidence/default-readiness/RESULT.json, .openclinxr/evidence/rig-aware/RESULT.json)
    expect(gated("?footstepPlan=1&footstepRouteM=7")).toBeNull();
  });
});
