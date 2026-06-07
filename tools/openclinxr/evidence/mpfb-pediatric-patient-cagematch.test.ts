import { describe, expect, it } from "vitest";

import { decideHumanoidSourcePath, PEDS_ASTHMA_PATIENT_DECISION_INPUT } from "../factory/humanoid-source-decision-tree.js";

describe("mpfb-pediatric-patient-cagematch", () => {
  it("keeps Anny as primary for case-driven pediatric patient even when MPFB probe runs", () => {
    const decision = decideHumanoidSourcePath({
      ...PEDS_ASTHMA_PATIENT_DECISION_INPUT,
      requiresMpfbStandardRigOrShapekeys: true,
    });
    expect(decision.recommendedPath).toBe("anny_parametric_forward_pass");
    expect(decision.fallbacks).toContain("mpfb_makehuman_basemesh");
  });
});