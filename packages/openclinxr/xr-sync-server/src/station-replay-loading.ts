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
import { readCastContext } from "./conversation-trace-cast.js";
import type { SessionReviewStationEntry } from "./session-review-index.js";
import {
  SESSION_REVIEW_INDEX_FILE,
  SESSION_REVIEW_INDEX_SCHEMA,
  type SessionReviewIndex,
} from "./session-review-index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Per-server loaded replay data: the validated index plus every named trace. */
export interface LoadedStationReplay {
  stations: Map<string, LoadedReplayStation>;
  /** C11 per-station load failures (trace content only): a bad trace refuses
   * only its own station's join with its stored error, never the whole dir. */
  failures: Map<string, string>;
  /** C12 index complete flag, copied for the lobby state. */
  complete: boolean;
  /** C12 lobby entries in index order, copied from the review index. */
  lobbyStations: { stationId: string; stationIndex: number; turnCount: number; notePresent: boolean; noteChars: number }[];
}

/**
 * Load and validate a replay directory: the C9 review index plus every trace
 * file it names. Schema tags are checked; a malformed or missing INDEX throws
 * a named error (the room turns it into a refused join, never a partial
 * replay). A malformed or short trace refuses only its own station (C11):
 * the error is stored against that station and every other station still
 * replays. Turns and emotions are kept AS RECORDED from the trace file.
 */
export function loadStationReplayDir(dir: string): LoadedStationReplay {
  let indexRaw: string;
  try {
    indexRaw = readFileSync(join(dir, SESSION_REVIEW_INDEX_FILE), "utf8");
  } catch {
    throw new Error(`replay-no-index: ${join(dir, SESSION_REVIEW_INDEX_FILE)}`);
  }
  let index: SessionReviewIndex;
  try {
    index = JSON.parse(indexRaw) as SessionReviewIndex;
  } catch {
    throw new Error("replay-bad-index: review index is not JSON");
  }
  if (!isRecord(index) || index.schema !== SESSION_REVIEW_INDEX_SCHEMA) {
    throw new Error(`replay-bad-index-schema: ${(index as { schema?: unknown } | null)?.schema}`);
  }
  if (!Array.isArray(index.stations) || index.stations.length === 0) {
    throw new Error("replay-bad-index: review index names no stations");
  }
  const stations = new Map<string, LoadedReplayStation>();
  const failures = new Map<string, string>();
  const stationCount = typeof index.stationCount === "number" ? index.stationCount : index.stations.length;
  const lobbyStations: LoadedStationReplay["lobbyStations"] = [];
  for (const entry of index.stations) {
    if (!isRecord(entry) || typeof entry.stationId !== "string" || entry.stationId === "") {
      throw new Error("replay-bad-index: station entry without a stationId");
    }
    if (typeof entry.traceFile !== "string" || entry.traceFile === "") {
      throw new Error(`replay-bad-index: station ${entry.stationId} names no trace file`);
    }
    const typed = entry as unknown as SessionReviewStationEntry;
    lobbyStations.push({
      stationId: typed.stationId,
      stationIndex: typeof typed.stationIndex === "number" ? typed.stationIndex : lobbyStations.length,
      turnCount: typeof typed.turnCount === "number" ? typed.turnCount : 0,
      notePresent: typed.notePresent === true,
      noteChars: typeof typed.noteChars === "number" ? typed.noteChars : 0,
    });
    // C11: a bad TRACE refuses only its own station (the error is stored
    // against it and surfaces at join); every other station still replays.
    try {
      const station = loadReplayStationTrace(dir, entry as SessionReviewStationEntry, stationCount);
      stations.set(station.stationId, station);
    } catch (error) {
      failures.set(entry.stationId, error instanceof Error ? error.message : String(error));
    }
  }
  return { stations, failures, complete: index.complete === true, lobbyStations };
}

/** One validated replayable station: its index entry plus its recorded trace. */
export interface LoadedReplayStation {
  stationId: string;
  stationIndex: number;
  stationCount: number;
  entry: SessionReviewStationEntry;
  events: ConversationTraceEvent[];
  turns: { turnId: number; actorId: string; replyId: string; cueId: string; end: string }[];
  emotions: EmotionTransition[];
  /** C18 the slot's scenario id ("" off a cast station). */
  scenarioId: string;
  /** C18 recorded cast context (undefined off-cast). */
  cast?: { scenarioId: string; actors: string[]; baseline: string; emotionPolicy: { baseline: string; upperBound: string; lowerBound: string; transitions: unknown[] } };
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
    kind === "note-submitted" ||
    kind === "scheduled-event"
  );
}

/** Loose replay-file shapes for validation (dot access keeps useLiteralKeys quiet). */
interface RawReplayTrace {
  schema?: unknown;
  scenarioId?: unknown;
  cast?: unknown;
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
  eventId?: unknown;
  tag?: unknown;
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
    // C19: the scheduled interjection replays its entry id + tag (ids only,
    // never text); the replyId comes from the recorded turn like every turn.
    if (typeof item.eventId === "string") {
      event.eventId = item.eventId;
    }
    if (typeof item.tag === "string") {
      event.tag = item.tag;
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
  // C18: the recorded cast context (absent off-cast / pre-C18). Validated here
  // so a malformed cast refuses only its own station; review-safe by
  // construction (ids, baseline, policy only — never utterance text).
  const scenarioId = typeof (trace as { scenarioId?: unknown }).scenarioId === "string" ? (trace as { scenarioId: string }).scenarioId : "";
  const shared = readCastContext(trace.cast, entry.traceFile);
  const cast = shared === undefined ? undefined : {
    scenarioId: shared.scenarioId,
    actors: [...shared.actors],
    baseline: shared.baseline,
    emotionPolicy: {
      baseline: shared.emotionPolicy.baseline as string,
      upperBound: shared.emotionPolicy.upperBound as string,
      lowerBound: shared.emotionPolicy.lowerBound as string,
      transitions: [...shared.emotionPolicy.transitions] as unknown[],
    },
  };
  return {
    stationId: entry.stationId,
    stationIndex: typeof entry.stationIndex === "number" ? entry.stationIndex : 0,
    stationCount,
    entry,
    events,
    turns,
    emotions,
    scenarioId,
    ...(cast === undefined ? {} : { cast }),
  };
}

/** Default ms between recorded replay events when replayStepMs is not configured. */
export const DEFAULT_REPLAY_STEP_MS = 300;

/**
 * Validate server replay step config. Returns the step when configured, the
 * default when absent. Throws on invalid (fail fast at boot, never per join).
 */
export function parseReplayStepMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_REPLAY_STEP_MS;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("bad-replay-step-ms: replayStepMs must be a finite number > 0");
  }
  return value;
}

/** Minimal replay-room state surface a scheduled interjection replays into. */
export interface ScheduledReplayState {
  turnId: number;
  turnOwner: string;
  actors: { get(id: string): { speaking: boolean; replyId: string; cueId: string; emotion: string } | undefined };
}

/**
 * C19 faculty replay of one scheduled interjection: the recorded turn plays
 * into schema state AS RECORDED (replyId/cueId from trace.turns, no emotion
 * consumed — the live interjection emitted no transition). Returns the open
 * turn for the caller to hold, or null when the event is not scheduled.
 */
export function applyScheduledReplayEvent(
  state: ScheduledReplayState,
  turnsById: ReadonlyMap<number, LoadedReplayStation["turns"][number]>,
  event: ConversationTraceEvent,
): { turnId: number; actorId: string } | null {
  if (event.kind !== "scheduled-event" || event.turnId === null) {
    return null;
  }
  const entry = turnsById.get(event.turnId);
  const actor = entry && entry.actorId !== "" ? state.actors.get(entry.actorId) : undefined;
  if (!entry || !actor) {
    return null;
  }
  state.turnId = entry.turnId;
  actor.speaking = true;
  actor.replyId = entry.replyId;
  actor.cueId = entry.cueId;
  state.turnOwner = "actor";
  return { turnId: entry.turnId, actorId: entry.actorId };
}
