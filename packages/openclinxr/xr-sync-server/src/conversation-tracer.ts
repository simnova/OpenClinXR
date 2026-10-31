/**
 * C19 live conversation tracer for the xr-sync encounter room.
 *
 * Split out of conversation-trace.ts for the file-size gate (the pure
 * reducer + replay stay there; this module owns the live class only). The
 * room owns one tracer: it appends actor-agnostic events, resolves
 * per-actor emotion transitions from the probe policy (or the cast
 * station's policy), derives the trace view with the shared pure reducer,
 * and persists the review-safe file.
 */
import {
  EmotionEngine,
  type CaseEmotionPolicy,
  type EmotionEventKind,
  type EmotionTransition,
} from "@openclinxr/conversation-policy";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONVERSATION_TRACE_FILE_SUFFIX,
  CONVERSATION_TRACE_SCHEMA,
  PROBE_CASE_EMOTION_POLICY,
  reduceConversationEvents,
  type ConversationCastContext,
  type ConversationTrace,
  type ConversationTraceEvent,
} from "./conversation-trace.js";
import {
  cloneCastContext,
  transitionWithCastHold,
} from "./conversation-trace-cast.js";

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
  /** C7 station partition key for the owning room ("" when no stations). */
  private stationId = "";
  /** C18 the slot's scenario id ("" off a cast station). */
  private scenarioId = "";
  /** C18 recorded cast context for the reducer (undefined off-cast). */
  private castContext: ConversationCastContext | undefined = undefined;
  /**
   * C17 emotion policy for the owning room (PROBE policy unless the room sets
   * its cast station's policy). Live transitions resolve against it; C18 the
   * shared pure reducer resolves against the recorded cast context, so a
   * cast session's persisted emotions match the live values.
   */
  private emotionPolicy: CaseEmotionPolicy = PROBE_CASE_EMOTION_POLICY;
  /** C17 engine starting emotion (PROBE baseline unless the room sets its cast baseline). */
  private emotionBaseline: CaseEmotionPolicy["baseline"] = PROBE_CASE_EMOTION_POLICY.baseline;

  /** C7: bind the owning room's station before any event is pushed. */
  setStationId(stationId: string): void {
    this.stationId = stationId;
  }

  /** C17: bind the owning room's emotion policy + engine baseline (cast stations). */
  setStationEmotionPolicy(policy: CaseEmotionPolicy): void {
    this.emotionPolicy = policy;
    this.emotionBaseline = policy.baseline;
  }

  /** C18: bind the owning room's cast (scenario id, roster, policy + baseline). Null clears back to off-cast. */
  setStationCast(cast: { scenarioId: string; actors: string[]; baseline: string; emotionPolicy: CaseEmotionPolicy } | null): void {
    if (cast === null) {
      this.scenarioId = "";
      this.castContext = undefined;
      this.emotionPolicy = PROBE_CASE_EMOTION_POLICY;
      this.emotionBaseline = PROBE_CASE_EMOTION_POLICY.baseline;
      return;
    }
    this.scenarioId = cast.scenarioId;
    this.emotionPolicy = cast.emotionPolicy;
    this.emotionBaseline = cast.emotionPolicy.baseline;
    this.castContext = cloneCastContext({
      scenarioId: cast.scenarioId,
      actors: [...cast.actors],
      baseline: cast.baseline,
      emotionPolicy: cast.emotionPolicy,
    });
  }

  /** Append one conversation event, in application order. */
  push(event: ConversationTraceEvent): void {
    this.events.push(event);
  }

  /** Resolve one emotion transition for an actor, advancing its engine. */
  transition(actorId: string, kind: EmotionEventKind, turnIndex: number): EmotionTransition {
    let engine = this.engines.get(actorId);
    if (!engine) {
      engine = new EmotionEngine(this.emotionBaseline);
      this.engines.set(actorId, engine);
    }
    // C17/C18 no-match hold lives in conversation-trace-cast.ts (single source).
    return transitionWithCastHold(engine, this.emotionPolicy, kind, turnIndex);
  }

  /** Live trace view: events copied, turns + emotions recomputed by the reducer. */
  snapshot(): ConversationTrace {
    const { turns, emotions } = reduceConversationEvents(this.events, this.castContext);
    const out: ConversationTrace = {
      schema: CONVERSATION_TRACE_SCHEMA,
      stationId: this.stationId,
      scenarioId: this.scenarioId,
      events: this.events.map((event) => ({ ...event })),
      turns,
      emotions,
    };
    if (this.castContext !== undefined) {
      out.cast = cloneCastContext(this.castContext);
    }
    return out;
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
