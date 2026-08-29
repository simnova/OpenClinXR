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
 * OBSERVABLE: Encounter environment panel lists floor/wall hex and fixtureSlots,
 * but not the selected shell's lighting facts (ambientHemisphereSky,
 * ambientHemisphereGround, keyLightIntensity) from ENVIRONMENT_SHELL_DESCRIPTORS.
 *
 * MEASURED 2026-08-28. ed_exam_bay_v1: sky 0xf4f0dc, ground 0x223042,
 * keyLightIntensity 2.5. Panel after tsk_81a4 shows wall #f1f5f9 and six slotIds.
 * No sky/ground hex, no key intensity. Residual of environmentId plant NOT TESTED
 * "writing wallColor/lighting" — this hop is READ-ONLY listing, not a Scenario write.
 *
 * claimScope: read-only listing of descriptor lighting for the selected environmentId.
 * notEvidenceFor: writing lighting onto Scenario; STATION_INTERIOR_LIGHTING_VARIANT_IDS
 * pick; 3D preview; Quest; clinical lighting correctness.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

describe("the authoring form lists shell lighting", () => {
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

  it.fails("(1) Encounter environment panel shows ed_exam_bay_v1 lighting facts", () => {
    const shell = ENVIRONMENT_SHELL_DESCRIPTORS["ed_exam_bay_v1"];
    expect(shell).toBeDefined();
    if (shell == null) throw new Error("ed_exam_bay_v1 descriptor missing");
    expect(shell.ambientHemisphereSky).toBe(0xf4f0dc);
    expect(shell.ambientHemisphereGround).toBe(0x223042);
    expect(shell.keyLightIntensity).toBe(2.5);
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    const panel = screen.getByLabelText("Encounter environment");
    const lighting = within(panel).getByLabelText("Shell lighting");
    const sky = `#${shell.ambientHemisphereSky.toString(16).padStart(6, "0")}`;
    const ground = `#${shell.ambientHemisphereGround.toString(16).padStart(6, "0")}`;
    expect(within(lighting).getByText(new RegExp(`sky\\s+${sky}`, "i"))).toBeInTheDocument();
    expect(within(lighting).getByText(new RegExp(`ground\\s+${ground}`, "i"))).toBeInTheDocument();
    expect(within(lighting).getByText(/key\s+2\.5/i)).toBeInTheDocument();
  });

  it("(2) COUNTERWEIGHT: merge still does not write lighting onto Scenario.environment", () => {
    const merged = mergeFormValuesIntoScenario(
      edChestPainScenario,
      scenarioToFormValues(edChestPainScenario),
    );
    expect(merged.environment).not.toHaveProperty("keyLightIntensity");
    expect(merged.environment).not.toHaveProperty("ambientHemisphereSky");
    expect(merged.environment).not.toHaveProperty("ambientHemisphereGround");
  });

  it("(3) COUNTERWEIGHT: fixtureSlots list from tsk_81a4 stays present", () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    const panel = screen.getByLabelText("Encounter environment");
    expect(within(panel).getByLabelText("Fixture slots")).toBeInTheDocument();
  });
});

// NOT TESTED: 3D preview; writing lighting onto Scenario; interior lighting variant pick.
