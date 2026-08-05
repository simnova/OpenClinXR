import type { CaseEmotionPolicy } from "../emotion-engine.js";

/**
 * Anxious-parent emotion policy.
 *
 * Models an SP parent (e.g. pediatric asthma scenario) who starts the
 * encounter anxious about their child's condition.
 *
 * Escalation path:  learner dismissive / interruption → anxious ↑
 * De-escalation path: learner empathetic / acknowledgement → concerned → reassured ↓
 * Clinical questions show engagement → slight easing.
 * Silence holds current emotion (parent waits for learner to speak).
 */
export const anxiousParentPolicy: CaseEmotionPolicy = {
  baseline: "anxious",
  upperBound: "anxious",
  lowerBound: "reassured",

  transitions: [
    // ── De-escalation (empathy / acknowledgement) ──
    { from: "anxious", triggeredBy: "learner_empathetic", to: "concerned" },
    { from: "anxious", triggeredBy: "learner_acknowledgement", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "concerned", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "reassured", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "reassured", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "neutral", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "neutral", triggeredBy: "learner_acknowledgement", to: "reassured" },

    // ── Escalation (dismissive / interruption) ──
    { from: "reassured", triggeredBy: "learner_dismissive", to: "concerned" },
    { from: "reassured", triggeredBy: "learner_interruption", to: "anxious" },
    { from: "concerned", triggeredBy: "learner_dismissive", to: "anxious" },
    { from: "concerned", triggeredBy: "learner_interruption", to: "anxious" },
    { from: "neutral", triggeredBy: "learner_dismissive", to: "concerned" },
    { from: "neutral", triggeredBy: "learner_interruption", to: "concerned" },

    // ── Hold at ceiling (already anxious) ──
    { from: "anxious", triggeredBy: "learner_dismissive", to: "anxious" },
    { from: "anxious", triggeredBy: "learner_interruption", to: "anxious" },

    // ── Silence: hold current ──
    { from: "anxious", triggeredBy: "actor_silence_timeout", to: "anxious" },
    { from: "concerned", triggeredBy: "actor_silence_timeout", to: "concerned" },
    { from: "reassured", triggeredBy: "actor_silence_timeout", to: "reassured" },
    { from: "neutral", triggeredBy: "actor_silence_timeout", to: "neutral" },

    // ── Clinical / personal questions → slight engagement ──
    { from: "anxious", triggeredBy: "learner_clinical_question", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_clinical_question", to: "concerned" },
    { from: "anxious", triggeredBy: "learner_personal_question", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_personal_question", to: "concerned" },
  ],
};

/**
 * Neutral-patient emotion policy.
 *
 * Models a patient who starts calm and only escalates on clear negative
 * triggers, or de-escalates with empathy. Simpler transition map than the
 * anxious parent — a baseline comparator for engine correctness.
 */
export const neutralPatientPolicy: CaseEmotionPolicy = {
  baseline: "neutral",
  upperBound: "anxious",
  lowerBound: "reassured",

  transitions: [
    // ── De-escalation ──
    { from: "concerned", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "concerned", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "neutral", triggeredBy: "learner_empathetic", to: "reassured" },
    { from: "neutral", triggeredBy: "learner_acknowledgement", to: "reassured" },
    { from: "reassured", triggeredBy: "learner_empathetic", to: "reassured" },

    // ── Escalation ──
    { from: "neutral", triggeredBy: "learner_dismissive", to: "concerned" },
    { from: "concerned", triggeredBy: "learner_dismissive", to: "anxious" },
    { from: "neutral", triggeredBy: "learner_interruption", to: "anxious" },
    { from: "concerned", triggeredBy: "learner_interruption", to: "anxious" },
    { from: "reassured", triggeredBy: "learner_dismissive", to: "concerned" },
    { from: "anxious", triggeredBy: "learner_dismissive", to: "anxious" },

    // ── Silence: hold ──
    { from: "anxious", triggeredBy: "actor_silence_timeout", to: "anxious" },
    { from: "concerned", triggeredBy: "actor_silence_timeout", to: "concerned" },
    { from: "neutral", triggeredBy: "actor_silence_timeout", to: "neutral" },
    { from: "reassured", triggeredBy: "actor_silence_timeout", to: "reassured" },
  ],
};
