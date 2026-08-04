/**
 * Shared claim-control constants for conversation tooling.
 * History-taking coverage is TRACED, never scored.
 */

export const CONVERSATION_CLAIM_SCOPE = {
  turnTaking: "turn_taking_arbitration_traced_not_scored",
  bargeIn: "learner_barge_in_traced_not_scored",
  historyCoverage: "history_taking_domain_coverage_traced_not_scored",
} as const;

export const CONVERSATION_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "exam_equivalence",
  "scoring",
  "learner_readiness",
] as const;

export type ConversationNotEvidenceFor = typeof CONVERSATION_NOT_EVIDENCE_FOR;

export type ConversationActorRef = {
  actorId: string;
  role: string;
};

export type TurnTakingReason =
  | "explicit_addressed_actor"
  | "continues_prior_actor"
  | "default_primary_actor"
  | "round_robin_fallback";

export type TurnTakingDecision = {
  nextActorId: string;
  reason: TurnTakingReason;
  conversationTurn: number;
  traceTag: "turn_taking_arbitrated";
  claimScope: typeof CONVERSATION_CLAIM_SCOPE.turnTaking;
  notEvidenceFor: ConversationNotEvidenceFor;
};

export type ActorTurnInProgress = {
  actorId: string;
  conversationTurn: number;
  startedAtSecond: number;
  expectedResponseText?: string;
  learnerUtterance?: string;
  stationRunId?: string;
};

export type LearnerBargeInInput = {
  atSecond: number;
  learnerUtterance?: string;
};

export type BargeInOutcome = "actor_turn_interrupted" | "no_active_turn_to_interrupt";

export type BargeInResolution = {
  outcome: BargeInOutcome;
  bargeInTraceTag: "learner_barge_in";
  interruptedActorId: string | null;
  interruptedAtSecond: number;
  truncatedResponse: boolean;
  yieldedToLearner: boolean;
  claimScope: typeof CONVERSATION_CLAIM_SCOPE.bargeIn;
  notEvidenceFor: ConversationNotEvidenceFor;
};

export type HistoryTakingDomain = {
  domainId: string;
  label: string;
  matchesTraceTags: string[];
  matchesKeywords?: string[];
};

export type HistoryTakingCoverageSpec = {
  scenarioId: string;
  domains: HistoryTakingDomain[];
};

export type HistoryTakingCoverageState = {
  scenarioId: string;
  coveredDomainIds: string[];
  missingDomainIds: string[];
  /**
   * Count-based coverage of DOMAINS only.
   * Explicitly: coverage of asked domains, NOT a clinical/performance score.
   */
  coveragePercent: number;
  coverageTraceTags: string[];
  claimScope: typeof CONVERSATION_CLAIM_SCOPE.historyCoverage;
  notEvidenceFor: ConversationNotEvidenceFor;
};

export type HistoryTakingCoverageUpdateInput = {
  traceTags?: readonly string[];
  learnerUtterance?: string;
};

export type HistoryTakingCoverageUpdateResult = {
  state: HistoryTakingCoverageState;
  newlyCoveredDomainIds: string[];
};
