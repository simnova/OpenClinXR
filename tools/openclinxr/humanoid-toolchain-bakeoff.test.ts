import { describe, expect, it } from "vitest";
import { buildHumanoidToolchainBakeoffReport, validateBakeoffReport } from "./humanoid-toolchain-bakeoff.js";

describe("humanoid toolchain bakeoff", () => {
  it("compares current Anny variants with local and approval-gated alternatives", async () => {
    const report = await buildHumanoidToolchainBakeoffReport({ generatedAt: "2026-05-27T00:00:00.000Z" });

    expect(validateBakeoffReport(report)).toEqual({ ok: true });
    expect(report.decision.keepAnnyAsSeed).toBe(true);
    expect(report.candidates.map((candidate) => candidate.id)).toEqual(expect.arrayContaining([
      "anny_neutral_runtime_seed",
      "ob_patient_aisha_source_variant",
      "ob_nurse_williams_source_variant",
      "ob_partner_omar_source_variant",
      "mpfb_ob_patient_local_candidate",
      "charmorph_antonia_local_candidate",
      "mpfb_makehuman_blender_source",
      "mblab_blender_source",
      "hunyuan3d_local_or_model_cache",
      "meshy_cloud_requires_approval",
    ]));
    expect(report.candidates.find((candidate) => candidate.id === "meshy_cloud_requires_approval")?.promotionStatus).toBe("not_promotable_without_approval");
    expect(report.candidates.find((candidate) => candidate.id === "ob_patient_aisha_source_variant")?.metrics?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
