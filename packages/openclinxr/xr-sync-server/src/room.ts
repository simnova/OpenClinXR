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

export const KNOWN_ACTOR_IDS = ["physician", "patient"] as const;
export type KnownActorId = (typeof KNOWN_ACTOR_IDS)[number];

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
  actors: Record<string, { id: string; speaking: boolean; emotion: string }>;
  learners: Record<
    string,
    { sessionId: string; headX: number; headY: number; headZ: number; lastSeq: number }
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

export function snapshotState(state: EncounterStateInstance): EncounterSnapshot {
  const actors: EncounterSnapshot["actors"] = {};
  for (const [id, actor] of state.actors) {
    actors[id] = { id: actor.id, speaking: actor.speaking, emotion: actor.emotion };
  }
  const learners: EncounterSnapshot["learners"] = {};
  for (const [sessionId, learner] of state.learners) {
    learners[sessionId] = {
      sessionId: learner.sessionId,
      headX: learner.headX,
      headY: learner.headY,
      headZ: learner.headZ,
      lastSeq: learner.lastSeq,
    };
  }
  return { serverTick: state.serverTick, phase: state.phase, actors, learners };
}

/** Server-authoritative encounter room. Clients send intents; only ack/reject go back as messages. */
export class EncounterRoom extends Room<{ state: EncounterStateInstance }> {
  /** Per-client selected actor. Server-side only, never synced. */
  private selectedActor = new Map<string, string>();

  override onCreate(): void {
    latestRoom = this;
    this.setState(new EncounterState());
    this.state.serverTick = 0;
    this.state.phase = "brief";
    this.state.actors = new MapSchema<ActorStateInstance>();
    this.state.learners = new MapSchema<LearnerStateInstance>();
    for (const id of KNOWN_ACTOR_IDS) {
      const actor = new ActorState();
      actor.id = id;
      actor.speaking = false;
      actor.emotion = "neutral";
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
    return true;
  }

  private applyUtterance(
    client: Client,
    _learner: LearnerStateInstance,
    seq: number,
    kind: string,
    payload: unknown,
  ): boolean {
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
    if (actorId === undefined || !this.state.actors.has(actorId)) {
      this.reject(client, seq, "no-actor-selected");
      return false;
    }
    const actor = this.state.actors.get(actorId);
    if (!actor) {
      this.reject(client, seq, "unknown-actor");
      return false;
    }
    actor.speaking = kind === "utterance-start";
    return true;
  }
}
