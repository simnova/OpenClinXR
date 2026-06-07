import { describe, expect, it } from "vitest";
import { renderCagematchReportPage } from "./cagematch-report-view.js";
import type { CagematchReportPage } from "@openclinxr/model-vetting";

const sample: CagematchReportPage = {
  schemaVersion: "openclinxr.cagematch-report-page.v1",
  reportId: "humanoid-source-side-by-side-2026-06-07-anny-vs-mpfb",
  lane: "humanoid-source-side-by-side",
  runId: "2026-06-07-anny-vs-mpfb",
  title: "Anny Comfy vs MPFB",
  subtitle: "Pediatric comparator",
  generatedAt: "2026-06-07T00:00:00.000Z",
  canonicalPlanPath: "docs/openclinxr/asset-pipeline-vetting-and-cagematch-plan-2026-06-05.md",
  family: "Humanoid source generation",
  claimScope: "no promotion",
  objectives: ["Compare pediatric sources"],
  processSteps: ["Generate", "Capture"],
  caseContext: { scenarioId: "peds_asthma_parent_anxiety_v1", actorRole: "patient", actorProfile: "child" },
  technologies: [{ technologyId: "anny_parametric_forward_pass", displayName: "Anny", summary: "s", strengths: ["a"], limitations: ["b"] }],
  feasibilityCriteria: [{
    criterionId: "license",
    label: "License",
    question: "Legal?",
    weight: "required",
    technologies: { anny_parametric_forward_pass: { rating: "pass", note: "ok" } },
  }],
  decisionBranches: [{
    branchId: "peds",
    condition: "Child",
    choose: "anny_parametric_forward_pass",
    rationale: "Case sliders",
    exampleScenarios: ["peds patient"],
  }],
  interimVerdict: {
    summary: "Anny primary",
    recommendedPrimary: "anny_parametric_forward_pass",
    recommendedFallback: "mpfb_makehuman_basemesh",
    blockedReasons: [],
    compareBeforePromotion: ["screenshots"],
  },
  media: [{ mediaId: "front", kind: "image", label: "Front", urlPath: "/cagematch-reports/x/front.png", caption: "cap" }],
  relatedCommands: ["pnpm asset:cagematch:report-page"],
  notEvidenceFor: ["production_asset_readiness"],
};

describe("cagematch report view", () => {
  it("renders objectives, criteria, decision tree, process walkthrough, and media sections", () => {
    const html = renderCagematchReportPage({
      ...sample,
      processExplanations: [{
        stepNumber: 1,
        title: "Load studio",
        narrative: "Open dual compare.",
        lookFor: ["Both meshes visible"],
      }],
    });
    expect(html).toContain("Objectives");
    expect(html).toContain("Feasibility criteria");
    expect(html).toContain("Decision tree");
    expect(html).toContain("Process walkthrough");
    expect(html).toContain("decision-flowchart");
    expect(html).toContain("Visual evidence");
    expect(html).toContain(sample.media[0]?.urlPath ?? "");
  });
});