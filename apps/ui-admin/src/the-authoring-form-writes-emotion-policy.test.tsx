import "@testing-library/jest-dom/vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseAuthoringWorkbench } from "./CaseAuthoringWorkbench.js";
import {
  mergeFormValuesIntoScenario,
  scenarioToFormValues,
} from "./case-authoring-model.js";

/**
 * OBSERVABLE: faculty cannot author scenario.emotionPolicy. ScenarioFormValues has
 * no emotionPolicy. mergeFormValuesIntoScenario preserves it from the imported
 * base (currently undefined on ed_chest_pain_priority_v1). Runtime then falls
 * back to DEFAULT_EMOTION_POLICY (emotion-policy.ts) so every authored case
 * gets anxious-parent affect unless JSON is edited.
 *
 * MEASURED 2026-08-28. CaseEmotionPolicySchema: baseline, upperBound, lowerBound,
 * transitions[]. InteractionEmotionSchema closed set (pain, anxious, concerned,
 * reassured, neutral) already in interactionEmotionOptions. No scenario-fixture
 * currently sets emotionPolicy. World-config writes landed; this is the remaining
 * merge-preserve field that drives runtime affect (Q1 conversation tooling).
 *
 * claimScope: faculty round-trip of emotionPolicy onto scenario.emotionPolicy.
 * notEvidenceFor: clinical affect; scoring; Quest; inventing transition tables.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 *
 * ## FIXED (#0)
 * - `ScenarioFormValues` gains `emotionPolicy`; `scenarioToFormValues` projects
 *   `scenario.emotionPolicy` (transitions cloned) (case-authoring-model.ts).
 * - `mergeFormValuesIntoScenario` writes the form emotionPolicy onto
 *   `scenario.emotionPolicy` when all three bounds are present; transitions come
 *   from the form value or fall back to the imported base's rules (then `[]`,
 *   which CaseEmotionPolicySchema requires). An omitted or incomplete policy is
 *   dropped, preserving the imported base — no invented default
 *   (case-authoring-model.ts).
 * - `CaseAuthoringWorkbench` renders an "Emotion policy" card with baseline /
 *   upper-bound / lower-bound Selects bound to `emotionPolicy.*`, options from
 *   `interactionEmotionOptions` (closed InteractionEmotionSchema set)
 *   (EmotionPolicyPanel.tsx).
 */

const AUTHORED = {
  baseline: "pain" as const,
  upperBound: "anxious" as const,
  lowerBound: "neutral" as const,
  transitions: [],
};

describe("the authoring form writes emotionPolicy", () => {
  beforeAll(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("(1) scenarioToFormValues carries emotionPolicy", () => {
    expect(edChestPainScenario.emotionPolicy).toBeUndefined();
    const values = scenarioToFormValues(edChestPainScenario) as { emotionPolicy?: unknown };
    expect(values).toHaveProperty("emotionPolicy");
  });

  it("(2) mergeFormValuesIntoScenario writes the form emotionPolicy onto the scenario", () => {
    const values = {
      ...scenarioToFormValues(edChestPainScenario),
      emotionPolicy: AUTHORED,
    };
    const merged = mergeFormValuesIntoScenario(
      edChestPainScenario,
      values as ReturnType<typeof scenarioToFormValues>,
    );
    expect(merged.emotionPolicy).toEqual(AUTHORED);
  });

  it(
    "(3) the workbench has an emotion-policy control",
    () => {
      render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
      expect(screen.getByLabelText(/emotion policy/i)).toBeInTheDocument();
    },
    30_000,
  );

  it("(4) COUNTERWEIGHT: merge does not invent a default emotionPolicy when the form omits one", () => {
    const values = scenarioToFormValues(edChestPainScenario);
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, values);
    expect(merged.emotionPolicy).toBeUndefined();
  });

  it("(5) COUNTERWEIGHT: equipment still round-trips", () => {
    const values = scenarioToFormValues(edChestPainScenario);
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, values);
    expect(merged.equipment).toEqual(edChestPainScenario.equipment);
  });
});

// NOT TESTED: transition-rule editor; clinical affect; DEFAULT_EMOTION_POLICY contents.
