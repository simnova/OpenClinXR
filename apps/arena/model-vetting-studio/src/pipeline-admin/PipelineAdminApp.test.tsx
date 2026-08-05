// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PipelineCandidateIndex } from "@openclinxr/model-vetting";
import { ConfigProvider } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      promotion: {
        promoted: true,
        promotedAt: "2026-08-03T21:30:00.000Z",
        promotedBy: "faculty_reviewer",
        recordPath: ".openclinxr/asset-production/promotions/peds_nurse_kevin.json",
      },
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
      promotion: null,
      notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/__regenerate-index") && init?.method === "POST") {
      return new Response(
        JSON.stringify({ ok: true, index: smallIndex, stdout: "regenerated" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/__batch-score") && init?.method === "POST") {
      const scoredIndex: PipelineCandidateIndex = {
        ...smallIndex,
        scoredCandidateCount: 2,
        candidates: smallIndex.candidates.map((c) =>
          c.visionScore
            ? c
            : {
                ...c,
                visionScore: {
                  full: null,
                  face: null,
                  aggregateRealism_0to1: 0.12,
                  aggregateClothing_0to1: 0.18,
                  reason: "batch scored",
                  sourceReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
                  scoredAt: "2026-08-03T22:00:00.000Z",
                  notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
                },
              },
        ),
      };
      return new Response(
        JSON.stringify({
          ok: true,
          index: scoredIndex,
          scoredCandidateCount: 2,
          sourceReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Default: load index JSON for table
    return new Response(JSON.stringify(smallIndex), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    expect((await screen.findAllByText("peds_nurse_kevin")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not evidence for: clinical validity/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("nurse").length).toBeGreaterThan(0);
  });

  it("shows Promoted status tag for promoted candidates", async () => {
    renderAdmin();
    await screen.findByText("Pipeline Administration & Model Vetting");
    expect((await screen.findAllByTestId("status-promoted")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Promoted").length).toBeGreaterThan(0);
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
    // Await the real index→ready state transition (fetch setIndex), not a wall-clock
    // getByRole name-walk. Role queries on a full antd Table tree are CPU-heavy and
    // flake under full-gate contention (~3.5s alone; fails ~1/3 under turbo load).
    await screen.findByTestId("pipeline-admin-ready");
    expect(screen.getAllByTestId("candidate-promote").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("candidate-preview").length).toBeGreaterThan(0);
  });

  it("Regenerate index posts /__regenerate-index and reloads table", async () => {
    renderAdmin();
    await screen.findByText("Pipeline Administration & Model Vetting");
    fireEvent.click(screen.getByTestId("regenerate-index"));
    await waitFor(() => {
      expect(screen.getByTestId("regenerate-message")).toBeInTheDocument();
    });
    const regenCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]).includes("/__regenerate-index"),
    );
    expect(regenCalls.length).toBeGreaterThan(0);
    expect((regenCalls[0]![1] as RequestInit).method).toBe("POST");
    expect(screen.getByText(/Index regenerated/i)).toBeInTheDocument();
  });

  it("Batch score posts /__batch-score and shows aesthetic success message", async () => {
    renderAdmin();
    await screen.findByText("Pipeline Administration & Model Vetting");
    fireEvent.click(screen.getByTestId("batch-score"));
    await waitFor(() => {
      expect(screen.getByTestId("batch-score-message")).toBeInTheDocument();
    });
    const batchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/__batch-score"));
    expect(batchCalls.length).toBeGreaterThan(0);
    expect((batchCalls[0]![1] as RequestInit).method).toBe("POST");
    const alert = screen.getByTestId("batch-score-message");
    expect(alert).toHaveTextContent(/Batch score applied/i);
    expect(alert).toHaveTextContent(/Aesthetic-only/i);
  });

  it("opens DIFF view when two candidates are selected and Compare is clicked", async () => {
    renderAdmin();
    await screen.findByText("Pipeline Administration & Model Vetting");
    const checkboxes = await screen.findAllByRole("checkbox");
    // antd Table: first checkbox is header select-all; pick two row boxes
    const rowBoxes = checkboxes.filter((el) => el.getAttribute("aria-label") !== "Select all");
    expect(rowBoxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(rowBoxes[0]!);
    fireEvent.click(rowBoxes[1]!);
    const compareBtn = screen.getByTestId("compare-button");
    await waitFor(() => expect(compareBtn).not.toBeDisabled());
    fireEvent.click(compareBtn);
    expect(await screen.findByTestId("candidate-diff-view")).toBeInTheDocument();
    expect(screen.getByText(/Score & rigging deltas/i)).toBeInTheDocument();
  });
});
