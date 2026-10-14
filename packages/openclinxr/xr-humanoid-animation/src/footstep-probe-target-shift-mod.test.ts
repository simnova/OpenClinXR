import { describe, expect, it } from "vitest";
import { parseFootstepTargetShiftM } from "./footstep-probe-target-shift-mod.js";

describe("the footstep probe target-shift flag", () => {
  it("reads 0 by default and parses signed metres", () => {
    expect(parseFootstepTargetShiftM("?footstepPlan=1")).toBe(0);
    expect(parseFootstepTargetShiftM("?footstepPlan=1&footstepProbeTargetShiftM=0.1")).toBeCloseTo(0.1, 12);
    expect(parseFootstepTargetShiftM("?footstepPlan=1&footstepProbeTargetShiftM=-0.1")).toBeCloseTo(-0.1, 12);
    expect(parseFootstepTargetShiftM("?footstepPlan=1&footstepProbeTargetShiftM=nope")).toBe(0);
  });
});
