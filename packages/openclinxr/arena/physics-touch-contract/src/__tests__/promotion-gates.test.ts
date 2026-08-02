import { describe, expect, it } from "vitest";
import {
  PHYSICS_TOUCH_PROMOTION,
  runtimePromotionAllowed,
  liveEngineProductionAllowed,
  bakedTransformsCaptureAllowed,
} from "../promotion-gates.js";

describe("promotion gates", () => {
  it("keeps runtimePromotionAllowed false (pre-production fence)", () => {
    expect(runtimePromotionAllowed).toBe(false);
  });

  it("keeps PHYSICS_TOUCH_PROMOTION.runtimePromotionAllowed false", () => {
    expect(PHYSICS_TOUCH_PROMOTION.runtimePromotionAllowed).toBe(false);
  });

  it("keeps liveEngineProductionAllowed false (live WASM forbidden in production)", () => {
    expect(liveEngineProductionAllowed).toBe(false);
    expect(PHYSICS_TOUCH_PROMOTION.liveEngineProductionAllowed).toBe(false);
  });

  it("allows bakedTransformsCaptureAllowed true (baked opt-in capture path)", () => {
    expect(bakedTransformsCaptureAllowed).toBe(true);
    expect(PHYSICS_TOUCH_PROMOTION.bakedTransformsCaptureAllowed).toBe(true);
  });

  it("declares determinismScope as local", () => {
    expect(PHYSICS_TOUCH_PROMOTION.determinismScope).toBe("local");
  });

  it("declares governingMadrs as [0030, 0031]", () => {
    expect(PHYSICS_TOUCH_PROMOTION.governingMadrs).toEqual(["0030", "0031"]);
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

  it("split gates: runtime+live false, baked true (MADR 0031 consumer model)", () => {
    expect(runtimePromotionAllowed).toBe(false);
    expect(liveEngineProductionAllowed).toBe(false);
    expect(bakedTransformsCaptureAllowed).toBe(true);
    // Verify the object gate matches
    expect(PHYSICS_TOUCH_PROMOTION.runtimePromotionAllowed).toBe(false);
    expect(PHYSICS_TOUCH_PROMOTION.liveEngineProductionAllowed).toBe(false);
    expect(PHYSICS_TOUCH_PROMOTION.bakedTransformsCaptureAllowed).toBe(true);
  });
});
