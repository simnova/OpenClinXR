/**
 * #113 — patient opening utterance inspector.
 *
 * Enumerates every scenarioBank station and reports:
 * - bankOpeningUtterance (patient.openingUtterance)
 * - patientDemeanor (stage direction — must not equal speech)
 * - producedInitialDialogueText (factory function the build calls)
 * - runtimeInitialDialogueText (function the app calls)
 *
 * claimScope: authored cold-open speech vs demeanor category error.
 * notEvidenceFor: clinical appropriateness of lines, later conversation turns.
 */

import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import { factoryInitialDialogueTextForScenario } from "../factory/generated-ed-station-runtime-bundle.js";
import { initialDialogueTextForScenario } from "../../../apps/ui-xr/src/initial-dialogue-text.js";

export type StationOpening = {
  scenarioId: string;
  patientActorId: string;
  patientDisplayName: string;
  bankOpeningUtterance: string;
  patientDemeanor: string;
  producedInitialDialogueText: string;
  runtimeInitialDialogueText: string;
};

export async function inspectPatientOpeningUtterance(): Promise<{ stations: StationOpening[] }> {
  const stations: StationOpening[] = [];

  for (const scenario of scenarioBank) {
    const patient =
      scenario.actors.find((actor) => actor.role === "patient") ?? scenario.actors[0];
    const patientDisplayName = patient?.displayName ?? "";
    const patientActorId = patient?.actorId ?? "";
    const bankOpeningUtterance =
      typeof patient?.openingUtterance === "string" ? patient.openingUtterance : "";
    const patientDemeanor = typeof patient?.demeanor === "string" ? patient.demeanor : "";

    const producedInitialDialogueText = factoryInitialDialogueTextForScenario(scenario.scenarioId);
    // Call runtime the same way the app does when the bundle is aligned: pass the
    // produced line. With bank SSOT, runtime still returns the authored bank line.
    const runtimeInitialDialogueText = initialDialogueTextForScenario({
      scenarioId: scenario.scenarioId,
      runtimeInitialDialogueText: producedInitialDialogueText,
      bundleMismatch: false,
    });

    stations.push({
      scenarioId: scenario.scenarioId,
      patientActorId,
      patientDisplayName,
      bankOpeningUtterance,
      patientDemeanor,
      producedInitialDialogueText,
      runtimeInitialDialogueText,
    });
  }

  return { stations };
}
