import { MapSchema } from "@colyseus/schema";
import { Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  ActorState,
  EncounterState,
  LearnerState,
  type ActorStateInstance,
  type EncounterStateInstance,
  type LearnerStateInstance,
} from "./schema.js";

/** Matchmaking name clients join to reach the authoritative encounter room. */
export const ENCOUNTER_ROOM_NAME = "encounter";
/** Seconds a dropped client keeps its seat, learner entry, and lastSeq. */
export const RECONNECT_ALLOWANCE_SECONDS = 30;

/** Maximum extra probe actors a room may provision beyond the known encounter roster. */
export const MAX_EXTRA_ACTOR_IDS = 8;

export const KNOWN_ACTOR_IDS = ["physician", "patient"] as const;
export type KnownActorId = (typeof KNOWN_ACTOR_IDS)[number];

/** C3 scripted actor reply: an id the page renders, text kept server-side, and a server-clock duration. */
export interface C3ScriptedReply {
  id: string;
  text: string;
  durationMs: number;
}

/**
 * C3 server-side scripted reply table (module-local const, no LLM, no network).
 * Every durationMs sits in [1500, 4000]: the floor is 30x the C2 Quest RTT max
 * (43 ms) plus the 50 ms patch interval so the probe can observe and interrupt
 * a turn on device; the ceiling keeps the scripted run short.
 */
export const C3_REPLY_TABLE: readonly C3ScriptedReply[] = [
  { id: "c3-ack-open", text: "Thanks for sharing that. Tell me a little more about what brings you in today.", durationMs: 2000 },
  { id: "c3-ack-onset", text: "I see. When did you first notice that change?", durationMs: 2500 },
  { id: "c3-ack-recap", text: "Got it. Let me make sure I have that right before we go on.", durationMs: 3000 },
];

/**
 * Deterministic C3 reply picker: the actor's own 1-based turn count selects the
 * reply, so the same intent script always replays the same turn log.
 */
export function pickC3Reply(actorTurnCount: number): C3ScriptedReply {
  const index = (Math.max(1, Math.floor(actorTurnCount)) - 1) % C3_REPLY_TABLE.length;
  const reply = C3_REPLY_TABLE[index];
  if (!reply) {
    throw new Error("empty C3 reply table");
  }
  return reply;
}

/** One server-driven actor turn, in application order. Server-side only, never synced. */
export interface TurnRecord {
  turnId: number;
  actorId: string;
  replyId: string;
  /** Seq of the utterance-end intent that opened the turn. */
  startSeq: number;
  end: "open" | "completed" | "interrupted";
  /** Seq of the interrupting utterance-start, or null when completed/open. */
  endSeq: number | null;
}

/** One applied select-actor intent, in application order. Server-side only, never synced. */
export interface ProbeSelection {
  sessionId: string;
  actorId: string;
  seq: number;
}

/** Read-only probe observability for the C2 headset harness. Never sent on the wire. */
export interface RoomProbeStats {
  intentCounts: Record<string, number>;
  selections: ProbeSelection[];
  /** C3 actor-turn log; every entry is a copy, never a live reference. */
  turns: TurnRecord[];
}

/** Options accepted at room creation (forwarded from joinOrCreate). */
export interface EncounterRoomOptions {
  actors?: unknown;
}

/** Client-to-server intent kinds. The only message type that may mutate state. */
export type IntentKind = "pose" | "select-actor" | "utterance-start" | "utterance-end";
const INTENT_KINDS: ReadonlySet<string> = new Set([
  "pose",
  "select-actor",
  "utterance-start",
  "utterance-end",
]);

/** Wire envelope for one client intent. Validated before anything is applied. */
export interface IntentMessage {
  kind?: unknown;
  seq?: unknown;
  clientTs?: unknown;
  payload?: unknown;
}

/** Server reply for an applied intent, carrying the round-trip terminus. */
export interface AckMessage {
  seq: number;
  serverTs: number;
}

/** Server reply for a rejected intent. State is unchanged when this is sent. */
export interface RejectMessage {
  seq: number;
  reason: string;
}

/** Plain-object view of authoritative state, for tests and operators. */
export interface EncounterSnapshot {
  serverTick: number;
  phase: string;
  turnId: number;
  turnOwner: string;
  actors: Record<string, { id: string; speaking: boolean; emotion: string; replyId: string }>;
  learners: Record<
    string,
    { sessionId: string; headX: number; headY: number; headZ: number; lastSeq: number; speaking: boolean }
  >;
}

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

/**
 * Parse optional extra probe actor ids from room options. Invalid entries are
 * ignored; the known encounter roster is always present. Bounded so a probe
 * page can provision its own actors (e.g. a1/a2) without changing defaults.
 */
function parseExtraActorIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry)) {
      continue;
    }
    if (KNOWN_ACTOR_IDS.includes(entry as KnownActorId)) {
      continue;
    }
    if (!ids.includes(entry)) {
      ids.push(entry);
    }
    if (ids.length >= MAX_EXTRA_ACTOR_IDS) {
      break;
    }
  }
  return ids;
}

export function snapshotState(state: EncounterStateInstance): EncounterSnapshot {
  const actors: EncounterSnapshot["actors"] = {};
  for (const [id, actor] of state.actors) {
    actors[id] = { id: actor.id, speaking: actor.speaking, emotion: actor.emotion, replyId: actor.replyId };
  }
  const learners: EncounterSnapshot["learners"] = {};
  for (const [sessionId, learner] of state.learners) {
    learners[sessionId] = {
      sessionId: learner.sessionId,
      headX: learner.headX,
      headY: learner.headY,
      headZ: learner.headZ,
      lastSeq: learner.lastSeq,
      speaking: learner.speaking,
    };
  }
  return { serverTick: state.serverTick, phase: state.phase, turnId: state.turnId, turnOwner: state.turnOwner, actors, learners };
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

  /** Read-only copy of probe stats for the harness. Never sent on the wire. */
  getProbeStats(): RoomProbeStats {
    return {
      intentCounts: { ...this.intentCounts },
      selections: this.selectionLog.map((entry) => ({ ...entry })),
      turns: this.turnLog.map((entry) => ({ ...entry })),
    };
  }

  override onCreate(options?: EncounterRoomOptions): void {
    latestRoom = this;
    this.setState(new EncounterState());
    this.state.serverTick = 0;
    this.state.phase = "brief";
    this.state.turnId = 0;
    this.state.turnOwner = "none";
    this.state.actors = new MapSchema<ActorStateInstance>();
    this.state.learners = new MapSchema<LearnerStateInstance>();
    const roster = new Set<string>(KNOWN_ACTOR_IDS);
    for (const id of parseExtraActorIds(options?.actors)) {
      roster.add(id);
    }
    for (const id of roster) {
      const actor = new ActorState();
      actor.id = id;
      actor.speaking = false;
      actor.emotion = "neutral";
      actor.replyId = "";
      this.state.actors.set(id, actor);
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

  override onJoin(client: Client): void {
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
    this.dropLearner(client.sessionId);
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
    const learner = this.state.learners.get(client.sessionId);
    if (!learner) {
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
    const applied =
      kind === "pose"
        ? this.applyPose(client, learner, intentSeq, payload)
        : kind === "select-actor"
          ? this.applySelectActor(client, learner, intentSeq, payload)
          : this.applyUtterance(client, learner, intentSeq, kind, payload);
    if (!applied) {
      return;
    }
    this.intentCounts[kind as string] = (this.intentCounts[kind as string] ?? 0) + 1;
    learner.lastSeq = intentSeq;
    this.state.serverTick += 1;
    const ack: AckMessage = { seq: intentSeq, serverTs: Date.now() };
    client.send("ack", ack);
    // State sync is exclusively the schema patch tick. No per-intent
    // broadcast: see DESTRUCTIVE_PROBE_ANCHOR (T6 probe) in onCreate.
  }

  private applyPose(
    client: Client,
    learner: LearnerStateInstance,
    seq: number,
    payload: unknown,
  ): boolean {
    if (!isRecord(payload)) {
      this.reject(client, seq, "bad-pose-payload");
      return false;
    }
    const { x, y, z } = payload as { x?: unknown; y?: unknown; z?: unknown };
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
      this.reject(client, seq, "bad-pose-payload");
      return false;
    }
    learner.headX = x;
    learner.headY = y;
    learner.headZ = z;
    return true;
  }

  private applySelectActor(
    client: Client,
    learner: LearnerStateInstance,
    seq: number,
    payload: unknown,
  ): boolean {
    void learner;
    if (!isRecord(payload)) {
      this.reject(client, seq, "bad-select-actor-payload");
      return false;
    }
    const { actorId } = payload;
    if (typeof actorId !== "string") {
      this.reject(client, seq, "bad-select-actor-payload");
      return false;
    }
    if (!this.state.actors.has(actorId)) {
      this.reject(client, seq, "unknown-actor");
      return false;
    }
    this.selectedActor.set(client.sessionId, actorId);
    this.selectionLog.push({ sessionId: client.sessionId, actorId, seq });
    return true;
  }

  /**
   * End the open actor turn as interrupted (learner started speaking again).
   * The cancelled server-clock timer must never fire later and flip anything.
   */
  private interruptOpenTurn(endSeq: number): void {
    const open = this.openTurn;
    if (!open) {
      return;
    }
    open.timer.clear();
    this.openTurn = null;
    const actor = this.state.actors.get(open.actorId);
    if (actor) {
      actor.speaking = false;
    }
    const record = this.turnLog.find((entry) => entry.turnId === open.turnId);
    if (record && record.end === "open") {
      record.end = "interrupted";
      record.endSeq = endSeq;
    }
  }

  private applyUtterance(
    client: Client,
    learner: LearnerStateInstance,
    seq: number,
    kind: string,
    payload: unknown,
  ): boolean {
    // C3: client-supplied reply/turn fields are ignored; only `actorId` is read.
    let actorId = this.selectedActor.get(client.sessionId);
    if (payload !== undefined) {
      if (!isRecord(payload)) {
        this.reject(client, seq, "bad-utterance-payload");
        return false;
      }
      const { actorId: payloadActorId } = payload;
      if (payloadActorId !== undefined) {
        if (typeof payloadActorId !== "string") {
          this.reject(client, seq, "bad-utterance-payload");
          return false;
        }
        actorId = payloadActorId;
      }
    }
    if (kind === "utterance-start") {
      if (learner.speaking) {
        this.reject(client, seq, "utterance-already-open");
        return false;
      }
      if (actorId === undefined || !this.state.actors.has(actorId)) {
        this.reject(client, seq, "no-actor-selected");
        return false;
      }
      const spokenOver = this.state.actors.get(actorId);
      if (!spokenOver) {
        this.reject(client, seq, "unknown-actor");
        return false;
      }
      this.interruptOpenTurn(seq);
      learner.speaking = true;
      this.state.turnOwner = "learner";
      return true;
    }
    if (!learner.speaking) {
      this.reject(client, seq, "no-open-utterance");
      return false;
    }
    if (actorId === undefined || !this.state.actors.has(actorId)) {
      this.reject(client, seq, "no-actor-selected");
      return false;
    }
    const actor = this.state.actors.get(actorId);
    if (!actor) {
      this.reject(client, seq, "unknown-actor");
      return false;
    }
    learner.speaking = false;
    const turnCount = (this.actorTurnCounts.get(actorId) ?? 0) + 1;
    this.actorTurnCounts.set(actorId, turnCount);
    const reply = pickC3Reply(turnCount);
    const turnId = this.state.turnId + 1;
    this.state.turnId = turnId;
    actor.speaking = true;
    actor.replyId = reply.id;
    this.state.turnOwner = "actor";
    const record: TurnRecord = { turnId, actorId, replyId: reply.id, startSeq: seq, end: "open", endSeq: null };
    this.turnLog.push(record);
    const timer = this.clock.setTimeout(() => {
      if (this.openTurn?.turnId !== turnId) {
        return;
      }
      this.openTurn = null;
      actor.speaking = false;
      this.state.turnOwner = "none";
      record.end = "completed";
    }, reply.durationMs);
    this.openTurn = { turnId, actorId, timer };
    return true;
  }
}
