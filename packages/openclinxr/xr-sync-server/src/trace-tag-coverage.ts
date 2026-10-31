import type { ConversationTrace } from "./conversation-trace.js";

/** Review-safe scenario fields needed to evaluate required trace tag coverage. */
export interface TraceTagCoverageScenario {
  requiredTraceTags: string[];
  reviewRubric: Array<{ rubricId: string; requiredTraceTags: string[] }>;
}

/** One persisted rubric item's evidence split (labels deliberately excluded). */
export interface TraceTagRubricCoverage {
  rubricId: string;
  observedTags: string[];
  missingTags: string[];
}

export interface TraceTagCoverage {
  observedTraceTags: string[];
  missingRequiredTraceTags: string[];
  rubricCoverage: TraceTagRubricCoverage[];
}

/**
 * Ordered-dedup split matching domain/src/station-state.ts:113:
 * keep the first occurrence of each required tag, then partition in that order.
 */
export function splitRequiredTraceTags(required: readonly string[], produced: ReadonlySet<string>): { observed: string[]; missing: string[] } {
  const unique = [...new Set(required)];
  return {
    observed: unique.filter((tag) => produced.has(tag)),
    missing: unique.filter((tag) => !produced.has(tag)),
  };
}

/** Produced tags come only from persisted trace events, never scenario config. */
export function producedTraceTags(trace: ConversationTrace): Set<string> {
  const produced = new Set<string>();
  for (const event of trace.events) {
    if (typeof event.tag === "string") {
      produced.add(event.tag);
    }
    if (event.kind === "note-submitted") {
      produced.add("patient_note_submitted");
    }
  }
  return produced;
}

/** Build station-level and per-rubric coverage from one tracer snapshot. */
export function traceTagCoverage(trace: ConversationTrace, scenario: TraceTagCoverageScenario): TraceTagCoverage {
  const produced = producedTraceTags(trace);
  const station = splitRequiredTraceTags(scenario.requiredTraceTags, produced);
  return {
    observedTraceTags: station.observed,
    missingRequiredTraceTags: station.missing,
    rubricCoverage: scenario.reviewRubric.map((item) => {
      const split = splitRequiredTraceTags(item.requiredTraceTags, produced);
      return { rubricId: item.rubricId, observedTags: split.observed, missingTags: split.missing };
    }),
  };
}
