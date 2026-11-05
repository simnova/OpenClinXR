import type { HumanoidConversationEyeState } from "./conversational-eye-schedule.js";
import type { GeneratedHumanoidAnimationSlot } from "./types.js";

export type ConversationEyeRuntimeSlot = Pick<GeneratedHumanoidAnimationSlot, "activeSpeech">;

export type ConversationEyeFrame = {
  state: HumanoidConversationEyeState;
  elapsedMs: number;
};

/**
 * Resolve one slot's state and state-local clock. The active speaker talks; silent actors listen
 * while any other slot speaks; with nobody speaking they rest. A state transition starts a fresh
 * deterministic schedule rather than inheriting an unrelated bout's partial duration.
 */
export function resolveConversationEyeFrame(
  slot: ConversationEyeRuntimeSlot,
  anyActorSpeaking: boolean,
  nowMs: number,
): ConversationEyeFrame {
  const state: HumanoidConversationEyeState = slot.activeSpeech ? "talking" : anyActorSpeaking ? "listening" : "rest";
  const bag = slot as unknown as Record<string, unknown>;
  const prior = bag["_conversationEyeSchedule"] as { state?: unknown; originMs?: unknown } | undefined;
  if (prior?.state !== state || typeof prior.originMs !== "number") {
    bag["_conversationEyeSchedule"] = { state, originMs: nowMs };
    return { state, elapsedMs: 0 };
  }
  return { state, elapsedMs: Math.max(0, nowMs - prior.originMs) };
}
