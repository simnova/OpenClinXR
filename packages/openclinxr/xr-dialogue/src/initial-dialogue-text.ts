/**
 * Mock Dialogue line for the selected station (#107 + #113).
 *
 * SSOT is the patient actor's `openingUtterance` on the scenario bank — not a hardcoded
 * runtime table, and never `demeanor` (stage direction for emotion, not speech).
 *
 * Prefer the bank-authored line when present so a regenerated bundle that still carries
 * stale demeanor-as-speech cannot win. Bundle text is only used when the bank has no
 * opening utterance (loud absence still preferred over inventing speech).
 */

import { findScenarioFixtureById } from "@openclinxr/scenario-fixtures/scenario-bank";

const MISSING_OPENING = "[missing patient opening utterance]";

/**
 * Resolve the Mock Dialogue panel text for a station.
 * Bank patient openingUtterance is authoritative when present.
 */
export function initialDialogueTextForScenario(input: {
  scenarioId: string;
  runtimeInitialDialogueText?: string | null | undefined;
  bundleMismatch?: boolean | undefined;
}): string {
  const scenario = findScenarioFixtureById(input.scenarioId);
  const patient =
    scenario?.actors.find((actor) => actor.role === "patient") ?? scenario?.actors[0];
  const opening = patient?.openingUtterance?.trim() ?? "";
  if (patient?.displayName && opening.length > 0) {
    return `${patient.displayName}: ${opening}`;
  }

  // No bank-authored opening: never speak demeanor. Prefer aligned bundle only if it
  // does not look like demeanor-as-speech; otherwise loud absence.
  if (
    !input.bundleMismatch &&
    input.runtimeInitialDialogueText &&
    patient?.demeanor &&
    !input.runtimeInitialDialogueText.includes(patient.demeanor)
  ) {
    return input.runtimeInitialDialogueText;
  }
  if (patient?.displayName) {
    return `${patient.displayName}: ${MISSING_OPENING}`;
  }
  return `Patient: ${MISSING_OPENING}`;
}

/** Bank patient displayName for a station (empty when unknown). */
export function bankPatientDisplayNameForScenario(scenarioId: string): string {
  const scenario = findScenarioFixtureById(scenarioId);
  const patient =
    scenario?.actors.find((actor) => actor.role === "patient") ?? scenario?.actors[0];
  return patient?.displayName ?? "";
}
