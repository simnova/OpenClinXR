/** Baseline seam reproducing the current prepared-only host decision for owner regression controls. */
import { startPreparedActorTurnAudio, type PreparedActorStartContext } from "./prepared-actor-audio.js";

export function startActorTurnSpeech(
  context: PreparedActorStartContext,
  startNonAudibleDialogue: (context: PreparedActorStartContext) => boolean,
): boolean {
  void startNonAudibleDialogue;
  return startPreparedActorTurnAudio(context);
}

/** Owner scaffold; final implementation must consult actual prepared-map presence only. */
export function preparedActorTurnAudioAvailable(_context: PreparedActorStartContext): boolean { return false; }
