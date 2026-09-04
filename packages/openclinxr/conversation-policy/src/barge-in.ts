import { resolveCanonicalLearnerInterruption } from "./canonical-interruption.js";
import type {
  ActorTurnInProgress,
  BargeInContext,
  BargeInResolution,
  LearnerBargeInInput,
} from "./types.js";

/**
 * Resolve a learner barge-in against an in-progress actor turn.
 * Produces a DISTINCT traced outcome (tag: learner_barge_in) vs normal turns.
 * Duplicate/late interruptions are idempotent; a stale target never cancels a newer turn.
 */
export function resolveLearnerBargeIn(
  inProgress: ActorTurnInProgress | null | undefined,
  bargeInInput: LearnerBargeInInput,
  context: BargeInContext = {},
): BargeInResolution {
  return resolveCanonicalLearnerInterruption(inProgress, bargeInInput, context);
}
