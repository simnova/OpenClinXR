import { ArraySchema } from "@colyseus/schema";
import type { ScenarioCast } from "./scenario-cast.js";

const NOTE_TRACE_TAG = "patient_note_submitted";

/** Scenario-owned history topics shown to the learner for one cast station. */
export function topicMenuForCast(cast: ScenarioCast | null): string[] {
  return cast === null
    ? []
    : [...new Set(cast.requiredTraceTags)].filter((tag) => tag !== NOTE_TRACE_TAG);
}

/** Replace the synced menu when a station room is created. */
export function setTopicMenuState(state: { topicMenu: unknown }, menu: readonly string[]): void {
  (state as { topicMenu: ArraySchema<string> }).topicMenu = new ArraySchema<string>(...menu);
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
