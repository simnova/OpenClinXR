import type { Scenario } from "@openclinxr/shared-schemas";

export const SCENARIO_PROPOSALS_PATH = "/internal/scenario-proposals";

export const SCENARIO_PROPOSAL_CLAIM_BOUNDARY =
  "model_assisted_scenario_proposal_not_exam_equivalence" as const;

export const SCENARIO_PROPOSAL_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "scoring",
  "exam_equivalence",
  "autonomous_approval",
] as const;

/** Midpoint of the 0–1 uncertainty unit interval; high-uncertainty fields require a faculty patch. */
export const HIGH_UNCERTAINTY_REQUIRES_PATCH = 0.5;

export type ScenarioProposalFieldProvenance = {
  source: "model";
  providerId: string;
  generatedAt: string;
};

export type ScenarioProposalFieldUncertainty = {
  score: number;
  rationale: string;
};

export type ScenarioProposalGeneratedField = {
  path: string;
  value: unknown;
  provenance: ScenarioProposalFieldProvenance;
  uncertainty: ScenarioProposalFieldUncertainty;
};

export type ScenarioProposalPatch = {
  path: string;
  previous: unknown;
  next: unknown;
  reviewerId: string;
  at: string;
  rationale: string;
};

export type ScenarioProposalStatus = "draft" | "approved";

export type ScenarioProposalRecord = {
  proposalId: string;
  status: ScenarioProposalStatus;
  generatedFields: ScenarioProposalGeneratedField[];
  patchTrail: ScenarioProposalPatch[];
  currentRevision: Scenario;
  /** SHA-256 of currentRevision + patchTrail. Approve must send this digest. */
  revisionDigest: string;
  /** Set only when the proposal record is approved; not copied onto the authored scenario. */
  approvedBy?: string;
  approvedAt?: string;
  claimBoundary: typeof SCENARIO_PROPOSAL_CLAIM_BOUNDARY;
  notEvidenceFor: typeof SCENARIO_PROPOSAL_NOT_EVIDENCE_FOR;
};
