import {
  type BuildSamplingPlanInput,
  type SamplingPlan,
  type SamplingPlanActivationRecord,
  type SamplingPlanActivationReview,
  type SamplingPlanCoverage,
  type SamplingPlanCoverageDimension,
  type SamplingPlanCoverageMatrixRow,
  type SamplingPlanCoverageRequirement,
  type SamplingPlanCoverageResult,
  type SamplingPlanScenarioRevision,
  type SamplingPlanScenarioRevisionRef,
  type SamplingPlanStationRevisionPin,
  type SamplingPlanStationSelection,
  type SamplingPlanSubstitution,
  type SamplingPlanSubstitutionResult,
  samplingPlanCoverageDimensions,
  samplingPlanNotEvidenceFor,
} from "./types.js";

export * from "./types.js";

export function buildSamplingPlan(input: BuildSamplingPlanInput): SamplingPlan {
  const blockers: string[] = [];
  const blueprint = input.blueprintRevision.blueprint;
  requireIdentity(input.examFormId, "exam_form_id_missing", blockers);
  requirePositiveVersion(input.planVersion, "plan_version_invalid", blockers);
  requireIdentity(blueprint.blueprintId, "blueprint_id_missing", blockers);
  requirePositiveVersion(
    input.blueprintRevision.blueprintVersion,
    "blueprint_version_invalid",
    blockers,
  );

  const sortedSlots = [...blueprint.stationSlots].sort(
    (left, right) => left.order - right.order || left.slotId.localeCompare(right.slotId),
  );
  if (sortedSlots.length === 0) blockers.push("blueprint_station_slots_empty");
  const seenSlotIds = new Set<string>();
  const seenStationOrders = new Set<number>();
  for (const slot of sortedSlots) {
    if (seenSlotIds.has(slot.slotId)) blockers.push(`duplicate_blueprint_slot:${slot.slotId}`);
    if (seenStationOrders.has(slot.order)) {
      blockers.push(`duplicate_blueprint_station_order:${slot.order}`);
    }
    seenSlotIds.add(slot.slotId);
    seenStationOrders.add(slot.order);
  }
  const selectionsBySlot = new Map<string, SamplingPlanStationSelection>();
  for (const selection of input.selections) {
    if (selectionsBySlot.has(selection.slotId)) {
      blockers.push(`duplicate_station_selection:${selection.slotId}`);
      continue;
    }
    selectionsBySlot.set(selection.slotId, selection);
  }

  const blueprintSlotIds = new Set(sortedSlots.map((slot) => slot.slotId));
  for (const selection of input.selections) {
    if (!blueprintSlotIds.has(selection.slotId)) {
      blockers.push(`selection_not_in_blueprint:${selection.slotId}`);
    }
  }
  for (const slot of sortedSlots) {
    if (!selectionsBySlot.has(slot.slotId)) {
      blockers.push(`station_selection_missing:${slot.slotId}`);
    }
  }

  const substitutionResults: SamplingPlanSubstitutionResult[] = [];
  const acceptedSubstitutionBySlot = new Map<string, SamplingPlanSubstitution>();
  const substitutionSlots = new Set<string>();
  const substitutionIds = new Set<string>();
  for (const substitution of input.substitutions ?? []) {
    const substitutionBlockers = validateSubstitution(substitution, selectionsBySlot);
    if (substitutionIds.has(substitution.substitutionId)) {
      substitutionBlockers.push(`duplicate_substitution_id:${substitution.substitutionId}`);
    }
    substitutionIds.add(substitution.substitutionId);
    if (substitutionSlots.has(substitution.slotId)) {
      substitutionBlockers.push(`duplicate_substitution_for_slot:${substitution.slotId}`);
    }
    substitutionSlots.add(substitution.slotId);
    const applied = substitution.review.status === "accepted" && substitutionBlockers.length === 0;
    if (applied) {
      acceptedSubstitutionBySlot.set(substitution.slotId, substitution);
    }
    substitutionResults.push({
      substitutionId: substitution.substitutionId,
      slotId: substitution.slotId,
      fromScenarioRevision: { ...substitution.fromScenarioRevision },
      toScenarioRevision: scenarioRevisionRef(substitution.toScenario),
      rationale: substitution.rationale,
      review: { ...substitution.review },
      applied,
      blockers: unique(substitutionBlockers),
    });
    blockers.push(...substitutionBlockers);
  }

  const coverageMatrix: SamplingPlanCoverageMatrixRow[] = [];
  for (const slot of sortedSlots) {
    const selection = selectionsBySlot.get(slot.slotId);
    if (!selection) continue;
    const substitution = acceptedSubstitutionBySlot.get(slot.slotId);
    const scenario = substitution?.toScenario ?? selection.scenario;
    validateScenarioRevision(scenario, slot.slotId, blockers);
    coverageMatrix.push({
      slotId: slot.slotId,
      stationOrder: slot.order,
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.scenarioVersion,
      scenarioTitle: scenario.title,
      selectionSource: substitution ? "faculty_substitution" : "blueprint_assignment",
      substitutionId: substitution?.substitutionId ?? null,
      coverage: normalizeCoverage(scenario.coverage),
    });
  }

  const requirements = normalizeRequirements(input.blueprintRevision.requirements, blockers);
  const configuredDimensions = new Set(requirements.map((requirement) => requirement.dimension));
  const unconfiguredDimensions = samplingPlanCoverageDimensions.filter(
    (dimension) => !configuredDimensions.has(dimension),
  );
  const coverageResults = requirements.map((requirement): SamplingPlanCoverageResult => {
    const coveredBySlotIds = coverageMatrix
      .filter((row) => row.coverage[requirement.dimension].includes(requirement.value))
      .map((row) => row.slotId);
    const deficit = Math.max(0, requirement.minimumStations - coveredBySlotIds.length);
    return {
      ...requirement,
      coveredBySlotIds,
      actualStations: coveredBySlotIds.length,
      deficit,
      status: deficit === 0 ? "met" : "gap",
    };
  });
  const gaps = coverageResults.filter((result) => result.status === "gap");
  blockers.push(
    ...gaps.map(
      (gap) =>
        `coverage_gap:${gap.dimension}:${gap.value}:need_${gap.minimumStations}:have_${gap.actualStations}`,
    ),
  );

  const activationBlockers = unique(blockers);
  const blueprintRevision = {
    blueprintId: blueprint.blueprintId,
    blueprintVersion: input.blueprintRevision.blueprintVersion,
  };
  const scenarioRevisions = coverageMatrix.map((row) => ({
    slotId: row.slotId,
    stationOrder: row.stationOrder,
    scenarioId: row.scenarioId,
    scenarioVersion: row.scenarioVersion,
  }));
  const reviewIdentity = canonicalReviewIdentity({
    examFormId: input.examFormId,
    planVersion: input.planVersion,
    blueprintRevision,
    blueprint: {
      title: blueprint.title,
      stationSlots: sortedSlots,
      timing: blueprint.timing,
      requiredTraceTags: blueprint.requiredTraceTags,
      requiredSafetyCriticalTraceTags: blueprint.requiredSafetyCriticalTraceTags,
    },
    scenarioRevisions,
    coverageMatrix,
    coverageResults,
    unconfiguredDimensions,
    substitutions: substitutionResults,
    activationBlockers,
  });
  return {
    schemaVersion: "openclinxr.sampling-plan.v1",
    reviewIdentity,
    examFormId: input.examFormId,
    planVersion: input.planVersion,
    blueprintRevision,
    scenarioRevisions,
    coverageMatrix,
    coverageResults,
    gaps,
    unconfiguredDimensions,
    substitutions: substitutionResults,
    activationStatus:
      activationBlockers.length === 0 ? "ready_for_faculty_review" : "blocked",
    activationBlockers,
    claimBoundary: "faculty_reviewable_construct_coverage_not_validity_evidence",
    notEvidenceFor: samplingPlanNotEvidenceFor,
    validityEvidenceGate: false,
  };
}

export function createSamplingPlanActivationReview(
  plan: SamplingPlan,
  input: Pick<
    SamplingPlanActivationReview,
    "decisionId" | "decision" | "reviewerId" | "decidedAt"
  >,
): SamplingPlanActivationReview {
  return {
    ...input,
    reviewIdentity: plan.reviewIdentity,
    examFormId: plan.examFormId,
    planVersion: plan.planVersion,
    blueprintRevision: { ...plan.blueprintRevision },
    scenarioRevisions: plan.scenarioRevisions.map((revision) => ({ ...revision })),
  };
}

export function decideSamplingPlanActivation(
  plan: SamplingPlan,
  review: SamplingPlanActivationReview,
): SamplingPlanActivationRecord {
  const blockers = [...plan.activationBlockers];
  requireIdentity(review.decisionId, "decision_id_missing", blockers);
  requireIdentity(review.reviewerId, "reviewer_id_missing", blockers);
  requireIdentity(review.decidedAt, "decision_timestamp_missing", blockers);
  if (review.reviewIdentity !== plan.reviewIdentity) blockers.push("stale_review:plan_content");
  if (review.examFormId !== plan.examFormId) blockers.push("stale_review:exam_form_identity");
  if (review.planVersion !== plan.planVersion) blockers.push("stale_review:plan_version");
  if (!sameBlueprintRevision(review.blueprintRevision, plan.blueprintRevision)) {
    blockers.push("stale_review:blueprint_revision");
  }
  if (!sameScenarioRevisions(review.scenarioRevisions, plan.scenarioRevisions)) {
    blockers.push("stale_review:scenario_revisions");
  }
  if (review.decision === "reject_activation") blockers.push("faculty_rejected_activation");

  const uniqueBlockers = unique(blockers);
  return {
    schemaVersion: "openclinxr.sampling-plan-activation.v1",
    decisionId: review.decisionId,
    reviewIdentity: plan.reviewIdentity,
    status:
      review.decision === "approve_activation" && uniqueBlockers.length === 0
        ? "active"
        : "blocked",
    examFormId: plan.examFormId,
    planVersion: plan.planVersion,
    reviewerId: review.reviewerId,
    decidedAt: review.decidedAt,
    blueprintRevision: { ...plan.blueprintRevision },
    scenarioRevisions: plan.scenarioRevisions.map((revision) => ({ ...revision })),
    substitutionReviews: plan.substitutions.map((substitution) => ({
      ...substitution,
      fromScenarioRevision: { ...substitution.fromScenarioRevision },
      toScenarioRevision: { ...substitution.toScenarioRevision },
      review: { ...substitution.review },
      blockers: [...substitution.blockers],
    })),
    coverageResults: plan.coverageResults.map((result) => ({
      ...result,
      coveredBySlotIds: [...result.coveredBySlotIds],
    })),
    unconfiguredDimensions: [...plan.unconfiguredDimensions],
    blockers: uniqueBlockers,
    claimBoundary: plan.claimBoundary,
    notEvidenceFor: samplingPlanNotEvidenceFor,
    validityEvidenceGate: false,
  };
}

function validateSubstitution(
  substitution: SamplingPlanSubstitution,
  selectionsBySlot: ReadonlyMap<string, SamplingPlanStationSelection>,
): string[] {
  const blockers: string[] = [];
  requireIdentity(substitution.substitutionId, "substitution_id_missing", blockers);
  requireIdentity(substitution.rationale, `substitution_rationale_missing:${substitution.substitutionId}`, blockers);
  const selection = selectionsBySlot.get(substitution.slotId);
  if (!selection) {
    blockers.push(`substitution_slot_missing:${substitution.slotId}`);
  } else if (!sameScenarioRevision(substitution.fromScenarioRevision, selection.scenario)) {
    blockers.push(`substitution_source_revision_mismatch:${substitution.substitutionId}`);
  }
  if (substitution.review.status === "pending") {
    blockers.push(`substitution_pending_review:${substitution.substitutionId}`);
  } else {
    requireIdentity(
      substitution.review.reviewerId,
      `substitution_reviewer_missing:${substitution.substitutionId}`,
      blockers,
    );
    requireIdentity(
      substitution.review.reviewedAt,
      `substitution_review_timestamp_missing:${substitution.substitutionId}`,
      blockers,
    );
  }
  if (substitution.review.status === "accepted") {
    validateScenarioRevision(substitution.toScenario, substitution.slotId, blockers);
  }
  return unique(blockers);
}

function validateScenarioRevision(
  scenario: SamplingPlanScenarioRevision,
  slotId: string,
  blockers: string[],
): void {
  requireIdentity(scenario.scenarioId, `scenario_id_missing:${slotId}`, blockers);
  requirePositiveVersion(
    scenario.scenarioVersion,
    `scenario_version_invalid:${slotId}:${scenario.scenarioId}`,
    blockers,
  );
  if (scenario.status !== "approved") {
    blockers.push(`scenario_revision_not_approved:${slotId}:${scenario.scenarioId}`);
  }
}

function normalizeRequirements(
  requirements: readonly SamplingPlanCoverageRequirement[],
  blockers: string[],
): SamplingPlanCoverageRequirement[] {
  const seen = new Set<string>();
  const configuredDimensions = new Set<SamplingPlanCoverageDimension>();
  const normalized = requirements.map((requirement) => {
    if (seen.has(requirement.requirementId)) {
      blockers.push(`duplicate_coverage_requirement:${requirement.requirementId}`);
    }
    seen.add(requirement.requirementId);
    configuredDimensions.add(requirement.dimension);
    requireIdentity(requirement.requirementId, "coverage_requirement_id_missing", blockers);
    requireIdentity(
      requirement.value,
      `coverage_requirement_value_missing:${requirement.requirementId}`,
      blockers,
    );
    requirePositiveVersion(
      requirement.minimumStations,
      `coverage_requirement_minimum_invalid:${requirement.requirementId}`,
      blockers,
    );
    return {
      ...requirement,
      requirementId: requirement.requirementId.trim(),
      value: requirement.value.trim(),
    };
  });
  for (const dimension of samplingPlanCoverageDimensions) {
    if (!configuredDimensions.has(dimension)) {
      blockers.push(`coverage_dimension_unconfigured:${dimension}`);
    }
  }
  return normalized;
}

function normalizeCoverage(coverage: SamplingPlanCoverage): SamplingPlanCoverage {
  return Object.fromEntries(
    samplingPlanCoverageDimensions.map((dimension) => [
      dimension,
      unique(coverage[dimension].map((value) => value.trim()).filter(Boolean)).sort(),
    ]),
  ) as unknown as SamplingPlanCoverage;
}

function scenarioRevisionRef(
  scenario: SamplingPlanScenarioRevision,
): SamplingPlanScenarioRevisionRef {
  return {
    scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion,
  };
}

function sameScenarioRevision(
  expected: SamplingPlanScenarioRevisionRef,
  actual: SamplingPlanScenarioRevision,
): boolean {
  return (
    expected.scenarioId === actual.scenarioId &&
    expected.scenarioVersion === actual.scenarioVersion
  );
}

function sameBlueprintRevision(
  left: SamplingPlan["blueprintRevision"],
  right: SamplingPlan["blueprintRevision"],
): boolean {
  return (
    left.blueprintId === right.blueprintId &&
    left.blueprintVersion === right.blueprintVersion
  );
}

function sameScenarioRevisions(
  left: readonly SamplingPlanStationRevisionPin[],
  right: readonly SamplingPlanStationRevisionPin[],
): boolean {
  const canonical = (revisions: readonly SamplingPlanStationRevisionPin[]) =>
    [...revisions]
      .sort(
        (a, b) =>
          a.stationOrder - b.stationOrder ||
          a.slotId.localeCompare(b.slotId) ||
          a.scenarioId.localeCompare(b.scenarioId),
      )
      .map(
        (revision) =>
          `${revision.stationOrder}:${revision.slotId}:${revision.scenarioId}:${revision.scenarioVersion}`,
      );
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function requireIdentity(value: string, blocker: string, blockers: string[]): void {
  if (value.trim().length === 0) blockers.push(blocker);
}

function requirePositiveVersion(value: number, blocker: string, blockers: string[]): void {
  if (!Number.isSafeInteger(value) || value < 1) blockers.push(blocker);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function canonicalReviewIdentity(value: unknown): string {
  return JSON.stringify(value);
}
