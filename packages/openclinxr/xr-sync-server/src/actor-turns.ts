/**
 * Server-driven actor-turn intent application for the encounter room.
 *
 * Split out of room.ts for the file-size gate (C3 utterance-start/end with
 * the server-clock reply timer, interruption, and phase-close handling). The
 * room owns state/clock/turn bookkeeping and passes them through the narrow
 * structural bindings below; this module owns only the per-kind validation
 * and turn side effects. Moved verbatim from room.ts (same behaviour).
 */
import type { Client } from "@colyseus/core";
import type { EmotionEventKind } from "@openclinxr/conversation-policy";
import { pickC3Reply, type ConversationTracer } from "./conversation-trace.js";
import type { LearnerStateInstance } from "./schema.js";
import type { TurnRecord } from "./room-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Minimal actor surface the turn applier mutates. */
export interface TurnActorState {
  speaking: boolean;
  emotion: string;
  replyId: string;
  cueId: string;
}

/** Room clock surface the reply timer uses. */
export interface TurnClock {
  setTimeout(handler: (...args: unknown[]) => void, ms: number): { clear(): void };
}

/** Narrow room surface the utterance applier mutates. */
export interface ActorTurnBindings {
  actors: { get(id: string): TurnActorState | undefined; has(id: string): boolean };
  selectedActor: Map<string, string>;
  turnId: number;
  setTurnId(id: number): void;
  turnOwner: string;
  setTurnOwner(owner: string): void;
  tracer: ConversationTracer;
  clock: TurnClock;
  turnLog: TurnRecord[];
  actorTurnCounts: Map<string, number>;
  turnOpenedAtMs: Map<number, number>;
  getOpenTurn(): { turnId: number; actorId: string; timer: { clear(): void } } | null;
  setOpenTurn(turn: { turnId: number; actorId: string; timer: { clear(): void } } | null): void;
  reject(client: Client, seq: number, reason: string): void;
}

/**
 * End the open actor turn as interrupted (learner started speaking again).
 * The cancelled server-clock timer must never fire later and flip anything.
 */
function interruptOpenTurn(
  bindings: ActorTurnBindings,
  endSeq: number,
): void {
  const open = bindings.getOpenTurn();
  if (!open) {
    return;
  }
  open.timer.clear();
  bindings.setOpenTurn(null);
  const actor = bindings.actors.get(open.actorId);
  if (actor) {
    actor.speaking = false;
  }
  const record = bindings.turnLog.find((entry) => entry.turnId === open.turnId);
  if (record && record.end === "open") {
    record.end = "interrupted";
    record.endSeq = endSeq;
  }
}

/** Apply a validated utterance-start/utterance-end intent (C3/C4 turn engine). */
export function applyUtteranceIntent(
  bindings: ActorTurnBindings,
  client: Client,
  learner: LearnerStateInstance,
  seq: number,
  kind: string,
  payload: unknown,
): boolean {
  // C3/C4: client-supplied reply/turn/cue/emotion fields are ignored; only `actorId` is read.
  let actorId = bindings.selectedActor.get(client.sessionId);
  if (payload !== undefined) {
    if (!isRecord(payload)) {
      bindings.reject(client, seq, "bad-utterance-payload");
      return false;
    }
    const { actorId: payloadActorId } = payload;
    if (payloadActorId !== undefined) {
      if (typeof payloadActorId !== "string") {
        bindings.reject(client, seq, "bad-utterance-payload");
        return false;
      }
      actorId = payloadActorId;
    }
  }
  if (kind === "utterance-start") {
    if (learner.speaking) {
      bindings.reject(client, seq, "utterance-already-open");
      return false;
    }
    if (actorId === undefined || !bindings.actors.has(actorId)) {
      bindings.reject(client, seq, "no-actor-selected");
      return false;
    }
    const spokenOver = bindings.actors.get(actorId);
    if (!spokenOver) {
      bindings.reject(client, seq, "unknown-actor");
      return false;
    }
    // C4: an utterance-start that interrupts an open actor turn emits a
    // learner_interruption emotion transition (turnIndex = interrupted
    // turn); a non-interrupting start emits no emotion event. The learner
    // appears as an actor-agnostic trace event (no sessionId).
    const interrupted = bindings.getOpenTurn();
    if (interrupted) {
      const interruption: EmotionEventKind = "learner_interruption";
      const spokenActor = bindings.actors.get(interrupted.actorId);
      if (spokenActor) {
        spokenActor.emotion = bindings.tracer.transition(interrupted.actorId, interruption, interrupted.turnId).to;
      }
      bindings.tracer.push({ seq, kind: "utterance-start", actorId: "", turnId: interrupted.turnId });
    } else {
      bindings.tracer.push({ seq, kind: "utterance-start", actorId: "", turnId: null });
    }
    interruptOpenTurn(bindings, seq);
    learner.speaking = true;
    bindings.setTurnOwner("learner");
    return true;
  }
  if (!learner.speaking) {
    bindings.reject(client, seq, "no-open-utterance");
    return false;
  }
  if (actorId === undefined || !bindings.actors.has(actorId)) {
    bindings.reject(client, seq, "no-actor-selected");
    return false;
  }
  const actor = bindings.actors.get(actorId);
  if (!actor) {
    bindings.reject(client, seq, "unknown-actor");
    return false;
  }
  learner.speaking = false;
  const turnCount = (bindings.actorTurnCounts.get(actorId) ?? 0) + 1;
  bindings.actorTurnCounts.set(actorId, turnCount);
  const reply = pickC3Reply(turnCount);
  const turnId = bindings.turnId + 1;
  bindings.setTurnId(turnId);
  actor.speaking = true;
  actor.replyId = reply.id;
  // C4: each actor turn carries renderable content from the scripted table:
  // the cueId (audio/viseme cue) plus the EmotionEngine transition for the
  // utterance-end's learner_acknowledgement (turnIndex = the opened turn).
  actor.cueId = reply.cueId;
  const acknowledgement: EmotionEventKind = "learner_acknowledgement";
  actor.emotion = bindings.tracer.transition(actorId, acknowledgement, turnId).to;
  bindings.tracer.push({ seq, kind: "utterance-end", actorId, turnId });
  bindings.setTurnOwner("actor");
  const record: TurnRecord = { turnId, actorId, replyId: reply.id, startSeq: seq, end: "open", endSeq: null };
  bindings.turnLog.push(record);
  bindings.turnOpenedAtMs.set(turnId, Date.now());
  const timer = bindings.clock.setTimeout(() => {
    if (bindings.getOpenTurn()?.turnId !== turnId) {
      return;
    }
    bindings.setOpenTurn(null);
    actor.speaking = false;
    bindings.setTurnOwner("none");
    record.end = "completed";
    // C4: the room adds only the clock timer that emits turn-completed.
    bindings.tracer.push({ seq: null, kind: "turn-completed", actorId, turnId });
  }, reply.durationMs);
  bindings.setOpenTurn({ turnId, actorId, timer });
  return true;
}
