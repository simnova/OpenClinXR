import { describe, expect, it } from "vitest";
import {
  classifyEmotionEvent,
  classifyEmotionEventDetailed,
  EMOTION_EVENT_RULES,
} from "./emotion-event-classifier.js";

describe("EmotionEventClassifier default (fail-closed)", () => {
  it("defaults unknown learner input to learner_unclassified", () => {
    expect(classifyEmotionEvent({ text: "qqq-not-an-allowlisted-cue" })).toBe(
      "learner_unclassified",
    );
  });

  it("defaults empty and missing transcripts to learner_unclassified", () => {
    expect(classifyEmotionEvent({ text: "" })).toBe("learner_unclassified");
    expect(classifyEmotionEvent({})).toBe("learner_unclassified");
  });

  it("never defaults to learner_clinical_question", () => {
    expect(classifyEmotionEvent({ text: "anything at all" })).not.toBe(
      "learner_clinical_question",
    );
  });

  it("is deterministic: same input produces the same kind", () => {
    const input = { text: "when did the pain start" };
    expect(classifyEmotionEvent(input)).toBe(classifyEmotionEvent(input));
  });
});

describe("EmotionEventClassifier machine flags", () => {
  it("classifies a barge-in flag as learner_interruption before any text rule", () => {
    expect(
      classifyEmotionEvent({ text: "calm down", bargeIn: true }),
    ).toBe("learner_interruption");
  });

  it("classifies a station silence timeout as actor_silence_timeout", () => {
    expect(
      classifyEmotionEvent({ text: "", silenceTimeout: true }),
    ).toBe("actor_silence_timeout");
  });
});

describe("EmotionEventClassifier allowlist rule matches", () => {
  it("matches empathetic validation phrases", () => {
    expect(classifyEmotionEvent({ text: "i understand this is hard" })).toBe(
      "learner_empathetic",
    );
  });

  it("does not match empathetic phrases inside a negation", () => {
    expect(classifyEmotionEvent({ text: "i don't understand why you're upset" })).toBe(
      "learner_unclassified",
    );
  });

  it("matches dismissive / premature-reassurance phrases", () => {
    expect(classifyEmotionEvent({ text: "calm down, it's nothing" })).toBe(
      "learner_dismissive",
    );
  });

  it("ranks dismissal above empathy when a sentence patronizes", () => {
    expect(
      classifyEmotionEvent({ text: "i understand but you need to calm down" }),
    ).toBe("learner_dismissive");
  });

  it("matches authored clinical-question phrases only", () => {
    expect(classifyEmotionEvent({ text: "when did the pain start" })).toBe(
      "learner_clinical_question",
    );
    expect(classifyEmotionEvent({ text: "any allergies or medications" })).toBe(
      "learner_clinical_question",
    );
  });

  it("matches personal identity probes", () => {
    expect(classifyEmotionEvent({ text: "are you married?" })).toBe(
      "learner_personal_question",
    );
  });

  it("classifies a whole-utterance backchannel as acknowledgement", () => {
    expect(classifyEmotionEvent({ text: "mm-hmm" })).toBe("learner_acknowledgement");
    expect(classifyEmotionEvent({ text: "ok, got it" })).toBe("learner_acknowledgement");
  });

  it("does not treat a question starting with ok as a backchannel", () => {
    expect(classifyEmotionEvent({ text: "ok what medications do you take" })).toBe(
      "learner_clinical_question",
    );
  });

  it("fires from an emotion_acknowledged trace tag with no lexical cue", () => {
    expect(
      classifyEmotionEvent({ text: "mmm", traceTags: ["emotion_acknowledged"] }),
    ).toBe("learner_empathetic");
  });

  it("reports the matched rule id for Q4 traces", () => {
    const verdict = classifyEmotionEventDetailed({ text: "calm down" });
    expect(verdict).toEqual({
      kind: "learner_dismissive",
      source: "rule_match",
      ruleId: "r_dismissive_v1",
      matchedPhrase: "calm down",
      matchedTraceTag: null,
    });
  });

  it("is punctuation- and apostrophe-agnostic", () => {
    expect(classifyEmotionEvent({ text: "I’m sorry, that must be scary." })).toBe(
      "learner_empathetic",
    );
    expect(classifyEmotionEvent({ text: "I'm sorry, that must be scary." })).toBe(
      "learner_empathetic",
    );
  });
});

describe("EmotionEventClassifier authored rules", () => {
  it("respects actorRole gating when rules carry one", () => {
    const gated = EMOTION_EVENT_RULES.map((rule) =>
      rule.id === "r_dismissive_v1" ? { ...rule, actorRole: ["family"] } : rule,
    );
    expect(classifyEmotionEvent({ text: "calm down" }, gated)).toBe("learner_unclassified");
    expect(classifyEmotionEvent({ text: "calm down", actorRole: "family" }, gated)).toBe(
      "learner_dismissive",
    );
  });
});
