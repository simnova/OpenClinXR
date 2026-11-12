import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * MN1 recompute helper (card WN1).
 *
 * Outcome decision (never inferred from one sample; producer-owned):
 * - packages/openclinxr/xr-sync-server/src/actor-turns.ts:204-213 writes the
 *   utterance-end `match` ("exact" | "phrase" | "fallback") and `tag`
 *   (authored topic tag, or a reserved tag) per learner turn.
 * - packages/openclinxr/xr-sync-server/src/conversation-trace.ts:152-153
 *   defines `match?: "exact" | "phrase" | "fallback"` on the utterance-end
 *   event; lines 455-460 enforce that a fallback carries a reserved tag and
 *   that `speech_low_confidence` belongs to a speech fallback event.
 * - packages/openclinxr/xr-sync-server/src/topic-answers.ts:27,30 defines the
 *   reserved tags `utterance_unmatched` (unmatched free text) and
 *   `speech_low_confidence` (please-repeat: speech below the authored
 *   confidence threshold).
 *
 * Classification:
 * - "please-repeat" = tag `speech_low_confidence`
 * - "unmatched" = tag `utterance_unmatched`
 * - "matched" = match `exact` | `phrase` with an authored tag
 * - N = matched + unmatched + please-repeat (learner turns)
 */

export const UNMATCHED_TAG = "utterance_unmatched";
export const LOW_CONFIDENCE_TAG = "speech_low_confidence";

export type Mn1Outcome = "matched" | "unmatched" | "please-repeat";

export type Mn1Counts = {
  matched: number;
  unmatched: number;
  "please-repeat": number;
  N: number;
};

export const EMPTY_MN1_COUNTS: Mn1Counts = {
  matched: 0,
  unmatched: 0,
  "please-repeat": 0,
  N: 0,
};

type UtteranceEndView = {
  kind: unknown;
  tag: unknown;
  match: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Classify one trace event; non-utterance-end events return null (not a learner turn). */
export function classifyMn1Event(event: unknown): Mn1Outcome | null {
  if (!isRecord(event)) {
    return null;
  }
  const view = event as UtteranceEndView;
  if (view.kind !== "utterance-end") {
    return null;
  }
  if (view.tag === LOW_CONFIDENCE_TAG) {
    return "please-repeat";
  }
  if (view.tag === UNMATCHED_TAG) {
    return "unmatched";
  }
  if (view.match === "exact" || view.match === "phrase") {
    return "matched";
  }
  if (view.match === "fallback") {
    throw new Error(
      `mn1_unexpected_fallback_tag:${typeof view.tag === "string" ? view.tag : "missing"}`,
    );
  }
  throw new Error(
    `mn1_unexpected_utterance_end:match=${typeof view.match === "string" ? view.match : "missing"}:tag=${typeof view.tag === "string" ? view.tag : "missing"}`,
  );
}

/** Count learner turns by outcome over one trace's event list. */
export function countMn1Events(events: readonly unknown[]): Mn1Counts {
  const counts: Mn1Counts = { matched: 0, unmatched: 0, "please-repeat": 0, N: 0 };
  for (const event of events) {
    const outcome = classifyMn1Event(event);
    if (outcome === null) {
      continue;
    }
    if (outcome === "matched") {
      counts.matched += 1;
    } else if (outcome === "unmatched") {
      counts.unmatched += 1;
    } else {
      counts["please-repeat"] += 1;
    }
    counts.N += 1;
  }
  return counts;
}

export function addMn1Counts(left: Mn1Counts, right: Mn1Counts): Mn1Counts {
  return {
    matched: left.matched + right.matched,
    unmatched: left.unmatched + right.unmatched,
    "please-repeat": left["please-repeat"] + right["please-repeat"],
    N: left.N + right.N,
  };
}

function traceEventsOf(trace: unknown): readonly unknown[] {
  if (!isRecord(trace)) {
    return [];
  }
  const events = (trace as { events?: unknown }).events;
  return Array.isArray(events) ? events : [];
}

/** Recompute MN1 counts from parsed trace objects (review-index files contribute zero). */
export function recomputeMn1FromTraces(traces: readonly unknown[]): Mn1Counts {
  let total: Mn1Counts = { matched: 0, unmatched: 0, "please-repeat": 0, N: 0 };
  for (const trace of traces) {
    total = addMn1Counts(total, countMn1Events(traceEventsOf(trace)));
  }
  return total;
}

/** Recompute MN1 counts from *.conversation-trace.json files in a directory. */
export function recomputeMn1FromTraceDir(traceDir: string): {
  counts: Mn1Counts;
  perFile: Record<string, Mn1Counts>;
} {
  const names = readdirSync(traceDir).filter((name) => name.endsWith(".conversation-trace.json")).sort();
  const perFile: Record<string, Mn1Counts> = {};
  let total: Mn1Counts = { matched: 0, unmatched: 0, "please-repeat": 0, N: 0 };
  for (const name of names) {
    const trace = JSON.parse(readFileSync(path.join(traceDir, name), "utf8")) as unknown;
    const counts = countMn1Events(traceEventsOf(trace));
    perFile[name] = counts;
    total = addMn1Counts(total, counts);
  }
  return { counts: total, perFile };
}

/** sha256 of a file's bytes (sources[] integrity). */
export function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
