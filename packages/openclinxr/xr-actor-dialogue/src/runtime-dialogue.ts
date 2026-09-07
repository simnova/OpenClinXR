import type { XrActorDialogueStore } from "./store.js";
import type { EncounterRuntimeDialogueTurn } from "@openclinxr/asset-registry";

export function runtimeDialogueTurnForTraceTag(store: XrActorDialogueStore, tag: string): EncounterRuntimeDialogueTurn | undefined {
  return store.runtimeDialogueTurnForTraceTag(tag);
}