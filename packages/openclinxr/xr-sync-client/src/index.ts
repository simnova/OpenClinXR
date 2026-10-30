/**
 * Lean headset sync client: intents out with per-intent ack or reject, encounter state in via reflection-decoded patches.
 *
 * The only runtime dependency of this package is the Colyseus SDK. State is
 * never fetched or broadcast as JSON; the SDK decodes schema patches by
 * reflection and this module maps them to plain snapshots for consumers.
 * Do not add imports.
 */
import { Client, type Room } from "@colyseus/sdk";
import type { ConnectOptions } from "./options.js";

/** Client-to-server intent kinds, mirroring the server contract. */
export type IntentKind = "pose" | "select-actor" | "utterance-start" | "utterance-end";

/** JSON payload carried by one intent. */
export type IntentPayload = Record<string, unknown>;

/** Resolved outcome for an applied intent, with round-trip time. */
export interface AckResult {
  status: "ack";
  seq: number;
  serverTs: number;
  rttMs: number;
}

/** Resolved outcome for a rejected intent. State is unchanged. */
export interface RejectResult {
  status: "reject";
  seq: number;
  reason: string;
  rttMs: number;
}

/** Either outcome of one sent intent. */
export type IntentResult = AckResult | RejectResult;

/** Plain view of one synced actor. */
export interface SnapshotActor {
  id: string;
  speaking: boolean;
  emotion: string;
  /** C3 server-driven reply id ("" before the actor's first turn). */
  replyId: string;
  /** C4 server-driven cue id ("" before the actor's first turn). */
  cueId: string;
}

/** Plain view of one synced learner, including intent cursor. */
export interface SnapshotLearner {
  sessionId: string;
  headX: number;
  headY: number;
  headZ: number;
  lastSeq: number;
  /** C3 learner speech flag: true between utterance-start and utterance-end. */
  speaking: boolean;
}

/** Plain view of synced encounter state delivered to onState. */
export interface EncounterSnapshot {
  serverTick: number;
  phase: string;
  /** C6 integer seconds left in the current phase (0 when closed; absent on old servers / brief mode). */
  phaseRemainingS?: number;
  /** C3 actor-turn counter (0 before any actor turn). */
  turnId: number;
  /** C3 turn owner: "none" | "learner" | "actor". */
  turnOwner: string;
  actors: Record<string, SnapshotActor>;
  learners: Record<string, SnapshotLearner>;
  /** C5 connected faculty observers (read-only). Present once the server counts them. */
  observerCount?: number;
}

/** Live headset-side connection: intents out, snapshots in. */
export interface SyncConnection {
  readonly sessionId: string;
  readonly reconnectionToken: string;
  sendIntent(kind: IntentKind, payload?: IntentPayload): Promise<IntentResult>;
  onState(callback: (snapshot: EncounterSnapshot) => void): () => void;
  leave(consented?: boolean): Promise<void>;
  reconnect(): Promise<void>;
}

const INTENT_TIMEOUT_MS = 5000;
const ROOM_NAME = "encounter";

interface PendingIntent {
  resolve: (result: IntentResult) => void;
  reject: (error: Error) => void;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Map the reflection-decoded room state to a plain snapshot. Undefined while undecodable. */
function toSnapshot(state: unknown): EncounterSnapshot | undefined {
  if (typeof state !== "object" || state === null) {
    return undefined;
  }
  const candidate = state as { toJSON?: unknown };
  if (typeof candidate.toJSON !== "function") {
    return undefined;
  }
  const json = (candidate.toJSON as () => unknown)();
  if (typeof json !== "object" || json === null) {
    return undefined;
  }
  return json as EncounterSnapshot;
}

/** Join the encounter room at url and wire intent, snapshot, and reconnect handling. */
export async function connect(url: string, options: ConnectOptions = {}): Promise<SyncConnection> {
  const client = new Client(url);
  const initialRoom = await client.joinOrCreate<Room>(ROOM_NAME, options.roomOptions ?? {});
  return createConnection(client, initialRoom);
}

function createConnection(client: Client, initialRoom: Room): SyncConnection {
  let room: Room = initialRoom;
  let seq = 0;
  const pending = new Map<number, PendingIntent>();
  const stateListeners = new Set<(snapshot: EncounterSnapshot) => void>();

  const pushCurrent = (): void => {
    const snapshot = toSnapshot(room.state);
    if (snapshot === undefined) {
      return;
    }
    for (const listener of stateListeners) {
      listener(snapshot);
    }
  };

  const failAllPending = (error: Error): void => {
    for (const [, item] of pending) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };

  const settle = (message: { seq?: unknown; serverTs?: unknown; reason?: unknown }, status: "ack" | "reject"): void => {
    const messageSeq = message.seq;
    if (typeof messageSeq !== "number") {
      return;
    }
    const item = pending.get(messageSeq);
    if (!item) {
      return;
    }
    pending.delete(messageSeq);
    clearTimeout(item.timer);
    const rttMs = performance.now() - item.startedAt;
    if (status === "ack") {
      item.resolve({
        status: "ack",
        seq: messageSeq,
        serverTs: typeof message.serverTs === "number" ? message.serverTs : 0,
        rttMs,
      });
    } else {
      item.resolve({
        status: "reject",
        seq: messageSeq,
        reason: typeof message.reason === "string" ? message.reason : "unknown",
        rttMs,
      });
    }
  };

  const wireRoom = (next: Room): void => {
    room = next;
    room.onMessage("ack", (message) => settle(message as { seq?: unknown }, "ack"));
    room.onMessage("reject", (message) => settle(message as { seq?: unknown }, "reject"));
    room.onStateChange(() => {
      pushCurrent();
    });
    room.onLeave(() => {
      failAllPending(new Error("room left with in-flight intents"));
    });
    pushCurrent();
  };

  wireRoom(initialRoom);

  return {
    get sessionId(): string {
      return room.sessionId;
    },
    get reconnectionToken(): string {
      return room.reconnectionToken;
    },
    sendIntent(kind: IntentKind, payload: IntentPayload = {}): Promise<IntentResult> {
      seq += 1;
      const current = seq;
      const startedAt = performance.now();
      return new Promise<IntentResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(current);
          reject(new Error(`intent ${current} timed out after ${INTENT_TIMEOUT_MS}ms`));
        }, INTENT_TIMEOUT_MS);
        pending.set(current, { resolve, reject, startedAt, timer });
        room.send("intent", { kind, seq: current, clientTs: Date.now(), payload });
      });
    },
    onState(callback: (snapshot: EncounterSnapshot) => void): () => void {
      stateListeners.add(callback);
      pushCurrent();
      return () => {
        stateListeners.delete(callback);
      };
    },
    async leave(consented = true): Promise<void> {
      await room.leave(consented);
    },
    async reconnect(): Promise<void> {
      const token = room.reconnectionToken;
      const next = await client.reconnect(token);
      wireRoom(next as Room);
    },
  };
}
