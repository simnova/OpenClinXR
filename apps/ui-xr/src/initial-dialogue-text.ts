/**
 * Mock Dialogue line for the selected station (#107).
 *
 * Prefer the shipped runtime bundle's stationContext when it matches the station;
 * otherwise derive from the scenario bank patient displayName so the panel cannot
 * name someone who is not in the room (Morgan Lee / Jordan Williams drift class).
 */

import { findScenarioFixtureById } from "@openclinxr/scenario-fixtures/scenario-bank";

/** Authored fallback lines keyed by scenario — must name the bank patient. */
const BANK_FALLBACK_LINES: Record<string, string> = {
  ed_chest_pain_priority_v1:
    "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
  ed_chest_pain_priority_v2:
    "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
  peds_asthma_parent_anxiety_v1:
    "Maya Johnson: My chest feels tight and it is hard to breathe.",
  psych_suicidal_ideation_safety_v1:
    "Jordan Reed: I do not feel safe being alone right now.",
  telehealth_diabetes_health_literacy_v1:
    "Luis Martinez: I want to follow the plan, but the instructions are hard to understand.",
  ob_headache_preeclampsia_triage_v1:
    "Aisha Khan: My headache is getting worse, and the lights are bothering my eyes.",
  ed_stroke_alert_handoff_v1:
    "Samuel Brooks: My right arm feels weak, and I cannot get the words out clearly.",
  stepdown_sepsis_nurse_escalation_v1:
    "Helen Carter: I feel worse than this morning, and I am shaking again.",
  clinic_abdominal_pain_interpreter_v1:
    "Lucia Morales: The pain is mostly on the lower right side, and I need the interpreter.",
  oncology_bad_news_family_v1:
    "David Miller: I want my sister here before we talk about the scan results.",
  postop_fever_consult_pressure_v1:
    "Priya Shah: My belly hurts more today, and I have chills.",
};

/**
 * Resolve the Mock Dialogue panel text for a station.
 * When the runtime bundle is aligned and carries initialDialogueText, use it;
 * otherwise fall back to a bank-named line (never a foreign cast name).
 */
export function initialDialogueTextForScenario(input: {
  scenarioId: string;
  runtimeInitialDialogueText?: string | null | undefined;
  bundleMismatch?: boolean | undefined;
}): string {
  if (!input.bundleMismatch && input.runtimeInitialDialogueText) {
    return input.runtimeInitialDialogueText;
  }
  const authored = BANK_FALLBACK_LINES[input.scenarioId];
  if (authored) return authored;

  const scenario = findScenarioFixtureById(input.scenarioId);
  const patient =
    scenario?.actors.find((actor) => actor.role === "patient") ?? scenario?.actors[0];
  if (patient?.displayName) {
    const demeanor =
      typeof patient.demeanor === "string" && patient.demeanor.trim().length > 0
        ? patient.demeanor
        : "I am ready to begin this encounter.";
    return `${patient.displayName}: ${demeanor}`;
  }
  return "Patient: I am ready to begin this encounter.";
}

/** Bank patient displayName for a station (empty when unknown). */
export function bankPatientDisplayNameForScenario(scenarioId: string): string {
  const scenario = findScenarioFixtureById(scenarioId);
  const patient =
    scenario?.actors.find((actor) => actor.role === "patient") ?? scenario?.actors[0];
  return patient?.displayName ?? "";
}
