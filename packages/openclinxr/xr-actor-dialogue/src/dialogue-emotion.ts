import type { XrActorDialogueStore } from "./store.js";
import type { HumanoidDialogueEmotionContext, HumanoidExpressionEmotion } from "./types.js";

export function scenarioDialogueEmotionContext(
  store: XrActorDialogueStore,
  actorId: string,
  text: string,
  explicitEmotion?: HumanoidExpressionEmotion,
  emotionSource?: HumanoidDialogueEmotionContext["source"]
): HumanoidDialogueEmotionContext {
  return store.scenarioDialogueEmotionContext(actorId, text, explicitEmotion, emotionSource);
}