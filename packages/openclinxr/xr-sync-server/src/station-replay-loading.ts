/**
 * C11 per-station replay trace validation for the xr-sync encounter server.
 *
 * Split out of station-replay.ts for the file-size gate. Validation is PER
 * STATION: one station's malformed trace (or its emotion shortage) refuses
 * only that station's replay join with a named error; every other station in
 * the same replayDir still replays. Only a corrupt or missing review INDEX
 * fails the whole directory (boot-time loadError, as before).
 *
 * Emotion accounting (C11 grade carry-over): a recorded utterance-end consumes
 * one emotion (the acknowledgement) and an interrupting utterance-start (a
 * start while a turn is open) consumes one (the interruption) — mirroring
 * stepReplay exactly. A trace whose emotions array is shorter than the
 * transitions its events need refuses the join at load; the load-time check
 * makes consumeReplayEmotion exhaustion unreachable, so the replay asserts
 * instead of falling back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmotionTransition } from "@openclinxr/conversation-policy";
import { CONVERSATION_TRACE_SCHEMA, type ConversationTraceEvent } from "./conversation-trace.js";
import type { SessionReviewStationEntry } from "./session-review-index.js";

/** One validated replayable station: its index entry plus its recorded trace. */
export interface LoadedReplayStation {
  stationId: string;
  stationIndex: number;
  stationCount: number;
  entry: SessionReviewStationEntry;
  events: ConversationTraceEvent[];
  turns: { turnId: number; actorId: string; replyId: string; cueId: string; end: string }[];
  emotions: EmotionTransition[];
}

function isReplayTraceEventKind(kind: unknown): boolean {
  return (
    kind === "select-actor" ||
    kind === "utterance-start" ||
    kind === "utterance-end" ||
    kind === "turn-completed" ||
    kind === "observer-joined" ||
    kind === "observer-left" ||
    kind === "phase-changed" ||
    kind === "rotation-failed" ||
    kind === "note-submitted"
  );
}

/** Loose replay-file shapes for validation (dot access keeps useLiteralKeys quiet). */
interface RawReplayTrace {
  schema?: unknown;
  events?: unknown;
  turns?: unknown;
  emotions?: unknown;
}

interface RawReplayEvent {
  seq?: unknown;
  kind?: unknown;
  actorId?: unknown;
  turnId?: unknown;
  phase?: unknown;
  chars?: unknown;
}

interface RawReplayTurn {
  turnId?: unknown;
  actorId?: unknown;
  replyId?: unknown;
  cueId?: unknown;
  end?: unknown;
}

interface RawReplayEmotion {
  to?: unknown;
}

/**
 * Count the emotion transitions a replay will consume from an event list,
 * mirroring stepReplay: one per utterance-end that opens a recorded turn,
 * one per utterance-start that interrupts an open turn. Nothing else consumes.
 */
export function requiredEmotionConsumptions(
  events: ConversationTraceEvent[],
  turns: { turnId: number }[],
): number {
  const turnIds = new Set(turns.map((turn) => turn.turnId));
  let openTurnId: number | null = null;
  let required = 0;
  for (const event of events) {
    switch (event.kind) {
      case "utterance-end": {
        if (event.turnId !== null && turnIds.has(event.turnId)) {
          required += 1;
          openTurnId = event.turnId;
        }
        break;
      }
      case "utterance-start": {
        if (openTurnId !== null) {
          required += 1;
          openTurnId = null;
        }
        break;
      }
      case "turn-completed": {
        if (event.turnId !== null && openTurnId === event.turnId) {
          openTurnId = null;
        }
        break;
      }
      case "phase-changed": {
        if (event.phase !== "encounter") {
          openTurnId = null;
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  return required;
}

/**
 * Load and validate one station's recorded trace: schema tag, known event
 * kinds (note-submitted carries chars), well-formed turns/emotions, and the
 * emotion-count check. Throws a named error (the caller records it against
 * this station only, never the whole directory).
 */
export function loadReplayStationTrace(
  dir: string,
  entry: SessionReviewStationEntry,
  stationCount: number,
): LoadedReplayStation {
  const stationId = entry.stationId;
  let traceRaw: string;
  try {
    traceRaw = readFileSync(join(dir, entry.traceFile), "utf8");
  } catch {
    throw new Error(`replay-missing-trace: ${join(dir, entry.traceFile)}`);
  }
  let trace: RawReplayTrace;
  try {
    trace = JSON.parse(traceRaw) as RawReplayTrace;
  } catch {
    throw new Error(`replay-bad-trace: ${entry.traceFile} is not JSON`);
  }
  if (trace.schema !== CONVERSATION_TRACE_SCHEMA) {
    throw new Error(`replay-bad-trace-schema: ${entry.traceFile}`);
  }
  const rawEvents = trace.events;
  const rawTurns = trace.turns;
  const rawEmotions = trace.emotions;
  if (!Array.isArray(rawEvents) || !Array.isArray(rawTurns) || !Array.isArray(rawEmotions)) {
    throw new Error(`replay-bad-trace: ${entry.traceFile} misses events/turns/emotions`);
  }
  const events: ConversationTraceEvent[] = [];
  for (const raw of rawEvents) {
    const item = raw as RawReplayEvent;
    if (typeof raw !== "object" || raw === null || !isReplayTraceEventKind(item.kind)) {
      throw new Error(`replay-bad-trace: ${entry.traceFile} holds an unknown event kind`);
    }
    const event: ConversationTraceEvent = {
      seq: typeof item.seq === "number" ? item.seq : null,
      kind: item.kind as ConversationTraceEvent["kind"],
      actorId: typeof item.actorId === "string" ? item.actorId : "",
      turnId: typeof item.turnId === "number" ? item.turnId : null,
    };
    if (typeof item.phase === "string") {
      event.phase = item.phase;
    }
    // C11: the accepted-note length replays into noteStatus/noteChars; the
    // note text itself was never recorded and is never replayed.
    if (typeof item.chars === "number") {
      event.chars = item.chars;
    }
    events.push(event);
  }
  const turns = [];
  for (const raw of rawTurns) {
    const item = raw as RawReplayTurn;
    // Turns drive playback (actor, recorded ids, ends): a turn without an
    // actor cannot replay, so the trace is refused with a named error.
    if (typeof raw !== "object" || raw === null || typeof item.turnId !== "number" || typeof item.actorId !== "string" || item.actorId === "") {
      throw new Error(`replay-bad-trace: ${entry.traceFile} holds a malformed turn`);
    }
    turns.push({
      turnId: item.turnId,
      actorId: item.actorId,
      replyId: typeof item.replyId === "string" ? item.replyId : "",
      cueId: typeof item.cueId === "string" ? item.cueId : "",
      end: typeof item.end === "string" ? item.end : "",
    });
  }
  const emotions: EmotionTransition[] = [];
  for (const raw of rawEmotions) {
    const item = raw as RawReplayEmotion;
    if (typeof raw !== "object" || raw === null || typeof item.to !== "string") {
      throw new Error(`replay-bad-trace: ${entry.traceFile} holds a malformed emotion`);
    }
    emotions.push(raw as unknown as EmotionTransition);
  }
  // C11 grade carry-over: the replay consumes one emotion per acknowledgement
  // and one per interruption; a shorter emotions array would exhaust the
  // cursor mid-replay, so the trace refuses the join here instead.
  const required = requiredEmotionConsumptions(events, turns);
  if (emotions.length < required) {
    throw new Error(`replay-bad-trace: ${entry.traceFile} holds fewer emotions than its events consume (needs ${required}, has ${emotions.length})`);
  }
  return {
    stationId: entry.stationId,
    stationIndex: typeof entry.stationIndex === "number" ? entry.stationIndex : 0,
    stationCount,
    entry,
    events,
    turns,
    emotions,
  };
}
