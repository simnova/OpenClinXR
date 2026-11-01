/**
 * C18 cast context for the review-safe conversation trace.
 *
 * Split out of conversation-trace.ts for the file-size gate. The trace
 * records what the pure reducer needs on a cast station (scenario id,
 * cast roster, baseline, emotion policy) so the reducer stays cast-aware
 * from recorded data alone: no scenario bank, no utterance text, no caption
 * text. Off-cast traces carry no cast context (C4 shape and values unchanged).
 */
import type {
  EmotionEngine,
  CaseEmotionPolicy,
  EmotionEventKind,
  EmotionTransition,
} from "@openclinxr/conversation-policy";
import type { TraceTopicAnswer } from "./topic-answers.js";

/** C18 cast context recorded in the trace (review-safe: ids + policy only). */
export interface ConversationCastContext {
  /** The slot's scenario id (mirrors the trace top-level scenarioId). */
  scenarioId: string;
  /** Cast roster: an actor's first turn in the station is its opening line. */
  actors: string[];
  /** Station baseline emotion (the scenario baseline). */
  baseline: string;
  /** The station's emotion policy (scenario policy or empty at baseline). */
  emotionPolicy: CaseEmotionPolicy;
  /** C23 review-safe topic-to-reply selectors (no authored line text). */
  topicAnswers?: TraceTopicAnswer[];
}

/** Stable named cue for a cast actor's opening reply (mirrors scenario-cast). */
export const CAST_TRACE_OPENING_CUE_ID = "cue-opening-01";

/** Opening replyId for one cast actor (live: `${actorId}:opening`). */
export function castOpeningReplyId(actorId: string): string {
  return `${actorId}:opening`;
}

/** True when this turn is the actor's recorded opening (first turn + rostered). */
export function isCastOpening(
  castActors: ReadonlySet<string> | null,
  actorId: string,
  turnCount: number,
): boolean {
  return castActors !== null && turnCount === 1 && castActors.has(actorId);
}

/**
 * Mirror of the live tracer's no-match hold (ConversationTracer.transition):
 * when the station policy names no (from, trigger) rule, the emotion is
 * unchanged WITHOUT the engine clamp (the clamp must not move a baseline
 * the policy never transitions away from, e.g. knee "anxious").
 */
export function transitionWithCastHold(
  engine: EmotionEngine,
  policy: CaseEmotionPolicy,
  kind: EmotionEventKind,
  turnIndex: number,
): EmotionTransition {
  const current = engine.currentEmotion;
  const matched = policy.transitions.some((rule) => rule.from === current && rule.triggeredBy === kind);
  if (!matched) {
    return { from: current, to: current, trigger: kind, changed: false, turnIndex };
  }
  return engine.transition({ kind }, policy, turnIndex);
}

/** Read a C18 recorded cast context from a loose replay input (undefined when absent). */
export function readCastContext(raw: unknown, traceFile: string): ConversationCastContext | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`replay-bad-trace: ${traceFile} holds a malformed cast context`);
  }
  const record = raw as { scenarioId?: unknown; actors?: unknown; baseline?: unknown; emotionPolicy?: unknown; topicAnswers?: unknown };
  const { scenarioId, actors, baseline, emotionPolicy: policy } = record;
  if (
    typeof scenarioId !== "string" ||
    !Array.isArray(actors) ||
    !actors.every((entry) => typeof entry === "string") ||
    typeof baseline !== "string" ||
    typeof policy !== "object" ||
    policy === null
  ) {
    throw new Error(`replay-bad-trace: ${traceFile} holds a malformed cast context`);
  }
  const p = policy as { baseline?: unknown; upperBound?: unknown; lowerBound?: unknown; transitions?: unknown };
  if (
    typeof p.baseline !== "string" ||
    typeof p.upperBound !== "string" ||
    typeof p.lowerBound !== "string" ||
    !Array.isArray(p.transitions)
  ) {
    throw new Error(`replay-bad-trace: ${traceFile} holds a malformed cast context`);
  }
  return {
    scenarioId,
    actors: [...(actors as string[])],
    baseline,
    emotionPolicy: {
      baseline: p.baseline,
      upperBound: p.upperBound,
      lowerBound: p.lowerBound,
      transitions: [...(p.transitions as CaseEmotionPolicy["transitions"])],
    } as CaseEmotionPolicy,
    ...(Array.isArray(record.topicAnswers)
      ? {
          topicAnswers: record.topicAnswers.map((answer) => {
            if (typeof answer !== "object" || answer === null) throw new Error(`replay-bad-trace: ${traceFile} holds malformed topic answers`);
            const item = answer as { actorId?: unknown; topicTags?: unknown; replyId?: unknown };
            if (typeof item.actorId !== "string" || !Array.isArray(item.topicTags) || !item.topicTags.every((tag) => typeof tag === "string") || typeof item.replyId !== "string") {
              throw new Error(`replay-bad-trace: ${traceFile} holds malformed topic answers`);
            }
            return { actorId: item.actorId, topicTags: [...item.topicTags] as string[], replyId: item.replyId };
          }),
        }
      : {}),
  };
}

/** Starting emotion for a replay room (recorded baseline, else neutral). */
export function replayBaselineForCast(cast: { baseline?: unknown } | undefined): string {
  return typeof cast?.baseline === "string" && cast.baseline !== "" ? cast.baseline : "neutral";
}

/** Deep copy of a cast context (tracer snapshots must not alias live state). */
export function cloneCastContext(cast: ConversationCastContext): ConversationCastContext {
  return {
    scenarioId: cast.scenarioId,
    actors: [...cast.actors],
    baseline: cast.baseline,
    emotionPolicy: {
      baseline: cast.emotionPolicy.baseline,
      upperBound: cast.emotionPolicy.upperBound,
      lowerBound: cast.emotionPolicy.lowerBound,
      transitions: [...cast.emotionPolicy.transitions],
    },
    ...(cast.topicAnswers === undefined
      ? {}
      : { topicAnswers: cast.topicAnswers.map((answer) => ({ ...answer, topicTags: [...answer.topicTags] })) }),
  };
}
