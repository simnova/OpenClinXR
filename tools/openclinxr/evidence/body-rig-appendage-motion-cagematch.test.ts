import { describe, expect, it } from "vitest";
import { classifyBodyRigMotionRegion } from "./body-rig-appendage-motion-cagematch.js";

describe("body rig appendage motion region classifier", () => {
  it("classifies Blender and MPFB side-suffixed appendage bones", () => {
    expect(classifyBodyRigMotionRegion("upper_arm.L")).toBe("leftArm");
    expect(classifyBodyRigMotionRegion("forearm.R")).toBe("rightArm");
    expect(classifyBodyRigMotionRegion("upperarm01.L")).toBe("leftArm");
    expect(classifyBodyRigMotionRegion("lowerarm01.R")).toBe("rightArm");
    expect(classifyBodyRigMotionRegion("thigh.L")).toBe("leftLeg");
    expect(classifyBodyRigMotionRegion("shin.R")).toBe("rightLeg");
    expect(classifyBodyRigMotionRegion("upperleg01.L")).toBe("leftLeg");
    expect(classifyBodyRigMotionRegion("lowerleg01.R")).toBe("rightLeg");
    expect(classifyBodyRigMotionRegion("neck01")).toBe("head");
    expect(classifyBodyRigMotionRegion("spine02")).toBe("torso");
  });
});
