import type {
  Scenario,
} from "@openclinxr/shared-schemas";
import {abdominalPainInterpreterDialogueSeeds,
  abdominalPainInterpreterScenario, 
} from "./abdominal-pain-interpreter.js";
import {
  adultAbdominalPainDialogueSeeds,
  adultAbdominalPainScenario,
} from "./adult-abdominal-pain.js";
import type { LearnerScenarioView } from "./builders.js";
import {
  clinicKneePainDialogueSeeds,
  clinicKneePainScenario,
} from "./clinic-knee-pain.js";
import {
  type DialogueFixtureSeed,
  edChestPainDialogueSeeds,
  edChestPainScenario,
} from "./ed-chest-pain-mod.js";
import {obPreeclampsiaDialogueSeeds,
  obPreeclampsiaScenario, 
} from "./ob-preeclampsia.js";
import {oncologyBadNewsDialogueSeeds,
  oncologyBadNewsScenario, 
} from "./oncology-bad-news.js";
import {pediatricAsthmaDialogueSeeds,
  pediatricAsthmaScenario, 
} from "./pediatric-asthma.js";
import {
  pedsFeverDialogueSeeds,
  pedsFeverScenario,
} from "./peds-fever.js";
import {postopFeverDialogueSeeds,
  postopFeverScenario, 
} from "./postop-fever.js";
import {primaryCareDyslipidemiaDialogueSeeds,
  primaryCareDyslipidemiaScenario, 
} from "./primary-care-dyslipidemia.js";
import {psychiatricSafetyDialogueSeeds,
  psychiatricSafetyScenario, 
} from "./psychiatric-safety.js";
import {stepdownSepsisDialogueSeeds,
  stepdownSepsisScenario, 
} from "./stepdown-sepsis.js";
import {strokeAlertDialogueSeeds,
  strokeAlertScenario, 
} from "./stroke-alert.js";
import {telehealthDiabetesDialogueSeeds,
  telehealthDiabetesScenario, 
} from "./telehealth-diabetes.js";
import {wardDeliriumDialogueSeeds,
  wardDeliriumScenario, 
} from "./ward-delirium.js";

export { responseClipForBodyRegion } from "./touch-response-clip.js";
export type { LearnerScenarioView };

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

