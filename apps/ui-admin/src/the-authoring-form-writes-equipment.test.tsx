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
 * OBSERVABLE: faculty cannot edit scenario.equipment. The workbench has no
 * equipment control. ScenarioFormValues has no equipment. mergeFormValuesIntoScenario
 * preserves equipment from the imported base (case-authoring-model.ts:281, 289-305).
 *
 * MEASURED 2026-08-28. ed_chest_pain_priority_v1 equipment is
 * ["12-lead ECG machine", "bedside monitor", "stretcher", "IV pole",
 * "oxygen nasal cannula", "wall clock"]. environmentId authoring landed; equipment
 * is the remaining world-config field called out in the merge preserve list.
 *
 * claimScope: faculty string-list of equipment ids round-trips onto scenario.equipment.
 * notEvidenceFor: 3D placement; fixtureSlots; Quest; clinical inventory completeness.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

describe("the authoring form writes equipment", () => {
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

  it.fails("(1) scenarioToFormValues carries equipment", () => {
    const values = scenarioToFormValues(edChestPainScenario) as { equipment?: string[] };
    expect(edChestPainScenario.equipment).toEqual([
      "12-lead ECG machine",
      "bedside monitor",
      "stretcher",
      "IV pole",
      "oxygen nasal cannula",
      "wall clock",
    ]);
    expect(values.equipment).toEqual(edChestPainScenario.equipment);
  });

  it.fails("(2) mergeFormValuesIntoScenario writes the form equipment onto the scenario", () => {
    const values = {
      ...scenarioToFormValues(edChestPainScenario),
      equipment: ["stretcher"],
    };
    const merged = mergeFormValuesIntoScenario(
      edChestPainScenario,
      values as ReturnType<typeof scenarioToFormValues>,
    );
    expect(merged.equipment).toEqual(["stretcher"]);
  });

  it.fails("(3) the workbench has an equipment list labelled Equipment", () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    expect(screen.getByLabelText(/equipment/i)).toBeInTheDocument();
  });

  it("(4) COUNTERWEIGHT: environmentId still round-trips when equipment is not on the form", () => {
    const values = scenarioToFormValues(edChestPainScenario);
    expect(values.environmentId).toBe(edChestPainScenario.environment?.environmentId);
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, values);
    expect(merged.environment?.environmentId).toBe(edChestPainScenario.environment?.environmentId);
  });
});

// NOT TESTED: 3D placement; fixtureSlots; wallColor/lighting.
