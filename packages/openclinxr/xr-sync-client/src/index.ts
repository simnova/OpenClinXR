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
  /** C7 station id ("" when no stations: C6 behaviour). Always present on C7 servers. */
  stationId?: string;
  /** C7 station index (0 when no stations). */
  stationIndex?: number;
  /** C7 station count (0 when no stations). */
  stationCount?: number;
}

/** Live headset-side connection: intents out, snapshots in. */
export interface SyncConnection {
  readonly sessionId: string;
  readonly reconnectionToken: string;
  /** C8: last rotation-failed notice from the server (null when none). */
  readonly rotationFailed: { stationId: string } | null;
  sendIntent(kind: IntentKind, payload?: IntentPayload): Promise<IntentResult>;
  onState(callback: (snapshot: EncounterSnapshot) => void): () => void;
  /** C8: typed callback for the server rotation-failed notice (no station choice). */
  onRotationFailed(callback: (info: { stationId: string }) => void): () => void;
  leave(consented?: boolean): Promise<void>;
  reconnect(): Promise<void>;
}

const INTENT_TIMEOUT_MS = 5000;
const ROOM_NAME = "encounter";

interface PendingIntent {
  room: Room;
  resolve: (result: IntentResult) => void;
  reject: (error: Error) => void;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedIntent {
  seq: number;
  kind: IntentKind;
  payload: IntentPayload;
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
  const rotationFailedListeners = new Set<(info: { stationId: string }) => void>();
  let lastRotationFailed: { stationId: string } | null = null;
  let rotating = false;
  const rotationQueue: QueuedIntent[] = [];

  const pushCurrent = (): void => {
    const snapshot = toSnapshot(room.state);
    if (snapshot === undefined) {
      return;
    }
    for (const listener of stateListeners) {
      listener(snapshot);
    }
  };

  const failRoomPending = (target: Room, error: Error): void => {
    for (const [key, item] of [...pending]) {
      if (item.room === target) {
        pending.delete(key);
        clearTimeout(item.timer);
        item.reject(error);
      }
    }
  };

  const settleFrom = (
    source: Room,
    message: { seq?: unknown; serverTs?: unknown; reason?: unknown },
    status: "ack" | "reject",
  ): void => {
    const messageSeq = message.seq;
    if (typeof messageSeq !== "number") {
      return;
    }
    const item = pending.get(messageSeq);
    if (!item || item.room !== source) {
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

  const sendOn = (target: Room, current: number, kind: IntentKind, payload: IntentPayload): void => {
    const item = pending.get(current);
    if (!item) {
      return;
    }
    try {
      target.send("intent", { kind, seq: current, clientTs: Date.now(), payload });
    } catch (error) {
      pending.delete(current);
      clearTimeout(item.timer);
      item.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const flushRotationQueue = (): void => {
    const queued = rotationQueue.splice(0, rotationQueue.length);
    for (const entry of queued) {
      pending.set(entry.seq, { room, resolve: entry.resolve, reject: entry.reject, startedAt: entry.startedAt, timer: entry.timer });
      sendOn(room, entry.seq, entry.kind, entry.payload);
    }
  };

  const wireRoom = (next: Room): void => {
    room = next;
    const bound = next;
    room.onMessage("ack", (message) => settleFrom(bound, message as { seq?: unknown }, "ack"));
    room.onMessage("reject", (message) => settleFrom(bound, message as { seq?: unknown }, "reject"));
    room.onMessage("rotation-failed", (message) => {
      const stationId = (message as { stationId?: unknown }).stationId;
      const info = { stationId: typeof stationId === "string" ? stationId : "" };
      lastRotationFailed = info;
      for (const listener of rotationFailedListeners) {
        listener(info);
      }
    });
    // C8 rotation: the server moves the learner AND the observer to the next
    // station's room with a server-issued seat reservation. The client
    // consumes it (it never picks a station): seq stays monotonic, onState
    // subscriptions survive, pending intents are per room (an intent settles
    // only from the room it was sent to; old-room leave fails only that
    // room's pending), and intents sent while a rotation is in flight are
    // queued and sent to the new room in order. leave/reconnect target current.
    room.onMessage("rotate", (reservation: unknown) => {
      rotating = true;
      void (async () => {
        const old = bound;
        try {
          const incoming = await client.consumeSeatReservation(
            reservation as Parameters<Client["consumeSeatReservation"]>[0],
          );
          wireRoom(incoming as unknown as Room);
          rotating = false;
          flushRotationQueue();
          try {
            await old.leave();
          } catch {
            // Old room leave is best-effort; the new room is already wired and
            // its pending is untouched (per-room fail only fails old's own).
          }
        } catch {
          rotating = false;
          flushRotationQueue();
          // Reservation consume failed: the connection stays on the old room
          // (closed). Queued intents were flushed to it and surface there.
        }
      })();
    });
    room.onStateChange(() => {
      pushCurrent();
    });
    room.onLeave(() => {
      failRoomPending(bound, new Error("room left with in-flight intents"));
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
    get rotationFailed(): { stationId: string } | null {
      return lastRotationFailed;
    },
    sendIntent(kind: IntentKind, payload: IntentPayload = {}): Promise<IntentResult> {
      seq += 1;
      const current = seq;
      const startedAt = performance.now();
      return new Promise<IntentResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(current);
          const queuedIndex = rotationQueue.findIndex((entry) => entry.seq === current);
          if (queuedIndex >= 0) {
            rotationQueue.splice(queuedIndex, 1);
          }
          reject(new Error(`intent ${current} timed out after ${INTENT_TIMEOUT_MS}ms`));
        }, INTENT_TIMEOUT_MS);
        if (rotating) {
          rotationQueue.push({ seq: current, kind, payload, resolve, reject, startedAt, timer });
          return;
        }
        pending.set(current, { room, resolve, reject, startedAt, timer });
        sendOn(room, current, kind, payload);
      });
    },
    onState(callback: (snapshot: EncounterSnapshot) => void): () => void {
      stateListeners.add(callback);
      pushCurrent();
      return () => {
        stateListeners.delete(callback);
      };
    },
    onRotationFailed(callback: (info: { stationId: string }) => void): () => void {
      rotationFailedListeners.add(callback);
      return () => {
        rotationFailedListeners.delete(callback);
      };
    },
    async leave(consented = true): Promise<void> {
      for (const entry of rotationQueue.splice(0, rotationQueue.length)) {
        clearTimeout(entry.timer);
        entry.reject(new Error("connection left with queued intent"));
      }
      await room.leave(consented);
    },
    async reconnect(): Promise<void> {
      const token = room.reconnectionToken;
      const next = await client.reconnect(token);
      wireRoom(next as Room);
    },
  };
}
