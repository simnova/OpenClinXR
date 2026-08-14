/**
 * Scenario governance review gate constants (clinical / psychometric / legal / simulationQa).
 * Extracted from ScenarioReviewGatePanel.tsx so evidence/inspect tools can import the capability
 * surface without pulling the React component graph (the tools typecheck project has no jsx/vite).
 */

/** Capability surface for evidence/inspect — not a role model. */
export const SCENARIO_REVIEW_RECORDABLE_DIMENSIONS = [
  "clinical",
  "psychometric",
  "legal",
  "simulationQa",
] as const;

export type ScenarioReviewDimension = (typeof SCENARIO_REVIEW_RECORDABLE_DIMENSIONS)[number];

/** Reviewer types the rationale; client does not hardcode comments. */
export const SCENARIO_REVIEW_RATIONALE_IS_CALLER_SUPPLIED = true as const;

/** Unmade decisions surface as pending (not hidden/absent) so a reviewer sees work remaining. */
export const SCENARIO_REVIEW_UNMADE_DECISION_DISPLAY = "pending" as const;
