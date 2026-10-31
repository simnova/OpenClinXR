import { MapSchema } from "@colyseus/schema";
import { Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  ConversationTracer,
  type ConversationTrace,
} from "./conversation-trace.js";
// C3 reply table + picker live in conversation-trace.js (single source shared
// with the trace reducer); re-exported here so existing room.js importers
// (C4 RED, evidence harness dist imports) keep working.
export { C3_REPLY_TABLE, pickC3Reply, type C3ScriptedReply } from "./conversation-trace.js";
import {
  EncounterState,
  LearnerState,
  type ActorStateInstance,
  type EncounterStateInstance,
  type LearnerStateInstance,
} from "./schema.js";
import { OBSERVER_READ_ONLY_REASON, parseEncounterRole, rejectNotJoined } from "./observer.js";
import * as PhaseClock from "./phase-clock.js";
import type { StationTiming } from "./phase-clock.js";
import type { EncounterRoomOptions, ProbeSelection, RoomProbeStats, TurnRecord } from "./room-types.js";
import { populateActorRoster } from "./roster.js";
import { castForStation, populateCastRoster, stationEmotionPolicy, type CastVoiceActor } from "./scenario-cast.js";
import { INTENT_KINDS, type AckMessage, type IntentMessage, type RejectMessage } from "./protocol.js";
// Wire protocol types live in protocol.js; re-exported here so the package
// "." surface and existing room.js importers keep working unchanged.
export type { AckMessage, IntentKind, IntentMessage, RejectMessage } from "./protocol.js";
import { applyPoseIntent, applySelectActorIntent } from "./learner-intents.js";
import { DEFAULT_NOTE_MAX_CHARS, validateNoteSubmit } from "./patient-note.js";
import { applyUtteranceIntent } from "./actor-turns.js";
import {
  assertStationJoinAllowed,
  clearStationNoncesOnDispose,
  configureStationRoom,
  consumeRotateTokenForJoin,
  recordStationPose,
  stationNonceCounts,
  type StationBinding,
} from "./station-rotation.js";
import { handleStationClosed } from "./session-review-index.js";

/** Matchmaking name clients join to reach the authoritative encounter room. */
export const ENCOUNTER_ROOM_NAME = "encounter";
/** Seconds a dropped client keeps its seat, learner entry, and lastSeq. */
export const RECONNECT_ALLOWANCE_SECONDS = 30;

/** Latest live room, set in onCreate. Single-room C1 helper for tests/ops. */
let latestRoom: EncounterRoom | undefined;

export function getLatestRoom(): EncounterRoom | undefined {
  return latestRoom;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Server-authoritative encounter room. Clients send intents; only ack/reject go back as messages. */
export class EncounterRoom extends Room<{ state: EncounterStateInstance }> {
  /** Per-client selected actor. Server-side only, never synced. */
  private selectedActor = new Map<string, string>();
  /** Applied (acked) intents by kind, in arrival order. Probe observability only. */
  private intentCounts: Record<string, number> = { pose: 0, "select-actor": 0, "utterance-start": 0, "utterance-end": 0 };
  /** Applied select-actor intents in application order. Probe observability only. */
  private selectionLog: ProbeSelection[] = [];
  /** C3 server-driven actor turns, in application order. Probe observability only. */
  private turnLog: TurnRecord[] = [];
  /** Per-actor completed turn counts driving the deterministic reply picker. */
  private actorTurnCounts = new Map<string, number>();
  /** The currently open actor turn, if any, with its server-clock completion timer. */
  private openTurn: { turnId: number; actorId: string; timer: { clear(): void } } | null = null;
  /** C4 live conversation tracer: actor-agnostic events, no sessionId, no reply text. */
  private tracer = new ConversationTracer();
  /** Directory for the persisted conversation trace file; null disables persistence. */
  private traceDir: string | null = null;
  /** C5 connected faculty observers (read-only, no learners[] entry, no reconnection seat). */
  private observers = new Set<string>();
  /** C5 host-clock ms per opened turn (Date.now at turn open). Never synced, never in the trace. */
  private turnOpenedAtMs = new Map<number, number>();
  /**
   * C6 server-bound station timing (null = brief, C1..C5 behaviour). Bound
   * per server by a ConfiguredEncounterRoom subclass (see server.ts), never
   * from client roomOptions. A module cell cannot do this: it is consumed by
   * the first room only, so a second room on the same server would lose its
   * clock (and two servers in one process would overwrite each other).
   */
  protected stationTiming: StationTiming | null = null;
  /** C6 server-bound trace directory (null disables persistence). Same binding as stationTiming. */
  protected stationTraceDir: string | null = null;
  /** C11 server-bound patient-note bound (null uses the module default). Same binding as stationTiming. */
  protected stationNoteMaxChars: number | null = null;
  /** C11 held learner patient note text (server-side only: never synced, never traced). */
  private noteText: string | null = null;
  /** C6 station phase clock (null when no timing: C1..C5 brief behaviour). Driven by this.clock. */
  private phaseClock: { stop(): void } | null = null;
  /** C6 host-clock ms per entered phase (Date.now at phase enter). Probe only, never in the trace. */
  private phaseChangedAtMs = new Map<string, number>();
  /** C7 per-server station binding (stations + single-use nonces), shared by reference. */
  protected stationBinding: StationBinding = { stations: null, examBlueprint: null, scenarioCasts: null, creationNonces: new Map(), joinNonces: new Set(), appliedPoseByStation: new Map(), rotationFaults: { failNext: 0, bogusRotate: false } };
  /** C7 rotation guard: closed fires once per room; this is the backstop. */
  private rotationStarted = false;
  /**
   * C17 cast voice for this room's station (per-actor opening lines; null off
   * a cast station). Bound in onCreate: rooms are per-station, so the first
   * reply per actor per station is the scenario opening.
   */
  private castVoice: Map<string, CastVoiceActor> | null = null;

  /** Read-only copy of probe stats for the harness. Never sent on the wire. */
  getProbeStats(): RoomProbeStats {
    return {
      intentCounts: { ...this.intentCounts },
      selections: this.selectionLog.map((entry) => ({ ...entry })),
      turns: this.turnLog.map((entry) => ({ ...entry })),
      turnOpenedAtMs: Object.fromEntries(this.turnOpenedAtMs) as Record<number, number>,
      phaseChangedAtMs: Object.fromEntries(this.phaseChangedAtMs) as Record<string, number>,
      stationNonces: stationNonceCounts(this.stationBinding),
    };
  }

  /** C4 live conversation trace (turns + emotions recomputed by the shared reducer). */
  getConversationTrace(): ConversationTrace {
    return this.tracer.snapshot();
  }

  /** Persist the trace file now (server close path; same content as the dispose write). */
  flushConversationTrace(): void {
    if (this.traceDir) {
      this.tracer.persist(this.traceDir, this.roomId);
    }
  }

  override onCreate(options?: EncounterRoomOptions): void {
    // C12: a review lobby belongs on a replay server only. A reviewer
    // pointed at a live server must never get a live learner seat.
    if (isRecord(options) && (options as Record<string, unknown>)["reviewLobby"] === true) {
      throw new Error("review-lobby-live-refused: join a replay server with reviewLobby");
    }
    latestRoom = this;
    // Server-bound config only: client roomOptions.timing / .phase /
    // .traceDir / .stationId / .stationIndex are never read.
    this.traceDir = this.stationTraceDir;
    this.setState(new EncounterState());
    this.state.serverTick = 0;
    this.state.turnId = 0;
    this.state.turnOwner = "none";
    this.state.observerCount = 0; this.state.noteStatus = "none"; this.state.noteChars = 0;
    this.state.phaseRemainingS = 0;
    // C7 station assignment: server binding + creation nonce only (never client roomOptions).
    const station = configureStationRoom(this.stationBinding, options, this.state, this.tracer);
    // C15: the blueprint id + current slot label ride the synced state (""
    // without a blueprint). Rotation rooms re-resolve here per station.
    const blueprint = this.stationBinding.examBlueprint;
    this.state.blueprintId = blueprint?.blueprintId ?? "";
    this.state.stationLabel = blueprint?.labels.get(station.stationId) ?? "";
    // C16: a cast station replaces the roster with the slot's scenario cast
    // (first and every rotation: onCreate runs per room). Without scenarios,
    // the C15 behaviour is unchanged.
    const cast = castForStation(this.stationBinding.scenarioCasts, station.stationIndex);
    this.state.scenarioId = cast?.scenarioId ?? "";
    this.state.scenarioTitle = cast?.scenarioTitle ?? "";
    this.state.actors = new MapSchema<ActorStateInstance>();
    if (cast !== null) {
      populateCastRoster(this.state.actors, cast);
      // C17: the station's cast voice (first reply per actor) and emotion
      // policy ride this room only (per-station rooms, so per-station voice).
      this.castVoice = new Map(cast.castActors.map((entry) => [entry.actorId, entry]));
      this.tracer.setStationEmotionPolicy(stationEmotionPolicy(cast));
    } else {
      populateActorRoster(this.state.actors, options);
    }
    this.state.learners = new MapSchema<LearnerStateInstance>();

    // C6 station clock from the server binding; client roomOptions.timing /
    // roomOptions.phase are ignored (see phase-clock.ts). C7 rotation fires
    // on the station's "closed" phase-changed, on the room clock.
    this.phaseClock = PhaseClock.attachStationPhaseClock(
      {
        clock: this.clock,
        state: this.state,
        tracer: this.tracer,
        turnLog: this.turnLog,
        getOpenTurn: () => this.openTurn,
        clearPhaseTurn: () => {
          this.openTurn = null;
        },
        phaseChangedAtMs: this.phaseChangedAtMs,
        onClosed: () => {
          void this.rotateStation();
        },
      },
      this.stationTiming,
    );
    // C7 isolation: non-first stations are server-created rooms for rotated learners only.
    if (station.stationIndex > 0) {
      void this.setPrivate(true);
      this.lock();
    }

    this.onMessage("intent", (client, message: IntentMessage) => {
      this.handleIntent(client, message);
    });

    // DESTRUCTIVE_PROBE_ANCHOR (T6 probe): the probe patch inserts a
    // this.broadcast("snapshot", ...) call in handleIntent. It must stay
    // absent: the only named server-to-client messages are ack/reject.
    // State reaches clients exclusively through Colyseus schema patches,
    // which the lean client decodes by reflection (no schema import).

    // Explicit catch-all: unknown client message types are dropped on the
    // floor. "intent" is already handled above, so it is skipped here.
    this.onMessage("*", (_client, type) => {
      if (type === "intent") {
        return;
      }
    });
  }

  override onAuth(client: Client, options?: EncounterRoomOptions): boolean {
    void client;
    // C12 backstop: reviewLobby on a live server refuses even when the room
    // already exists (onCreate covers the first join).
    if (isRecord(options) && (options as Record<string, unknown>)["reviewLobby"] === true) {
      throw new Error("review-lobby-live-refused: join a replay server with reviewLobby");
    }
    // Refuse unknown roles here so the SDK join rejects. Learner (default)
    // and observer pass; anything else throws.
    parseEncounterRole(options);
    // C7 isolation: non-first rooms admit only server-issued rotations.
    assertStationJoinAllowed(this.stationBinding, this.state.stationIndex, options);
    return true;
  }

  override onJoin(client: Client, options?: EncounterRoomOptions): void {
    // Role re-parsed at join (onAuth already refused unknown roles; this
    // throw is the backstop when onAuth is bypassed).
    const role = parseEncounterRole(options);
    // C7 isolation backstop: consume the rotation nonce for non-first rooms.
    if (!consumeRotateTokenForJoin(this.state.stationIndex, this.stationBinding.joinNonces, options)) {
      throw new Error("c7-no-rotation-token");
    }
    if (role === "observer") {
      // Faculty observer: counted, traced, never a learner seat.
      this.observers.add(client.sessionId);
      this.state.observerCount = this.observers.size;
      this.tracer.push({ seq: null, kind: "observer-joined", actorId: "", turnId: null });
      return;
    }
    // Same sessionId can re-appear after a reconnection: never reset progress.
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

  override async onDrop(client: Client): Promise<void> {
    // C5: observer drops need no reconnection seat: remove immediately and
    // trace presence. Chosen because observers hold no progress (no learner
    // entry, no lastSeq, no selection) so there is nothing to resume.
    if (this.observers.delete(client.sessionId)) {
      this.state.observerCount = this.observers.size;
      this.tracer.push({ seq: null, kind: "observer-left", actorId: "", turnId: null });
      return;
    }
    // Unclean disconnect: hold the seat so the learner entry and lastSeq
    // survive a reconnect within the allowance.
    try {
      await this.allowReconnection(client, RECONNECT_ALLOWANCE_SECONDS);
    } catch {
      this.dropLearner(client.sessionId);
    }
  }

  override onLeave(client: Client): void {
    // Effective leave (consented, or reconnection allowance expired).
    // Observer guard first: delete returns true only once, so a drop+leave
    // pair emits exactly one observer-left.
    if (this.observers.delete(client.sessionId)) {
      this.state.observerCount = this.observers.size;
      this.tracer.push({ seq: null, kind: "observer-left", actorId: "", turnId: null });
      return;
    }
    this.dropLearner(client.sessionId);
  }

  override onDispose(): void {
    this.phaseClock?.stop();
    this.phaseClock = null;
    this.flushConversationTrace();
    clearStationNoncesOnDispose(this.stationBinding);
  }

  /** C9: hold this station's review data, rotate, then write the session index once. */
  private async rotateStation(): Promise<void> {
    await handleStationClosed(
      {
        stations: this.stationBinding.stations,
        stationIndex: this.state.stationIndex,
        stationId: this.state.stationId,
        roomId: this.roomId,
        clients: this.clients,
        isObserver: (id) => this.observers.has(id),
        actorIds: [...this.state.actors.keys()],
        closedAt: this.phaseChangedAtMs.get("closed"),
        binding: this.stationBinding,
        traceDir: this.stationTraceDir,
        traceSnapshot: () => this.tracer.snapshot(),
        flushTrace: () => this.flushConversationTrace(),
        noteText: this.noteText,
        onRotationFailed: () => this.tracer.push({ seq: null, kind: "rotation-failed", actorId: "", turnId: null }),
        rotationStarted: this.rotationStarted,
        setRotationStarted: (value) => { this.rotationStarted = value; },
      }, ENCOUNTER_ROOM_NAME);
  }

  private dropLearner(sessionId: string): void {
    this.state.learners.delete(sessionId);
    this.selectedActor.delete(sessionId);
  }

  private reject(client: Client, seq: number, reason: string): void {
    const message: RejectMessage = { seq, reason };
    client.send("reject", message);
  }

  private handleIntent(client: Client, message: IntentMessage): void {
    // C5 read-only gate: every observer intent rejects before any validation
    // or mutation, is never counted, and never touches serverTick. The seq
    // echoes the envelope when well-formed so the client can settle.
    if (this.observers.has(client.sessionId)) {
      // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
      const seq = isRecord(message) && Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
      this.reject(client, seq, OBSERVER_READ_ONLY_REASON);
      return;
    }
    const learner = this.state.learners.get(client.sessionId);
    if (!learner) {
      rejectNotJoined((seqNum, reason) => this.reject(client, seqNum, reason), message);
      return;
    }
    if (!isRecord(message)) {
      this.reject(client, 0, "bad-envelope");
      return;
    }
    const { kind, seq, clientTs, payload } = message;
    if (typeof kind !== "string" || !INTENT_KINDS.has(kind)) {
      this.reject(client, Number.isInteger(seq) ? (seq as number) : 0, "unknown-kind");
      return;
    }
    if (!Number.isInteger(seq) || (seq as number) <= learner.lastSeq) {
      this.reject(client, Number.isInteger(seq) ? (seq as number) : 0, "stale-seq");
      return;
    }
    if (!isFiniteNumber(clientTs)) {
      this.reject(client, seq as number, "bad-client-ts");
      return;
    }
    const intentSeq = seq as number;
    // C13/C14 review intents live only in replay rooms: a live learner sending
    // one gets a clean reject (never routed into the utterance engine).
    if (kind === "return-to-lobby" || kind === "score-station" || kind === "finalize-review") {
      this.reject(client, intentSeq, "unknown-kind");
      return;
    }
    // C6 phase gate (brief mode has none: C1..C5 behaviour).
    const gated = PhaseClock.phaseGateReason(this.phaseClock !== null, this.state.phase, kind as string);
    if (gated !== null) {
      this.reject(client, intentSeq, gated);
      return;
    }
    const bindings = {
      actors: this.state.actors,
      selectedActor: this.selectedActor,
      selectionLog: this.selectionLog,
      tracer: this.tracer,
      reject: this.reject.bind(this),
    };
    const applied =
      kind === "pose"
        ? applyPoseIntent(bindings, client, learner, intentSeq, payload)
        : kind === "select-actor"
          ? applySelectActorIntent(bindings, client, intentSeq, payload)
          : kind === "note-submit"
            ? this.applyNote(client, intentSeq, payload)
            : this.applyUtterance(client, learner, intentSeq, kind, payload);
    if (!applied) {
      return;
    }
    this.intentCounts[kind as string] = (this.intentCounts[kind as string] ?? 0) + 1;
    if (kind === "pose" && this.state.stationId !== "") recordStationPose(this.stationBinding, this.state.stationId);
    learner.lastSeq = intentSeq;
    this.state.serverTick += 1;
    const ack: AckMessage = { seq: intentSeq, serverTs: Date.now() };
    client.send("ack", ack);
    // State sync is exclusively the schema patch tick. No per-intent
    // broadcast: see DESTRUCTIVE_PROBE_ANCHOR (T6 probe) in onCreate.
  }

  /** C11 patient-note application: validated in the note module, held here. */
  private applyNote(client: Client, seq: number, payload: unknown): boolean {
    const validated = validateNoteSubmit(this.state.phase, this.stationNoteMaxChars ?? DEFAULT_NOTE_MAX_CHARS, payload);
    if (typeof validated !== "string") {
      this.reject(client, seq, validated.reason);
      return false;
    }
    this.noteText = validated;
    this.state.noteStatus = "submitted";
    this.state.noteChars = validated.length;
    this.tracer.push({ seq, kind: "note-submitted", actorId: "", turnId: null, chars: validated.length });
    return true;
  }

  private applyUtterance(
    client: Client,
    learner: LearnerStateInstance,
    seq: number,
    kind: string,
    payload: unknown,
  ): boolean {
    return applyUtteranceIntent(
      {
        actors: this.state.actors,
        selectedActor: this.selectedActor,
        turnId: this.state.turnId,
        setTurnId: (id) => {
          this.state.turnId = id;
        },
        turnOwner: this.state.turnOwner,
        setTurnOwner: (owner) => {
          this.state.turnOwner = owner;
        },
        tracer: this.tracer,
        clock: this.clock,
        turnLog: this.turnLog,
        actorTurnCounts: this.actorTurnCounts,
        turnOpenedAtMs: this.turnOpenedAtMs,
        getOpenTurn: () => this.openTurn,
        setOpenTurn: (turn) => {
          this.openTurn = turn;
        },
        reject: this.reject.bind(this),
        castVoice: this.castVoice === null ? null : { actors: this.castVoice },
      },
      client,
      learner,
      seq,
      kind,
      payload,
    );
  }
}
