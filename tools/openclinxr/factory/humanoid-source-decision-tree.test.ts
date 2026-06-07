import { describe, expect, it } from "vitest";

import {
  PEDS_ASTHMA_PARENT_MPFB_COMPARE_INPUT,
  PEDS_ASTHMA_PATIENT_DECISION_INPUT,
  decideHumanoidSourcePath,
} from "./humanoid-source-decision-tree.js";

describe("humanoid-source-decision-tree", () => {
  it("routes pediatric case-driven patient to Anny parametric forward pass", () => {
    const decision = decideHumanoidSourcePath(PEDS_ASTHMA_PATIENT_DECISION_INPUT);
    expect(decision.recommendedPath).toBe("anny_parametric_forward_pass");
    expect(decision.fallbacks).toContain("mpfb_makehuman_basemesh");
    expect(decision.notEvidenceFor).toContain("production_asset_readiness");
  });

  it("routes adult parent MPFB rig compare toward MPFB with license blocker", () => {
    const decision = decideHumanoidSourcePath(PEDS_ASTHMA_PARENT_MPFB_COMPARE_INPUT);
    expect(decision.recommendedPath).toBe("mpfb_makehuman_basemesh");
    expect(decision.blockedReasons).toContain("makehuman_output_license_not_reviewed_for_promotion");
  });

  it("blocks when neither Anny nor MPFB is available", () => {
    const decision = decideHumanoidSourcePath({
      ...PEDS_ASTHMA_PATIENT_DECISION_INPUT,
      annyLocalImportAvailable: false,
      mpfbAddonDetected: false,
    });
    expect(decision.recommendedPath).toBe("blocked_pending_license_or_probe");
  });
});