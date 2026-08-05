import type { InteractionEmotion } from "@openclinxr/shared-schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Kinds of conversation events that can trigger an emotion transition in the
 * standardized-patient / parent actor. Pure behavioral taxonomy — not a
 * clinical assessment or scoring input.
 */
export type EmotionEventKind =
  | "learner_empathetic"
  | "learner_dismissive"
  | "learner_interruption"
  | "actor_silence_timeout"
  | "learner_acknowledgement"
  | "learner_clinical_question"
  | "learner_personal_question";

/** A single conversation event driving a potential emotion change. */
export type EmotionEvent = {
  kind: EmotionEventKind;
};

/**
 * A single transition rule in a case's emotion policy.
 * The engine matches (from, triggeredBy) pairs; first rule in policy order wins.
 */
export type EmotionTransitionRule = {
  from: InteractionEmotion;
  triggeredBy: EmotionEventKind;
  to: InteractionEmotion;
};

/**
 * Per-case emotion policy that drives the transition engine.
 *
 * baseline  – emotion the actor starts the encounter in.
 * upperBound – most-intense-negative emotion the actor can reach (clamp ceiling).
 * lowerBound – calmest / most-positive emotion the actor can reach (clamp floor).
 * transitions – ordered rule list; first (from, triggeredBy) match wins.
 */
export type CaseEmotionPolicy = {
  baseline: InteractionEmotion;
  upperBound: InteractionEmotion;
  lowerBound: InteractionEmotion;
  /** Ordered – first match wins (policy author controls priority). */
  transitions: readonly EmotionTransitionRule[];
};

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export type EmotionTransitionInput = {
  currentEmotion: InteractionEmotion;
  event: EmotionEvent;
  casePolicy: CaseEmotionPolicy;
  /** Conversation turn index (for trace/replay). */
  turnIndex: number | undefined;
};

export type EmotionTransition = {
  from: InteractionEmotion;
  to: InteractionEmotion;
  trigger: EmotionEventKind;
  changed: boolean;
  turnIndex: number | undefined;
};

// ---------------------------------------------------------------------------
// Internal ranking (dialogue-subset only — pain is a touch-response emotion)
// ---------------------------------------------------------------------------

/**
 * Ordered from most-negative to most-positive dialogue affect.
 * "pain" is NOT in this list because it is a touch-examination response emotion,
 * not a dialogue-driven affect. It is treated as neutral-rank for clamping.
 */
const DIALOGUE_EMOTION_ORDER: readonly InteractionEmotion[] = [
  "anxious",
  "concerned",
  "neutral",
  "reassured",
] as const satisfies readonly InteractionEmotion[];

function emotionRank(e: InteractionEmotion): number {
  const idx = DIALOGUE_EMOTION_ORDER.indexOf(e);
  // Non-dialogue emotions (e.g. "pain") fall back to neutral rank
  return idx >= 0 ? idx : DIALOGUE_EMOTION_ORDER.indexOf("neutral");
}

function clampEmotion(
  target: InteractionEmotion,
  upperBound: InteractionEmotion,
  lowerBound: InteractionEmotion,
): InteractionEmotion {
  const targetRank = emotionRank(target);
  const upperRank = emotionRank(upperBound);
  const lowerRank = emotionRank(lowerBound);

  // Lower rank = more negative. Clamp if target exceeds bounds.
  if (targetRank < upperRank) return upperBound;
  if (targetRank > lowerRank) return lowerBound;
  return target;
}

// ---------------------------------------------------------------------------
// Pure transition resolver
// ---------------------------------------------------------------------------

/**
 * Deterministic, pure emotion-transition resolver.
 *
 * 1. Find the first policy transition rule matching (currentEmotion, event.kind).
 * 2. If no rule matches, hold currentEmotion.
 * 3. Clamp the resolved target to [upperBound, lowerBound].
 * 4. Return the transition (changed=true only when to ≠ from).
 *
 * No wall-clock, no RNG, no Date.now. Same input → same output every time.
 */
export function resolveEmotionTransition(
  input: EmotionTransitionInput,
): EmotionTransition {
  const { currentEmotion, event, casePolicy, turnIndex } = input;

  // First matching rule wins (policy author controls priority via ordering).
  const matching = casePolicy.transitions.filter(
    (rule) => rule.from === currentEmotion && rule.triggeredBy === event.kind,
  );

  let target: InteractionEmotion;
  if (matching.length > 0) {
    target = matching[0]!.to;
  } else {
    // No rule for this (from, trigger) pair → hold current emotion.
    target = currentEmotion;
  }

  // Clamp to policy bounds.
  target = clampEmotion(target, casePolicy.upperBound, casePolicy.lowerBound);

  return {
    from: currentEmotion,
    to: target,
    trigger: event.kind,
    changed: target !== currentEmotion,
    turnIndex,
  };
}

// ---------------------------------------------------------------------------
// Stateful engine (tracks currentEmotion across a multi-turn conversation)
// ---------------------------------------------------------------------------

/**
 * Mutable, stateful wrapper around resolveEmotionTransition for use in a
 * running encounter. Tracks the actor's current emotion across turns.
 */
export class EmotionEngine {
  private _current: InteractionEmotion;

  constructor(initial: InteractionEmotion) {
    this._current = initial;
  }

  get currentEmotion(): InteractionEmotion {
    return this._current;
  }

  /**
   * Apply an event against the case policy, update currentEmotion, and return
   * the resolved transition.
   */
  transition(
    event: EmotionEvent,
    casePolicy: CaseEmotionPolicy,
    turnIndex?: number,
  ): EmotionTransition {
    const result = resolveEmotionTransition({
      currentEmotion: this._current,
      event,
      casePolicy,
      turnIndex,
    });
    this._current = result.to;
    return result;
  }

  /** Reset the engine to a specific emotion (e.g. for replay or scenario init). */
  reset(to: InteractionEmotion): void {
    this._current = to;
  }
}
