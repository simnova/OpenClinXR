import type { ExamBlueprint } from "../types.js";

export const samplingPlanCoverageDimensions = [
  "specialty",
  "environment",
  "actor_role",
  "safety_critical_event",
  "communication",
  "reasoning",
  "synthesis",
  "pressure_profile",
] as const;

export type SamplingPlanCoverageDimension = (typeof samplingPlanCoverageDimensions)[number];

export type SamplingPlanCoverage = Readonly<
  Record<SamplingPlanCoverageDimension, readonly string[]>
>;

export type SamplingPlanCoverageRequirement = {
  requirementId: string;
  dimension: SamplingPlanCoverageDimension;
  value: string;
  minimumStations: number;
};

export type SamplingPlanScenarioRevision = {
  scenarioId: string;
  scenarioVersion: number;
  title: string;
  status: "approved" | "draft" | "retired";
  coverage: SamplingPlanCoverage;
};

export type SamplingPlanScenarioRevisionRef = {
  scenarioId: string;
  scenarioVersion: number;
};

export type SamplingPlanStationRevisionPin = SamplingPlanScenarioRevisionRef & {
  slotId: string;
  stationOrder: number;
};

export type SamplingPlanStationSelection = {
  slotId: string;
  scenario: SamplingPlanScenarioRevision;
};

export type SamplingPlanSubstitutionReview =
  | { status: "pending" }
  | {
      status: "accepted" | "rejected";
      reviewerId: string;
      reviewedAt: string;
    };

export type SamplingPlanSubstitution = {
  substitutionId: string;
  slotId: string;
  fromScenarioRevision: SamplingPlanScenarioRevisionRef;
  toScenario: SamplingPlanScenarioRevision;
  rationale: string;
  review: SamplingPlanSubstitutionReview;
};

export type BuildSamplingPlanInput = {
  examFormId: string;
  planVersion: number;
  blueprintRevision: {
    blueprint: ExamBlueprint;
    blueprintVersion: number;
    requirements: readonly SamplingPlanCoverageRequirement[];
  };
  selections: readonly SamplingPlanStationSelection[];
  substitutions?: readonly SamplingPlanSubstitution[];
};

export type SamplingPlanCoverageMatrixRow = {
  slotId: string;
  stationOrder: number;
  scenarioId: string;
  scenarioVersion: number;
  scenarioTitle: string;
  selectionSource: "blueprint_assignment" | "faculty_substitution";
  substitutionId: string | null;
  coverage: SamplingPlanCoverage;
};

export type SamplingPlanCoverageResult = SamplingPlanCoverageRequirement & {
  coveredBySlotIds: string[];
  actualStations: number;
  deficit: number;
  status: "met" | "gap";
};

export type SamplingPlanSubstitutionResult = {
  substitutionId: string;
  slotId: string;
  fromScenarioRevision: SamplingPlanScenarioRevisionRef;
  toScenarioRevision: SamplingPlanScenarioRevisionRef;
  rationale: string;
  review: SamplingPlanSubstitutionReview;
  applied: boolean;
  blockers: string[];
};

export const samplingPlanNotEvidenceFor = [
  "clinical_validity",
  "psychometric_validity",
  "scoring_validity",
  "licensure_equivalence",
  "exam_equivalence",
] as const;

export type SamplingPlan = {
  schemaVersion: "openclinxr.sampling-plan.v1";
  /** Canonical serialized identity of every reviewed blueprint, requirement, selection, and substitution field. */
  reviewIdentity: string;
  examFormId: string;
  planVersion: number;
  blueprintRevision: {
    blueprintId: string;
    blueprintVersion: number;
  };
  scenarioRevisions: SamplingPlanStationRevisionPin[];
  coverageMatrix: SamplingPlanCoverageMatrixRow[];
  coverageResults: SamplingPlanCoverageResult[];
  gaps: SamplingPlanCoverageResult[];
  unconfiguredDimensions: SamplingPlanCoverageDimension[];
  substitutions: SamplingPlanSubstitutionResult[];
  activationStatus: "blocked" | "ready_for_faculty_review";
  activationBlockers: string[];
  claimBoundary: "faculty_reviewable_construct_coverage_not_validity_evidence";
  notEvidenceFor: typeof samplingPlanNotEvidenceFor;
  validityEvidenceGate: false;
};

export type SamplingPlanActivationReview = {
  decisionId: string;
  decision: "approve_activation" | "reject_activation";
  reviewerId: string;
  decidedAt: string;
  reviewIdentity: string;
  examFormId: string;
  planVersion: number;
  blueprintRevision: SamplingPlan["blueprintRevision"];
  scenarioRevisions: SamplingPlanStationRevisionPin[];
};

export type SamplingPlanActivationRecord = {
  schemaVersion: "openclinxr.sampling-plan-activation.v1";
  decisionId: string;
  reviewIdentity: string;
  status: "active" | "blocked";
  examFormId: string;
  planVersion: number;
  reviewerId: string;
  decidedAt: string;
  blueprintRevision: SamplingPlan["blueprintRevision"];
  scenarioRevisions: SamplingPlanStationRevisionPin[];
  substitutionReviews: SamplingPlanSubstitutionResult[];
  coverageResults: SamplingPlanCoverageResult[];
  unconfiguredDimensions: SamplingPlanCoverageDimension[];
  blockers: string[];
  claimBoundary: SamplingPlan["claimBoundary"];
  notEvidenceFor: typeof samplingPlanNotEvidenceFor;
  validityEvidenceGate: false;
};
