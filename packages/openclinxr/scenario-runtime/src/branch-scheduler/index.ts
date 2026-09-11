/**
 * Deterministic branch scheduler: (frozen case seed, admitted learner events,
 * current branch state, policy version) → next case branch.
 *
 * Internal to scenario-runtime. Not on the package entrypoint. The composition
 * seam is `composeAdmittedLearnerEventPath`, which folds one admitted
 * TraceEvent-shaped learner event at a time — the same records
 * `ScenarioRuntime.appendLearnerEvent` already writes to the ledger.
 */

export const BRANCH_SCHEDULER_CLAIM_SCOPE = "deterministic_branch_scheduler" as const;

export const BRANCH_SCHEDULER_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "assessment_validity",
  "learner_readiness",
  "quest_readiness",
  "production_deployment",
  "adaptive_high_stakes_scoring",
] as const;

export type BranchSchedulerRefusalReason =
  | "reordered_events"
  | "cross_station"
  | "stale_policy"
  | "reviewer_only_input"
  | "authored_hidden_truth_mutation"
  | "prefix_gap";

export type BranchPredicate =
  | { predicateId: string; kind: "event_type_admitted"; eventType: string }
  | { predicateId: string; kind: "tag_admitted"; tag: string }
  | { predicateId: string; kind: "prefix_length_at_least"; minimum: number }
  | { predicateId: string; kind: "last_event_type"; eventType: string };

export type BranchCue = {
  cueId: string;
  kind: "environment" | "actor";
  actorId?: string;
  payload: Readonly<Record<string, string>>;
};

export type AuthoredBranchTransition = {
  transitionId: string;
  fromBranchId: string;
  toBranchId: string;
  priority: number;
  predicates: readonly BranchPredicate[];
  environmentCue: BranchCue;
  actorCue: BranchCue;
  hiddenFromLearner: boolean;
};

export type FrozenCaseSeed = {
  seedId: string;
  scenarioId: string;
  stationRunId: string;
  caseRevision: string;
  policyVersion: string;
  initialBranchId: string;
  hiddenTruthFingerprint: string;
  transitions: readonly AuthoredBranchTransition[];
};

export type AdmittedLearnerEvent = {
  stationRunId: string;
  sequence: number;
  atSecond: number;
  eventType: string;
  source: string;
  tag?: string;
};

export type BranchState = {
  branchId: string;
  policyVersion: string;
  stationRunId: string;
  admittedCount: number;
  hiddenTruthFingerprint: string;
};

export type EvaluatedPredicate = {
  transitionId: string;
  predicateId: string;
  kind: BranchPredicate["kind"];
  result: boolean;
};

export type WithheldAlternative = {
  transitionId: string;
  toBranchId: string;
  hiddenFromLearner: boolean;
  matched: boolean;
  reason: "not_selected" | "predicates_unsatisfied";
};

export type BranchDecisionRecord = {
  seedId: string;
  scenarioId: string;
  stationRunId: string;
  policyVersion: string;
  fromBranchId: string;
  toBranchId: string;
  selectedTransitionId: string | null;
  evaluatedPredicates: readonly EvaluatedPredicate[];
  withheldAlternatives: readonly WithheldAlternative[];
  environmentCue: BranchCue;
  actorCue: BranchCue;
  eventPrefixFingerprint: string;
  claimScope: typeof BRANCH_SCHEDULER_CLAIM_SCOPE;
  notEvidenceFor: typeof BRANCH_SCHEDULER_NOT_EVIDENCE_FOR;
};

export type BranchSchedulerOk = {
  ok: true;
  nextState: BranchState;
  decision: BranchDecisionRecord;
};

export type BranchSchedulerClosed = {
  ok: false;
  reason: BranchSchedulerRefusalReason;
  detail: string;
};

export type BranchSchedulerResult = BranchSchedulerOk | BranchSchedulerClosed;

export type EvaluateBranchSchedulerInput = {
  seed: FrozenCaseSeed;
  admittedLearnerEvents: readonly AdmittedLearnerEvent[];
  current: BranchState;
  policyVersion: string;
};

const HOLD_ENVIRONMENT_CUE: BranchCue = {
  cueId: "hold_environment",
  kind: "environment",
  payload: {},
};

const HOLD_ACTOR_CUE: BranchCue = {
  cueId: "hold_actor",
  kind: "actor",
  payload: {},
};

export function initialBranchState(seed: FrozenCaseSeed): BranchState {
  return {
    branchId: seed.initialBranchId,
    policyVersion: seed.policyVersion,
    stationRunId: seed.stationRunId,
    admittedCount: 0,
    hiddenTruthFingerprint: seed.hiddenTruthFingerprint,
  };
}

export function eventPrefixFingerprint(
  seed: FrozenCaseSeed,
  events: readonly AdmittedLearnerEvent[],
): string {
  return JSON.stringify({
    seedId: seed.seedId,
    policyVersion: seed.policyVersion,
    stationRunId: seed.stationRunId,
    events: events.map((event) => ({
      sequence: event.sequence,
      atSecond: event.atSecond,
      eventType: event.eventType,
      tag: event.tag ?? null,
    })),
  });
}

export function evaluateBranchScheduler(input: EvaluateBranchSchedulerInput): BranchSchedulerResult {
  const refusal = refuseClosed(input);
  if (refusal) {
    return refusal;
  }

  const { seed, admittedLearnerEvents, current, policyVersion } = input;
  const candidates = seed.transitions.filter((transition) => transition.fromBranchId === current.branchId);
  const evaluatedPredicates = candidates.flatMap((transition) =>
    transition.predicates.map((predicate) => ({
      transitionId: transition.transitionId,
      predicateId: predicate.predicateId,
      kind: predicate.kind,
      result: evaluatePredicate(predicate, admittedLearnerEvents),
    })),
  );

  const matched = candidates.filter((transition) =>
    transition.predicates.every((predicate) => evaluatePredicate(predicate, admittedLearnerEvents)),
  );
  const selected = selectTransition(matched);
  const withheldAlternatives = candidates
    .filter((transition) => transition.transitionId !== selected?.transitionId)
    .map((transition) => ({
      transitionId: transition.transitionId,
      toBranchId: transition.toBranchId,
      hiddenFromLearner: transition.hiddenFromLearner,
      matched: matched.some((row) => row.transitionId === transition.transitionId),
      reason: matched.some((row) => row.transitionId === transition.transitionId)
        ? ("not_selected" as const)
        : ("predicates_unsatisfied" as const),
    }))
    .sort((left, right) => left.transitionId.localeCompare(right.transitionId));

  const toBranchId = selected?.toBranchId ?? current.branchId;
  const decision: BranchDecisionRecord = {
    seedId: seed.seedId,
    scenarioId: seed.scenarioId,
    stationRunId: seed.stationRunId,
    policyVersion,
    fromBranchId: current.branchId,
    toBranchId,
    selectedTransitionId: selected?.transitionId ?? null,
    evaluatedPredicates,
    withheldAlternatives,
    environmentCue: selected?.environmentCue ?? HOLD_ENVIRONMENT_CUE,
    actorCue: selected?.actorCue ?? HOLD_ACTOR_CUE,
    eventPrefixFingerprint: eventPrefixFingerprint(seed, admittedLearnerEvents),
    claimScope: BRANCH_SCHEDULER_CLAIM_SCOPE,
    notEvidenceFor: BRANCH_SCHEDULER_NOT_EVIDENCE_FOR,
  };

  return {
    ok: true,
    nextState: {
      branchId: toBranchId,
      policyVersion,
      stationRunId: seed.stationRunId,
      admittedCount: admittedLearnerEvents.length,
      hiddenTruthFingerprint: seed.hiddenTruthFingerprint,
    },
    decision: freezeDecision(decision),
  };
}

/**
 * Runtime composition: fold each admitted learner ledger event, in order, through
 * the scheduler. Equal seeds and equal prefixes produce equal decision sequences.
 */
export function composeAdmittedLearnerEventPath(input: {
  seed: FrozenCaseSeed;
  policyVersion: string;
  admittedLearnerEvents: readonly AdmittedLearnerEvent[];
}): { ok: true; decisions: readonly BranchDecisionRecord[]; finalState: BranchState } | BranchSchedulerClosed {
  let current = initialBranchState(input.seed);
  const decisions: BranchDecisionRecord[] = [];
  for (let index = 0; index < input.admittedLearnerEvents.length; index += 1) {
    const prefix = input.admittedLearnerEvents.slice(0, index + 1);
    const step = evaluateBranchScheduler({
      seed: input.seed,
      admittedLearnerEvents: prefix,
      current,
      policyVersion: input.policyVersion,
    });
    if (!step.ok) {
      return step;
    }
    decisions.push(step.decision);
    current = step.nextState;
  }
  return { ok: true, decisions, finalState: current };
}

function refuseClosed(input: EvaluateBranchSchedulerInput): BranchSchedulerClosed | null {
  const { seed, admittedLearnerEvents, current, policyVersion } = input;
  if (policyVersion !== seed.policyVersion || current.policyVersion !== seed.policyVersion) {
    return closedResult(
      "stale_policy",
      `policyVersion ${policyVersion} / state ${current.policyVersion} ≠ seed ${seed.policyVersion}`,
    );
  }
  if (current.hiddenTruthFingerprint !== seed.hiddenTruthFingerprint) {
    return closedResult("authored_hidden_truth_mutation", "current state hidden-truth fingerprint diverged from the frozen seed");
  }
  if (current.stationRunId !== seed.stationRunId) {
    return closedResult("cross_station", `state stationRunId ${current.stationRunId} ≠ seed ${seed.stationRunId}`);
  }
  if (current.admittedCount > admittedLearnerEvents.length) {
    return closedResult("prefix_gap", `state admittedCount ${current.admittedCount} exceeds prefix length ${admittedLearnerEvents.length}`);
  }

  const reviewer = admittedLearnerEvents.find((event) => event.source !== "learner");
  if (reviewer) {
    return closedResult("reviewer_only_input", `source ${reviewer.source} at sequence ${reviewer.sequence} is not an admitted learner event`);
  }

  const foreign = admittedLearnerEvents.find((event) => event.stationRunId !== seed.stationRunId);
  if (foreign) {
    return closedResult("cross_station", `event stationRunId ${foreign.stationRunId} ≠ seed ${seed.stationRunId}`);
  }

  const sequences = admittedLearnerEvents.map((event) => event.sequence);
  const ordered = [...sequences].sort((left, right) => left - right);
  const unique = new Set(sequences);
  if (unique.size !== sequences.length || sequences.some((sequence, index) => sequence !== ordered[index])) {
    return closedResult("reordered_events", "admitted learner events are not a strictly increasing sequence prefix");
  }
  for (let index = 1; index < admittedLearnerEvents.length; index += 1) {
    const previous = admittedLearnerEvents[index - 1];
    const admitted = admittedLearnerEvents[index];
    if (previous === undefined || admitted === undefined) {
      continue;
    }
    if (admitted.atSecond < previous.atSecond) {
      return closedResult("reordered_events", `atSecond decreased at sequence ${admitted.sequence}`);
    }
  }
  return null;
}

function evaluatePredicate(predicate: BranchPredicate, events: readonly AdmittedLearnerEvent[]): boolean {
  const last = events.at(-1);
  switch (predicate.kind) {
    case "event_type_admitted":
      return events.some((event) => event.eventType === predicate.eventType);
    case "tag_admitted":
      return events.some((event) => event.tag === predicate.tag);
    case "prefix_length_at_least":
      return events.length >= predicate.minimum;
    case "last_event_type":
      return last?.eventType === predicate.eventType;
  }
}

function selectTransition(
  matched: readonly AuthoredBranchTransition[],
): AuthoredBranchTransition | undefined {
  if (matched.length === 0) {
    return undefined;
  }
  return [...matched].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.transitionId.localeCompare(right.transitionId);
  })[0];
}

function closedResult(reason: BranchSchedulerRefusalReason, detail: string): BranchSchedulerClosed {
  return { ok: false, reason, detail };
}

function freezeDecision(decision: BranchDecisionRecord): BranchDecisionRecord {
  return Object.freeze({
    ...decision,
    evaluatedPredicates: Object.freeze([...decision.evaluatedPredicates]),
    withheldAlternatives: Object.freeze([...decision.withheldAlternatives]),
    environmentCue: Object.freeze({ ...decision.environmentCue, payload: Object.freeze({ ...decision.environmentCue.payload }) }),
    actorCue: Object.freeze({ ...decision.actorCue, payload: Object.freeze({ ...decision.actorCue.payload }) }),
    notEvidenceFor: BRANCH_SCHEDULER_NOT_EVIDENCE_FOR,
  });
}
