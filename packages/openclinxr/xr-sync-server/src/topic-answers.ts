import type { ScenarioCast } from "./scenario-cast.js";

/** One validated scenario-authored answer. Text is live-room-only and never enters the trace. */
export interface TopicAnswer {
  actorId: string;
  topicTags: string[];
  replyId: string;
  line: string;
}

/** Review-safe selector metadata recorded with the cast (no authored line text). */
export interface TraceTopicAnswer {
  actorId: string;
  topicTags: string[];
  replyId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate the factory seed bank and attach only each cast scenario's authored answers. */
export function applyDialogueSeeds(casts: ScenarioCast[], value: unknown): ScenarioCast[] {
  if (!Array.isArray(value)) {
    throw new Error("bad-dialogueSeeds: dialogueSeeds must be an array");
  }
  const castByScenario = new Map(casts.map((cast) => [cast.scenarioId, cast]));
  const answersByScenario = new Map<string, TopicAnswer[]>();
  for (const [entryIndex, rawEntry] of value.entries()) {
    if (!isRecord(rawEntry) || typeof rawEntry["scenarioId"] !== "string" || !Array.isArray(rawEntry["seeds"])) {
      throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}] must name scenarioId and a seeds array`);
    }
    const scenarioId = rawEntry["scenarioId"] as string;
    const cast = castByScenario.get(scenarioId);
    if (cast === undefined) {
      continue;
    }
    const answers = answersByScenario.get(scenarioId) ?? [];
    for (const [seedIndex, rawSeed] of (rawEntry["seeds"] as unknown[]).entries()) {
      if (!isRecord(rawSeed)) {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}].seeds[${seedIndex}] must be an object`);
      }
      const seedId = rawSeed["seedId"];
      const actorId = rawSeed["actorId"];
      const tags = rawSeed["expectedTraceTags"];
      const safety = rawSeed["safetyExpectation"];
      const caption = rawSeed["caption"];
      const spokenText = rawSeed["spokenText"];
      if (
        typeof seedId !== "string" || seedId === "" ||
        typeof actorId !== "string" || actorId === "" ||
        !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string") ||
        (safety !== "responds_from_visible_facts" && safety !== "blocks_hidden_truth_probe") ||
        (caption !== undefined && typeof caption !== "string") ||
        (spokenText !== undefined && typeof spokenText !== "string")
      ) {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}].seeds[${seedIndex}] is malformed`);
      }
      if (!cast.actorIds.includes(actorId)) {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds seed actorId ${actorId.slice(0, 64)} is not in the cast`);
      }
      const line = typeof caption === "string" ? caption : typeof spokenText === "string" ? spokenText : null;
      if (safety === "responds_from_visible_facts" && line !== null) {
        answers.push({ actorId, topicTags: [...(tags as string[])], replyId: `${actorId}:seed:${seedId}`, line });
      }
    }
    answersByScenario.set(scenarioId, answers);
  }
  return casts.map((cast) => ({ ...cast, topicAnswers: answersByScenario.get(cast.scenarioId) ?? [] }));
}

/** First authored match wins; caller separately protects the opening turn. */
export function pickTopicAnswer<T extends TraceTopicAnswer>(
  answers: readonly T[] | null | undefined,
  actorId: string,
  topicTag: string | undefined,
): T | undefined {
  if (topicTag === undefined) return undefined;
  return answers?.find((answer) => answer.actorId === actorId && answer.topicTags.includes(topicTag));
}
