import { describe, expect, it } from "vitest";
import * as sharedSchemas from "./index.js";
import { validateCaseEmotionPolicy } from "./index.js";

/**
 * OBSERVABLE: CaseEmotionPolicy.transitions[].to still accepts InteractionEmotion
 * "pain", so a dialogue transition can legally be pain. ActorTurnPlanSchema is
 * not exported. Direction 2026-09-02: DialogueEmotion cannot be pain; pain is
 * SomaticEmotion only. emotion-engine.ts:81 already omits pain from
 * DIALOGUE_EMOTION_ORDER; the schema does not.
 *
 * MEASURED 2026-09-02. validateCaseEmotionPolicy({ to: "pain" }).ok === true.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (DVA-1)
 * DialogueEmotionSchema excludes pain. CaseEmotionPolicy transitions use
 * DialogueEmotion. ActorTurnPlanSchema is exported.
 */

const DIALOGUE_PAIN_POLICY = {
  baseline: "neutral",
  upperBound: "anxious",
  lowerBound: "reassured",
  transitions: [
    { from: "neutral", triggeredBy: "learner_dismissive", to: "pain" },
  ],
};

describe("actor turn plan forbids dialogue pain", () => {
  it("(0) COUNTERWEIGHT: a dialogue transition to anxious still validates", () => {
    expect(
      validateCaseEmotionPolicy({
        baseline: "neutral",
        upperBound: "anxious",
        lowerBound: "reassured",
        transitions: [{ from: "neutral", triggeredBy: "learner_dismissive", to: "anxious" }],
      }).ok,
    ).toBe(true);
  });

  it("(1) CaseEmotionPolicy rejects a dialogue transition whose to is pain", () => {
    const result = validateCaseEmotionPolicy(DIALOGUE_PAIN_POLICY);
    expect(result.ok, "dialogue to=pain must be unrepresentable").toBe(false);
  });

  it("(2) ActorTurnPlanSchema is exported from shared-schemas", () => {
    expect(
      (sharedSchemas as Record<string, unknown>)["ActorTurnPlanSchema"],
      "ActorTurnPlanSchema missing — dialogue and somatic still share InteractionEmotion",
    ).toBeDefined();
  });
});
