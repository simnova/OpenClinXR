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
import { pickC3Reply } from "./conversation-trace.js";
import type { ConversationTracer } from "./conversation-tracer.js";
import { CAST_OPENING_CUE_ID, openingCaption, type CastVoiceActor } from "./scenario-cast.js";
import type { LearnerStateInstance } from "./schema.js";
import type { TurnRecord } from "./room-types.js";
import { validateTopicTag } from "./topic-menu.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Minimal actor surface the turn applier mutates. */
export interface TurnActorState {
  speaking: boolean;
  emotion: string;
  replyId: string;
  cueId: string;
  /** C17 learner-visible caption of the current reply ("" when silent). */
  caption: string;
}

/** C17 cast voice for one station: per-actor opening lines (null off a cast station). */
export interface CastVoice {
  actors: { get(id: string): CastVoiceActor | undefined; has(id: string): boolean };
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
  /** C17 cast voice for this room's station (null/undefined off a cast station: C3 behaviour). */
  castVoice?: CastVoice | null;
  /** C22 current cast station's scenario topic menu; null off a cast station. */
  topicMenu?: readonly string[] | null;
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
    // C17: the caption belongs to the reply; an interrupted reply shows none.
    actor.caption = "";
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
  const topic = validateTopicTag((payload ?? {}) as Record<string, unknown>, bindings.topicMenu ?? null);
  if (!topic.ok) {
    bindings.reject(client, seq, topic.reason);
    return false;
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
  // C17: on a cast station an actor's FIRST reply in the station is its
  // scenario opening line (replyId `${actorId}:opening`, learner-visible
  // caption, stable named cue, C3 first-row duration). Later turns fall back
  // to the C3 table with an empty caption. Off a cast station this is the C3
  // table from the first turn.
  const opening = turnCount === 1 ? bindings.castVoice?.actors.get(actorId) : undefined;
  const table = pickC3Reply(turnCount);
  const replyId = opening !== undefined ? `${actorId}:opening` : table.id;
  const cueId = opening !== undefined ? CAST_OPENING_CUE_ID : table.cueId;
  const durationMs = opening !== undefined ? pickC3Reply(1).durationMs : table.durationMs;
  const turnId = bindings.turnId + 1;
  bindings.setTurnId(turnId);
  actor.speaking = true;
  actor.replyId = replyId;
  // C4: each actor turn carries renderable content from the scripted table:
  // the cueId (audio/viseme cue) plus the EmotionEngine transition for the
  // utterance-end's learner_acknowledgement (turnIndex = the opened turn).
  actor.cueId = cueId;
  actor.caption = opening !== undefined ? openingCaption(opening.displayName, opening.openingUtterance) : "";
  const acknowledgement: EmotionEventKind = "learner_acknowledgement";
  actor.emotion = bindings.tracer.transition(actorId, acknowledgement, turnId).to;
  bindings.tracer.push({ seq, kind: "utterance-end", actorId, turnId, ...(topic.tag === undefined ? {} : { tag: topic.tag }) });
  bindings.setTurnOwner("actor");
  const record: TurnRecord = { turnId, actorId, replyId, startSeq: seq, end: "open", endSeq: null };
  bindings.turnLog.push(record);
  bindings.turnOpenedAtMs.set(turnId, Date.now());
  const timer = bindings.clock.setTimeout(() => {
    if (bindings.getOpenTurn()?.turnId !== turnId) {
      return;
    }
    bindings.setOpenTurn(null);
    actor.speaking = false;
    // C17: the caption clears when the reply ends (it names the reply, not the actor).
    actor.caption = "";
    bindings.setTurnOwner("none");
    record.end = "completed";
    // C4: the room adds only the clock timer that emits turn-completed.
    bindings.tracer.push({ seq: null, kind: "turn-completed", actorId, turnId });
  }, durationMs);
  bindings.setOpenTurn({ turnId, actorId, timer });
  return true;
}
