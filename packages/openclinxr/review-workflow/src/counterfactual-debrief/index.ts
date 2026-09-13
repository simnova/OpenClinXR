/**
 * Counterfactual debrief barrel — re-exports the implementation.
 */

export {
  buildCounterfactualCheckpoint,
  buildCounterfactualDebrief,
  COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE,
  COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR,
} from "./counterfactual-debrief.js";
export type {
  ActualPathSnapshot,
  BuildCounterfactualCheckpointInput,
  BuildCounterfactualDebriefInput,
  CounterfactualCheckpoint,
  CounterfactualDebriefResult,
  CounterfactualRefusal,
  CounterfactualReleaseGate,
  HypotheticalAlternativePath,
  LearnerAttemptRecord,
  ReviewedAlternative,
} from "./counterfactual-debrief.js";
