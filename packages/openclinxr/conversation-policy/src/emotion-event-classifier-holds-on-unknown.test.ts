/**
 * OBSERVABLE: learner events are not owned by a classifier that defaults unknown
 * input to learner_unclassified. emotion-engine.ts already holds when no rule
 * matches; nothing names that hold as learner_unclassified in a trace.
 *
 * DVA-5 (tsk_41e1ed13f0e69405). Direction:
 * docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md:255-257
 * — unknown → learner_unclassified → hold current dialogue state.
 * learner_clinical_question is authored-rule match only, never the unknown default.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED below.
 *
 * claimScope: deterministic classifier default + mapper returns one plan.
 * notEvidenceFor: clinical validity, empathy scoring, Quest, live STT.
 */
import { describe, expect, it } from "vitest";
import { classifyEmotionEvent } from "./emotion-event-classifier.js";
import { mapEmotionPerformance } from "./emotion-performance-mapper.js";

describe("emotion event classifier holds on unknown", () => {
  it.fails("(1) RED: unknown learner input classifies as learner_unclassified", () => {
    expect(classifyEmotionEvent({ text: "qqq-not-an-allowlisted-cue" })).toBe("learner_unclassified");
  });

  it.fails("(2) RED: mapper emits one performance plan from dialogue+somatic+style+ageBand", () => {
    const plan = mapEmotionPerformance({
      dialogueEmotion: "calm",
      somaticEmotion: "neutral",
      styleFamily: "neutral",
      style: "neutral",
      intensityBucket: "low",
      ageBand: "school_age",
    });
    expect(plan).toEqual(expect.objectContaining({ dialogueEmotion: "calm" }));
    expect(Object.keys(plan).length).toBeGreaterThan(0);
  });
});
