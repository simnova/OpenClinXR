import { describe, expect, it } from "vitest";
import { PHYSICS_TOUCH_PROMOTION, runtimePromotionAllowed } from "../promotion-gates.js";

describe("promotion gates", () => {
  it("keeps runtimePromotionAllowed false (pre-production fence)", () => {
    expect(runtimePromotionAllowed).toBe(false);
  });

  it("keeps PHYSICS_TOUCH_PROMOTION.runtimePromotionAllowed false", () => {
    expect(PHYSICS_TOUCH_PROMOTION.runtimePromotionAllowed).toBe(false);
  });

  it("declares determinismScope as local", () => {
    expect(PHYSICS_TOUCH_PROMOTION.determinismScope).toBe("local");
  });

  it("declares the correct governing MADR", () => {
    expect(PHYSICS_TOUCH_PROMOTION.governingMadr).toBe("0030");
  });

  it("declares notEvidenceFor list covering clinical, exam, scoring, learner readiness", () => {
    expect(PHYSICS_TOUCH_PROMOTION.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("prevents runtimePromotionAllowed from being mutable (const assertion)", () => {
    // TypeScript `as const` ensures the literal type `false`,
    // not `boolean`. This test verifies the runtime value is
    // strictly `false` as a double-check.
    expect(typeof runtimePromotionAllowed).toBe("boolean");
    expect(runtimePromotionAllowed).toBe(false);
    expect(runtimePromotionAllowed === false).toBe(true);
  });
});
