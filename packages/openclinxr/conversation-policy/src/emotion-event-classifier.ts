/**
 * Deterministic learner-event classifier (DVA-5).
 *
 * Direction: docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md:229-259.
 * Owner of learner events. Not DeepSeek, not a local classifier model, not an
 * embedding nearest-neighbor. v1 is allowlisted tokens / trace tags on learner
 * STT (D9-legal). It must not become an empathy score.
 *
 * Fail-closed contract:
 *   - known event  -> authored EmotionEngine transition (engine decides)
 *   - unknown      -> `learner_unclassified` -> hold current dialogue state
 *   - `learner_clinical_question` is an authored-rule match only, never the
 *     unknown default.
 *
 * Deterministic: same input -> same kind. No wall clock, no RNG, no Date.now.
 * Machine flags (barge-in / silence timeout) are checked before text rules.
 */
import type { EmotionEventKind } from "./emotion-engine.js";

// ---------------------------------------------------------------------------
// Rule shape
// ---------------------------------------------------------------------------

/**
 * One authored allowlist rule. `anyToken` / `notToken` phrases are matched on a
 * normalized copy of the learner transcript (word-boundary whole-phrase).
 * A rule with `anyTraceTag` can fire from turn trace tags alone (e.g.
 * `emotion_acknowledged`), which is how a non-lexical acknowledgement is still
 * owned instead of guessed.
 */
export type EmotionEventRule = {
  id: string;
  kind: EmotionEventKind;
  /** Whole-word phrases: any match fires the rule (subject to notToken). */
  anyToken?: readonly string[];
  /** If any of these phrases appear, the rule does not fire from text. */
  notToken?: readonly string[];
  /** Turn trace tags that can fire the rule independently of the text. */
  anyTraceTag?: readonly string[];
  /** Restrict the rule to turns addressing one of these actor roles. */
  actorRole?: readonly string[];
};

export type EmotionEventClassifierInput = {
  /** Learner STT transcript (final or smart-turn committed). */
  text?: string;
  /** Trace tags already emitted for this turn (e.g. emotion_acknowledged). */
  traceTags?: readonly string[];
  /** Barge-in flag from the voice clock. Never inferred from partial STT. */
  bargeIn?: boolean;
  /** Station timer fired: the actor is waiting on the learner. */
  silenceTimeout?: boolean;
  /** Actor role the learner is addressing (optional authored-rule gate). */
  actorRole?: string;
};

export type EmotionEventClassifierVerdict = {
  kind: EmotionEventKind;
  /** How the verdict was reached, for Q4 traces. */
  source: "machine_flag" | "rule_match" | "default";
  /** Matched rule id, when source === "rule_match". */
  ruleId: string | null;
  /** Matched phrase, when the rule fired from text. */
  matchedPhrase: string | null;
  /** Matched trace tag, when the rule fired from tags. */
  matchedTraceTag: string | null;
};

// ---------------------------------------------------------------------------
// Normalization (punctuation-insensitive, apostrophe-agnostic)
// ---------------------------------------------------------------------------

const NON_WORD_RE = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RE = /\s+/g;

function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(NON_WORD_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

/** Word-boundary whole-phrase search on a normalized text. */
function containsPhrase(text: string, phrase: string): boolean {
  let index = text.indexOf(phrase);
  while (index !== -1) {
    const before = text[index - 1] ?? "";
    const after = text[index + phrase.length] ?? "";
    const isBoundary = (ch: string): boolean => !ch || !/[a-z0-9]/.test(ch);
    if (isBoundary(before) && isBoundary(after)) return true;
    index = text.indexOf(phrase, index + 1);
  }
  return false;
}

// ---------------------------------------------------------------------------
// v1 authored allowlists (conservative; default stays learner_unclassified)
// ---------------------------------------------------------------------------

/** Short backchannels. Acknowledgement requires the whole utterance to be one. */
const BACKCHANNEL_TOKENS = [
  "ok",
  "okay",
  "mhm",
  "mm hmm",
  "uh huh",
  "right",
  "sure",
  "yeah",
  "yes",
  "yep",
  "got it",
  "i see",
  "alright",
  "all right",
  "understood",
] as const;

const TRACE_TAG_EMOTION_ACKNOWLEDGED = "emotion_acknowledged";

const EMPATHETIC_PHRASES = [
  "i understand",
  "i hear you",
  "i'm sorry",
  "i am sorry",
  "i'm here",
  "i am here",
  "i believe you",
  "i'm listening",
  "i am listening",
  "that must be",
  "that sounds",
  "i can see",
  "it's okay",
  "it's ok",
  "you're safe",
  "you are safe",
  "take your time",
  "we'll get through this",
] as const;

const EMPATHETIC_NOT_PHRASES = [
  "don't understand",
  "do not understand",
  "can't understand",
  "cannot understand",
  "don't get it",
] as const;

const DISMISSIVE_PHRASES = [
  "calm down",
  "just relax",
  "relax",
  "it's nothing",
  "it's fine",
  "you're fine",
  "you are fine",
  "you're overreacting",
  "you are overreacting",
  "you're being dramatic",
  "you are being dramatic",
  "stop crying",
  "don't cry",
  "don't worry",
  "don't be upset",
  "you'll be fine",
  "you will be fine",
  "it's not a big deal",
  "it is not a big deal",
  "nothing to worry about",
  "you should have",
  "your fault",
  "this isn't that bad",
  "this is not that bad",
] as const;

const PERSONAL_QUESTION_PHRASES = [
  "are you married",
  "are you single",
  "do you have kids",
  "do you have children",
  "do you have a boyfriend",
  "do you have a girlfriend",
  "how old are you",
  "is that your real name",
  "where are you from",
  "what's your nationality",
] as const;

const CLINICAL_QUESTION_PHRASES = [
  "what brings you",
  "what happened",
  "what are your symptoms",
  "what medications",
  "what medicine",
  "when did it start",
  "when did this start",
  "when did the pain start",
  "when was the last",
  "where does it hurt",
  "where is the pain",
  "can you describe",
  "can you take a deep breath",
  "how long have you",
  "how long has",
  "how is your breathing",
  "any allergies",
  "any medications",
  "any medicine",
  "any fever",
  "any cough",
  "any pain",
  "any shortness of breath",
  "any chest pain",
  "any difficulty breathing",
  "does it hurt",
  "does this hurt",
  "is the pain",
  "what's the pain",
  "what is the pain",
  "on a scale",
  "have you taken",
  "are you taking",
  "do you take",
  "are you allergic",
  "do you have any",
  "did you fall",
  "have you been",
  "has she been",
  "has he been",
  "does she have",
  "does he have",
  "are you having trouble",
  "does your chest",
  "does your throat",
] as const;

const ACKNOWLEDGEMENT_PHRASES = BACKCHANNEL_TOKENS;

/** Single-word vocabulary derived from BACKCHANNEL_TOKENS. */
const BACKCHANNEL_WORDS: ReadonlySet<string> = new Set(
  BACKCHANNEL_TOKENS.flatMap((phrase) => phrase.split(" ")),
);

/**
 * Authored v1 rule set, ordered by priority (first match wins, mirroring
 * EmotionEngine policy ordering in emotion-engine.ts).
 *
 * Order rationale: dismissal outranks empathy so a patronizing
 * "I understand, but calm down" escalates rather than de-escalates. The
 * acknowledgement rule only fires on whole-utterance backchannels, so it never
 * shadows a longer sentence that happens to start with "ok".
 */
export const EMOTION_EVENT_RULES: readonly EmotionEventRule[] = [
  {
    id: "r_dismissive_v1",
    kind: "learner_dismissive",
    anyToken: DISMISSIVE_PHRASES,
  },
  {
    id: "r_empathetic_validation_v1",
    kind: "learner_empathetic",
    anyToken: EMPATHETIC_PHRASES,
    notToken: EMPATHETIC_NOT_PHRASES,
    anyTraceTag: [TRACE_TAG_EMOTION_ACKNOWLEDGED],
  },
  {
    id: "r_personal_question_v1",
    kind: "learner_personal_question",
    anyToken: PERSONAL_QUESTION_PHRASES,
  },
  {
    id: "r_clinical_question_v1",
    kind: "learner_clinical_question",
    anyToken: CLINICAL_QUESTION_PHRASES,
  },
  {
    id: "r_acknowledgement_v1",
    kind: "learner_acknowledgement",
    anyToken: ACKNOWLEDGEMENT_PHRASES,
  },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function ruleAllowsActorRole(
  rule: EmotionEventRule,
  actorRole: string | undefined,
): boolean {
  if (!rule.actorRole || rule.actorRole.length === 0) return true;
  return actorRole !== undefined && rule.actorRole.includes(actorRole);
}

/** Whole-utterance backchannel: short, and every word is backchannel vocabulary. */
function isWholeUtteranceBackchannel(
  rule: EmotionEventRule,
  normalizedText: string,
): boolean {
  if (rule.kind !== "learner_acknowledgement" || normalizedText === "") return false;
  const tokens = normalizedText.split(" ");
  if (tokens.length > 4) return false;
  return tokens.every((token) => BACKCHANNEL_WORDS.has(token));
}

function ruleMatchesText(
  rule: EmotionEventRule,
  normalizedText: string,
): { matched: boolean; phrase: string | null } {
  if (normalizedText === "") return { matched: false, phrase: null };

  if (isWholeUtteranceBackchannel(rule, normalizedText)) {
    return { matched: true, phrase: normalizedText };
  }

  if (!rule.anyToken || rule.anyToken.length === 0) {
    return { matched: false, phrase: null };
  }

  const excludes = (rule.notToken ?? []).some((phrase) =>
    containsPhrase(normalizedText, normalizePhrase(phrase)),
  );
  if (excludes) return { matched: false, phrase: null };

  for (const phrase of rule.anyToken) {
    const normalizedPhrase = normalizePhrase(phrase);
    if (normalizedPhrase && containsPhrase(normalizedText, normalizedPhrase)) {
      return { matched: true, phrase };
    }
  }
  return { matched: false, phrase: null };
}

function ruleMatchesTraceTags(
  rule: EmotionEventRule,
  traceTags: readonly string[] | undefined,
): string | null {
  if (!rule.anyTraceTag || rule.anyTraceTag.length === 0) return null;
  if (!traceTags || traceTags.length === 0) return null;
  for (const tag of rule.anyTraceTag) {
    if (traceTags.includes(tag)) return tag;
  }
  return null;
}

/**
 * Classify one learner event. Pure and deterministic.
 *
 * Priority:
 *   1. machine flags (barge-in, silence timeout) — never read from partial STT;
 *   2. authored allowlist rules in EMOTION_EVENT_RULES order;
 *   3. default `learner_unclassified` (holds current dialogue state).
 */
export function classifyEmotionEventDetailed(
  input: EmotionEventClassifierInput,
  rules: readonly EmotionEventRule[] = EMOTION_EVENT_RULES,
): EmotionEventClassifierVerdict {
  if (input.bargeIn === true) {
    return {
      kind: "learner_interruption",
      source: "machine_flag",
      ruleId: null,
      matchedPhrase: null,
      matchedTraceTag: null,
    };
  }
  if (input.silenceTimeout === true) {
    return {
      kind: "actor_silence_timeout",
      source: "machine_flag",
      ruleId: null,
      matchedPhrase: null,
      matchedTraceTag: null,
    };
  }

  const normalizedText = normalizePhrase(input.text ?? "");

  for (const rule of rules) {
    if (!ruleAllowsActorRole(rule, input.actorRole)) continue;
    const textMatch = ruleMatchesText(rule, normalizedText);
    const traceTagMatch = ruleMatchesTraceTags(rule, input.traceTags);
    const firedFromText = textMatch.matched;
    const firedFromTag = traceTagMatch !== null;
    if (!firedFromText && !firedFromTag) continue;
    return {
      kind: rule.kind,
      source: "rule_match",
      ruleId: rule.id,
      matchedPhrase: firedFromText ? textMatch.phrase : null,
      matchedTraceTag: firedFromTag ? traceTagMatch : null,
    };
  }

  return {
    kind: "learner_unclassified",
    source: "default",
    ruleId: null,
    matchedPhrase: null,
    matchedTraceTag: null,
  };
}

/**
 * Classify one learner event, returning only the kind. Fail-closed default is
 * `learner_unclassified`; `learner_clinical_question` never appears as a
 * default.
 */
export function classifyEmotionEvent(
  input: EmotionEventClassifierInput,
  rules: readonly EmotionEventRule[] = EMOTION_EVENT_RULES,
): EmotionEventKind {
  return classifyEmotionEventDetailed(input, rules).kind;
}
