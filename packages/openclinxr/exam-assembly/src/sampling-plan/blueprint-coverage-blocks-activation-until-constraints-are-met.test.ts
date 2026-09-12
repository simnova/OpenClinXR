import type { Scenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { assembleExamForm, type ExamBlueprint } from "../index.js";
import {
  type BuildSamplingPlanInput,
  buildSamplingPlan,
  createSamplingPlanActivationReview,
  decideSamplingPlanActivation,
  type SamplingPlanCoverage,
  type SamplingPlanCoverageRequirement,
  type SamplingPlanScenarioRevision,
  type SamplingPlanSubstitution,
  samplingPlanCoverageDimensions,
} from "./evaluate.js";

describe("sampling-plan activation workflow", () => {
  it("builds a reviewable eight-construct matrix and activates only the exact reviewed revisions", () => {
    const input = completeInput();
    const assembledForm = assembleExamForm({
      examFormId: input.examFormId,
      blueprint: input.blueprintRevision.blueprint,
      scenarios: stationScenariosFromInput(input),
    });
    expect(assembledForm.status).toBe("ready_for_review");
    const plan = buildSamplingPlan({
      ...input,
      assembledForm,
      stationScenarios: stationScenariosFromInput(input),
    });

    expect(plan.activationStatus).toBe("ready_for_faculty_review");
    expect(plan.gaps).toEqual([]);
    expect(plan.coverageMatrix).toHaveLength(2);
    expect(plan.coverageResults.map((result) => result.dimension)).toEqual(
      samplingPlanCoverageDimensions,
    );
    expect(plan.scenarioRevisions).toEqual([
      { slotId: "station_ed", stationOrder: 1, scenarioId: "ed_chest", scenarioVersion: 7 },
      { slotId: "station_peds", stationOrder: 2, scenarioId: "peds_fever", scenarioVersion: 3 },
    ]);

    const review = createSamplingPlanActivationReview(plan, {
      decisionId: "sampling_decision_001",
      decision: "approve_activation",
      reviewerId: "faculty_reviewer_001",
      decidedAt: "2026-09-04T19:30:00.000Z",
    });
    const record = decideSamplingPlanActivation(plan, review);

    expect(record.status).toBe("active");
    expect(record.blueprintRevision).toEqual({
      blueprintId: "blueprint_construct_v1",
      blueprintVersion: 4,
    });
    expect(record.scenarioRevisions).toEqual(plan.scenarioRevisions);
    expect(record.validityEvidenceGate).toBe(false);
    expect(record.notEvidenceFor).toContain("psychometric_validity");
  });

  it("fails closed with explicit gaps across required constructs", () => {
    const input = completeInput();
    const plan = buildSamplingPlan({
      ...input,
      selections: [input.selections[0]].filter((selection) => selection !== undefined),
    });

    expect(plan.activationStatus).toBe("blocked");
    expect(plan.activationBlockers).toContain("station_selection_missing:station_peds");
    expect(plan.gaps.map((gap) => `${gap.dimension}:${gap.value}`)).toEqual([
      "specialty:pediatrics",
      "environment:pediatrics_clinic",
      "actor_role:parent",
      "safety_critical_event:sepsis_escalation",
      "communication:caregiver_agenda_setting",
      "reasoning:age_adjusted_differential",
      "synthesis:family_facing_summary",
      "pressure_profile:caregiver_anxiety",
    ]);

    const record = decideSamplingPlanActivation(
      plan,
      createSamplingPlanActivationReview(plan, {
        decisionId: "sampling_decision_blocked",
        decision: "approve_activation",
        reviewerId: "faculty_reviewer_001",
        decidedAt: "2026-09-04T19:31:00.000Z",
      }),
    );
    expect(record.status).toBe("blocked");
    expect(record.blockers).toContain(
      "coverage_gap:reasoning:age_adjusted_differential:need_1:have_0",
    );
  });

  it("applies only an accepted, revision-matched substitution and persists its review", () => {
    const input = completeInput();
    const basePeds = input.selections[1]?.scenario;
    if (!basePeds) throw new Error("fixture missing peds selection");
    const pending = substitution(basePeds, { status: "pending" });
    const pendingPlan = buildSamplingPlan({ ...input, substitutions: [pending] });
    expect(pendingPlan.activationStatus).toBe("blocked");
    expect(pendingPlan.activationBlockers).toContain("substitution_pending_review:sub_peds_001");
    expect(pendingPlan.coverageMatrix[1]?.scenarioId).toBe("peds_fever");

    const accepted: SamplingPlanSubstitution = {
      ...pending,
      review: {
        status: "accepted",
        reviewerId: "faculty_reviewer_002",
        reviewedAt: "2026-09-04T19:32:00.000Z",
      },
    };
    const acceptedPlan = buildSamplingPlan({ ...input, substitutions: [accepted] });
    expect(acceptedPlan.activationStatus).toBe("ready_for_faculty_review");
    expect(acceptedPlan.coverageMatrix[1]).toMatchObject({
      scenarioId: "peds_fever_substitute",
      scenarioVersion: 9,
      selectionSource: "faculty_substitution",
      substitutionId: "sub_peds_001",
    });

    const record = decideSamplingPlanActivation(
      acceptedPlan,
      createSamplingPlanActivationReview(acceptedPlan, {
        decisionId: "sampling_decision_substitution",
        decision: "approve_activation",
        reviewerId: "faculty_reviewer_003",
        decidedAt: "2026-09-04T19:33:00.000Z",
      }),
    );
    expect(record.status).toBe("active");
    expect(record.scenarioRevisions[1]).toMatchObject({
      scenarioId: "peds_fever_substitute",
      scenarioVersion: 9,
    });
    expect(record.substitutionReviews[0]).toMatchObject({
      applied: true,
      review: { status: "accepted", reviewerId: "faculty_reviewer_002" },
    });
  });

  it("refuses stale substitution sources and stale activation review pins", () => {
    const input = completeInput();
    const basePeds = input.selections[1]?.scenario;
    if (!basePeds) throw new Error("fixture missing peds selection");
    const staleSubstitution = substitution(basePeds, {
      status: "accepted",
      reviewerId: "faculty_reviewer_002",
      reviewedAt: "2026-09-04T19:34:00.000Z",
    });
    staleSubstitution.fromScenarioRevision.scenarioVersion = 2;
    const staleSubstitutionPlan = buildSamplingPlan({
      ...input,
      substitutions: [staleSubstitution],
    });
    expect(staleSubstitutionPlan.activationStatus).toBe("blocked");
    expect(staleSubstitutionPlan.activationBlockers).toContain(
      "substitution_source_revision_mismatch:sub_peds_001",
    );
    expect(staleSubstitutionPlan.coverageMatrix[1]?.scenarioId).toBe("peds_fever");

    const plan = buildSamplingPlan(input);
    const review = createSamplingPlanActivationReview(plan, {
      decisionId: "sampling_decision_stale",
      decision: "approve_activation",
      reviewerId: "faculty_reviewer_001",
      decidedAt: "2026-09-04T19:35:00.000Z",
    });
    const firstRevision = review.scenarioRevisions[0];
    if (!firstRevision) throw new Error("fixture missing scenario revision");
    firstRevision.scenarioVersion = 999;
    const record = decideSamplingPlanActivation(plan, review);
    expect(record.status).toBe("blocked");
    expect(record.blockers).toContain("stale_review:scenario_revisions");
  });

  it("refuses an old review when construct content changes under the same numeric versions", () => {
    const input = completeInput();
    const originalPlan = buildSamplingPlan(input);
    const originalReview = createSamplingPlanActivationReview(originalPlan, {
      decisionId: "sampling_decision_content_stale",
      decision: "approve_activation",
      reviewerId: "faculty_reviewer_001",
      decidedAt: "2026-09-04T19:36:00.000Z",
    });
    const peds = input.selections[1]?.scenario;
    if (!peds) throw new Error("fixture missing peds selection");
    const changedPlan = buildSamplingPlan({
      ...input,
      blueprintRevision: {
        ...input.blueprintRevision,
        requirements: input.blueprintRevision.requirements.map((coverageRequirement) =>
          coverageRequirement.dimension === "reasoning"
            ? { ...coverageRequirement, value: "developmental_reasoning" }
            : coverageRequirement,
        ),
      },
      selections: [
        input.selections[0],
        {
          slotId: "station_peds",
          scenario: {
            ...peds,
            coverage: {
              ...peds.coverage,
              reasoning: ["developmental_reasoning"],
            },
          },
        },
      ].filter((selection) => selection !== undefined),
    });

    expect(changedPlan.activationStatus).toBe("ready_for_faculty_review");
    expect(changedPlan.scenarioRevisions).toEqual(originalPlan.scenarioRevisions);
    expect(changedPlan.reviewIdentity).not.toBe(originalPlan.reviewIdentity);
    const record = decideSamplingPlanActivation(changedPlan, originalReview);
    expect(record.status).toBe("blocked");
    expect(record.blockers).toContain("stale_review:plan_content");
  });

  it("rejects duplicate substitution identities even when they target different slots", () => {
    const input = completeInput();
    const ed = input.selections[0]?.scenario;
    const peds = input.selections[1]?.scenario;
    if (!ed || !peds) throw new Error("fixture missing selections");
    const acceptedReview = {
      status: "accepted" as const,
      reviewerId: "faculty_reviewer_002",
      reviewedAt: "2026-09-04T19:37:00.000Z",
    };
    const first = substitution(peds, acceptedReview);
    const duplicateId: SamplingPlanSubstitution = {
      ...first,
      slotId: "station_ed",
      fromScenarioRevision: {
        scenarioId: ed.scenarioId,
        scenarioVersion: ed.scenarioVersion,
      },
      toScenario: { ...ed, scenarioId: "ed_chest_substitute", scenarioVersion: 8 },
    };

    const plan = buildSamplingPlan({ ...input, substitutions: [first, duplicateId] });
    expect(plan.activationStatus).toBe("blocked");
    expect(plan.activationBlockers).toContain("duplicate_substitution_id:sub_peds_001");
    expect(plan.substitutions[1]?.applied).toBe(false);
  });

  it("blocks activation when assembleExamForm reports unmet environment or safety-critical coverage", () => {
    const input = completeInput();
    const peds = input.selections[1]?.scenario;
    if (!peds) throw new Error("fixture missing peds selection");
    const incompletePeds: SamplingPlanScenarioRevision = {
      ...peds,
      coverage: {
        ...peds.coverage,
        environment: ["wrong_clinic"],
        safety_critical_event: ["wrong_escalation"],
      },
    };
    const incompleteInput: BuildSamplingPlanInput = {
      ...input,
      selections: [
        input.selections[0],
        { slotId: "station_peds", scenario: incompletePeds },
      ].filter((selection) => selection !== undefined),
    };
    const assembledForm = assembleExamForm({
      examFormId: incompleteInput.examFormId,
      blueprint: incompleteInput.blueprintRevision.blueprint,
      scenarios: stationScenariosFromInput(incompleteInput),
    });
    expect(assembledForm.status).toBe("blueprint_incomplete");
    expect(assembledForm.coverage.missingEnvironmentIds).toEqual(["pediatrics_clinic"]);
    expect(assembledForm.coverage.missingSafetyCriticalTraceTags).toEqual(["sepsis_escalation"]);

    const plan = buildSamplingPlan({
      ...incompleteInput,
      assembledForm,
      stationScenarios: stationScenariosFromInput(incompleteInput),
    });
    expect(plan.activationStatus).toBe("blocked");
    expect(plan.activationBlockers).toEqual(
      expect.arrayContaining([
        "assembly:missing_environment_coverage:pediatrics_clinic",
        "assembly:missing_safety_critical_trace_coverage:sepsis_escalation",
        "assembly_status:blueprint_incomplete",
        "coverage_gap:environment:pediatrics_clinic:need_1:have_0",
        "coverage_gap:safety_critical_event:sepsis_escalation:need_1:have_0",
      ]),
    );
  });

  it("requires a configured constraint for every activation dimension", () => {
    const input = completeInput();
    const plan = buildSamplingPlan({
      ...input,
      blueprintRevision: {
        ...input.blueprintRevision,
        requirements: input.blueprintRevision.requirements.filter(
          (coverageRequirement) => coverageRequirement.dimension !== "pressure_profile",
        ),
      },
    });

    expect(plan.activationStatus).toBe("blocked");
    expect(plan.activationBlockers).toContain(
      "coverage_dimension_unconfigured:pressure_profile",
    );
    expect(plan.unconfiguredDimensions).toEqual(["pressure_profile"]);
  });
});

function completeInput(): BuildSamplingPlanInput {
  return {
    examFormId: "form_construct_review_001",
    planVersion: 2,
    blueprintRevision: {
      blueprint: blueprint(),
      blueprintVersion: 4,
      requirements: requirements(),
    },
    selections: [
      { slotId: "station_ed", scenario: edScenario() },
      { slotId: "station_peds", scenario: pedsScenario() },
    ],
  };
}

function blueprint(): ExamBlueprint {
  return {
    blueprintId: "blueprint_construct_v1",
    title: "Construct coverage blueprint",
    stationSlots: [
      {
        slotId: "station_ed",
        order: 1,
        label: "Emergency medicine",
        requiredEnvironmentIds: ["ed_bay"],
        requiredTraceTags: ["urgent_recognition"],
      },
      {
        slotId: "station_peds",
        order: 2,
        label: "Pediatrics",
        requiredEnvironmentIds: ["pediatrics_clinic"],
        requiredTraceTags: ["caregiver_communication"],
      },
    ],
    timing: {
      doorwaySeconds: 60,
      encounterSeconds: 900,
      noteSeconds: 600,
      breakAfterStationOrders: [],
    },
    requiredTraceTags: ["urgent_recognition", "caregiver_communication"],
    requiredSafetyCriticalTraceTags: ["acs_escalation", "sepsis_escalation"],
  };
}

function requirements(): SamplingPlanCoverageRequirement[] {
  return [
    requirement("specialty", "pediatrics"),
    requirement("environment", "pediatrics_clinic"),
    requirement("actor_role", "parent"),
    requirement("safety_critical_event", "sepsis_escalation"),
    requirement("communication", "caregiver_agenda_setting"),
    requirement("reasoning", "age_adjusted_differential"),
    requirement("synthesis", "family_facing_summary"),
    requirement("pressure_profile", "caregiver_anxiety"),
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

function edScenario(): SamplingPlanScenarioRevision {
  return {
    scenarioId: "ed_chest",
    scenarioVersion: 7,
    title: "Emergency chest pressure",
    status: "approved",
    coverage: coverage({
      specialty: ["emergency_medicine"],
      environment: ["ed_bay"],
      actor_role: ["patient", "nurse"],
      safety_critical_event: ["acs_escalation"],
      communication: ["urgent_team_handoff"],
      reasoning: ["acute_coronary_differential"],
      synthesis: ["consultant_summary"],
      pressure_profile: ["time_critical_deterioration"],
    }),
  };
}

function pedsScenario(): SamplingPlanScenarioRevision {
  return {
    scenarioId: "peds_fever",
    scenarioVersion: 3,
    title: "Pediatric fever with caregiver",
    status: "approved",
    coverage: coverage({
      specialty: ["pediatrics"],
      environment: ["pediatrics_clinic"],
      actor_role: ["patient", "parent"],
      safety_critical_event: ["sepsis_escalation"],
      communication: ["caregiver_agenda_setting"],
      reasoning: ["age_adjusted_differential"],
      synthesis: ["family_facing_summary"],
      pressure_profile: ["caregiver_anxiety"],
    }),
  };
}

function substitutePedsScenario(): SamplingPlanScenarioRevision {
  return {
    ...pedsScenario(),
    scenarioId: "peds_fever_substitute",
    scenarioVersion: 9,
    title: "Pediatric fever substitute",
  };
}

function substitution(
  base: SamplingPlanScenarioRevision,
  review: SamplingPlanSubstitution["review"],
): SamplingPlanSubstitution {
  return {
    substitutionId: "sub_peds_001",
    slotId: "station_peds",
    fromScenarioRevision: {
      scenarioId: base.scenarioId,
      scenarioVersion: base.scenarioVersion,
    },
    toScenario: substitutePedsScenario(),
    rationale: "Use the reviewed pediatric alternate while preserving construct coverage.",
    review,
  };
}

function coverage(values: SamplingPlanCoverage): SamplingPlanCoverage {
  return values;
}

function stationScenariosFromInput(input: BuildSamplingPlanInput): Scenario[] {
  return input.selections.map((selection) => {
    const slot = input.blueprintRevision.blueprint.stationSlots.find(
      (candidate) => candidate.slotId === selection.slotId,
    );
    if (!slot) throw new Error(`fixture missing slot ${selection.slotId}`);
    const environmentId =
      selection.scenario.coverage.environment[0] ?? slot.requiredEnvironmentIds[0] ?? "unspecified_environment";
    const safetyTags =
      selection.scenario.coverage.safety_critical_event.length > 0
        ? [...selection.scenario.coverage.safety_critical_event]
        : ["unspecified_safety_event"];
    return {
      scenarioId: selection.scenario.scenarioId,
      version: selection.scenario.scenarioVersion,
      title: selection.scenario.title,
      status: selection.scenario.status,
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
      clinicalObjectives: ["faculty_reviewable_construct_coverage"],
      actors: (selection.scenario.coverage.actor_role.length > 0
        ? selection.scenario.coverage.actor_role
        : ["patient"]
      ).map((role, index) => ({
        actorId: `${selection.scenario.scenarioId}_${role}_${index}`,
        role: role === "parent" ? "family" : role === "nurse" ? "nurse" : "patient",
        displayName: role,
      })),
      requiredTraceTags: [...slot.requiredTraceTags],
      eventSchedule: [],
      reviewRubric: [
        {
          rubricId: `${selection.scenario.scenarioId}_rubric`,
          label: selection.scenario.title,
          requiredTraceTags: [...slot.requiredTraceTags],
        },
      ],
      governance: {
        scoreUseLabel: "formative_local_only",
        syntheticCaseDisclosure: "Synthetic fixture for faculty coverage review.",
        validationStage: "stage_1_expert_reviewed",
        validationLimitations: ["Construct coverage is not validity evidence."],
        requiredReviewerRoles: ["clinician"],
        sourceIds: ["src-blueprint-coverage"],
        safetyCriticalTraceTags: safetyTags,
        hiddenFactPolicy: {
          learnerView: "redact_hidden_facts",
          disclosureRequiresTrigger: true,
        },
      },
      environment: {
        environmentId,
        name: environmentId,
        description: environmentId,
      },
    };
  });
}
