/**
 * Counterfactual debrief barrel — re-exports the implementation.
 * Only exports symbols with confirmed external consumers (apps/ui-xr test).
 */

export {
  buildCounterfactualCheckpoint,
  buildCounterfactualDebrief,
  COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE,
  COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR,
} from "./counterfactual-debrief.js";
export type {
  CounterfactualReleaseGate,
  LearnerAttemptRecord,
  ReviewedAlternative,
} from "./counterfactual-debrief.js";
