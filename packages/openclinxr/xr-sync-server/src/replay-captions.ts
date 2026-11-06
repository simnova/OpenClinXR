/**
 * C31 replay captions recomputed from the cast + shipped seed bank by replyId.
 *
 * A replay server booted with scenarios + dialogueSeeds rebuilds the caption
 * bank the live room used (cast actors, topic answers, utterance fallback) and
 * resolves each recorded turn's caption from its replyId + recorded match kind.
 * Caption text never enters the trace: the bank lives in replay-room memory
 * only (see station-replay.ts), and the trace keeps ids + match kinds.
 */

import { C3_REPLY_TABLE } from "./conversation-trace.js";
import { scheduledReplyId } from "./scheduled-event.js";
import { openingCaption, parseScenarioCasts } from "./scenario-cast.js";
import type { LoadedReplayStation } from "./station-replay-loading.js";
import { applyDialogueSeeds } from "./topic-answers.js";

/** Replay-room caption bank: replyId (+ recorded match) back to a caption. */
export interface ReplayCaptionBank {
  resolve(
    scenarioId: string,
    actorId: string,
    replyId: string,
    match: "exact" | "phrase" | "fallback" | undefined,
  ): string | null;
}

/**
 * Build the caption bank from the replay scenarios + dialogue seed bank (the
 * same inputs the live room casts from). Throws naming "scenarios" on a
 * non-array (parseScenarioCasts only checks length against the second arg).
 */
export function createReplayCaptionBank(
  scenarios: unknown,
  dialogueSeeds: unknown,
): ReplayCaptionBank {
  if (!Array.isArray(scenarios)) {
    throw new Error("bad-scenarios: scenarios must be an array");
  }
  const casts = applyDialogueSeeds(
    parseScenarioCasts(scenarios, (scenarios as unknown[]).map(() => "")),
    dialogueSeeds,
  );
  const byScenario = new Map(casts.map((cast) => [cast.scenarioId, cast]));
  return {
    resolve(scenarioId, actorId, replyId, match) {
      const cast = byScenario.get(scenarioId);
      if (cast === undefined) {
        return null;
      }
      const opening = cast.castActors.find((actor) => actor.actorId === actorId);
      if (opening === undefined) {
        return null;
      }
      if (replyId === `${actorId}:opening`) {
        return openingCaption(opening.displayName, opening.openingUtterance);
      }
      const answer = cast.topicAnswers.find(
        (entry) => entry.actorId === actorId && entry.replyId === replyId,
      );
      if (answer !== undefined) {
        return openingCaption(opening.displayName, answer.line);
      }
      if (C3_REPLY_TABLE.some((row) => row.id === replyId)) {
        // Only a recorded free-text fallback speaks the scenario fallback line; every other table turn is silent, as live.
        if (
          match === "fallback" &&
          cast.utteranceFallback !== null &&
          cast.utteranceFallback.line.trim() !== ""
        ) {
          return `${opening.displayName}: ${cast.utteranceFallback.line}`;
        }
        return "";
      }
      // A scheduled interjection resolves only when the scenario authored that eventId for this actor.
      if (cast.schedule.some((entry) => entry.actorId === actorId && scheduledReplyId(entry.eventId) === replyId)) {
        return "";
      }
      return null;
    },
  };
}

/**
 * First recorded replyId the bank cannot resolve, else null. A forged seed
 * id, a foreign opening, or an unknown scenario all resolve to nothing and
 * refuse the station at join.
 */
export function firstUnresolvedReply(
  bank: ReplayCaptionBank,
  station: LoadedReplayStation,
): string | null {
  for (const turn of station.turns) {
    const match = station.events.find(
      (event) => event.kind === "utterance-end" && event.turnId === turn.turnId,
    )?.match;
    const caption = bank.resolve(station.scenarioId, turn.actorId, turn.replyId, match);
    // Only null refuses: it names nothing in the bank (forged seed id,
    // foreign opening, unknown scenario). An empty caption is a resolved
    // silence (scheduled interjection, unlined fallback) and replays as "".
    if (caption === null) {
      return turn.replyId;
    }
  }
  return null;
}
