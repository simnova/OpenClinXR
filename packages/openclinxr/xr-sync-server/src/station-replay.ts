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

import type { Client } from "@colyseus/core";
import { ArraySchema, MapSchema } from "@colyseus/schema";
import type { ConversationTraceEvent } from "./conversation-trace.js";
import { replayBaselineForCast } from "./conversation-trace-cast.js";
import {
  type FacultyScoreBinding,
  handleReplayReviewIntent,
} from "./faculty-score.js";
import { replayRubricCoverageCounts, replayScoreChecked } from "./replay-rubric-coverage.js";
import {
  isReviewLobbyRequest,
  setupLobbyState,
} from "./review-lobby.js";
import {
  handleLobbyIntentWithFinalize,
  isReviewFinalized,
  launchLobbyReplayFor,
  launchReplayReturnFor,
  readValidLobbyScores,
  rejectReplayGuardedIntent,
} from "./review-packet.js";
import { ENCOUNTER_ROOM_NAME, EncounterRoom } from "./room.js";
import { ActorState, type ActorStateInstance, EncounterState, LearnerState, type LearnerStateInstance, ReplayRubricCoverageState, type ReplayRubricCoverageStateInstance, ReplayRubricState, type ReplayRubricStateInstance } from "./schema.js";
import type { LoadedReplayStation, LoadedStationReplay } from "./station-replay-loading.js";
import { applyScheduledReplayEvent } from "./station-replay-loading.js";

/** Reject reason every replay-room intent receives (C13 review intents excepted). */
export { REPLAY_READ_ONLY_REASON } from "./faculty-score.js";

import { parseEncounterRole } from "./observer.js";
import type { EncounterRoomOptions } from "./room-types.js";
import {
  handleScenarioScoreIntent,
  readScenarioLobbyScores,
  stationScenarioRubric,
} from "./scenario-rubric.js";

/** Default ms between recorded replay events (see station-replay-loading.ts). */
export { DEFAULT_REPLAY_STEP_MS, parseReplayStepMs } from "./station-replay-loading.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Per-server replay binding closed over by the replay room class. */
export interface StationReplayBinding {
  replay: LoadedStationReplay | null;
  /** Boot-time load failure, refused at join with this named error. */
  loadError: string | null;
  stepMs: number;
  /** C14 replay directory (note files for the review packet; null when unset). */
  replayDir: string | null;
  /** C11 per-station trace failures (a bad trace refuses only its station). */
  stationFailures: Map<string, string>;
  /** C13 faculty score binding (scoreDir + rubric, server config only). */
  score: FacultyScoreBinding;
}

function replayStationIdOf(options: unknown): string {
  if (!isRecord(options)) {
    return "";
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["replayStationId"] on this Record.
  const value = options["replayStationId"];
  return typeof value === "string" ? value : "";
}

/** True when the intent message asks to score the station. */
function isScoreStationIntent(message: unknown): boolean {
  if (!isRecord(message)) {
    return false;
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["kind"] on this Record.
  return message["kind"] === "score-station";
}

/**
 * Fill replay-room state.replayRubric with the station's scenario checklist
 * (labels reach headset state only, never a persisted file). Null rubric
 * means the station has no scenario rubric: the state carries [].
 */
function setReplayRubricState(state: { replayRubric: unknown }, rubric: { id: string; label: string }[] | null): void {
  const rows = new ArraySchema<ReplayRubricStateInstance>();
  for (const entry of rubric ?? []) {
    const row = new ReplayRubricState();
    row.id = entry.id;
    row.label = entry.label;
    rows.push(row);
  }
  (state as { replayRubric: typeof rows }).replayRubric = rows;
}

function setReplayRubricCoverageState(
  state: { replayRubricCoverage: unknown },
  coverage: Array<{ rubricId: string; observedTags: string[]; missingTags: string[] }> | null,
  rubric: Array<{ id: string; requiredTraceTags?: string[] }> | null = null,
): void {
  const rows = new ArraySchema<ReplayRubricCoverageStateInstance>();
  for (const entry of replayRubricCoverageCounts(coverage ?? [], rubric ?? undefined)) {
    const row = new ReplayRubricCoverageState();
    row.id = entry.id;
    row.observedCount = entry.observedCount;
    row.requiredCount = entry.requiredCount;
    rows.push(row);
  }
  (state as { replayRubricCoverage: typeof rows }).replayRubricCoverage = rows;
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
    /** C13 per-lobby launch guard: a lobby launches at most once. */
    private lobbyLaunchPending = false;
    /** C14 per-replay-room return guard: a lobby launches back at most once. */
    private replayReturnGuard = { returnPending: false };

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
        // C13 badges are read from disk when the lobby opens (a new server
        // over the same scoreDir shows earlier scores); C14 adds the
        // finalized flag from the packet on disk. Forged score files are
        // ignored by the strict reader (same validator as finalize). C20: on
        // a scenarios-bank server each badge validates against its own
        // station's scenario rubric.
        const stationIds = replay.lobbyStations.map((entry) => entry.stationId);
        const scenarioBank = binding.score.scenarioRubrics ?? null;
        const scores = scenarioBank !== null
          ? readScenarioLobbyScores(binding.score.scoreDir, stationIds, (id) => stationScenarioRubric(replay, scenarioBank, id))
          : readValidLobbyScores(binding.score.scoreDir, stationIds, binding.score.rubric);
        setupLobbyState(this.state, replay, scores, isReviewFinalized(binding.score.scoreDir));
        setReplayRubricState(this.state, null);
        setReplayRubricCoverageState(this.state, null);
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
      // first-appearance order, starting at the recorded baseline (C18).
      const roster = new Set<string>();
      for (const turn of station.turns) {
        if (turn.actorId !== "" && !roster.has(turn.actorId)) {
          roster.add(turn.actorId);
        }
      }
      const castBaseline = replayBaselineForCast(station.cast);
      for (const id of roster) {
        const actor = new ActorState();
        actor.id = id;
        actor.speaking = false;
        actor.emotion = castBaseline;
        actor.replyId = "";
        actor.cueId = "";
        this.state.actors.set(id, actor);
      }
      this.state.learners = new MapSchema<LearnerStateInstance>();
      // C13: a re-opened station seeds its checked count from disk (0 when unscored).
      // C20: the replayed station's scenario checklist for the headset ([] when
      // the station's scenario is not in the bank); scoring below validates
      // against this same rubric.
      const scenarioBank = binding.score.scenarioRubrics ?? null;
      const scenarioResolved = scenarioBank !== null ? stationScenarioRubric(binding.replay, scenarioBank, station.stationId) : null;
      this.state.scoreChecked = replayScoreChecked(binding.score.scoreDir, station.stationId, scenarioBank, scenarioResolved);
      setReplayRubricState(this.state, scenarioResolved?.rubric ?? null);
      setReplayRubricCoverageState(this.state, scenarioResolved === null ? null : station.entry.rubricCoverage ?? [], scenarioResolved?.rubric ?? null);
      // One station per room: lock at create so a concurrent reviewer of a
      // different station creates anew instead of sharing this room. The
      // creating client's seat is already reserved, so it still joins.
      void this.setPrivate(true);
      this.lock();
      this.onMessage("intent", (client, message: unknown) => {
        // C14 guards (one return-to-lobby per room; locked scores) run before
        // the C13 review handler; every other intent still rejects
        // replay-read-only (see faculty-score.ts). C20: on a scenarios-bank
        // server, score-station validates against the station's own scenario
        // rubric (see scenario-rubric.ts).
        if (rejectReplayGuardedIntent(this.replayReturnGuard, binding.score, client, message)) {
          return;
        }
        if (scenarioBank !== null && isScoreStationIntent(message)) {
          handleScenarioScoreIntent(
            this.state,
            binding.score.scoreDir ?? "",
            station.stationId,
            station.scenarioId,
            scenarioResolved?.rubric ?? null,
            client,
            message,
          );
          return;
        }
        handleReplayReviewIntent(this.state, binding.score, station.stationId, client, message, (onFailed) => {
          launchReplayReturnFor(ENCOUNTER_ROOM_NAME, this.replayReturnGuard, station.stationId, client, onFailed);
        });
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

    /** C12 lobby select gate plus the C14 finalize sign-off (see review-packet.ts). */
    private handleLobbyIntent(client: Client, message: unknown): void {
      const room = this;
      const scenarioBank = binding.score.scenarioRubrics ?? null;
      handleLobbyIntentWithFinalize(
        {
          state: room.state,
          get launchPending(): boolean {
            return room.lobbyLaunchPending;
          },
          set launchPending(value: boolean) {
            room.lobbyLaunchPending = value;
          },
          replay: binding.replay,
        },
        binding.score,
        binding.replayDir,
        client,
        message,
        (stationId, onFailed) => {
          launchLobbyReplayFor(ENCOUNTER_ROOM_NAME, stationId, client, onFailed);
        },
        // C20: on a scenarios-bank server the sign-off validates each station
        // against its own scenario rubric (packet totalPossible is the sum of
        // the per-station rubric sizes).
        scenarioBank === null
          ? undefined
          : (id) => stationScenarioRubric(binding.replay, scenarioBank, id),
      );
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
          // C19: the recorded scheduled interjection replays (replyId/cueId
          // from trace.turns); select-actor and rotation-failed carry no state.
          const scheduled = applyScheduledReplayEvent(this.state, this.replayTurnsById, event);
          if (scheduled !== null) {
            this.replayOpenTurn = scheduled;
          }
          break;
        }
      }
    }
  }
  return StationReplayRoom;
}
