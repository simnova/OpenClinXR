import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  edChestPainScenario,
  scenarioDialogueSeedBank,
} from "@openclinxr/scenario-fixtures";
import {
  createReplayCaptionBank,
  replayConversationTrace,
} from "@openclinxr/xr-sync-server/conversation-replay";

/**
 * MN2 recompute helper (card WN2, re-scope C).
 *
 * Compares the captions the learner's client displayed (the capture
 * harness DOM log, committed as
 * tools/openclinxr/evidence/site/fixtures/mn2/mn2-dom-captions.json)
 * against captions recomputed from the committed traces.
 *
 * Production path, never reimplemented:
 * - replay: `replayConversationTrace` from
 *   `@openclinxr/xr-sync-server/conversation-replay`
 *   (packages/openclinxr/xr-sync-server/src/conversation-trace.ts:384).
 * - caption: `createReplayCaptionBank(...).resolve(scenarioId, actorId,
 *   replyId, match)` — the lookup the replay client uses
 *   (packages/openclinxr/xr-sync-server/src/replay-captions.ts:34-87),
 *   built from the shipped scenario + dialogue seed bank exactly as the
 *   C31 replay server builds it.
 * - match kind per turn comes from the trace's own utterance-end event
 *   with that turnId, as `firstUnresolvedReply` reads it
 *   (replay-captions.ts:99-101).
 *
 * Status per replayed turn:
 * - matched: recomputed caption equals an attributable extract caption.
 * - not-attributable: recomputed caption is in the extract but was
 *   pre-seeded in sample 0, so it cannot show the turn was displayed.
 * - unmatched: recomputed caption appears nowhere in the extract.
 * - not-replayable: replay threw, or the bank resolves nothing for the
 *   replyId (reported with detail, excluded from matched, never skipped).
 */

export type Mn2TurnStatus = "matched" | "unmatched" | "not-attributable" | "not-replayable";

export type Mn2TurnComparison = {
  trace: string;
  turnId: number | null;
  replyId: string | null;
  caption: string | null;
  status: Mn2TurnStatus;
  detail?: string;
};

export type Mn2Recompute = {
  /** Attributable extract captions compared. */
  N: number;
  matched: number;
  notAttributable: { count: number; captions: string[] };
  perTurn: Mn2TurnComparison[];
};

export type Mn2ExtractCaption = {
  speaker: unknown;
  text: unknown;
  firstSample: unknown;
  firstAtMs: unknown;
  attributable: unknown;
};

export type Mn2Extract = {
  sourcePath: unknown;
  sourceSha256: unknown;
  sampleCount: unknown;
  captions: Mn2ExtractCaption[];
};

/** Production caption bank, typed structurally (the module publishes the builder, not the type). */
export type Mn2CaptionBank = {
  resolve(
    scenarioId: string,
    actorId: string,
    replyId: string,
    match: "exact" | "phrase" | "fallback" | undefined,
  ): string | null;
};

/** The bank the C31 replay server builds: shipped scenario + seed bank. */
export function buildMn2CaptionBank(): Mn2CaptionBank {
  return createReplayCaptionBank([edChestPainScenario], scenarioDialogueSeedBank) as Mn2CaptionBank;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function captionText(caption: Mn2ExtractCaption): string | null {
  if (typeof caption.speaker !== "string" || typeof caption.text !== "string") {
    return null;
  }
  return `${caption.speaker}: ${caption.text}`;
}

function attributableCaptions(extract: Mn2Extract): string[] {
  if (!Array.isArray(extract.captions)) {
    return [];
  }
  const out: string[] = [];
  for (const caption of extract.captions) {
    if (!isRecord(caption) || caption["attributable"] !== true) {
      continue;
    }
    const text = captionText(caption as Mn2ExtractCaption);
    if (text !== null) {
      out.push(text);
    }
  }
  return out;
}

function extractCaptionTexts(extract: Mn2Extract): string[] {
  if (!Array.isArray(extract.captions)) {
    return [];
  }
  const out: string[] = [];
  for (const caption of extract.captions) {
    if (!isRecord(caption)) {
      continue;
    }
    const text = captionText(caption as Mn2ExtractCaption);
    if (text !== null) {
      out.push(text);
    }
  }
  return out;
}

type TraceView = {
  scenarioId?: unknown;
  events?: unknown;
};

function eventsOf(trace: unknown): Record<string, unknown>[] {
  if (!isRecord(trace)) {
    return [];
  }
  const events = (trace as TraceView).events;
  if (!Array.isArray(events)) {
    return [];
  }
  return events.filter((event): event is Record<string, unknown> => isRecord(event));
}

function matchOfTurn(events: Record<string, unknown>[], turnId: number): "exact" | "phrase" | "fallback" | undefined {
  const end = events.find((event) => event["kind"] === "utterance-end" && event["turnId"] === turnId);
  const match = end?.["match"];
  return match === "exact" || match === "phrase" || match === "fallback" ? match : undefined;
}

/** Compare one parsed trace against the extract through the production bank. */
export function compareMn2Trace(
  name: string,
  trace: unknown,
  extract: Mn2Extract,
  bank: Mn2CaptionBank,
): Mn2TurnComparison[] {
  const attributable = new Set(attributableCaptions(extract));
  const displayed = new Set(extractCaptionTexts(extract));
  let replayed: { turns?: unknown };
  try {
    replayed = replayConversationTrace(trace as never) as { turns?: unknown };
  } catch (error) {
    return [
      {
        trace: name,
        turnId: null,
        replyId: null,
        caption: null,
        status: "not-replayable",
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
  if (!isRecord(trace) || !Array.isArray(replayed.turns)) {
    return [
      {
        trace: name,
        turnId: null,
        replyId: null,
        caption: null,
        status: "not-replayable",
        detail: "trace has no replayable turns",
      },
    ];
  }
  const events = eventsOf(trace);
  const scenarioId = typeof (trace as TraceView).scenarioId === "string" ? ((trace as TraceView).scenarioId as string) : "";
  const out: Mn2TurnComparison[] = [];
  for (const rawTurn of replayed.turns) {
    if (!isRecord(rawTurn) || typeof rawTurn["turnId"] !== "number") {
      continue;
    }
    const turnId = rawTurn["turnId"] as number;
    const actorId = typeof rawTurn["actorId"] === "string" ? (rawTurn["actorId"] as string) : "";
    const replyId = typeof rawTurn["replyId"] === "string" ? (rawTurn["replyId"] as string) : "";
    const caption = bank.resolve(scenarioId, actorId, replyId, matchOfTurn(events, turnId));
    if (caption === null) {
      out.push({ trace: name, turnId, replyId, caption: null, status: "not-replayable", detail: `unresolved replyId ${replyId}` });
    } else if (attributable.has(caption)) {
      out.push({ trace: name, turnId, replyId, caption, status: "matched" });
    } else if (displayed.has(caption)) {
      out.push({ trace: name, turnId, replyId, caption, status: "not-attributable" });
    } else {
      out.push({ trace: name, turnId, replyId, caption, status: "unmatched" });
    }
  }
  return out;
}

/** Compare named parsed traces against one parsed extract. */
export function compareMn2Traces(
  traces: readonly { name: string; trace: unknown }[],
  extract: Mn2Extract,
  bank?: Mn2CaptionBank,
): Mn2Recompute {
  const resolved = bank ?? buildMn2CaptionBank();
  const perTurn = traces.flatMap(({ name, trace }) => compareMn2Trace(name, trace, extract, resolved));
  const attributable = attributableCaptions(extract);
  const notAttributable = [...new Set(perTurn.filter((entry) => entry.status === "not-attributable").map((entry) => entry.caption ?? ""))].sort();
  return {
    N: attributable.length,
    matched: perTurn.filter((entry) => entry.status === "matched").length,
    notAttributable: { count: notAttributable.length, captions: notAttributable },
    perTurn,
  };
}

/** Compare every *.conversation-trace.json file in a directory against one parsed extract. */
export function recomputeMn2FromTraceDir(traceDir: string, extract: Mn2Extract): Mn2Recompute {
  const names = readdirSync(traceDir).filter((name) => name.endsWith(".conversation-trace.json")).sort();
  const traces = names.map((name) => ({
    name,
    trace: JSON.parse(readFileSync(path.join(traceDir, name), "utf8")) as unknown,
  }));
  return compareMn2Traces(traces, extract);
}

/** Read a committed extract file. */
export function readMn2Extract(extractPath: string): Mn2Extract {
  return JSON.parse(readFileSync(extractPath, "utf8")) as Mn2Extract;
}

/** The extract's recorded source sha256 matches these store bytes. */
export function extractSourceShaMatches(extract: Mn2Extract, storeBytes: Buffer): boolean {
  if (typeof extract.sourceSha256 !== "string") {
    return false;
  }
  return createHash("sha256").update(storeBytes).digest("hex") === extract.sourceSha256;
}

/** sha256 of a file's bytes (sources[] integrity). */
export function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
