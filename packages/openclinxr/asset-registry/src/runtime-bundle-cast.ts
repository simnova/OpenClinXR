import {
  ED_CHEST_PAIN_SCENARIO_ID,
  resolveScenarioActorCast,
  type CaseScenarioSource,
  type ScenarioActorCast,
} from "./actor-casting.js";

export function resolveRuntimeBundleCast(
  scenarioId?: string,
  scenario?: CaseScenarioSource,
): ScenarioActorCast[] {
  const resolved = resolveScenarioActorCast(
    scenarioId ?? ED_CHEST_PAIN_SCENARIO_ID,
    scenario,
  );
  // Preserve the legacy ED fixture only for wholly unresolved ID-only callers. Known and
  // injected scenarios keep their complete declared cast, including absent optional roles.
  return resolved.length > 0 || scenario
    ? resolved
    : resolveScenarioActorCast(ED_CHEST_PAIN_SCENARIO_ID);
}
