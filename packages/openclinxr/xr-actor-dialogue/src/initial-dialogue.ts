import { initialDialogueTextForScenario } from "@openclinxr/xr-dialogue";
import type { ActorDialogueDeps } from "./types.js";

export function initialDialogueTextForSelectedScenario(deps: Pick<
  ActorDialogueDeps,
  "encounterBundle" | "selectedScenarioId" | "isSelectedScenarioRuntimeBundleMismatch"
>): string {
  return initialDialogueTextForScenario({
    scenarioId: deps.selectedScenarioId(),
    runtimeInitialDialogueText:
      deps.encounterBundle().sceneManifest.stationContext?.initialDialogueText,
    bundleMismatch: deps.isSelectedScenarioRuntimeBundleMismatch(),
  });
}
