
/** Authored dialogue affect carried by one topic-answer seed (mirrors DialogueFixtureSeed["affect"]). */
export type TopicAffect = "anxious" | "concerned" | "reassured" | "neutral";

/** True when the value is one of the four authored dialogue emotions. */
export function isTopicAffect(value: unknown): value is TopicAffect {
  return value === "anxious" || value === "concerned" || value === "reassured" || value === "neutral";
}

/** One validated scenario-authored answer. Text is live-room-only and never enters the trace. */
export interface TopicAnswer {
  actorId: string;
  topicTags: string[];
  replyId: string;
  line: string;
  affect?: TopicAffect;
  phrases: string[];
}

/** Scenario-authored fallback line for unmatched free text (live-room-only). */
export interface UtteranceFallback {
  line: string;
}

/** Trace tag recorded for free text that matched no authored phrase; no authored answer may carry it. */
export const UNMATCHED_TOPIC_TAG = "utterance_unmatched";

/**
 * Normalize learner text or an authored phrase: NFKC, case fold (upper then lower, so ss/SS and sigma forms meet),
 * strip Latin combining accents, every run of non-letter/non-number to one space, trim. Letters of any script survive.
 */
export function normalizeUtterance(text: string): string {
  return text
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Review-safe selector metadata recorded with the cast (no authored line text). */
export interface TraceTopicAnswer {
  actorId: string;
  topicTags: string[];
  replyId: string;
  affect?: TopicAffect;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate the factory seed bank and attach only each cast scenario's authored answers. */
/** The cast fields seed validation reads (kept structural so scenario-cast.ts can import TopicAnswer one way). */
interface SeedableCast {
  scenarioId: string;
  actorIds: readonly string[];
  topicAnswers: TopicAnswer[];
  utteranceFallback: UtteranceFallback | null;
}

export function applyDialogueSeeds<C extends SeedableCast>(casts: C[], value: unknown): C[] {
  if (!Array.isArray(value)) {
    throw new Error("bad-dialogueSeeds: dialogueSeeds must be an array");
  }
  const castByScenario = new Map(casts.map((cast) => [cast.scenarioId, cast]));
  const answersByScenario = new Map<string, TopicAnswer[]>();
  const fallbackByScenario = new Map<string, UtteranceFallback | null>();
  const seedIdsByScenario = new Map<string, Set<string>>();
  for (const [entryIndex, rawEntry] of value.entries()) {
    if (!isRecord(rawEntry) || typeof rawEntry["scenarioId"] !== "string" || !Array.isArray(rawEntry["seeds"])) {
      throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}] must name scenarioId and a seeds array`);
    }
    const scenarioId = rawEntry["scenarioId"] as string;
    const cast = castByScenario.get(scenarioId);
    if (cast === undefined) {
      continue;
    }
    const rawFallback = rawEntry["utteranceFallback"];
    if (rawFallback === undefined) {
      if (!fallbackByScenario.has(scenarioId)) fallbackByScenario.set(scenarioId, null);
    } else {
      if (!isRecord(rawFallback) || typeof rawFallback["line"] !== "string" || (rawFallback["line"] as string).trim() === "") {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}].utteranceFallback must carry a non-empty line`);
      }
      fallbackByScenario.set(scenarioId, { line: rawFallback["line"] as string });
    }
    const answers = answersByScenario.get(scenarioId) ?? [];
    const seenSeedIds = seedIdsByScenario.get(scenarioId) ?? new Set<string>();
    seedIdsByScenario.set(scenarioId, seenSeedIds);
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
      const affect = rawSeed["affect"];
      if (
        typeof seedId !== "string" || seedId === "" ||
        typeof actorId !== "string" || actorId === "" ||
        !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string") ||
        (safety !== "responds_from_visible_facts" && safety !== "blocks_hidden_truth_probe") ||
        (caption !== undefined && typeof caption !== "string") ||
        (spokenText !== undefined && typeof spokenText !== "string") ||
        (affect !== undefined && !isTopicAffect(affect))
      ) {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}].seeds[${seedIndex}] is malformed`);
      }
      if ((tags as string[]).includes(UNMATCHED_TOPIC_TAG)) {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}].seeds[${seedIndex}] uses the reserved tag ${UNMATCHED_TOPIC_TAG}`);
      }
      if (seenSeedIds.has(seedId)) {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}] repeats seedId ${seedId.slice(0, 64)}`);
      }
      seenSeedIds.add(seedId);
      if (!cast.actorIds.includes(actorId)) {
        throw new Error(`bad-dialogueSeeds: dialogueSeeds seed actorId ${actorId.slice(0, 64)} is not in the cast`);
      }
      const line = typeof caption === "string" ? caption : typeof spokenText === "string" ? spokenText : null;
      const rawPhrases = rawSeed["utterancePhrases"];
      let phrases: string[] = [];
      if (rawPhrases !== undefined) {
        if (!Array.isArray(rawPhrases) || rawPhrases.some((entry) => typeof entry !== "string" || (entry as string).trim() === "")) {
          throw new Error(`bad-dialogueSeeds: dialogueSeeds[${entryIndex}].seeds[${seedIndex}] utterancePhrases must be an array of non-empty strings`);
        }
        phrases = (rawPhrases as string[]).map((entry) => normalizeUtterance(entry)).filter((entry) => entry !== "");
      }
      if (safety === "responds_from_visible_facts" && line !== null) {
        answers.push({ actorId, topicTags: [...(tags as string[])], replyId: `${actorId}:seed:${seedId}`, line, ...(affect === undefined ? {} : { affect: affect as TopicAffect }), phrases });
      }
    }
    answersByScenario.set(scenarioId, answers);
  }
  return casts.map((cast) => ({ ...cast, topicAnswers: answersByScenario.get(cast.scenarioId) ?? [], utteranceFallback: fallbackByScenario.get(cast.scenarioId) ?? null }));
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

/** Match learner free text against authored phrases: exact beats phrase; longest phrase (in words) wins, ties to first authored. */
export function matchUtterance(
  rawText: string,
  answers: readonly TopicAnswer[] | null | undefined,
  actorId: string,
  menu: readonly string[],
): { kind: "exact" | "phrase"; tag: string } | { kind: "fallback" } {
  const text = normalizeUtterance(rawText);
  const candidates: Array<{ answer: TopicAnswer; tag: string }> = [];
  for (const answer of answers ?? []) {
    if (answer.actorId !== actorId) continue;
    const tag = answer.topicTags.find((entry) => menu.includes(entry));
    if (tag === undefined) continue;
    candidates.push({ answer, tag });
  }
  for (const { answer, tag } of candidates) {
    for (const phrase of answer.phrases) {
      if (text === phrase) return { kind: "exact", tag };
    }
  }
  let best: { kind: "phrase"; tag: string; words: number } | null = null;
  for (const { answer, tag } of candidates) {
    for (const phrase of answer.phrases) {
      if (phrase === "" || !` ${text} `.includes(` ${phrase} `)) continue;
      const words = phrase.split(" ").length;
      if (best === null || words > best.words) best = { kind: "phrase", tag, words };
    }
  }
  if (best !== null) return { kind: best.kind, tag: best.tag };
  return { kind: "fallback" };
}
