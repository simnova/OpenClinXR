/** Ordinary turns and prepared audio share explicit, one-attempt outcomes. */
import { isPreparedEntryPresent, retireOwnedActorSession, startPreparedActorTurnAudioOutcome, type PreparedActorStartContext } from "./prepared-actor-audio.js";

export type OrdinaryActorTurnSpeechOutcome =
  | { kind: "audio_started" }
  | { kind: "dialogue_only"; reason: "prepared_audio_unavailable" }
  | { kind: "refused"; reason: "prepared_audio_unavailable" | "invalid_cues" | "suspended" | "owned_stop_refusal" | "playback_failed" | "ordinary_setup_failed" };
export type OrdinaryTurnHostAdapter = {
  readSpeech: (context: PreparedActorStartContext) => { text?: string } | undefined;
  startDialogue: (context: PreparedActorStartContext) => void;
};

export function startActorTurnSpeech(
  context: PreparedActorStartContext,
  ordinary: ((context: PreparedActorStartContext) => boolean) | OrdinaryTurnHostAdapter,
): OrdinaryActorTurnSpeechOutcome {
  if (isPreparedEntryPresent(context.actorId, context.spokenText)) return startPreparedActorTurnAudioOutcome(context);
  try {
    const previous = typeof ordinary === "function" ? undefined : ordinary.readSpeech(context);
    if (!retireOwnedActorSession(context.actorId)) return { kind: "refused", reason: "owned_stop_refusal" };
    if (typeof ordinary === "function") {
      if (!ordinary(context)) return { kind: "refused", reason: "ordinary_setup_failed" };
    } else {
      ordinary.startDialogue(context);
      const speech = ordinary.readSpeech(context);
      if (!speech || speech.text !== context.spokenText || speech === previous) return { kind: "refused", reason: "ordinary_setup_failed" };
    }
    return { kind: "dialogue_only", reason: "prepared_audio_unavailable" };
  } catch {
    return { kind: "refused", reason: "ordinary_setup_failed" };
  }
}

export function preparedActorTurnAudioAvailable(context: PreparedActorStartContext): boolean {
  return isPreparedEntryPresent(context.actorId, context.spokenText);
}
