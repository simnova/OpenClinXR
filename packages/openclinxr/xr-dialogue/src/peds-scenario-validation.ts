import { PEDS_ASTHMA_SCENARIO_ID } from "@openclinxr/scenario-fixtures/authored-utterance-record";

/**
 * Validator only. Moved out of apps/ui-xr/src/peds-authored-turn-surface.ts, where it sat
 * beside the turn-surface lookups, so the app kept a validation rule inside a
 * functionality module.
 */
export function isPedsAsthmaScenario(scenarioId: string): boolean {
  return scenarioId === PEDS_ASTHMA_SCENARIO_ID;
}
