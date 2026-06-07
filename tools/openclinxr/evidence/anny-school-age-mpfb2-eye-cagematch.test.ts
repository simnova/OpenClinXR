import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("anny-school-age-mpfb2-eye-cagematch wiring", () => {
  it("registers package script and factory defaults", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["asset:anny:school-age-mpfb2-eye"]).toBe(
      "tsx tools/openclinxr/evidence/anny-school-age-mpfb2-eye-cagematch.ts",
    );
  });

  it("exports mpfb2 eye cagematch schema version in source", () => {
    const source = readFileSync("tools/openclinxr/evidence/anny-school-age-mpfb2-eye-cagematch.ts", "utf8");
    expect(source).toContain("openclinxr.anny-school-age-mpfb2-eye-cagematch.v1");
    expect(source).toContain("peds_patient_child_school_age_mpfb2_eye");
    expect(source).toContain("emotion_transition");
    expect(source).toContain("glb_morph_target_emotion_transition_from_case_definition");
    expect(source).toContain("mpfb2_informed_low_poly_procedural_seated_eyes");
    expect(source).toContain("viseme_timeline");
    expect(source).toContain("apps/ui-xr/public/cagematch");
    expect(source).toContain("captureDialogueText");
  });
});