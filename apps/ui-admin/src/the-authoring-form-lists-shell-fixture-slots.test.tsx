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
 * OBSERVABLE: faculty can pick environmentId and see width/depth/height/floor, but
 * the Encounter environment panel does not list the selected shell's fixtureSlots
 * or wallColor. Those live on ENVIRONMENT_SHELL_DESCRIPTORS and drive runtime
 * placement (`station-environment.ts`) and factory spatial-zone plans.
 *
 * MEASURED 2026-08-28. ed_chest_pain_priority_v1 → ed_exam_bay_v1.
 * Descriptor wallColor 0xf1f5f9. Fixture slotIds: stretcher, monitor, ecg_cart,
 * door_leaf, wall_board, learner_start (6). Panel text today: Room name,
 * environmentId, width/depth/height, floor #59636b. No slotId, no wall hex.
 * environmentId/equipment/assetNeeds write hops landed; this is the remaining
 * world-config residual named in the environmentId plant NOT TESTED line
 * (wallColor) plus fixtureSlots (equipment plant notEvidenceFor).
 *
 * claimScope: read-only listing of descriptor fixtureSlots + wallColor for the
 * selected environmentId. notEvidenceFor: writing wallColor onto Scenario;
 * 3D preview; lighting knobs; Quest; clinical room realism.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 *
 * ## FIXED (#0)
 * EncounterEnvironmentPanel now lists the selected shell's fixtureSlots (each slotId as its
 * own list item under aria-label="Fixture slots") and the wallColor hex (wall #f1f5f9 for
 * ed_exam_bay_v1) beside the existing floor hex. Read-only listing — wallColor/fixtureSlots
 * are still not written onto Scenario.environment (counterweights (3)/(4) stay green).
 */

describe("the authoring form lists shell fixtureSlots and wallColor", () => {
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

  it("(1) Encounter environment panel lists every ed_exam_bay_v1 fixture slotId", () => {
    const shell = ENVIRONMENT_SHELL_DESCRIPTORS["ed_exam_bay_v1"];
    expect(shell).toBeDefined();
    if (shell == null) throw new Error("ed_exam_bay_v1 descriptor missing");
    const slots = shell.fixtureSlots;
    expect(slots.map((s) => s.slotId)).toEqual([
      "stretcher",
      "monitor",
      "ecg_cart",
      "door_leaf",
      "wall_board",
      "learner_start",
    ]);
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    const panel = screen.getByLabelText("Encounter environment");
    const list = within(panel).getByLabelText("Fixture slots");
    for (const slot of slots) {
      expect(within(list).getByText(slot.slotId, { exact: true })).toBeInTheDocument();
    }
  });

  it("(2) Encounter environment panel shows the selected shell wallColor hex", () => {
    const shell = ENVIRONMENT_SHELL_DESCRIPTORS["ed_exam_bay_v1"];
    expect(shell).toBeDefined();
    if (shell == null) throw new Error("ed_exam_bay_v1 descriptor missing");
    const wallColor = shell.wallColor;
    expect(wallColor).toBe(0xf1f5f9);
    const hex = `#${wallColor.toString(16).padStart(6, "0")}`;
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    const panel = screen.getByLabelText("Encounter environment");
    expect(within(panel).getByText(new RegExp(`wall\\s+${hex}`, "i"))).toBeInTheDocument();
  });

  it("(3) COUNTERWEIGHT: merge still does not write wallColor onto Scenario.environment", () => {
    const merged = mergeFormValuesIntoScenario(
      edChestPainScenario,
      scenarioToFormValues(edChestPainScenario),
    );
    expect(merged.environment).toEqual({
      environmentId: "ed_exam_bay_v1",
      name: "Emergency Department Exam Bay",
      description: expect.any(String),
    });
    expect(merged.environment).not.toHaveProperty("wallColor");
    expect(merged.environment).not.toHaveProperty("fixtureSlots");
  });

  it("(4) COUNTERWEIGHT: fourteen registered shells stay the option source", () => {
    expect(Object.keys(ENVIRONMENT_SHELL_DESCRIPTORS)).toHaveLength(14);
  });
});

// NOT TESTED: 3D room preview; writing wallColor/lighting onto Scenario; fixture placement edits.
