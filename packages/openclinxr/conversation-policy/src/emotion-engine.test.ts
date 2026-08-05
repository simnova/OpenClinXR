import { describe, expect, it } from "vitest";
import {
  EmotionEngine,
  resolveEmotionTransition,
  type CaseEmotionPolicy,
  type EmotionEvent,
  type EmotionEventKind,
} from "./emotion-engine.js";
import { anxiousParentPolicy, neutralPatientPolicy } from "./fixtures/emotion-policies.js";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const empathetic: EmotionEvent = { kind: "learner_empathetic" };
const dismissive: EmotionEvent = { kind: "learner_dismissive" };
const interruption: EmotionEvent = { kind: "learner_interruption" };
const silence: EmotionEvent = { kind: "actor_silence_timeout" };
const acknowledgement: EmotionEvent = { kind: "learner_acknowledgement" };
const clinicalQ: EmotionEvent = { kind: "learner_clinical_question" };
const personalQ: EmotionEvent = { kind: "learner_personal_question" };

// ---------------------------------------------------------------------------
// resolveEmotionTransition (pure function)
// ---------------------------------------------------------------------------

describe("resolveEmotionTransition", () => {
  // ── De-escalation ──

  it("de-escalates anxious → concerned on empathetic (anxious parent policy)", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "anxious",
      event: empathetic,
      casePolicy: anxiousParentPolicy,
      turnIndex: 1,
    });
    expect(result).toEqual({
      from: "anxious",
      to: "concerned",
      trigger: "learner_empathetic",
      changed: true,
      turnIndex: 1,
    });
  });

  it("de-escalates concerned → reassured on acknowledgement (anxious parent)", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "concerned",
      event: acknowledgement,
      casePolicy: anxiousParentPolicy,
      turnIndex: 3,
    });
    expect(result).toEqual({
      from: "concerned",
      to: "reassured",
      trigger: "learner_acknowledgement",
      changed: true,
      turnIndex: 3,
    });
  });

  // ── Escalation ──

  it("escalates concerned → anxious on dismissive (anxious parent)", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "concerned",
      event: dismissive,
      casePolicy: anxiousParentPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("anxious");
    expect(result.changed).toBe(true);
  });

  it("escalates reassured → anxious on interruption (anxious parent)", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "reassured",
      event: interruption,
      casePolicy: anxiousParentPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("anxious");
    expect(result.changed).toBe(true);
  });

  it("neutral → anxious on interruption (neutral patient policy)", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "neutral",
      event: interruption,
      casePolicy: neutralPatientPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("anxious"); // neutralPatientPolicy jumps straight to anxious on interruption
    expect(result.changed).toBe(true);
  });

  // ── Bounds clamping ──

  it("clamps at upper bound: anxious stays anxious on dismissive", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "anxious",
      event: dismissive,
      casePolicy: anxiousParentPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("anxious");
    expect(result.changed).toBe(false); // holding
  });

  it("clamps at lower bound: reassured stays reassured on empathetic", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "reassured",
      event: empathetic,
      casePolicy: anxiousParentPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("reassured");
    expect(result.changed).toBe(false);
  });

  it("clamps to upper bound when current exceeds ceiling", () => {
    // Custom policy with tight upper bound: concerned is ceiling.
    // anxious rank (0) < concerned rank (1) → clamp to upperBound "concerned".
    const tightPolicy: CaseEmotionPolicy = {
      baseline: "anxious",
      upperBound: "concerned",
      lowerBound: "reassured",
      transitions: [],
    };
    const result = resolveEmotionTransition({
      currentEmotion: "anxious",
      event: empathetic,
      casePolicy: tightPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("concerned");
    expect(result.changed).toBe(true);
  });

  // ── Hold / no-change ──

  it("holds emotion when no rule matches (unmapped event kind)", () => {
    // neutral + personalQ has no rule in neutralPatientPolicy
    const result = resolveEmotionTransition({
      currentEmotion: "anxious",
      event: personalQ,
      casePolicy: neutralPatientPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("anxious");
    expect(result.changed).toBe(false);
    expect(result.trigger).toBe("learner_personal_question");
  });

  it("holds emotion on silence timeout (anxious parent)", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "concerned",
      event: silence,
      casePolicy: anxiousParentPolicy,
      turnIndex: undefined,
    });
    expect(result.to).toBe("concerned");
    expect(result.changed).toBe(false);
  });

  // ── Determinism ──

  it("is deterministic: same input → same output (5 calls)", () => {
    const input = {
      currentEmotion: "concerned" as const,
      event: dismissive,
      casePolicy: anxiousParentPolicy,
      turnIndex: 2,
    };
    const first = resolveEmotionTransition(input);
    for (let i = 0; i < 5; i++) {
      expect(resolveEmotionTransition(input)).toEqual(first);
    }
  });

  // ── Trigger → emotion mapping ──

  it.each([
    ["learner_empathetic", "anxious", "concerned"],
    ["learner_acknowledgement", "anxious", "concerned"],
    ["learner_dismissive", "concerned", "anxious"],
    ["learner_interruption", "reassured", "anxious"],
    ["learner_clinical_question", "anxious", "concerned"],
    ["learner_personal_question", "anxious", "concerned"],
  ] as const)(
    "%s maps %s → %s (anxious parent policy)",
    (trigger, from, to) => {
      const result = resolveEmotionTransition({
        currentEmotion: from,
        event: { kind: trigger },
        casePolicy: anxiousParentPolicy,
        turnIndex: undefined,
      });
      expect(result.from).toBe(from);
      expect(result.to).toBe(to);
      expect(result.trigger).toBe(trigger);
    },
  );

  // ── All event kinds are recognized ──

  it("does not throw for any event kind", () => {
    const kinds: EmotionEventKind[] = [
      "learner_empathetic",
      "learner_dismissive",
      "learner_interruption",
      "actor_silence_timeout",
      "learner_acknowledgement",
      "learner_clinical_question",
      "learner_personal_question",
    ];
    for (const kind of kinds) {
      expect(() =>
        resolveEmotionTransition({
          currentEmotion: "neutral",
          event: { kind },
          casePolicy: anxiousParentPolicy,
          turnIndex: undefined,
        }),
      ).not.toThrow();
    }
  });

  // ── Turn index passthrough ──

  it("passes turnIndex through to output unchanged", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "neutral",
      event: empathetic,
      casePolicy: anxiousParentPolicy,
      turnIndex: 7,
    });
    expect(result.turnIndex).toBe(7);
  });

  it("turnIndex is undefined when not provided", () => {
    const result = resolveEmotionTransition({
      currentEmotion: "neutral",
      event: empathetic,
      casePolicy: anxiousParentPolicy,
      turnIndex: undefined,
    });
    expect(result.turnIndex).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EmotionEngine (stateful)
// ---------------------------------------------------------------------------

describe("EmotionEngine", () => {
  it("initializes with the given emotion", () => {
    const engine = new EmotionEngine("anxious");
    expect(engine.currentEmotion).toBe("anxious");
  });

  it("tracks a multi-turn de-escalation sequence: anxious → concerned → reassured", () => {
    const engine = new EmotionEngine(anxiousParentPolicy.baseline);

    const t1 = engine.transition(empathetic, anxiousParentPolicy, 1);
    expect(t1).toMatchObject({ from: "anxious", to: "concerned", changed: true });
    expect(engine.currentEmotion).toBe("concerned");

    const t2 = engine.transition(acknowledgement, anxiousParentPolicy, 2);
    expect(t2).toMatchObject({ from: "concerned", to: "reassured", changed: true });
    expect(engine.currentEmotion).toBe("reassured");
  });

  it("tracks a multi-turn escalation sequence: reassured → concerned → anxious", () => {
    const engine = new EmotionEngine("reassured");

    const t1 = engine.transition(dismissive, anxiousParentPolicy, 1);
    expect(t1).toMatchObject({ from: "reassured", to: "concerned", changed: true });

    const t2 = engine.transition(dismissive, anxiousParentPolicy, 2);
    expect(t2).toMatchObject({ from: "concerned", to: "anxious", changed: true });
    expect(engine.currentEmotion).toBe("anxious");
  });

  it("tracks a full round-trip: anxious → concerned → reassured → concerned → anxious", () => {
    const engine = new EmotionEngine("anxious");

    engine.transition(empathetic, anxiousParentPolicy, 1); // → concerned
    expect(engine.currentEmotion).toBe("concerned");

    engine.transition(acknowledgement, anxiousParentPolicy, 2); // → reassured
    expect(engine.currentEmotion).toBe("reassured");

    engine.transition(dismissive, anxiousParentPolicy, 3); // → concerned
    expect(engine.currentEmotion).toBe("concerned");

    engine.transition(interruption, anxiousParentPolicy, 4); // → anxious
    expect(engine.currentEmotion).toBe("anxious");
  });

  it("reset() sets a new current emotion", () => {
    const engine = new EmotionEngine("anxious");
    engine.transition(empathetic, anxiousParentPolicy, 1);
    expect(engine.currentEmotion).toBe("concerned");

    engine.reset("neutral");
    expect(engine.currentEmotion).toBe("neutral");
  });

  it("holds at ceiling across multiple escalation events", () => {
    const engine = new EmotionEngine("anxious");
    engine.transition(dismissive, anxiousParentPolicy, 1);
    engine.transition(interruption, anxiousParentPolicy, 2);
    engine.transition(dismissive, anxiousParentPolicy, 3);
    expect(engine.currentEmotion).toBe("anxious"); // never beyond anxious
  });

  it("switches between policies correctly (reset + new policy)", () => {
    const engine = new EmotionEngine("anxious");

    // Under anxious parent, empathetic moves anxious → concerned
    engine.transition(empathetic, anxiousParentPolicy, 1);
    expect(engine.currentEmotion).toBe("concerned");

    // Reset and use neutral patient policy
    engine.reset("concerned");
    // Under neutral patient, interruption from concerned → anxious
    engine.transition(interruption, neutralPatientPolicy, 2);
    expect(engine.currentEmotion).toBe("anxious");
  });

  it("produces changed=false when holding at bounds", () => {
    const engine = new EmotionEngine("reassured");
    const result = engine.transition(empathetic, anxiousParentPolicy, 1);
    expect(result.changed).toBe(false);
    expect(result.from).toBe("reassured");
    expect(result.to).toBe("reassured");
  });
});
