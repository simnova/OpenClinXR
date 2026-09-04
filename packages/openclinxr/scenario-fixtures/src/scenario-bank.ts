import type {
  DynamicEncounterFactoryProjectionArtifact,
  Scenario,
} from "@openclinxr/shared-schemas";
import {
  adultAbdominalPainDialogueSeeds,
  adultAbdominalPainScenario,
} from "./adult-abdominal-pain.js";
import {
  type DialogueFixtureSeed,
  edChestPainDialogueSeeds,
  edChestPainScenario,
  edChestPainScenarioV2,
  edChestPainScenarioV3,
} from "./ed-chest-pain.js";
import {
  pedsFeverDialogueSeeds,
  pedsFeverScenario,
} from "./peds-fever.js";
import {
  pediatricAsthmaScenario, pediatricAsthmaDialogueSeeds,
} from "./pediatric-asthma.js";
import {
  psychiatricSafetyScenario, psychiatricSafetyDialogueSeeds,
} from "./psychiatric-safety.js";
import {
  telehealthDiabetesScenario, telehealthDiabetesDialogueSeeds,
} from "./telehealth-diabetes.js";
import {
  wardDeliriumScenario, wardDeliriumDialogueSeeds,
} from "./ward-delirium.js";
import {
  obPreeclampsiaScenario, obPreeclampsiaDialogueSeeds,
} from "./ob-preeclampsia.js";
import {
  strokeAlertScenario, strokeAlertDialogueSeeds,
} from "./stroke-alert.js";
import {
  stepdownSepsisScenario, stepdownSepsisDialogueSeeds,
} from "./stepdown-sepsis.js";
import {
  abdominalPainInterpreterScenario, abdominalPainInterpreterDialogueSeeds,
} from "./abdominal-pain-interpreter.js";
import {
  oncologyBadNewsScenario, oncologyBadNewsDialogueSeeds,
} from "./oncology-bad-news.js";
import {
  postopFeverScenario, postopFeverDialogueSeeds,
} from "./postop-fever.js";
import {
  primaryCareDyslipidemiaScenario, primaryCareDyslipidemiaDialogueSeeds,
} from "./primary-care-dyslipidemia.js";
import {
  clinicKneePainDialogueSeeds,
  clinicKneePainScenario,
} from "./clinic-knee-pain.js";

import type { LearnerScenarioView } from "./builders.js";
export type { LearnerScenarioView };

export { responseClipForBodyRegion } from "./touch-response-clip.js";

export const scenarioBank = [
  edChestPainScenario,
  pediatricAsthmaScenario,
  wardDeliriumScenario,
  telehealthDiabetesScenario,
  obPreeclampsiaScenario,
  psychiatricSafetyScenario,
  strokeAlertScenario,
  stepdownSepsisScenario,
  abdominalPainInterpreterScenario,
  oncologyBadNewsScenario,
  postopFeverScenario,
  primaryCareDyslipidemiaScenario,
  adultAbdominalPainScenario,
  pedsFeverScenario,
  clinicKneePainScenario,
] as const satisfies readonly Scenario[];

export function findScenarioFixtureById(
  scenarioId: string,
  scenarios: readonly Scenario[] = scenarioBank,
): Scenario | undefined {
  for (const scenario of scenarios) {
    if (scenario.scenarioId === scenarioId) {
      return scenario;
    }
  }
  return undefined;
}

export type ScenarioDialogueSeedBankEntry = {
  scenarioId: string;
  seeds: readonly DialogueFixtureSeed[];
};

export const scenarioDialogueSeedBank = [
  { scenarioId: edChestPainScenario.scenarioId, seeds: edChestPainDialogueSeeds },
  { scenarioId: pediatricAsthmaScenario.scenarioId, seeds: pediatricAsthmaDialogueSeeds },
  { scenarioId: wardDeliriumScenario.scenarioId, seeds: wardDeliriumDialogueSeeds },
  { scenarioId: telehealthDiabetesScenario.scenarioId, seeds: telehealthDiabetesDialogueSeeds },
  { scenarioId: obPreeclampsiaScenario.scenarioId, seeds: obPreeclampsiaDialogueSeeds },
  { scenarioId: psychiatricSafetyScenario.scenarioId, seeds: psychiatricSafetyDialogueSeeds },
  { scenarioId: strokeAlertScenario.scenarioId, seeds: strokeAlertDialogueSeeds },
  { scenarioId: stepdownSepsisScenario.scenarioId, seeds: stepdownSepsisDialogueSeeds },
  { scenarioId: abdominalPainInterpreterScenario.scenarioId, seeds: abdominalPainInterpreterDialogueSeeds },
  { scenarioId: oncologyBadNewsScenario.scenarioId, seeds: oncologyBadNewsDialogueSeeds },
  { scenarioId: postopFeverScenario.scenarioId, seeds: postopFeverDialogueSeeds },
  { scenarioId: primaryCareDyslipidemiaScenario.scenarioId, seeds: primaryCareDyslipidemiaDialogueSeeds },
  { scenarioId: adultAbdominalPainScenario.scenarioId, seeds: adultAbdominalPainDialogueSeeds },
  { scenarioId: pedsFeverScenario.scenarioId, seeds: pedsFeverDialogueSeeds },
  { scenarioId: clinicKneePainScenario.scenarioId, seeds: clinicKneePainDialogueSeeds },
] as const satisfies readonly ScenarioDialogueSeedBankEntry[];

