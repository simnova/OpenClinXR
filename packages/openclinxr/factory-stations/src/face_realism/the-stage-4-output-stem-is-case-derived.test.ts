import { describe, expect, it } from "vitest";

import { stage4OutputStem } from "./stages-b.js";

/**
 * Card tsk_083b92e9c7ca5d7b: the stage-4 default output stem is
 * case-derived, not a shared literal.
 *
 * The materializer's #377 guard keys the anatomical eye target by output
 * stem (EYE_DIAMETER_TARGET_MM). The old shared default `stage4-lidconform`
 * is keyed for nobody, so a bake under it refuses mid-run -- and registering
 * it would be worse: one entry would size every unknown actor alike (a
 * child's globe in an adult socket). The default therefore derives from the
 * bake's own case (else the --reference / --eye-colour-reference subject),
 * matching the `<case>-eyeglobe-base` ring-source naming the pre-conform
 * base bake already uses.
 *
 * claimScope: the stem-derivation rule. notEvidenceFor: the conform itself
 * (see the lid-conform child report test).
 */
describe("the stage-4 default output stem is case-derived", () => {
  it("derives <caseId>-lidconform for a child-like record without known_good", () => {
    const rec = {
      materializer_argv: {
        value: ["--reference", "peds_patient_child", "--actor-role", "patient"],
      },
    };
    expect(stage4OutputStem(rec, "peds_asthma_parent_anxiety_v1")).toBe(
      "peds_asthma_parent_anxiety_v1-lidconform",
    );
  });

  it("falls back to the bake subject when no case id is passed", () => {
    const byReference = {
      materializer_argv: { value: ["--reference", "peds_patient_child"] },
    };
    expect(stage4OutputStem(byReference)).toBe("peds_patient_child-lidconform");
    const byEyeColour = {
      materializer_argv: {
        value: ["--eye-colour-reference", "ob_patient_aisha"],
      },
    };
    expect(stage4OutputStem(byEyeColour)).toBe("ob_patient_aisha-lidconform");
  });

  it("sanitises the derived stem to file-safe characters", () => {
    const rec = {
      materializer_argv: { value: ["--reference", "weird case/id"] },
    };
    expect(stage4OutputStem(rec, "weird case/id")).toBe("weird_case_id-lidconform");
  });
});
