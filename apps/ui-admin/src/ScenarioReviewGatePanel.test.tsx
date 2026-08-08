import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  SCENARIO_REVIEW_RATIONALE_IS_CALLER_SUPPLIED,
  SCENARIO_REVIEW_RECORDABLE_DIMENSIONS,
  ScenarioReviewGatePanel,
} from "./ScenarioReviewGatePanel.js";
import type { AdminScenario } from "./api-client.js";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
});

const baseScenario = {
  scenarioId: "peds_asthma_parent_anxiety_v1",
  version: 1,
  title: "Pediatric Asthma With Parent Anxiety",
  status: "DRAFT",
  clinicalObjectives: [],
  requiredTraceTags: [],
  review: {
    clinical: "draft",
    psychometric: "draft",
    legal: "draft",
    simulationQa: "draft",
  },
  governance: {
    scoreUseLabel: "formative_local_only",
    syntheticCaseDisclosure: "Synthetic",
    validationStage: "stage_0_synthetic_draft",
    requiredReviewerRoles: ["pediatrician", "psychometrician", "legal", "simulation_qa"],
    sourceIds: [],
  },
  equipment: [],
  actors: [],
  assetNeeds: [],
} as unknown as AdminScenario;

describe("ScenarioReviewGatePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes all four recordable dimensions with caller-supplied rationale capability", () => {
    expect([...SCENARIO_REVIEW_RECORDABLE_DIMENSIONS]).toEqual([
      "clinical",
      "psychometric",
      "legal",
      "simulationQa",
    ]);
    expect(SCENARIO_REVIEW_RATIONALE_IS_CALLER_SUPPLIED).toBe(true);
  });

  it("renders four dimension forms and submits caller-supplied rationales", async () => {
    const submitScenarioReview = vi.fn(async (input: {
      reviewerRole: string;
      comments: string;
      decision: string;
    }) => ({
      ...baseScenario,
      review: {
        ...baseScenario.review,
        [input.reviewerRole]: input.decision === "APPROVED" ? "approved" : "changes_requested",
      },
      status: "READY_FOR_REVIEW",
    }));
    const listScenarioReviewDecisions = vi.fn(async () => []);

    render(
      <ScenarioReviewGatePanel
        scenario={baseScenario}
        submitScenarioReview={submitScenarioReview as never}
        listScenarioReviewDecisions={listScenarioReviewDecisions}
      />,
    );

    expect(screen.getByLabelText("Clinical review dimension")).toBeInTheDocument();
    expect(screen.getByLabelText("Psychometric review dimension")).toBeInTheDocument();
    expect(screen.getByLabelText("Legal review dimension")).toBeInTheDocument();
    expect(screen.getByLabelText("Simulation QA review dimension")).toBeInTheDocument();
    expect(screen.getByText("clinical: pending")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Psychometric rationale"), {
      target: { value: "Psychometric rationale from reviewer for local formative only." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit psychometric decision" }));

    await waitFor(() => {
      expect(submitScenarioReview).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioId: "peds_asthma_parent_anxiety_v1",
          version: 1,
          reviewerRole: "psychometric",
          comments: "Psychometric rationale from reviewer for local formative only.",
          decision: "APPROVED",
        }),
      );
    });
  });

  it("does not submit when rationale is empty", async () => {
    const submitScenarioReview = vi.fn();
    const listScenarioReviewDecisions = vi.fn(async () => []);

    render(
      <ScenarioReviewGatePanel
        scenario={baseScenario}
        submitScenarioReview={submitScenarioReview as never}
        listScenarioReviewDecisions={listScenarioReviewDecisions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit legal decision" }));
    expect(submitScenarioReview).not.toHaveBeenCalled();
  });
});
