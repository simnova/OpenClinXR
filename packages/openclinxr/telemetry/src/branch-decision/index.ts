/**
 * Persistence shape for one evaluated branch-scheduler decision.
 *
 * Internal to telemetry. Not on the package entrypoint. The record is a local
 * structural type — this module does not import scenario-runtime.
 *
 * Learner-safe attributes omit withheld alternatives so a learner-facing
 * exporter cannot leak hidden branches.
 */

export const BRANCH_DECISION_SPAN_NAME = "openclinxr.branch.decision" as const;

export type BranchDecisionCue = {
  cueId: string;
  kind: "environment" | "actor";
  actorId?: string;
  payload: Readonly<Record<string, string>>;
};

export type BranchDecisionEvaluatedPredicate = {
  transitionId: string;
  predicateId: string;
  kind: string;
  result: boolean;
};

export type BranchDecisionWithheldAlternative = {
  transitionId: string;
  toBranchId: string;
  hiddenFromLearner: boolean;
  matched: boolean;
  reason: string;
};

export type BranchDecisionRecord = {
  seedId: string;
  scenarioId: string;
  stationRunId: string;
  policyVersion: string;
  fromBranchId: string;
  toBranchId: string;
  selectedTransitionId: string | null;
  evaluatedPredicates: readonly BranchDecisionEvaluatedPredicate[];
  withheldAlternatives: readonly BranchDecisionWithheldAlternative[];
  environmentCue: BranchDecisionCue;
  actorCue: BranchDecisionCue;
  eventPrefixFingerprint: string;
  claimScope: string;
  notEvidenceFor: readonly string[];
};

export type LearnerSafeBranchDecisionAttributes = {
  "openclinxr.scenario_id": string;
  "openclinxr.station_run_id": string;
  "openclinxr.branch.seed_id": string;
  "openclinxr.branch.policy_version": string;
  "openclinxr.branch.from": string;
  "openclinxr.branch.to": string;
  "openclinxr.branch.selected_transition": string;
  "openclinxr.branch.environment_cue": string;
  "openclinxr.branch.actor_cue": string;
  "openclinxr.branch.prefix_fingerprint": string;
};

export type PersistedBranchDecision = {
  spanName: typeof BRANCH_DECISION_SPAN_NAME;
  record: BranchDecisionRecord;
  learnerSafeAttributes: LearnerSafeBranchDecisionAttributes;
};

export function persistBranchDecision(record: BranchDecisionRecord): PersistedBranchDecision {
  return {
    spanName: BRANCH_DECISION_SPAN_NAME,
    record: Object.freeze({
      ...record,
      evaluatedPredicates: Object.freeze([...record.evaluatedPredicates]),
      withheldAlternatives: Object.freeze([...record.withheldAlternatives]),
      notEvidenceFor: Object.freeze([...record.notEvidenceFor]),
    }),
    learnerSafeAttributes: {
      "openclinxr.scenario_id": record.scenarioId,
      "openclinxr.station_run_id": record.stationRunId,
      "openclinxr.branch.seed_id": record.seedId,
      "openclinxr.branch.policy_version": record.policyVersion,
      "openclinxr.branch.from": record.fromBranchId,
      "openclinxr.branch.to": record.toBranchId,
      "openclinxr.branch.selected_transition": record.selectedTransitionId ?? "hold",
      "openclinxr.branch.environment_cue": record.environmentCue.cueId,
      "openclinxr.branch.actor_cue": record.actorCue.cueId,
      "openclinxr.branch.prefix_fingerprint": record.eventPrefixFingerprint,
    },
  };
}

export function learnerSafeAttributesOmitWithheld(
  attributes: LearnerSafeBranchDecisionAttributes,
): boolean {
  return !Object.keys(attributes).some((key) => /withheld|hidden|alternative/i.test(key));
}
