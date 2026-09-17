/** Baseline seam reproducing the current prepared-only host decision for owner regression controls. */
import { startPreparedActorTurnAudio, type PreparedActorStartContext } from "./prepared-actor-audio.js";

export function startActorTurnSpeech(
  context: PreparedActorStartContext,
  startNonAudibleDialogue: (context: PreparedActorStartContext) => void,
): boolean {
  void startNonAudibleDialogue;
  return startPreparedActorTurnAudio(context);
}
