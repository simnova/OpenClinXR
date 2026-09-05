import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminScenario, AdminScenarioReviewDecision } from "./api-client.js";
import {
  facultyCompileLockAllowsCompile,
  facultyCompileLockIdentityMoved,
  mergeFacultyCompileLockRows,
  type FacultyCompileLockRow,
} from "./faculty-compile-lock.js";
import {
  AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX,
  authoredScenarioContentIdentity,
  resolveScenarioReviewGateDisplay,
  SCENARIO_REVIEW_RECORDABLE_DIMENSIONS,
  SCENARIO_REVIEW_STALE_DECISION_DISPLAY,
  ScenarioReviewGatePanel,
  scenarioReviewGatesAllowLearnerUse,
} from "./scenario-review-gate-panel.js";

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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

const approvedReview = {
  clinical: "approved",
  psychometric: "approved",
  legal: "approved",
  simulationQa: "approved",
} as const;

function makeScenario(overrides: Partial<AdminScenario> = {}): AdminScenario {
  return {
    scenarioId: "peds_asthma_parent_anxiety_v1",
    version: 1,
    title: "Pediatric Asthma With Parent Anxiety",
    status: "DRAFT",
    clinicalObjectives: ["Assess pediatric respiratory distress"],
    requiredTraceTags: ["oxygen_request"],
    review: { ...approvedReview },
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
    ...overrides,
  } as unknown as AdminScenario;
}

function approvedHistory(scenario: AdminScenario, identity?: string): AdminScenarioReviewDecision[] {
  return SCENARIO_REVIEW_RECORDABLE_DIMENSIONS.map((dimension) => ({
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    reviewerRole: dimension,
    reviewerId: `admin_${dimension}_reviewer`,
    decision: "APPROVED",
    comments: `${dimension} rationale`,
    evidenceRefs: [
      `evidence:local-admin:${scenario.scenarioId}:${dimension}`,
      ...(identity === undefined ? [] : [`${AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX}${identity}`]),
    ],
    reviewedAt: "2026-05-04T09:00:00.000Z",
  }));
}

describe("the scenario edit invalidates stale faculty approval", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not treat unchanged review labels as a current approval without a matching-version decision", () => {
    const scenario = makeScenario();
    const displays = Object.fromEntries(
      SCENARIO_REVIEW_RECORDABLE_DIMENSIONS.map((dimension) => [
        dimension,
        resolveScenarioReviewGateDisplay({
          dimension,
          reviewLabel: "approved",
          scenarioId: scenario.scenarioId,
          version: scenario.version,
          currentAuthoredContentIdentity: authoredScenarioContentIdentity(scenario),
          history: [],
        }),
      ]),
    ) as Record<(typeof SCENARIO_REVIEW_RECORDABLE_DIMENSIONS)[number], string>;

    expect(displays.clinical).toBe(SCENARIO_REVIEW_STALE_DECISION_DISPLAY);
    expect(scenarioReviewGatesAllowLearnerUse(displays)).toBe(false);
  });

  it("marks each dimension stale when version advances even if labels stay approved", () => {
    const v1 = makeScenario({ version: 1 });
    const identity = authoredScenarioContentIdentity(v1);
    const v2 = makeScenario({ version: 2, review: { ...approvedReview } });

    for (const dimension of SCENARIO_REVIEW_RECORDABLE_DIMENSIONS) {
      expect(
        resolveScenarioReviewGateDisplay({
          dimension,
          reviewLabel: "approved",
          scenarioId: v2.scenarioId,
          version: v2.version,
          currentAuthoredContentIdentity: authoredScenarioContentIdentity(v2),
          history: approvedHistory(v1, identity),
        }),
      ).toBe(SCENARIO_REVIEW_STALE_DECISION_DISPLAY);
    }
  });

  it("marks gates stale when authored content identity moves at the same version", () => {
    const original = makeScenario();
    const edited = makeScenario({ title: "Pediatric Asthma With Parent Anxiety (edited stem)" });
    const originalIdentity = authoredScenarioContentIdentity(original);
    expect(originalIdentity).not.toBe(authoredScenarioContentIdentity(edited));

    expect(
      resolveScenarioReviewGateDisplay({
        dimension: "clinical",
        reviewLabel: "approved",
        scenarioId: edited.scenarioId,
        version: edited.version,
        currentAuthoredContentIdentity: authoredScenarioContentIdentity(edited),
        history: approvedHistory(original, originalIdentity),
        boundAuthoredContentIdentity: originalIdentity,
      }),
    ).toBe(SCENARIO_REVIEW_STALE_DECISION_DISPLAY);
    expect(
      resolveScenarioReviewGateDisplay({
        dimension: "psychometric",
        reviewLabel: "approved",
        scenarioId: edited.scenarioId,
        version: edited.version,
        currentAuthoredContentIdentity: authoredScenarioContentIdentity(edited),
        history: approvedHistory(original, originalIdentity),
        boundAuthoredContentIdentity: originalIdentity,
      }),
    ).toBe(SCENARIO_REVIEW_STALE_DECISION_DISPLAY);
  });

  it("keeps a matching-version identity-bound approval current", () => {
    const scenario = makeScenario();
    const identity = authoredScenarioContentIdentity(scenario);
    expect(
      resolveScenarioReviewGateDisplay({
        dimension: "legal",
        reviewLabel: "approved",
        scenarioId: scenario.scenarioId,
        version: scenario.version,
        currentAuthoredContentIdentity: identity,
        history: approvedHistory(scenario, identity),
        boundAuthoredContentIdentity: identity,
      }),
    ).toBe("approved");
  });

  it("changes identity when environment is edited", () => {
    const base = {
      ...makeScenario(),
      environment: { environmentId: "exam_room_peds_v1", name: "Peds exam room", description: "Bay 2" },
    } as unknown as AdminScenario;
    const edited = {
      ...base,
      environment: { environmentId: "telehealth_home_visit_v1", name: "Home visit", description: "Bay 2" },
    } as unknown as AdminScenario;
    expect(authoredScenarioContentIdentity(base)).not.toBe(authoredScenarioContentIdentity(edited));
  });

  it("changes identity when a nested actor emotionPolicy is edited", () => {
    const actor = {
      actorId: "patient_maya_johnson_v1",
      role: "patient",
      displayName: "Maya Johnson",
      demeanor: "anxious",
      communicationProfile: {
        styleFamily: "pediatric",
        style: "direct",
        intensity: 2,
        baselineMood: ["anxious"],
        communicativeness: "moderate",
      },
      emotionPolicy: { baselineAffect: "anxious", peakAffect: "distressed" },
      phenotype: { ageYears: 9, garmentLayers: ["short_sleeve_exam_tshirt"] },
    };
    const base = { ...makeScenario(), actors: [actor] } as unknown as AdminScenario;
    const edited = {
      ...base,
      actors: [{ ...actor, emotionPolicy: { baselineAffect: "anxious", peakAffect: "panic" } }],
    } as unknown as AdminScenario;
    expect(authoredScenarioContentIdentity(base)).not.toBe(authoredScenarioContentIdentity(edited));
  });

  it("does not change identity when only review labels or workflow status change", () => {
    const base = makeScenario();
    const labelsOnly = makeScenario({
      review: {
        clinical: "draft",
        psychometric: "approved",
        legal: "changes_requested",
        simulationQa: "approved",
      },
      status: "READY_FOR_REVIEW",
    });
    expect(authoredScenarioContentIdentity(base)).toBe(authoredScenarioContentIdentity(labelsOnly));
  });

  it("does not stale from object key insertion order", () => {
    const a = makeScenario();
    const record = a as unknown as Record<string, unknown>;
    const reordered = Object.fromEntries(
      Object.keys(record)
        .reverse()
        .map((key) => [key, record[key]]),
    ) as unknown as AdminScenario;
    expect(authoredScenarioContentIdentity(a)).toBe(authoredScenarioContentIdentity(reordered));
  });

  it("renders stale tags and refuses compile/learner-use after a version advance", async () => {
    const v1 = makeScenario({ version: 1 });
    const v2 = makeScenario({ version: 2 });
    const listScenarioReviewDecisions = vi.fn(async (input: { version: number }) =>
      input.version === 1 ? approvedHistory(v1, authoredScenarioContentIdentity(v1)) : [],
    );
    const submitScenarioReview = vi.fn();

    const { rerender } = render(
      <ScenarioReviewGatePanel
        scenario={v1}
        submitScenarioReview={submitScenarioReview}
        listScenarioReviewDecisions={listScenarioReviewDecisions}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("clinical: approved")).toBeInTheDocument();
    });

    rerender(
      <ScenarioReviewGatePanel
        scenario={v2}
        submitScenarioReview={submitScenarioReview}
        listScenarioReviewDecisions={listScenarioReviewDecisions}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("clinical: stale")).toBeInTheDocument();
      expect(screen.getByText("psychometric: stale")).toBeInTheDocument();
      expect(screen.getByText("legal: stale")).toBeInTheDocument();
      expect(screen.getByText("simulationQa: stale")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Compile learner-use readiness")).toHaveTextContent(
      "Compile/learner-use readiness: refused until stale or pending gates are recorded again",
    );
    expect(screen.getByText("Prior faculty approvals are stale")).toBeInTheDocument();
  });

  it("requires a new explicit per-dimension decision after authored content edits; labels alone do not reapprove", async () => {
    const original = makeScenario();
    const edited = makeScenario({
      title: "Pediatric Asthma With Parent Anxiety (edited stem)",
      review: { ...approvedReview },
    });
    const originalIdentity = authoredScenarioContentIdentity(original);
    const listScenarioReviewDecisions = vi.fn(async () => approvedHistory(original, originalIdentity));
    const submitScenarioReview = vi.fn(async (input: { reviewerRole: string; comments: string }) => ({
      ...edited,
      review: {
        ...edited.review,
        [input.reviewerRole]: "approved",
      },
    }));

    const { rerender } = render(
      <ScenarioReviewGatePanel
        scenario={original}
        submitScenarioReview={submitScenarioReview as never}
        listScenarioReviewDecisions={listScenarioReviewDecisions}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("clinical: approved")).toBeInTheDocument();
    });

    rerender(
      <ScenarioReviewGatePanel
        scenario={edited}
        submitScenarioReview={submitScenarioReview as never}
        listScenarioReviewDecisions={listScenarioReviewDecisions}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("clinical: stale")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Compile learner-use readiness")).toHaveTextContent("refused");

    fireEvent.change(screen.getByLabelText("Clinical rationale"), {
      target: { value: "Re-reviewed edited stem for local formative only." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit clinical decision" }));

    await waitFor(() => {
      expect(submitScenarioReview).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioId: edited.scenarioId,
          version: 1,
          reviewerRole: "clinical",
          comments: "Re-reviewed edited stem for local formative only.",
          evidenceRefs: expect.arrayContaining([
            `${AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX}${authoredScenarioContentIdentity(edited)}`,
          ]),
        }),
      );
    });

    expect(screen.getByText("psychometric: stale")).toBeInTheDocument();
    expect(screen.getByText("legal: stale")).toBeInTheDocument();
    expect(screen.getByText("simulationQa: stale")).toBeInTheDocument();
    expect(screen.getByLabelText("Compile learner-use readiness")).toHaveTextContent("refused");
  });

  it("marks a faculty compile lock stale when compile-node contentHash moves and refuses compile", () => {
    const previous: FacultyCompileLockRow[] = [
      {
        rowId: "lock:actor:patient_maya_johnson_v1",
        kind: "actor",
        compileSubject: "patient_maya_johnson_v1",
        locked: true,
        stale: false,
        contentHash: "hash-at-lock",
        reviewedVersion: 1,
        authoredContentIdentity: "identity-v1",
      },
    ];
    const next: FacultyCompileLockRow[] = [
      {
        rowId: "lock:actor:patient_maya_johnson_v1",
        kind: "actor",
        compileSubject: "patient_maya_johnson_v1",
        locked: false,
        stale: false,
        contentHash: "hash-after-edit",
        reviewedVersion: 2,
        authoredContentIdentity: "identity-v2",
      },
    ];

    const previousRow = previous[0];
    const nextRow = next[0];
    expect(previousRow).toBeDefined();
    expect(nextRow).toBeDefined();
    expect(previousRow && nextRow ? facultyCompileLockIdentityMoved(previousRow, nextRow) : false).toBe(true);
    const merged = mergeFacultyCompileLockRows(next, previous);
    expect(merged[0]).toMatchObject({
      locked: true,
      stale: true,
      contentHash: "hash-after-edit",
      reviewedVersion: 2,
    });
    expect(facultyCompileLockAllowsCompile(merged)).toBe(false);
  });

  it("does not inherit compile readiness from an unchanged lock label when authored identity moved", () => {
    const previous: FacultyCompileLockRow[] = [
      {
        rowId: "lock:equipment:nebulizer",
        kind: "equipment",
        compileSubject: "nebulizer",
        locked: true,
        stale: false,
        contentHash: "same-artifact-hash",
        reviewedVersion: 1,
        authoredContentIdentity: "identity-v1",
      },
    ];
    const next: FacultyCompileLockRow[] = [
      {
        rowId: "lock:equipment:nebulizer",
        kind: "equipment",
        compileSubject: "nebulizer",
        locked: true,
        stale: false,
        contentHash: "same-artifact-hash",
        reviewedVersion: 1,
        authoredContentIdentity: "identity-after-stem-edit",
      },
    ];

    const merged = mergeFacultyCompileLockRows(next, previous);
    expect(merged[0]?.locked).toBe(true);
    expect(merged[0]?.stale).toBe(true);
    expect(facultyCompileLockAllowsCompile(merged)).toBe(false);
  });

  it("keeps a lock current when version, authored identity, and contentHash all match", () => {
    const row: FacultyCompileLockRow = {
      rowId: "lock:actor:patient_maya_johnson_v1",
      kind: "actor",
      compileSubject: "patient_maya_johnson_v1",
      locked: true,
      stale: false,
      contentHash: "same-hash",
      reviewedVersion: 1,
      authoredContentIdentity: "same-identity",
    };
    const merged = mergeFacultyCompileLockRows([{ ...row, locked: false }], [row]);
    expect(merged[0]).toMatchObject({ locked: true, stale: false, contentHash: "same-hash" });
    expect(facultyCompileLockAllowsCompile(merged)).toBe(true);
  });
});
