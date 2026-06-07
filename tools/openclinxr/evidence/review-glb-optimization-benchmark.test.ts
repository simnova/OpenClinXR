import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  REVIEW_GLB_OPTIMIZATION_BENCHMARK_SCHEMA_VERSION,
  type ReviewGlbOptimizationBenchmarkReport,
  validateReviewGlbOptimizationBenchmarkReport,
} from "./review-glb-optimization-benchmark.js";

describe("review GLB optimization benchmark", () => {
  it("exposes scripts for local benchmark generation and validation", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:review-glb:optimization-benchmark"]).toBe(
      "tsx tools/openclinxr/evidence/review-glb-optimization-benchmark.ts",
    );
    expect(rootPackage.scripts["asset:review-glb:optimization-benchmark:validate"]).toBe(
      "tsx tools/openclinxr/evidence/review-glb-optimization-benchmark.ts --validate-latest",
    );
  });

  it("keeps optimized review fixtures blocked from replacement until browser visibility evidence exists", () => {
    const report = validReport();

    expect(validateReviewGlbOptimizationBenchmarkReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report);
    invalid.candidates[0].browserReplacementReady = true;
    invalid.candidates[0].blockers = [];

    expect(validateReviewGlbOptimizationBenchmarkReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/candidates/0/browserReplacementReady must stay false until browser evidence is attached",
        "/candidates/0/blockers must require browser visibility evidence",
      ]),
    });
  });

  it("requires Meshopt variants to carry body-visibility proof blockers", () => {
    const report = validReport();
    const meshopt = report.candidates[0].variants.find((variant) => variant.variantId === "meshopt_delivery");
    if (!meshopt) throw new Error("missing meshopt fixture");
    meshopt.blockers = meshopt.blockers.filter((blocker) => blocker !== "meshopt_body_visibility_capture_required");

    expect(validateReviewGlbOptimizationBenchmarkReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/candidates/0/variants/meshopt_delivery must require body visibility proof",
      ]),
    });
  });
});

function validReport(): ReviewGlbOptimizationBenchmarkReport {
  const baseMetrics = {
    meshes: 1,
    primitives: 1,
    skins: 1,
    animations: 5,
    accessors: 20,
    morphTargets: 8,
    materials: 3,
    nodes: 12,
    extensionsUsed: [],
  };
  const variant = (variantId: ReviewGlbOptimizationBenchmarkReport["candidates"][number]["variants"][number]["variantId"], blockers: string[]) => ({
    variantId,
    outputGlbPath: `.openclinxr/asset-production/review-glb-optimization/run/peds_patient_child/${variantId}.glb`,
    beforeBytes: 34_932_472,
    afterBytes: variantId === "meshopt_delivery" ? 8_000_000 : 18_000_000,
    byteReductionRatio: variantId === "meshopt_delivery" ? 0.229 : 0.5153,
    percentSmaller: variantId === "meshopt_delivery" ? 77.1 : 48.47,
    metricsPreserved: true,
    reviewFixtureCandidate: blockers.length === 1,
    browserReplacementAllowed: false,
    blockers,
    warnings: [],
    beforeMetrics: baseMetrics,
    afterMetrics: {
      ...baseMetrics,
      extensionsUsed: variantId === "meshopt_delivery" ? ["EXT_meshopt_compression"] : [],
    },
  });

  return {
    schemaVersion: REVIEW_GLB_OPTIMIZATION_BENCHMARK_SCHEMA_VERSION,
    generatedAt: "2026-06-07T00:00:00.000Z",
    claimScope: "browser_review_fixture_optimization_benchmark_not_visual_realism_or_readiness",
    runId: "test-run",
    sourceGlbPaths: ["apps/ui-xr/public/generated-humanoids/peds_patient_child.glb"],
    outputRoot: ".openclinxr/asset-production/review-glb-optimization/test-run",
    candidates: [{
      sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
      sourceBytes: 34_932_472,
      variants: [
        variant("prune_dedup", ["browser_visibility_capture_required_before_replacing_committed_review_glb"]),
        variant("prune_dedup_resample_sparse", ["browser_visibility_capture_required_before_replacing_committed_review_glb"]),
        variant("quantize_no_meshopt", ["browser_visibility_capture_required_before_replacing_committed_review_glb"]),
        variant("meshopt_delivery", [
          "meshopt_body_visibility_capture_required",
          "browser_visibility_capture_required_before_replacing_committed_review_glb",
        ]),
      ],
      bestSizeVariantId: "meshopt_delivery",
      recommendedReviewFixtureVariantId: "quantize_no_meshopt",
      browserReplacementReady: false,
      blockers: ["browser_visibility_capture_required_before_replacing_committed_review_glb"],
    }],
    policy: {
      committedReviewAssetsAllowed: true,
      rawGeneratedOutputsAllowedInGit: false,
      browserReplacementRequiresCaptureEvidence: true,
      meshoptRequiresBrowserVisibilityProof: true,
    },
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}
