import {
  CONVERSATION_CLAIM_SCOPE,
  CONVERSATION_NOT_EVIDENCE_FOR,
  type ActorTurnInProgress,
  type BargeInResolution,
  type LearnerBargeInInput,
} from "./types.js";

/**
 * Resolve a learner barge-in against an in-progress actor turn.
 * Produces a DISTINCT traced outcome (tag: learner_barge_in) vs normal turns.
 */
export function resolveLearnerBargeIn(
  inProgress: ActorTurnInProgress | null | undefined,
  bargeInInput: LearnerBargeInInput,
): BargeInResolution {
  if (!inProgress) {
    return {
      outcome: "no_active_turn_to_interrupt",
      bargeInTraceTag: "learner_barge_in",
      interruptedActorId: null,
      interruptedAtSecond: bargeInInput.atSecond,
      truncatedResponse: false,
      yieldedToLearner: false,
      claimScope: CONVERSATION_CLAIM_SCOPE.bargeIn,
      notEvidenceFor: CONVERSATION_NOT_EVIDENCE_FOR,
    };
  }

  return {
    outcome: "actor_turn_interrupted",
    bargeInTraceTag: "learner_barge_in",
    interruptedActorId: inProgress.actorId,
    interruptedAtSecond: bargeInInput.atSecond,
    truncatedResponse: true,
    yieldedToLearner: true,
    claimScope: CONVERSATION_CLAIM_SCOPE.bargeIn,
    notEvidenceFor: CONVERSATION_NOT_EVIDENCE_FOR,
  };
}
