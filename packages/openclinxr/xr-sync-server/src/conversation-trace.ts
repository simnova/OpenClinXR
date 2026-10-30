/**
 * C4 review-safe conversation trace for the xr-sync encounter room.
 *
 * The room records one actor-agnostic event per applied conversation intent
 * (select-actor / utterance-start / utterance-end) plus one server-generated
 * turn-completed event per finished actor turn. turns + emotions are a PURE
 * reduction over those events: the room and replayConversationTrace share
 * reduceConversationEvents, so the persisted file replays to itself. The room
 * adds only the clock timer that emits turn-completed.
 *
 * No learner sessionId and no reply text ever enter the trace: the learner
 * appears as actor-agnostic events (actorId ""), and reply text stays in the
 * server-side C3 reply table. No timestamps either (serverTick allowed only if
 * replay ignores it; this trace carries no tick at all).
 */
import {
  EmotionEngine,
  type CaseEmotionPolicy,
  type EmotionEventKind,
  type EmotionTransition,
} from "@openclinxr/conversation-policy";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Learner speech completed: the acknowledgement that opens an actor reply. */
const LEARNER_ACKNOWLEDGEMENT: EmotionEventKind = "learner_acknowledgement";
/** Learner speech started over an open actor turn. */
const LEARNER_INTERRUPTION: EmotionEventKind = "learner_interruption";

/** Schema tag written into every persisted conversation trace file. */
export const CONVERSATION_TRACE_SCHEMA = "openclinxr.xr-sync.conversation-trace.v1";

/** C3 server-side scripted actor reply: an id the page renders, text kept
 * server-side, a server-clock duration, and the audio/viseme cue the page
 * renders as a mouth bar while the reply speaks. */
export interface C3ScriptedReply {
  id: string;
  text: string;
  durationMs: number;
  /** Audio/viseme cue id. Distinct per row; named like the clip it selects. */
  cueId: string;
}

/**
 * C3 server-side scripted reply table (module-local const, no LLM, no network).
 * Every durationMs sits in [1500, 4000]: the floor is 30x the C2 Quest RTT max
 * (43 ms) plus the 50 ms patch interval so the probe can observe and interrupt
 * a turn on device; the ceiling keeps the scripted run short.
 */
export const C3_REPLY_TABLE: readonly C3ScriptedReply[] = [
  {
    id: "c3-ack-open",
    text: "Thanks for sharing that. Tell me a little more about what brings you in today.",
    durationMs: 2000,
    cueId: "cue-greeting-01",
  },
  {
    id: "c3-ack-onset",
    text: "I see. When did you first notice that change?",
    durationMs: 2500,
    cueId: "cue-followup-02",
  },
  {
    id: "c3-ack-recap",
    text: "Got it. Let me make sure I have that right before we go on.",
    durationMs: 3000,
    cueId: "cue-recap-03",
  },
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

/**
 * Probe case emotion policy for the C4 sync probe (module-local server const).
 * Baseline neutral; acknowledgement reassures, interruption concerns, and a
 * further acknowledgement settles back to neutral. Bounds match the dialogue
 * subset so no transition ever clamps.
 */
export const PROBE_CASE_EMOTION_POLICY: CaseEmotionPolicy = {
  baseline: "neutral",
  upperBound: "anxious",
  lowerBound: "reassured",
  transitions: [
    { from: "neutral", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "reassured", triggeredBy: "learner_interruption", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_acknowledgement", to: "neutral" },
  ],
};

/** Trace event kinds. turn-completed is server-generated (seq null). C5 adds
 * observer-joined/observer-left presence events (seq null, actorId "", turnId
 * null, no session id); the reducer ignores them for turns/emotions. C6 adds
 * phase-changed (seq null, actorId "", turnId null, phase set); the reducer
 * closes an open turn as "closed-by-phase" when the new phase is not
 * "encounter". */
export type ConversationTraceEventKind =
  | "select-actor"
  | "utterance-start"
  | "utterance-end"
  | "turn-completed"
  | "observer-joined"
  | "observer-left"
  | "phase-changed";

/** One conversation event, in application order. Actor-agnostic: the learner
 * appears as utterance events with no sessionId; utterance-end names the
 * actor the reply targets (a roster id, never learner identity). */
export interface ConversationTraceEvent {
  /** Intent seq that produced this event; null for server-generated turn-completed. */
  seq: number | null;
  kind: ConversationTraceEventKind;
  /** Selected actor (select-actor), completed turn's actor (turn-completed),
   * the reply target (utterance-end), or "" for learner speech (utterance-start). */
  actorId: string;
  /** Turn the event belongs to: interrupted turn (interrupting utterance-start),
   * opened turn (utterance-end), completed turn (turn-completed); else null. */
  turnId: number | null;
  /** C6 station phase for "phase-changed" events; undefined for all other kinds. */
  phase?: string;
}

/** One server-driven actor turn, recomputed from events alone. */
export interface ConversationTraceTurn {
  turnId: number;
  actorId: string;
  replyId: string;
  cueId: string;
  /** Seq of the utterance-end intent that opened the turn. */
  startSeq: number;
  end: "open" | "completed" | "interrupted" | "closed-by-phase";
  /** Seq of the interrupting utterance-start, or null when completed/open. */
  endSeq: number | null;
}

/** Review-safe persisted conversation: schema tag, raw events, and the
 * recomputed derived views (turns + emotions). Derived views are fully
 * determined by events; replay ignores the stored copies. */
export interface ConversationTrace {
  schema: string;
  events: ConversationTraceEvent[];
  turns: ConversationTraceTurn[];
  emotions: EmotionTransition[];
}

/** Derived views recomputed from events alone. */
export interface ReducedConversation {
  turns: ConversationTraceTurn[];
  emotions: EmotionTransition[];
}

/**
 * Pure shared reducer: events in, turns + emotions out. No clock, no RNG, no
 * network. The room records events (adding only the clock-timer
 * turn-completed) and replayConversationTrace runs this over the file's events,
 * so both compute identical derived views from identical events.
 *
 * Turn indexing mirrors the room: an utterance-end opens turn N+1 on the
 * currently selected actor (selected by the latest select-actor event); an
 * utterance-start while a turn is open interrupts it. Emotion transitions use
 * one EmotionEngine per actor from the probe policy: utterance-end emits
 * learner_acknowledgement (before the reply opens, turnIndex = new turn),
 * an interrupting utterance-start emits learner_interruption
 * (turnIndex = interrupted turn); a non-interrupting utterance-start emits
 * nothing.
 */
export function reduceConversationEvents(events: readonly ConversationTraceEvent[]): ReducedConversation {
  let currentActor: string | null = null;
  const actorTurnCounts = new Map<string, number>();
  const engines = new Map<string, EmotionEngine>();
  const turns: ConversationTraceTurn[] = [];
  const emotions: EmotionTransition[] = [];
  let openTurnId: number | null = null;

  const engineFor = (actorId: string): EmotionEngine => {
    let engine = engines.get(actorId);
    if (!engine) {
      engine = new EmotionEngine(PROBE_CASE_EMOTION_POLICY.baseline);
      engines.set(actorId, engine);
    }
    return engine;
  };

  for (const event of events) {
    switch (event.kind) {
      case "select-actor": {
        if (event.actorId !== "") {
          currentActor = event.actorId;
        }
        break;
      }
      case "utterance-start": {
        if (openTurnId !== null) {
          const record = turns.find((entry) => entry.turnId === openTurnId);
          if (record && record.end === "open") {
            record.end = "interrupted";
            record.endSeq = event.seq;
          }
          if (record) {
            emotions.push(
              engineFor(record.actorId).transition({ kind: LEARNER_INTERRUPTION }, PROBE_CASE_EMOTION_POLICY, openTurnId),
            );
          }
          openTurnId = null;
        }
        break;
      }
      case "utterance-end": {
        // The room records the turn's target actor (a roster id) so a payload
        // actorId override replays; older events with "" fall back to the selection.
        const actorId = event.actorId !== "" ? event.actorId : currentActor;
        if (!actorId) {
          break;
        }
        const turnCount = (actorTurnCounts.get(actorId) ?? 0) + 1;
        actorTurnCounts.set(actorId, turnCount);
        const reply = pickC3Reply(turnCount);
        const turnId = turns.length + 1;
        turns.push({
          turnId,
          actorId,
          replyId: reply.id,
          cueId: reply.cueId,
          startSeq: event.seq ?? 0,
          end: "open",
          endSeq: null,
        });
        openTurnId = turnId;
        emotions.push(
          engineFor(actorId).transition({ kind: LEARNER_ACKNOWLEDGEMENT }, PROBE_CASE_EMOTION_POLICY, turnId),
        );
        break;
      }
      case "turn-completed": {
        if (event.turnId !== null) {
          const record = turns.find((entry) => entry.turnId === event.turnId);
          if (record && record.end === "open") {
            record.end = "completed";
          }
          if (openTurnId === event.turnId) {
            openTurnId = null;
          }
        }
        break;
      }
      case "observer-joined":
      case "observer-left": {
        // C5 presence only: no turns, no emotions, no selection change.
        break;
      }
      case "phase-changed": {
        // C6: leaving the encounter with a turn open ends it as
        // "closed-by-phase" (shared reducer, same as live). Entering a phase
        // (including "encounter") never opens or completes a turn.
        if (event.phase !== "encounter" && openTurnId !== null) {
          const record = turns.find((entry) => entry.turnId === openTurnId);
          if (record && record.end === "open") {
            record.end = "closed-by-phase";
          }
          openTurnId = null;
        }
        break;
      }
    }
  }
  return { turns, emotions };
}

/**
 * Replay a persisted (or live) trace from its events alone: turns and emotions
 * are RECOMPUTED, never echoed, so a tampered derived field replays to the
 * untampered value. The input shape is deliberately loose (kind: string):
 * only events are read; stored turns/emotions are ignored. Unknown schema
 * tags and unknown event kinds throw rather than replaying corruptly.
 */
export interface ReplayableConversationTrace {
  schema: string;
  events: readonly {
    seq: number | null;
    kind: string;
    actorId: string;
    turnId: number | null;
    phase?: string;
  }[];
}

function isTraceEventKind(kind: string): kind is ConversationTraceEventKind {
  return (
    kind === "select-actor" ||
    kind === "utterance-start" ||
    kind === "utterance-end" ||
    kind === "turn-completed" ||
    kind === "observer-joined" ||
    kind === "observer-left" ||
    kind === "phase-changed"
  );
}

export function replayConversationTrace(trace: ReplayableConversationTrace): ConversationTrace {
  if (trace.schema !== CONVERSATION_TRACE_SCHEMA) {
    throw new Error(`unsupported conversation trace schema: ${trace.schema}`);
  }
  const events: ConversationTraceEvent[] = trace.events.map((event) => {
    if (!isTraceEventKind(event.kind)) {
      throw new Error(`unknown conversation trace event kind: ${event.kind}`);
    }
    const out: ConversationTraceEvent = { seq: event.seq, kind: event.kind, actorId: event.actorId, turnId: event.turnId };
    if (event.phase !== undefined) {
      out.phase = event.phase;
    }
    return out;
  });
  const { turns, emotions } = reduceConversationEvents(events);
  return {
    schema: CONVERSATION_TRACE_SCHEMA,
    events,
    turns,
    emotions,
  };
}

/** Persisted-file name suffix for the review-safe conversation trace. */
export const CONVERSATION_TRACE_FILE_SUFFIX = ".conversation-trace.json";

/**
 * Live conversation tracer owned by one encounter room: appends
 * actor-agnostic events, resolves per-actor emotion transitions from the
 * probe policy, derives the trace view with the shared pure reducer, and
 * persists the review-safe file. The room adds only the clock timer that
 * emits turn-completed; everything else here is shared with replay.
 */
export class ConversationTracer {
  private events: ConversationTraceEvent[] = [];
  private engines = new Map<string, EmotionEngine>();

  /** Append one conversation event, in application order. */
  push(event: ConversationTraceEvent): void {
    this.events.push(event);
  }

  /** Resolve one emotion transition for an actor, advancing its engine. */
  transition(actorId: string, kind: EmotionEventKind, turnIndex: number): EmotionTransition {
    let engine = this.engines.get(actorId);
    if (!engine) {
      engine = new EmotionEngine(PROBE_CASE_EMOTION_POLICY.baseline);
      this.engines.set(actorId, engine);
    }
    return engine.transition({ kind }, PROBE_CASE_EMOTION_POLICY, turnIndex);
  }

  /** Live trace view: events copied, turns + emotions recomputed by the reducer. */
  snapshot(): ConversationTrace {
    const { turns, emotions } = reduceConversationEvents(this.events);
    return {
      schema: CONVERSATION_TRACE_SCHEMA,
      events: this.events.map((event) => ({ ...event })),
      turns,
      emotions,
    };
  }

  /**
   * Best-effort trace persistence: one <roomId>.conversation-trace.json in
   * dir (mkdir -p), written synchronously so room dispose leaves the file
   * behind. Failures never propagate; probe evidence must not break dispose
   * or server close.
   */
  persist(dir: string, roomId: string): void {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${roomId}${CONVERSATION_TRACE_FILE_SUFFIX}`), `${JSON.stringify(this.snapshot())}\n`, "utf8");
    } catch {
      // Probe evidence only.
    }
  }
}
