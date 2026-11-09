/**
 * C46 the one coveredTags contract, shared by the live trace validator (conversation-trace.ts) and the replay loader
 * (station-replay-loading.ts). Only an utterance-end carries coveredTags; the value is a string array holding the event's own tag
 * (the matched topic always covers itself), deduped. An empty array is refused: the live room writes coveredTags only when
 * an answer covers more than one tag, so an empty list is malformed (absent is the way to say "matched topic only").
 */
export type CoveredTagsVerdict = { ok: true; tags: string[] } | { ok: false; reason: "not-utterance-end" | "malformed" };

export function validateCoveredTags(kind: string, tag: string | undefined, raw: unknown): CoveredTagsVerdict {
  if (kind !== "utterance-end") {
    return { ok: false, reason: "not-utterance-end" };
  }
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    return { ok: false, reason: "malformed" };
  }
  const deduped = [...new Set(raw as string[])];
  if (tag === undefined || !deduped.includes(tag)) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, tags: deduped };
}
