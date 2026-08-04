// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PipelineCandidate } from "@openclinxr/model-vetting";
import { ConfigProvider } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "./jsdom-setup.js";
import { CandidateDiffView } from "./CandidateDiffView.js";
import { openClinXrVettingTheme } from "./theme.js";

const left: PipelineCandidate = {
  candidateId: "g/left_mesh",
  group: "g",
  manifestId: "left_mesh",
  role: "nurse",
  glbPath: ".openclinxr/asset-production/anny/g/left_mesh.glb",
  sizeBytes: 10,
  modifiedAt: "2026-08-03T00:00:00.000Z",
  visionScore: {
    full: { realism_0to1: 0.3, clothing_0to1: 0.4, reason: "L" },
    face: { realism_0to1: 0.2, clothing_0to1: 0.1, reason: "L" },
    aggregateRealism_0to1: 0.25,
    aggregateClothing_0to1: 0.4,
    reason: "left",
    sourceReportPath: null,
    scoredAt: null,
    notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
  },
  riggingSummary: {
    realismGrade: "C",
    boneCount: 20,
    morphTargetCount: 10,
    hasRealGarmentRegion: false,
    garmentRegionFaces: 0,
    wardrobeTags: ["scrubs"],
    skinningNormalized: false,
    claimScope: "aesthetic_structural_rigging_metadata_only_not_clinical_or_production_rig",
  },
  thumbnailPath: null,
  notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
};

const right: PipelineCandidate = {
  ...left,
  candidateId: "g/right_mesh",
  manifestId: "right_mesh",
  role: "parent",
  visionScore: {
    full: { realism_0to1: 0.5, clothing_0to1: 0.6, reason: "R" },
    face: { realism_0to1: 0.45, clothing_0to1: 0.2, reason: "R" },
    aggregateRealism_0to1: 0.48,
    aggregateClothing_0to1: 0.55,
    reason: "right",
    sourceReportPath: null,
    scoredAt: null,
    notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
  },
  riggingSummary: {
    realismGrade: "B",
    boneCount: 23,
    morphTargetCount: 25,
    hasRealGarmentRegion: true,
    garmentRegionFaces: 324,
    wardrobeTags: ["scrubs", "short_sleeve"],
    skinningNormalized: true,
    claimScope: "aesthetic_structural_rigging_metadata_only_not_clinical_or_production_rig",
  },
};

afterEach(() => {
  cleanup();
});

describe("CandidateDiffView", () => {
  it("renders side-by-side panels, score deltas, and notEvidenceFor gates", () => {
    render(
      <ConfigProvider theme={openClinXrVettingTheme}>
        <CandidateDiffView left={left} right={right} />
      </ConfigProvider>,
    );
    expect(screen.getByTestId("candidate-diff-view")).toBeInTheDocument();
    expect(screen.getByTestId("diff-side-Left")).toHaveTextContent("left_mesh");
    expect(screen.getByTestId("diff-side-Right")).toHaveTextContent("right_mesh");
    expect(screen.getByText("Score & rigging deltas (right − left)")).toBeInTheDocument();
    expect(screen.getAllByText("Aggregate realism").length).toBeGreaterThan(0);
    expect(screen.getByText("Bone count")).toBeInTheDocument();
    expect(screen.getAllByText(/not evidence for: clinical validity/i).length).toBeGreaterThan(0);
    // Positive aggregate realism delta ~ +23 (table Δ column)
    expect(screen.getAllByText("+23").length).toBeGreaterThan(0);
  });
});
