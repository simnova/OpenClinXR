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
  turnId?: string;
  planId?: string;
  startedAtMs?: number;
  acceptedInterruptionId?: string;
  acceptedInterruptionAtMs?: number;
};

export type LearnerBargeInInput = {
  atSecond: number;
  learnerUtterance?: string;
  /** Canonical turn-clock ms. When omitted, derived as atSecond * 1000. */
  atMs?: number;
  /** Stable interruption identity. When omitted, derived from run/turn/clock. */
  interruptionId?: string;
  /** Target actor turn. When omitted, the in-progress turn is the target. */
  turnId?: string;
  stationRunId?: string;
};

export const TURN_MODALITIES_CANCELLED_ON_BARGE_IN = [
  "audio",
  "viseme",
  "gaze",
  "posture",
  "affect",
] as const;

export type TurnCancelModality = (typeof TURN_MODALITIES_CANCELLED_ON_BARGE_IN)[number];

export type CanonicalInterruptionIdentity = {
  interruptionId: string;
  turnId: string;
  stationRunId: string;
  clockMs: number;
};

export type TurnCancellationDirective = {
  interruptionId: string;
  turnId: string;
  planId: string | null;
  clockMs: number;
  reason: "learner_barge_in";
  action: "audio.clear";
  cancelModalities: typeof TURN_MODALITIES_CANCELLED_ON_BARGE_IN;
};

export type BargeInContext = {
  completedTurnIds?: readonly string[];
  /** Currently executing turn that must not be cancelled unless it is the target. */
  activeTurnId?: string;
  acceptedInterruption?: {
    interruptionId: string;
    turnId: string;
    clockMs: number;
  };
};

export type BargeInOutcome =
  | "actor_turn_interrupted"
  | "no_active_turn_to_interrupt"
  | "duplicate_interruption"
  | "late_interruption"
  | "stale_turn_refused"
  | "newer_turn_protected";

export type BargeInResolution = {
  outcome: BargeInOutcome;
  bargeInTraceTag: "learner_barge_in";
  interruptedActorId: string | null;
  interruptedAtSecond: number;
  truncatedResponse: boolean;
  yieldedToLearner: boolean;
  interruptionId: string;
  turnId: string | null;
  planId: string | null;
  clockMs: number;
  cancellationDirective: TurnCancellationDirective | null;
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
