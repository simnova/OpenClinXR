/**
 * Faculty replay of a branch-scheduler decision record.
 *
 * Internal to review-workflow. Not on the package entrypoint. The decision
 * record is a local structural type so this module does not import
 * scenario-runtime or telemetry.
 *
 * Faculty replay includes withheld alternatives. Learner provenance does not.
 */

export const BRANCH_REPLAY_CLAIM_SCOPE = "faculty_branch_replay_not_score_use" as const;

export const BRANCH_REPLAY_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "assessment_validity",
  "learner_readiness",
  "quest_readiness",
  "production_deployment",
  "adaptive_high_stakes_scoring",
] as const;

export type BranchDecisionReplayCue = {
  cueId: string;
  kind: "environment" | "actor";
  actorId?: string;
  payload: Readonly<Record<string, string>>;
};

export type BranchDecisionReplayPredicate = {
  transitionId: string;
  predicateId: string;
  kind: string;
  result: boolean;
};

export type BranchDecisionReplayWithheld = {
  transitionId: string;
  toBranchId: string;
  hiddenFromLearner: boolean;
  matched: boolean;
  reason: string;
};

/** Plain-data twin of the scheduler decision; no package coupling. */
export type BranchDecisionReplayRecord = {
  seedId: string;
  scenarioId: string;
  stationRunId: string;
  policyVersion: string;
  fromBranchId: string;
  toBranchId: string;
  selectedTransitionId: string | null;
  evaluatedPredicates: readonly BranchDecisionReplayPredicate[];
  withheldAlternatives: readonly BranchDecisionReplayWithheld[];
  environmentCue: BranchDecisionReplayCue;
  actorCue: BranchDecisionReplayCue;
  eventPrefixFingerprint: string;
};

export type FacultyBranchReplay = {
  stationRunId: string;
  scenarioId: string;
  policyVersion: string;
  fromBranchId: string;
  toBranchId: string;
  selectedTransitionId: string | null;
  evaluatedPredicates: readonly BranchDecisionReplayPredicate[];
  withheldAlternatives: readonly BranchDecisionReplayWithheld[];
  environmentCue: BranchDecisionReplayCue;
  actorCue: BranchDecisionReplayCue;
  eventPrefixFingerprint: string;
  claimScope: typeof BRANCH_REPLAY_CLAIM_SCOPE;
  notEvidenceFor: typeof BRANCH_REPLAY_NOT_EVIDENCE_FOR;
};

export type LearnerBranchProvenance = {
  stationRunId: string;
  fromBranchId: string;
  toBranchId: string;
  selectedTransitionId: string | null;
  environmentCueId: string;
  actorCueId: string;
  claimScope: typeof BRANCH_REPLAY_CLAIM_SCOPE;
  notEvidenceFor: typeof BRANCH_REPLAY_NOT_EVIDENCE_FOR;
};

export function projectFacultyBranchReplay(record: BranchDecisionReplayRecord): FacultyBranchReplay {
  return {
    stationRunId: record.stationRunId,
    scenarioId: record.scenarioId,
    policyVersion: record.policyVersion,
    fromBranchId: record.fromBranchId,
    toBranchId: record.toBranchId,
    selectedTransitionId: record.selectedTransitionId,
    evaluatedPredicates: [...record.evaluatedPredicates],
    withheldAlternatives: [...record.withheldAlternatives],
    environmentCue: record.environmentCue,
    actorCue: record.actorCue,
    eventPrefixFingerprint: record.eventPrefixFingerprint,
    claimScope: BRANCH_REPLAY_CLAIM_SCOPE,
    notEvidenceFor: BRANCH_REPLAY_NOT_EVIDENCE_FOR,
  };
}

export function projectLearnerBranchProvenance(record: BranchDecisionReplayRecord): LearnerBranchProvenance {
  return {
    stationRunId: record.stationRunId,
    fromBranchId: record.fromBranchId,
    toBranchId: record.toBranchId,
    selectedTransitionId: record.selectedTransitionId,
    environmentCueId: record.environmentCue.cueId,
    actorCueId: record.actorCue.cueId,
    claimScope: BRANCH_REPLAY_CLAIM_SCOPE,
    notEvidenceFor: BRANCH_REPLAY_NOT_EVIDENCE_FOR,
  };
}
