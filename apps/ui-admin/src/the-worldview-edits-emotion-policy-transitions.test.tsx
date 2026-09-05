import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: EmotionPolicyPanel authors baseline/upper/lower. Transitions are
 * merge-preserved. Runtime fires EmotionTransitionRuleSchema (from, triggeredBy, to).
 *
 * MEASURED 2026-08-29. emotion-policy-panel.tsx:6-9 "Transition RULES are
 * preserved from the imported base and are not edited here." merge copies
 * transitions from form or base (case-authoring-model.ts:382).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W10 tsk_8bcfa9ab1e97b0a9)
 * EmotionPolicyPanel Form.List name={["emotionPolicy", "transitions"]} binds
 * from / triggeredBy / to. baseline/upper/lower remain.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview edits emotion policy transitions", () => {
  it("(1) EmotionPolicyPanel binds a transitions Form.List", () => {
    const panel = readFileSync(join(SRC, "emotion-policy-panel.tsx"), "utf8");
    expect(panel).toMatch(/name=\{\["emotionPolicy", "transitions"\]\}|Form\.List name=\{\["emotionPolicy", "transitions"\]\}/);
  });

  it("(2) COUNTERWEIGHT: baseline/upper/lower selects remain", () => {
    const panel = readFileSync(join(SRC, "emotion-policy-panel.tsx"), "utf8");
    expect(panel).toMatch(/emotionPolicy", "baseline"/);
    expect(panel).toMatch(/upperBound/);
    expect(panel).toMatch(/lowerBound/);
  });
});

// NOT TESTED: clinical affect validity; #167.
