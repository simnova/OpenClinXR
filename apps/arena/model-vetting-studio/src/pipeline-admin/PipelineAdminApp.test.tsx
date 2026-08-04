// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PipelineCandidateIndex } from "@openclinxr/model-vetting";
import { ConfigProvider } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "./jsdom-setup.js";

// Stub the three.js preview/compare so jsdom never touches WebGL.
vi.mock("./CandidatePreview.js", () => ({
  CandidatePreview: () => <div data-testid="stub-preview" />,
  CandidateCompare: () => <div data-testid="stub-compare" />,
}));

import { PipelineAdminApp } from "./PipelineAdminApp.js";
import { openClinXrVettingTheme } from "./theme.js";

// Small fixture (kept tiny so antd Table rendering stays fast in jsdom; the full
// 37-candidate sample is asserted in pipeline-admin-data.test.ts).
const smallIndex: PipelineCandidateIndex = {
  schemaVersion: "openclinxr.pipeline-candidate-index.v1",
  generatedAt: "2026-08-03T21:00:00.000Z",
  claimScope: "aesthetic_pipeline_candidate_inventory_metadata_only_not_clinical_or_production_readiness",
  sourceVisionScoreReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
  candidateCount: 2,
  scoredCandidateCount: 1,
  notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
  candidates: [
    {
      candidateId: "peds_asthma_parent_anxiety_v1/peds_nurse_kevin",
      group: "peds_asthma_parent_anxiety_v1",
      manifestId: "peds_nurse_kevin",
      role: "nurse",
      glbPath: ".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_nurse_kevin.glb",
      sizeBytes: 23137552,
      modifiedAt: "2026-08-02T00:00:00.000Z",
      visionScore: {
        full: null,
        face: null,
        aggregateRealism_0to1: 0.34,
        aggregateClothing_0to1: 0.52,
        reason: "readable low-poly humanoid",
        sourceReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
        scoredAt: "2026-08-03T20:59:26.729Z",
        notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
      },
      riggingSummary: {
        realismGrade: "B",
        boneCount: 23,
        morphTargetCount: 25,
        hasRealGarmentRegion: true,
        garmentRegionFaces: 324,
        wardrobeTags: ["nurse_scrubs"],
        skinningNormalized: true,
        claimScope: "aesthetic_structural_rigging_metadata_only_not_clinical_or_production_rig",
      },
      thumbnailPath: null,
      notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
    },
    {
      candidateId: "peds_asthma_parent_anxiety_v1/peds_anxious_parent",
      group: "peds_asthma_parent_anxiety_v1",
      manifestId: "peds_anxious_parent",
      role: "parent",
      glbPath: ".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_anxious_parent.glb",
      sizeBytes: 21550404,
      modifiedAt: "2026-08-02T00:00:00.000Z",
      visionScore: null,
      riggingSummary: null,
      thumbnailPath: null,
      notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
    },
  ],
};

beforeAll(() => {
  vi.stubGlobal("fetch", (async () =>
    new Response(JSON.stringify(smallIndex), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch);
});

afterEach(() => cleanup());

function renderAdmin(): void {
  render(
    <ConfigProvider theme={openClinXrVettingTheme}>
      <PipelineAdminApp indexOverrideUrl="/test-index.json" />
    </ConfigProvider>,
  );
}

describe("PipelineAdminApp", () => {
  it("renders the admin heading, stats, and candidate rows with scores", async () => {
    renderAdmin();
    expect(await screen.findByText("Pipeline Administration & Model Vetting")).toBeInTheDocument();
    // Sample index has 37 candidates including peds_nurse_kevin rows.
    expect((await screen.findAllByText("peds_nurse_kevin")).length).toBeGreaterThan(0);
    // notEvidenceFor gates surfaced.
    expect(screen.getAllByText(/not evidence for: clinical validity/i).length).toBeGreaterThan(0);
    // A role tag renders.
    expect(screen.getAllByText("nurse").length).toBeGreaterThan(0);
  });

  it("toggles score framing emphasis without crashing", async () => {
    renderAdmin();
    await screen.findByText("Pipeline Administration & Model Vetting");
    const fullFrame = screen.getByText("Full frame");
    fireEvent.click(fullFrame);
    expect(screen.getByText("Face frame")).toBeInTheDocument();
  });

  it("renders per-row Preview and Promote actions", async () => {
    renderAdmin();
    await screen.findByText("Pipeline Administration & Model Vetting");
    expect((await screen.findAllByRole("button", { name: "Promote" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Preview" }).length).toBeGreaterThan(0);
  });
});
