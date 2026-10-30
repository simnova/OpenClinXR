/**
 * C10 faculty station replay from the recorded trace.
 *
 * Kept in its own module so room.ts stays under the file-size gate. When the
 * server is booted with { replayDir, replayStepMs } (server config only, never
 * client roomOptions), server.ts defines the room class built here under the
 * same room name instead of the live room: a faculty reviewer joins with
 * roomOptions.replayStationId and watches one recorded station play back.
 *
 * Playback is one recorded trace event per replayStepMs on the room clock,
 * applied into schema state AS RECORDED (replyId/cueId from trace.turns,
 * emotion from trace.emotions in event order): replay is not a recompute
 * through the current reply table, which may have changed between recording
 * and review. Every intent in a replay room rejects "replay-read-only", and a
 * replay room never writes (no trace persist, no review index): the replay
 * directory stays byte-identical.
 *
 * Each replay room locks itself at create, so concurrent reviewers of
 * different stations never share a room (every joinOrCreate creates anew).
 * Unknown or missing replayStationId refuses the join with a named error.
 */
import { MapSchema } from "@colyseus/schema";
import type { Client } from "@colyseus/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConversationTraceEvent } from "./conversation-trace.js";
import { loadReplayStationTrace, type LoadedReplayStation } from "./station-replay-loading.js";
import { ActorState, EncounterState, LearnerState, type ActorStateInstance, type LearnerStateInstance } from "./schema.js";
import { EncounterRoom, ENCOUNTER_ROOM_NAME } from "./room.js";
import {
  isReviewLobbyRequest,
  launchLobbyStationReplay,
  lobbySelectStationIdOf,
  LOBBY_READ_ONLY_REASON,
  LOBBY_UNKNOWN_STATION_REASON,
  setupLobbyState,
  validateLobbySelect,
} from "./review-lobby.js";
import type { EncounterRoomOptions } from "./room-types.js";
import { parseEncounterRole } from "./observer.js";
import {
  SESSION_REVIEW_INDEX_FILE,
  SESSION_REVIEW_INDEX_SCHEMA,
  type SessionReviewIndex,
  type SessionReviewStationEntry,
} from "./session-review-index.js";

/** Reject reason every replay-room intent receives. The room is read-only. */
export const REPLAY_READ_ONLY_REASON = "replay-read-only";

/** Default ms between recorded events when replayStepMs is not configured. */
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

/** Per-server replay binding closed over by the replay room class. */
export interface StationReplayBinding {
  replay: LoadedStationReplay | null;
  /** Boot-time load failure, refused at join with this named error. */
  loadError: string | null;
  stepMs: number;
  /** C11 per-station trace failures (a bad trace refuses only its station). */
  stationFailures: Map<string, string>;
}

function replayStationIdOf(options: unknown): string {
  if (!isRecord(options)) {
    return "";
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["replayStationId"] on this Record.
  const value = options["replayStationId"];
  return typeof value === "string" ? value : "";
}

/**
 * Build the per-server replay room class: one recorded station per room,
 * defined under the same room name when replayDir is set. Extends the live
 * room only for its schema state and no-op persistence (stationTraceDir stays
 * null, so flush/dispose never touch the replay directory); onCreate, auth,
 * join, intents, and dispose are all replay-owned here, never the live path.
 */
export function createStationReplayRoomClass(binding: StationReplayBinding): typeof EncounterRoom {
  class StationReplayRoom extends EncounterRoom {
    private replayStation: LoadedReplayStation | null = null;
    private replayTurnsById = new Map<number, LoadedReplayStation["turns"][number]>();
    private replayCursor = 0;
    private replayEmotionCursor = 0;
    private replayOpenTurn: { turnId: number; actorId: string } | null = null;
    private replayTimer: { clear(): void } | null = null;

    override onCreate(options?: EncounterRoomOptions): void {
      if (binding.loadError !== null || binding.replay === null) {
        throw new Error(binding.loadError ?? "replay-unavailable");
      }
      // C12 lobby: a reviewer lists the index stations, then picks one.
      // The lobby lives in its own locked room; the pick reserves a fresh
      // replay room for that station and sends the seat to this client only.
      if (isReviewLobbyRequest(options)) {
        const replay = binding.replay;
        this.replayStation = null;
        this.setState(new EncounterState());
        setupLobbyState(this.state, replay);
        void this.setPrivate(true);
        this.lock();
        this.onMessage("intent", (client, message: unknown) => {
          this.handleLobbyIntent(client, message);
        });
        this.onMessage("*", (_client, type) => {
          if (type === "intent") {
            return;
          }
        });
        return;
      }
      const stationId = replayStationIdOf(options);
      if (stationId === "") {
        throw new Error("replay-missing-station-id");
      }
      const station = binding.replay.stations.get(stationId);
      if (!station) {
        // C11: a per-station trace failure refuses only that station (with
        // its stored load error); anything else is an unknown station.
        const failure = binding.stationFailures.get(stationId);
        throw new Error(failure ?? `replay-unknown-station: ${stationId.slice(0, 64)}`);
      }
      this.replayStation = station;
      this.replayTurnsById = new Map(station.turns.map((turn) => [turn.turnId, turn]));
      this.setState(new EncounterState());
      this.state.serverTick = 0;
      this.state.turnId = 0;
      this.state.turnOwner = "none";
      this.state.observerCount = 0;
      this.state.phase = "";
      this.state.phaseRemainingS = 0;
      this.state.stationId = station.stationId;
      this.state.stationIndex = station.stationIndex;
      this.state.stationCount = station.stationCount;
      this.state.mode = "replay";
      this.state.lastTurnEnd = "";
      this.state.replayDone = false;
      this.state.noteStatus = "none";
      this.state.noteChars = 0;
      this.state.actors = new MapSchema<ActorStateInstance>();
      // The replayed cast is the recorded cast: distinct turn actorIds in
      // first-appearance order. No live defaults, no reviewer-provisioned
      // extras: an always-neutral extra actor flaps cross-actor observers
      // (every snapshot compares each actor against one last emotion), so the
      // room carries exactly the actors that speak.
      const roster = new Set<string>();
      for (const turn of station.turns) {
        if (turn.actorId !== "" && !roster.has(turn.actorId)) {
          roster.add(turn.actorId);
        }
      }
      for (const id of roster) {
        const actor = new ActorState();
        actor.id = id;
        actor.speaking = false;
        actor.emotion = "neutral";
        actor.replyId = "";
        actor.cueId = "";
        this.state.actors.set(id, actor);
      }
      this.state.learners = new MapSchema<LearnerStateInstance>();
      // One station per room: lock at create so a concurrent reviewer of a
      // different station creates anew instead of sharing this room. The
      // creating client's seat is already reserved, so it still joins.
      void this.setPrivate(true);
      this.lock();
      this.onMessage("intent", (client, message: unknown) => {
        // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
        const seq = isRecord(message) && Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
        client.send("reject", { seq, reason: REPLAY_READ_ONLY_REASON });
      });
      // Explicit catch-all: unknown client message types are dropped on the
      // floor, mirroring the live room (state flows only through patches).
      this.onMessage("*", (_client, type) => {
        if (type === "intent") {
          return;
        }
      });
      if (station.events.length === 0) {
        this.state.replayDone = true;
        return;
      }
      this.replayTimer = this.clock.setInterval(() => {
        this.stepReplay();
      }, binding.stepMs);
    }

    override onAuth(client: Client, options?: EncounterRoomOptions): boolean {
      void client;
      // Refuse unknown roles here so the SDK join rejects, mirroring live.
      parseEncounterRole(options);
      // C12 lobby rooms admit their own reviewLobby joins (no station seat).
      if (isReviewLobbyRequest(options)) {
        return true;
      }
      // Backstop for direct joins: the room serves exactly its own station.
      const station = this.replayStation;
      if (station === null || replayStationIdOf(options) !== station.stationId) {
        throw new Error("replay-station-mismatch");
      }
      return true;
    }

    override onJoin(client: Client, options?: EncounterRoomOptions): void {
      void options;
      // Reviewers hold a learner seat for snapshot normalcy only: every
      // intent still rejects replay-read-only and lastSeq never advances.
      // Lobby reviewers share the same seat shape; a select-station ack
      // advances lastSeq like a live applied intent.
      if (!this.state.learners.has(client.sessionId)) {
        const learner = new LearnerState();
        learner.sessionId = client.sessionId;
        learner.headX = 0;
        learner.headY = 0;
        learner.headZ = 0;
        learner.lastSeq = 0;
        learner.speaking = false;
        this.state.learners.set(client.sessionId, learner);
      }
    }

    /** C12 lobby intent gate: select-station validates + launches, everything else is read-only. */
    private handleLobbyIntent(client: Client, message: unknown): void {
      if (!isRecord(message)) {
        client.send("reject", { seq: 0, reason: LOBBY_READ_ONLY_REASON });
        return;
      }
      // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
      const seq = Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
      // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["kind"] on this Record.
      const kind = message["kind"];
      if (kind !== "select-station") {
        client.send("reject", { seq, reason: LOBBY_READ_ONLY_REASON });
        return;
      }
      if (binding.replay === null) {
        client.send("reject", { seq, reason: LOBBY_UNKNOWN_STATION_REASON });
        return;
      }
      // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["payload"] on this Record.
      const stationId = lobbySelectStationIdOf(message["payload"]);
      const verdict = validateLobbySelect(binding.replay, stationId);
      if (!verdict.ok) {
        client.send("reject", { seq, reason: verdict.reason });
        return;
      }
      const learner = this.state.learners.get(client.sessionId);
      if (learner) {
        learner.lastSeq = seq;
      }
      this.state.serverTick += 1;
      client.send("ack", { seq, serverTs: Date.now() });
      // Launch THIS client's replay only (never a broadcast): the client
      // consumes the seat like a C7 rotation on the same connection.
      void launchLobbyStationReplay(ENCOUNTER_ROOM_NAME, stationId, client).catch(() => {
        try {
          client.send("rotation-failed", { stationId });
        } catch {
          // Best-effort; the ack already settled the intent.
        }
      });
    }

    override onLeave(client: Client): void {
      this.state.learners.delete(client.sessionId);
    }

    override async onDrop(client: Client): Promise<void> {
      void client;
    }

    override onDispose(): void {
      this.replayTimer?.clear();
      this.replayTimer = null;
      // No persistence here: a replay room never writes into the replay
      // directory (no trace file, no review index). The inherited dispose
      // only clears empty default nonces and flushes a null traceDir.
      super.onDispose();
    }

    /** Next recorded emotion "to" value in event order. The load-time
     * emotion-count check makes exhaustion unreachable: assert, never fall
     * back to the live value (a silent fallback would replay a wrong state). */
    private consumeReplayEmotion(): string {
      const next = this.replayStation?.emotions[this.replayEmotionCursor];
      if (!next) {
        throw new Error("replay-emotion-exhausted");
      }
      this.replayEmotionCursor += 1;
      return next.to;
    }

    /** Apply one recorded event per room-clock step into schema state. */
    private stepReplay(): void {
      const station = this.replayStation;
      if (station === null) {
        return;
      }
      const event = station.events[this.replayCursor];
      if (event === undefined) {
        this.state.replayDone = true;
        this.replayTimer?.clear();
        this.replayTimer = null;
        return;
      }
      this.replayCursor += 1;
      this.applyReplayEvent(event);
      this.state.serverTick += 1;
      if (this.replayCursor >= station.events.length) {
        this.state.replayDone = true;
        this.replayTimer?.clear();
        this.replayTimer = null;
      }
    }

    private applyReplayEvent(event: ConversationTraceEvent): void {
      switch (event.kind) {
        case "phase-changed": {
          const phase = event.phase ?? "";
          this.state.phase = phase;
          if (phase !== "encounter" && this.replayOpenTurn !== null) {
            const entry = this.replayTurnsById.get(this.replayOpenTurn.turnId);
            const actor = this.state.actors.get(this.replayOpenTurn.actorId);
            if (actor) {
              actor.speaking = false;
            }
            this.state.lastTurnEnd = entry?.end ?? "closed-by-phase";
            this.replayOpenTurn = null;
            this.state.turnOwner = "none";
          }
          break;
        }
        case "utterance-end": {
          // RECORDED values only: the reply table is never consulted (it may
          // have changed between recording and review).
          const entry = event.turnId !== null ? this.replayTurnsById.get(event.turnId) : undefined;
          const actorId = entry?.actorId ?? event.actorId;
          const actor = actorId !== "" ? this.state.actors.get(actorId) : undefined;
          if (entry && actor) {
            this.state.turnId = entry.turnId;
            actor.speaking = true;
            actor.replyId = entry.replyId;
            actor.cueId = entry.cueId;
            actor.emotion = this.consumeReplayEmotion();
            this.state.turnOwner = "actor";
            this.replayOpenTurn = { turnId: entry.turnId, actorId };
          }
          break;
        }
        case "utterance-start": {
          if (this.replayOpenTurn !== null) {
            const entry = this.replayTurnsById.get(this.replayOpenTurn.turnId);
            const actor = this.state.actors.get(this.replayOpenTurn.actorId);
            if (actor) {
              actor.speaking = false;
              actor.emotion = this.consumeReplayEmotion();
            }
            this.state.lastTurnEnd = entry?.end ?? "interrupted";
            this.state.turnOwner = "learner";
            this.replayOpenTurn = null;
          }
          break;
        }
        case "turn-completed": {
          if (event.turnId !== null) {
            const entry = this.replayTurnsById.get(event.turnId);
            const actor = entry && entry.actorId !== "" ? this.state.actors.get(entry.actorId) : undefined;
            if (actor) {
              actor.speaking = false;
            }
            this.state.lastTurnEnd = entry?.end ?? "completed";
            if (this.replayOpenTurn?.turnId === event.turnId) {
              this.replayOpenTurn = null;
            }
            this.state.turnOwner = "none";
          }
          break;
        }
        case "observer-joined": {
          this.state.observerCount += 1;
          break;
        }
        case "observer-left": {
          this.state.observerCount = Math.max(0, this.state.observerCount - 1);
          break;
        }
        case "note-submitted": {
          // C11: the recorded accepted-note length replays into state; the
          // note text was never recorded and is never replayed.
          this.state.noteStatus = "submitted";
          this.state.noteChars = typeof event.chars === "number" ? event.chars : 0;
          break;
        }
        default: {
          // select-actor and rotation-failed carry no replayed state.
          break;
        }
      }
    }
  }
  return StationReplayRoom;
}
