import { ArraySchema } from "@colyseus/schema";
import type { ConversationTracer } from "./conversation-tracer.js";
import type { ScenarioCast } from "./scenario-cast.js";
import { traceTagCoverage } from "./trace-tag-coverage.js";
import { TopicMenuEntryState, type TopicMenuEntryStateInstance } from "./schema.js";

const NOTE_TRACE_TAG = "patient_note_submitted";

/** C37 where a topic-menu label comes from ("other" requires a non-empty note). */
export type TopicLabelSource = "seed-phrase" | "tag" | "other";

/** C37 one learner-visible topic-menu entry. */
export interface TopicMenuEntry {
  tag: string;
  label: string;
  labelSource: TopicLabelSource;
  note: string;
  asked: boolean;
}

/** Scenario-owned history topics shown to the learner for one cast station.
 * A seed phrase shared by 2 or more tags labels none of those tags. */
export function topicMenuForCast(cast: ScenarioCast | null): TopicMenuEntry[] {
  if (cast === null) {
    return [];
  }
  const tags = [...new Set(cast.requiredTraceTags)].filter((tag) => tag !== NOTE_TRACE_TAG);
  const entries = tags.map((tag): TopicMenuEntry => {
    const seed = cast.topicAnswers.find((answer) => answer.topicTags.includes(tag) && answer.phrases.length > 0);
    if (seed !== undefined) {
      return { tag, label: seed.phrases[0] as string, labelSource: "seed-phrase" as TopicLabelSource, note: "", asked: false };
    }
    return { tag, label: tag, labelSource: "tag" as TopicLabelSource, note: "", asked: false };
  });
  const phraseCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.labelSource === "seed-phrase") {
      phraseCounts.set(entry.label, (phraseCounts.get(entry.label) ?? 0) + 1);
    }
  }
  return entries.map((entry) =>
    entry.labelSource === "seed-phrase" && (phraseCounts.get(entry.label) ?? 0) >= 2
      ? { tag: entry.tag, label: entry.tag, labelSource: "tag" as TopicLabelSource, note: "", asked: false }
      : entry,
  );
}

/** Tags of a synced topic menu, in order (for trace validation). */
export function topicMenuTags(state: { topicMenu: Iterable<{ tag: string }> }): string[] {
  return [...state.topicMenu].map((entry) => entry.tag);
}

/**
 * C37 mark each topic-menu entry's asked flag from the review's observed set:
 * asked is true exactly when the entry tag is in observedTags. Assigns only
 * on change (avoids redundant schema patches).
 */
function markAskedTopics(state: { topicMenu: Iterable<{ tag: string; asked: boolean }> }, observedTags: readonly string[]): void {
  for (const entry of state.topicMenu) {
    const asked = observedTags.includes(entry.tag);
    if (entry.asked !== asked) {
      entry.asked = asked;
    }
  }
}

/** Replace the synced menu when a station room is created. */
export function setTopicMenuState(state: { topicMenu: unknown }, menu: readonly TopicMenuEntry[]): void {
  (state as { topicMenu: ArraySchema<TopicMenuEntryStateInstance> }).topicMenu = new ArraySchema<TopicMenuEntryStateInstance>(
    ...menu.map((entry) => {
      const next = new TopicMenuEntryState();
      next.tag = entry.tag;
      next.label = entry.label;
      next.labelSource = entry.labelSource;
      next.note = entry.note;
      next.asked = entry.asked;
      return next;
    }),
  );
}

export type TopicTagVerdict =
  | { ok: true; tag?: string }
  | { ok: false; reason: "bad-utterance-payload" | "unknown-topic" };

/** Validate only cast-station utterance-end tags; off-cast fields remain ignored. */
export function validateTopicTag(payload: Record<string, unknown>, topicMenu: readonly string[] | null): TopicTagVerdict {
  if (topicMenu === null || payload["topicTag"] === undefined) {
    return { ok: true };
  }
  const tag = payload["topicTag"];
  if (typeof tag !== "string") {
    return { ok: false, reason: "bad-utterance-payload" };
  }
  if (!topicMenu.includes(tag)) {
    return { ok: false, reason: "unknown-topic" };
  }
  return { ok: true, tag };
}

/**
 * C37 keep each entry's asked flag equal to the review's observed set: recompute it from the tracer whenever a
 * tagged event (or the note) is pushed. A null cast clears the listener.
 */
export function trackAskedTopics(state: { topicMenu: Iterable<{ tag: string; asked: boolean }> }, tracer: ConversationTracer, cast: ScenarioCast | null): void {
  tracer.setPushListener(
    cast === null
      ? null
      : (event) => {
          if (typeof event.tag === "string" || event.kind === "note-submitted") {
            markAskedTopics(state, traceTagCoverage(tracer.snapshot(), cast).observedTraceTags);
          }
        },
  );
}
