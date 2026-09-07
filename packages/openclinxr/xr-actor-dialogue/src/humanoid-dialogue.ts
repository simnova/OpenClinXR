import type { XrActorDialogueStore } from "./store.js";
import type { HumanoidDialogueGazeTarget, HumanoidDialogueEmotionContext, HumanoidExpressionEmotion } from "./types.js";

export function triggerHumanoidDialogueForTrace(store: XrActorDialogueStore, tag: string, text: string): void {
  store.triggerHumanoidDialogueForTrace(tag, text);
}

export function triggerHumanoidDialogue(
  store: XrActorDialogueStore,
  actorId: string,
  text: string,
  gazeTarget: HumanoidDialogueGazeTarget,
  explicitEmotion?: HumanoidExpressionEmotion,
  actorRuntimeRealismRequirement?: unknown,
  emotionSource?: HumanoidDialogueEmotionContext["source"]
): void {
  store.triggerHumanoidDialogue(actorId, text, gazeTarget, explicitEmotion, actorRuntimeRealismRequirement, emotionSource);
}

export function humanoidDialogueDurationMs(store: XrActorDialogueStore, phonemeCount: number): number {
  return store.humanoidDialogueDurationMs(phonemeCount);
}