import type { XrActorDialogueStore } from "./store.js";

export function initialDialogueTextForSelectedScenario(store: XrActorDialogueStore): string {
  return store.initialDialogueTextForSelectedScenario();
}