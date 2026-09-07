import type { XrActorDialogueStore } from "./store.js";
import type { HumanoidDialogueGazeTarget } from "./types.js";

export function localDialogueActorIdForTraceTag(store: XrActorDialogueStore, tag: string): string | undefined {
  return store.localDialogueActorIdForTraceTag(tag);
}

export function localDialogueGazeTargetForTraceTag(store: XrActorDialogueStore, tag: string): HumanoidDialogueGazeTarget {
  return store.localDialogueGazeTargetForTraceTag(tag);
}