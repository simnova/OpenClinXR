import "@testing-library/jest-dom/vitest";
import { ENVIRONMENT_SHELL_DESCRIPTORS } from "@openclinxr/asset-registry";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseAuthoringWorkbench } from "./CaseAuthoringWorkbench.js";
import {
  mergeFormValuesIntoScenario,
  scenarioToFormValues,
} from "./case-authoring-model.js";

/**
 * OBSERVABLE: faculty cannot change which room a case uses. The encounter-environment
 * panel is read-only. ScenarioFormValues has no environmentId. mergeFormValuesIntoScenario
 * copies environment from the imported base and never writes a form value
 * (case-authoring-model.ts:262-276).
 *
 * MEASURED 2026-08-28. ENVIRONMENT_SHELL_DESCRIPTORS has 14 registered shells. The #69
 * panel shows displayName/width/depth/height/floor for the loaded id. Changing rooms
 * still requires editing JSON. World/config for the factory spatial-zone plan is not
 * authored on this surface.
 *
 * claimScope: faculty Select of a registered environmentId round-trips onto
 * scenario.environment.environmentId; EncounterEnvironmentPanel facts follow the new id.
 * notEvidenceFor: 3D preview; clinical room realism; Quest; exam equivalence.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

describe("the authoring form writes environmentId", () => {
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

  it.fails("(1) scenarioToFormValues carries environmentId", () => {
    const values = scenarioToFormValues(edChestPainScenario) as { environmentId?: string };
    expect(edChestPainScenario.environment?.environmentId).toBeTruthy();
    expect(values.environmentId).toBe(edChestPainScenario.environment?.environmentId);
  });

  it.fails("(2) mergeFormValuesIntoScenario writes the form environmentId onto the scenario", () => {
    const values = {
      ...scenarioToFormValues(edChestPainScenario),
      environmentId: "telehealth_home_visit_v1",
    };
    const merged = mergeFormValuesIntoScenario(
      edChestPainScenario,
      values as ReturnType<typeof scenarioToFormValues>,
    );
    expect(merged.environment?.environmentId).toBe("telehealth_home_visit_v1");
  });

  it.fails("(3) the Encounter environment panel has an environmentId combobox", () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    const panel = screen.getByLabelText("Encounter environment");
    expect(within(panel).getByRole("combobox", { name: /environment/i })).toBeInTheDocument();
  });

  it("(4) COUNTERWEIGHT: fourteen registered shells stay the option source", () => {
    expect(Object.keys(ENVIRONMENT_SHELL_DESCRIPTORS)).toHaveLength(14);
    expect(ENVIRONMENT_SHELL_DESCRIPTORS["ed_exam_bay_v1"]).toBeDefined();
    expect(ENVIRONMENT_SHELL_DESCRIPTORS["telehealth_home_visit_v1"]).toBeDefined();
  });

  it("(5) COUNTERWEIGHT: merge still preserves equipment from the imported base", () => {
    const values = scenarioToFormValues(edChestPainScenario);
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, values);
    expect(merged.equipment).toEqual(edChestPainScenario.equipment);
  });
});

// NOT TESTED: 3D room preview; writing wallColor/lighting; equipment authoring.
