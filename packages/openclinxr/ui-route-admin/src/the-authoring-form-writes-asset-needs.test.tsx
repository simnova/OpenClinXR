import "@testing-library/jest-dom/vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseAuthoringWorkbench } from "./case-authoring-workbench.js";
import {
  mergeFormValuesIntoScenario,
  scenarioToFormValues,
} from "./case-authoring-model.js";

/**
 * OBSERVABLE: faculty cannot edit scenario.assetNeeds. The workbench has no
 * asset-needs control. ScenarioFormValues has no assetNeeds. mergeFormValuesIntoScenario
 * preserves asset needs from the imported base (case-authoring-model.ts:283-304).
 *
 * MEASURED 2026-08-28. ed_chest_pain_priority_v1 has 6+ assetNeeds rows (character,
 * environment, equipment) with assetId, assetType, description, licenseStatus.
 * environmentId and equipment authoring landed; assetNeeds is the remaining
 * world-config field named in the merge preserve list.
 *
 * claimScope: faculty round-trip of assetNeeds[] onto scenario.assetNeeds.
 * notEvidenceFor: 3D placement; Quest; license validity; clinical completeness.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 *
 * ## FIXED (#0)
 * - `ScenarioFormValues` gains `assetNeeds`; `scenarioToFormValues` projects
 *   `scenario.assetNeeds` (case-authoring-model.ts).
 * - `mergeFormValuesIntoScenario` writes the form assetNeeds onto
 *   `scenario.assetNeeds`, trimmed with incomplete rows dropped (every
 *   AssetNeedSchema field requires a minLength-1 string); unchanged round-trips
 *   stay lossless (case-authoring-model.ts).
 * - `CaseAuthoringWorkbench` renders an "Asset needs" card with a row-based
 *   editor (assetId / assetType enum Select / description / licenseStatus) bound
 *   to the form `assetNeeds` field (asset-needs-panel.tsx).
 */

describe("the authoring form writes assetNeeds", () => {
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

  it("(1) scenarioToFormValues carries assetNeeds", () => {
    const values = scenarioToFormValues(edChestPainScenario) as {
      assetNeeds?: typeof edChestPainScenario.assetNeeds;
    };
    expect(edChestPainScenario.assetNeeds?.length).toBeGreaterThanOrEqual(6);
    expect(values.assetNeeds).toEqual(edChestPainScenario.assetNeeds);
  });

  it("(2) mergeFormValuesIntoScenario writes the form assetNeeds onto the scenario", () => {
    const one = (edChestPainScenario.assetNeeds ?? []).slice(0, 1);
    const values = {
      ...scenarioToFormValues(edChestPainScenario),
      assetNeeds: one,
    };
    const merged = mergeFormValuesIntoScenario(
      edChestPainScenario,
      values as ReturnType<typeof scenarioToFormValues>,
    );
    expect(merged.assetNeeds).toEqual(one);
  });

  it("(3) the workbench has an asset-needs control labelled Asset needs", () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    expect(screen.getByLabelText(/asset needs/i)).toBeInTheDocument();
  });

  it("(4) COUNTERWEIGHT: equipment still round-trips when assetNeeds is not on the form", () => {
    const values = scenarioToFormValues(edChestPainScenario);
    expect(values.equipment).toEqual(edChestPainScenario.equipment);
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, values);
    expect(merged.equipment).toEqual(edChestPainScenario.equipment);
  });
});

// NOT TESTED: 3D placement; license-status enum; Quest.
