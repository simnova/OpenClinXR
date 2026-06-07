import { describe, expect, it } from "vitest";
import { validateCagematchReportPage, validateCagematchReportRegistry, type CagematchReportPage } from "./cagematch-report.js";

const sampleReport: CagematchReportPage = {
  schemaVersion: "openclinxr.cagematch-report-page.v1",
  reportId: "humanoid-source-side-by-side-2026-06-07-anny-vs-mpfb",
  lane: "humanoid-source-side-by-side",
  runId: "2026-06-07-anny-vs-mpfb",
  title: "Anny Comfy vs MPFB pediatric comparator",
  subtitle: "Humanoid source generation cagematch",
  generatedAt: "2026-06-07T00:00:00.000Z",
  canonicalPlanPath: "docs/openclinxr/asset-pipeline-vetting-and-cagematch-plan-2026-06-05.md",
  family: "Humanoid source generation",
  claimScope: "isolated_cagematch_report_no_promotion",
  objectives: ["Compare sources under fixed pediatric patient profile"],
  processSteps: ["Generate candidates", "Capture side-by-side screenshots"],
  caseContext: {
    scenarioId: "peds_asthma_parent_anxiety_v1",
    actorRole: "patient",
    actorProfile: "school-age pediatric asthma patient",
  },
  technologies: [
    {
      technologyId: "anny_parametric_forward_pass",
      displayName: "Anny",
      summary: "Parametric child",
      strengths: ["Case sliders"],
      limitations: ["Mannequin-grade"],
    },
    {
      technologyId: "mpfb_makehuman_basemesh",
      displayName: "MPFB",
      summary: "MakeHuman basemesh",
      strengths: ["Rig library"],
      limitations: ["License review"],
    },
  ],
  feasibilityCriteria: [
    {
      criterionId: "license",
      label: "License",
      question: "Can we ship it?",
      weight: "required",
      technologies: {
        anny_parametric_forward_pass: { rating: "pass", note: "Apache-2 code path" },
        mpfb_makehuman_basemesh: { rating: "warn", note: "Needs review" },
      },
    },
  ],
  decisionBranches: [
    {
      branchId: "peds_parametric",
      condition: "School-age child with case phenotype sliders",
      choose: "anny_parametric_forward_pass",
      rationale: "Anny binds case params",
      exampleScenarios: ["peds_asthma_parent_anxiety_v1 patient"],
    },
  ],
  interimVerdict: {
    summary: "Anny leads for peds parametric path; MPFB remains comparator.",
    recommendedPrimary: "anny_parametric_forward_pass",
    recommendedFallback: "mpfb_makehuman_basemesh",
    blockedReasons: ["makehuman_output_license_not_reviewed_for_promotion"],
    compareBeforePromotion: ["isolated_model_vetting_studio_fixed_camera_screenshots"],
  },
  media: [],
  relatedCommands: ["pnpm asset:humanoid-source:side-by-side-cagematch"],
  notEvidenceFor: ["production_asset_readiness"],
};

describe("cagematch report page schema", () => {
  it("validates a complete report page", () => {
    expect(validateCagematchReportPage(sampleReport)).toEqual({ ok: true, report: sampleReport });
  });

  it("validates registry shape", () => {
    const registry = {
      schemaVersion: "openclinxr.cagematch-report-registry.v1",
      generatedAt: "2026-06-07T00:00:00.000Z",
      reports: [
        {
          reportId: sampleReport.reportId,
          lane: sampleReport.lane,
          runId: sampleReport.runId,
          title: sampleReport.title,
          family: sampleReport.family,
          reportUrlPath: `/cagematch-reports/${sampleReport.reportId}/report.json`,
          pageUrlQuery: `?cagematchReport=${sampleReport.reportId}`,
        },
      ],
    };
    expect(validateCagematchReportRegistry(registry).ok).toBe(true);
  });
});