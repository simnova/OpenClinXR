import type { CaseEmotionPolicy } from "@openclinxr/conversation-policy";
import { type Scenario, validateCaseEmotionPolicy } from "@openclinxr/shared-schemas";

/**
 * Actor emotion policy resolution for the scenario runtime (feature: conversation emotion).
 *
 * An authored `Scenario.emotionPolicy` (validated) drives actor affect; otherwise the
 * runtime falls back to DEFAULT_EMOTION_POLICY. Pure behavioral taxonomy — not a clinical
 * assessment or scoring input.
 */

/**
 * Default fallback emotion policy (mirrors anxiousParentPolicy).
 *
 * TODO(opt-in): replace with `import { anxiousParentPolicy } from "@openclinxr/conversation-policy"`
 * once the fixtures subpath is exported from the conversation-policy package.
 */
const DEFAULT_EMOTION_POLICY: CaseEmotionPolicy = {
  baseline: "anxious",
  upperBound: "anxious",
  lowerBound: "reassured",
  transitions: [
    { from: "anxious", triggeredBy: "learner_empathetic", to: "concerned" },
    { from: "anxious", triggeredBy: "learner_acknowledgement", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "concerned", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "reassured", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "reassured", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "neutral", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "neutral", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "reassured", triggeredBy: "learner_dismissive", to: "concerned" },
    { from: "reassured", triggeredBy: "learner_interruption", to: "anxious" },
    { from: "concerned", triggeredBy: "learner_dismissive", to: "anxious" },
    { from: "concerned", triggeredBy: "learner_interruption", to: "anxious" },
    { from: "neutral", triggeredBy: "learner_dismissive", to: "concerned" },
    { from: "neutral", triggeredBy: "learner_interruption", to: "concerned" },
    { from: "anxious", triggeredBy: "learner_dismissive", to: "anxious" },
    { from: "anxious", triggeredBy: "learner_interruption", to: "anxious" },
    { from: "anxious", triggeredBy: "actor_silence_timeout", to: "anxious" },
    { from: "concerned", triggeredBy: "actor_silence_timeout", to: "concerned" },
    { from: "reassured", triggeredBy: "actor_silence_timeout", to: "reassured" },
    { from: "neutral", triggeredBy: "actor_silence_timeout", to: "neutral" },
    { from: "anxious", triggeredBy: "learner_clinical_question", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_clinical_question", to: "concerned" },
    { from: "anxious", triggeredBy: "learner_personal_question", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_personal_question", to: "concerned" },
  ],
};

/**
 * Resolve the CaseEmotionPolicy for a scenario.
 *
 * Reads the typed optional `emotionPolicy` field from the Scenario
 * (validated via ajv-compiled `validateCaseEmotionPolicy`).
 * Falls back to DEFAULT_EMOTION_POLICY (anxious-parent mirror).
 */
export function resolveCaseEmotionPolicy(scenario: Scenario): CaseEmotionPolicy {
  if (scenario.emotionPolicy != null) {
    const result = validateCaseEmotionPolicy(scenario.emotionPolicy);
    if (result.ok) {
      return scenario.emotionPolicy;
    }
  }
  return DEFAULT_EMOTION_POLICY;
}
