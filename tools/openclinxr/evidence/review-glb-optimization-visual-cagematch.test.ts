import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  REVIEW_GLB_OPTIMIZATION_VISUAL_CAGEMATCH_SCHEMA_VERSION,
  validateReviewGlbOptimizationVisualCagematchReport,
} from "./review-glb-optimization-visual-cagematch.js";

describe("review GLB optimization visual cagematch", () => {
  it("exposes scripts for browser visual generation and validation", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:review-glb:optimization-visual-cagematch"]).toBe(
      "tsx tools/openclinxr/evidence/review-glb-optimization-visual-cagematch.ts",
    );
    expect(rootPackage.scripts["asset:review-glb:optimization-visual-cagematch:validate"]).toBe(
      "tsx tools/openclinxr/evidence/review-glb-optimization-visual-cagematch.ts --validate-latest",
    );
  });

  it("never treats browser review visibility as WebXR runtime replacement readiness", () => {
    const report = {
      schemaVersion: REVIEW_GLB_OPTIMIZATION_VISUAL_CAGEMATCH_SCHEMA_VERSION,
      generatedAt: "2026-06-07T00:00:00.000Z",
      claimScope: "browser_visual_cagematch_for_review_fixture_only_not_webxr_runtime_or_readiness",
      benchmarkReportPath: ".openclinxr/evidence/review-glb-optimization/report.json",
      modelVettingReportPath: ".openclinxr/evidence/review-glb-optimization-visual/report.json",
      publicModelVettingReportPath: "apps/arena/model-vetting-studio/public/cagematch/review/model-vetting-report.json",
      runId: "test-run",
      captureRoot: ".openclinxr/evidence/review-glb-optimization-visual/test-run",
      variants: [{
        candidateId: "candidate_quantize_no_meshopt",
        actorId: "patient",
        variantId: "quantize_no_meshopt",
        sourceGlbPath: "/cagematch/review/candidate_quantize_no_meshopt.glb",
        sourceBytes: 100,
        optimizedBytes: 67,
        percentSmaller: 33,
        metricsPreserved: true,
        browserReplacementAllowedByBenchmark: false,
        captures: [{
          view: "front",
          screenshotPath: ".openclinxr/evidence/review/front.png",
          loaded: true,
          meshCount: 1,
          normalizedBoundsMeters: { width: 0.5, height: 2.2, depth: 0.4 },
          nonBackgroundPixelRatio: 0.2,
          bodyVisible: true,
          blockers: [],
        }],
        visualUsability: {
          usableAsBrowserReviewFixture: true,
          usableAsWebXrRuntimeReplacement: false,
          blockers: ["webxr_runtime_replacement_requires_ui_xr_load_and_interaction_evidence"],
        },
      }],
      summary: [{
        variantId: "quantize_no_meshopt",
        captureCount: 1,
        bodyVisibleCount: 1,
        averagePercentSmaller: 33,
        usableAsBrowserReviewFixture: true,
        usableAsWebXrRuntimeReplacement: false,
        blockers: ["webxr_runtime_replacement_requires_ui_xr_load_and_interaction_evidence"],
      }],
      notEvidenceFor: [
        "b_plus_visual_realism_gate",
        "webxr_runtime_replacement",
        "production_asset_readiness",
        "quest_readiness",
        "learner_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    };

    expect(validateReviewGlbOptimizationVisualCagematchReport(report)).toEqual({ ok: true });

    report.summary[0].usableAsWebXrRuntimeReplacement = true;
    expect(validateReviewGlbOptimizationVisualCagematchReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/summary/0/usableAsWebXrRuntimeReplacement must be false",
      ]),
    });
  });
});
