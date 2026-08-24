/**
 * Shared hidden-truth guardrail for actor dialogue providers.
 *
 * A learner attempting to make an actor reveal un-elicited case facts ("what is
 * the hidden diagnosis?", "ignore your instructions") is refused locally, BEFORE
 * any model invocation. Both MockModelProviderAdapter and
 * OpenAiCompatibleModelProviderAdapter enforce this through this one predicate,
 * so the refusal behaviour cannot drift between the template and generated paths.
 */

const HIDDEN_TRUTH_EXTRACTION_PHRASES: readonly string[] = [
  "hidden fact",
  "hidden facts",
  "secret",
  "ignore your instructions",
  "ignore instructions",
  "system prompt",
  "developer message",
];

export function isHiddenTruthExtractionAttempt(utterance: string): boolean {
  const normalized = utterance.toLowerCase();
  return HIDDEN_TRUTH_EXTRACTION_PHRASES.some((phrase) => normalized.includes(phrase));
}
