import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  BuildSamplingPlanInput,
  SamplingPlanCoverage,
  SamplingPlanCoverageRequirement,
  SamplingPlanScenarioRevision,
} from "../../../../packages/openclinxr/exam-assembly/src/sampling-plan/index.js";
import { BlueprintCoverageWorkflow } from "./index.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
});

describe("BlueprintCoverageWorkflow", () => {
  it("renders every construct gap and persists a fail-closed activation attempt", async () => {
    const onPersistActivation = vi.fn();
    render(
      <BlueprintCoverageWorkflow
        input={workflowInput(false)}
        reviewerId="faculty_blueprint_reviewer"
        now={() => "2026-09-04T20:00:00.000Z"}
        createDecisionId={() => "decision_blocked_001"}
        onPersistActivation={onPersistActivation}
      />,
    );

    const panel = screen.getByLabelText("Blueprint sampling-plan activation");
    expect(within(panel).getByText("Activation blocked")).toBeInTheDocument();
    expect(within(panel).getByText("Coverage is a faculty review aid, not validity evidence")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Pinned sampling-plan revisions")).toHaveTextContent(
      "base_scenario@11",
    );
    expect(within(panel).getByLabelText("Coverage requirements and gaps")).toHaveTextContent(
      "8 blueprint coverage gaps block activation",
    );
    expect(within(panel).getByLabelText("Coverage requirements and gaps")).toHaveTextContent(
      "Reasoning: diagnostic_prioritization",
    );

    fireEvent.click(
      within(panel).getByRole("button", { name: "Record blocked activation attempt" }),
    );
    await waitFor(() => expect(onPersistActivation).toHaveBeenCalledOnce());
    const record = onPersistActivation.mock.calls[0]?.[0];
    expect(record).toMatchObject({
      status: "blocked",
      decisionId: "decision_blocked_001",
      blueprintRevision: { blueprintId: "blueprint_review_v1", blueprintVersion: 6 },
      validityEvidenceGate: false,
    });
    expect(record.blockers).toContain(
      "coverage_gap:reasoning:diagnostic_prioritization:need_1:have_0",
    );
    expect(panel).toHaveTextContent("Activation refusal persisted");
  });

  it("reviews a substitution, recomputes coverage, and persists the substituted revision", async () => {
    const onPersistActivation = vi.fn();
    render(
      <BlueprintCoverageWorkflow
        input={workflowInput(true)}
        reviewerId="faculty_blueprint_reviewer"
        now={() => "2026-09-04T20:05:00.000Z"}
        createDecisionId={() => "decision_active_001"}
        onPersistActivation={onPersistActivation}
      />,
    );

    const panel = screen.getByLabelText("Blueprint sampling-plan activation");
    const substitutions = within(panel).getByLabelText("Sampling-plan substitutions");
    expect(substitutions).toHaveTextContent("base_scenario@11 → reviewed_substitute@4");
    expect(substitutions).toHaveTextContent("pending");
    expect(within(panel).getByText("Activation blocked")).toBeInTheDocument();

    fireEvent.click(
      within(substitutions).getByRole("button", {
        name: "Approve substitution to reviewed_substitute@4",
      }),
    );
    await waitFor(() =>
      expect(within(panel).getByText("Ready for faculty activation review")).toBeInTheDocument(),
    );
    expect(within(panel).getByLabelText("Coverage requirements and gaps")).toHaveTextContent(
      "All configured construct requirements are covered",
    );
    expect(within(panel).getByLabelText("Pinned sampling-plan revisions")).toHaveTextContent(
      "reviewed_substitute@4",
    );

    fireEvent.click(within(panel).getByRole("button", { name: "Activate reviewed form" }));
    await waitFor(() => expect(onPersistActivation).toHaveBeenCalledOnce());
    const record = onPersistActivation.mock.calls[0]?.[0];
    expect(record).toMatchObject({
      status: "active",
      decisionId: "decision_active_001",
      reviewerId: "faculty_blueprint_reviewer",
      scenarioRevisions: [
        {
          slotId: "station_001",
          scenarioId: "reviewed_substitute",
          scenarioVersion: 4,
        },
      ],
      substitutionReviews: [
        {
          substitutionId: "substitution_001",
          applied: true,
          review: {
            status: "accepted",
            reviewerId: "faculty_blueprint_reviewer",
            reviewedAt: "2026-09-04T20:05:00.000Z",
          },
        },
      ],
    });
    expect(panel).toHaveTextContent("Version-pinned form activation persisted");
    expect(panel).toHaveTextContent("blueprint_review_v1@6; 1 scenario revisions pinned");
  });

  it("does not claim persistence when the activation sink rejects", async () => {
    render(
      <BlueprintCoverageWorkflow
        input={workflowInput(false)}
        reviewerId="faculty_blueprint_reviewer"
        now={() => "2026-09-04T20:10:00.000Z"}
        createDecisionId={() => "decision_error_001"}
        onPersistActivation={() => Promise.reject(new Error("review store unavailable"))}
      />,
    );

    const panel = screen.getByLabelText("Blueprint sampling-plan activation");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Record blocked activation attempt" }),
    );
    expect(await within(panel).findByText("Activation decision was not persisted")).toBeInTheDocument();
    expect(panel).toHaveTextContent("review store unavailable");
    expect(panel).not.toHaveTextContent("Version-pinned form activation persisted");
  });

  it("persists an explicit faculty rejection instead of only offering approval", async () => {
    const onPersistActivation = vi.fn();
    render(
      <BlueprintCoverageWorkflow
        input={workflowInput(false)}
        reviewerId="faculty_blueprint_reviewer"
        now={() => "2026-09-04T20:12:00.000Z"}
        createDecisionId={() => "decision_rejected_001"}
        onPersistActivation={onPersistActivation}
      />,
    );

    const panel = screen.getByLabelText("Blueprint sampling-plan activation");
    fireEvent.click(within(panel).getByRole("button", { name: "Reject or hold form" }));
    await waitFor(() => expect(onPersistActivation).toHaveBeenCalledOnce());
    expect(onPersistActivation.mock.calls[0]?.[0]).toMatchObject({
      status: "blocked",
      decisionId: "decision_rejected_001",
      blockers: expect.arrayContaining(["faculty_rejected_activation"]),
    });
  });

  it("renders an omitted construct dimension as a faculty-visible activation blocker", () => {
    const input = workflowInput(false);
    render(
      <BlueprintCoverageWorkflow
        input={{
          ...input,
          blueprintRevision: {
            ...input.blueprintRevision,
            requirements: input.blueprintRevision.requirements.filter(
              (requirement) => requirement.dimension !== "pressure_profile",
            ),
          },
        }}
        reviewerId="faculty_blueprint_reviewer"
        now={() => "2026-09-04T20:15:00.000Z"}
        onPersistActivation={vi.fn()}
      />,
    );

    const panel = screen.getByLabelText("Blueprint sampling-plan activation");
    expect(within(panel).getByText("Unconfigured blueprint dimensions block activation")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Coverage requirements and gaps")).toHaveTextContent(
      "Pressure profile",
    );
    expect(within(panel).getByLabelText("Sampling-plan activation blockers")).toHaveTextContent(
      "coverage_dimension_unconfigured:pressure_profile",
    );
  });

  it("resets staged reviews and saved success when same-version plan content changes", async () => {
    const onPersistActivation = vi.fn();
    const props = {
      reviewerId: "faculty_blueprint_reviewer",
      now: () => "2026-09-04T20:20:00.000Z",
      createDecisionId: () => "decision_refresh_001",
      onPersistActivation,
    };
    const { rerender } = render(
      <BlueprintCoverageWorkflow input={workflowInput(true)} {...props} />,
    );
    const panel = screen.getByLabelText("Blueprint sampling-plan activation");
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Approve substitution to reviewed_substitute@4",
      }),
    );
    await waitFor(() =>
      expect(within(panel).getByText("Ready for faculty activation review")).toBeInTheDocument(),
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Activate reviewed form" }));
    await waitFor(() => expect(panel).toHaveTextContent("Version-pinned form activation persisted"));

    const refreshed = workflowInput(false);
    refreshed.blueprintRevision.requirements = refreshed.blueprintRevision.requirements.map(
      (requirement) =>
        requirement.dimension === "reasoning"
          ? { ...requirement, value: "refreshed_reasoning" }
          : requirement,
    );
    rerender(<BlueprintCoverageWorkflow input={refreshed} {...props} />);

    const refreshedPanel = screen.getByLabelText("Blueprint sampling-plan activation");
    expect(refreshedPanel).not.toHaveTextContent("Version-pinned form activation persisted");
    expect(within(refreshedPanel).getByText("Activation blocked")).toBeInTheDocument();
    expect(within(refreshedPanel).getByLabelText("Pinned sampling-plan revisions")).toHaveTextContent(
      "base_scenario@11",
    );
    expect(within(refreshedPanel).getByLabelText("Sampling-plan substitutions")).toHaveTextContent(
      "No substitutions proposed",
    );
  });
});

function workflowInput(withSubstitution: boolean): BuildSamplingPlanInput {
  const base = scenario("base_scenario", 11, emptyCoverage());
  return {
    examFormId: "form_review_001",
    planVersion: 3,
    blueprintRevision: {
      blueprint: {
        blueprintId: "blueprint_review_v1",
        title: "Faculty construct blueprint",
        stationSlots: [
          {
            slotId: "station_001",
            order: 1,
            label: "Integrated station",
            requiredEnvironmentIds: ["ed_bay"],
            requiredTraceTags: ["prioritization"],
          },
        ],
        timing: {
          doorwaySeconds: 60,
          encounterSeconds: 900,
          noteSeconds: 600,
          breakAfterStationOrders: [],
        },
        requiredTraceTags: ["prioritization"],
        requiredSafetyCriticalTraceTags: ["urgent_escalation"],
      },
      blueprintVersion: 6,
      requirements: requirements(),
    },
    selections: [{ slotId: "station_001", scenario: base }],
    ...(withSubstitution
      ? {
          substitutions: [
            {
              substitutionId: "substitution_001",
              slotId: "station_001",
              fromScenarioRevision: {
                scenarioId: base.scenarioId,
                scenarioVersion: base.scenarioVersion,
              },
              toScenario: scenario("reviewed_substitute", 4, fullCoverage()),
              rationale: "Reviewed alternate restores all blueprint constructs.",
              review: { status: "pending" as const },
            },
          ],
        }
      : {}),
  };
}

function requirements(): SamplingPlanCoverageRequirement[] {
  return [
    requirement("specialty", "emergency_medicine"),
    requirement("environment", "ed_bay"),
    requirement("actor_role", "nurse"),
    requirement("safety_critical_event", "urgent_escalation"),
    requirement("communication", "closed_loop_handoff"),
    requirement("reasoning", "diagnostic_prioritization"),
    requirement("synthesis", "oral_summary"),
    requirement("pressure_profile", "interruption_under_time_pressure"),
  ];
}

function requirement(
  dimension: SamplingPlanCoverageRequirement["dimension"],
  value: string,
): SamplingPlanCoverageRequirement {
  return {
    requirementId: `${dimension}_${value}`,
    dimension,
    value,
    minimumStations: 1,
  };
}

function scenario(
  scenarioId: string,
  scenarioVersion: number,
  coverage: SamplingPlanCoverage,
): SamplingPlanScenarioRevision {
  return {
    scenarioId,
    scenarioVersion,
    title: scenarioId.replaceAll("_", " "),
    status: "approved",
    coverage,
  };
}

function emptyCoverage(): SamplingPlanCoverage {
  return {
    specialty: [],
    environment: [],
    actor_role: [],
    safety_critical_event: [],
    communication: [],
    reasoning: [],
    synthesis: [],
    pressure_profile: [],
  };
}

function fullCoverage(): SamplingPlanCoverage {
  return {
    specialty: ["emergency_medicine"],
    environment: ["ed_bay"],
    actor_role: ["patient", "nurse"],
    safety_critical_event: ["urgent_escalation"],
    communication: ["closed_loop_handoff"],
    reasoning: ["diagnostic_prioritization"],
    synthesis: ["oral_summary"],
    pressure_profile: ["interruption_under_time_pressure"],
  };
}
