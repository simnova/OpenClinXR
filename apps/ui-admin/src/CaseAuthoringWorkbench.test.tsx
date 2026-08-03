import "@testing-library/jest-dom/vitest";
import { findUnsafeClaimLanguage } from "@openclinxr/domain/claim-language";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { validateScenario } from "@openclinxr/shared-schemas";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseAuthoringWorkbench } from "./CaseAuthoringWorkbench.js";
import { parseScenarioJson } from "./case-authoring-model.js";

describe("CaseAuthoringWorkbench", () => {
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
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the authoring surface with a safe claim boundary and empty-draft validity", () => {
    render(<CaseAuthoringWorkbench />);

    expect(screen.getByRole("heading", { name: "Encounter Case Authoring" })).toBeInTheDocument();
    expect(screen.getByLabelText("Authoring claim boundary")).toHaveTextContent("clinical_validity");
    expect(screen.getByLabelText("Authoring claim boundary")).toHaveTextContent("learner_readiness");
    expect(screen.getByLabelText("Case validation status")).toHaveTextContent("valid against ScenarioSchema");

    const region = screen.getByLabelText("Encounter case authoring");
    expect(findUnsafeClaimLanguage(region.textContent ?? "")).toEqual([]);
  });

  it("exports the initial case as scenario-bank-shaped JSON that re-validates", () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);

    const exportField = screen.getByLabelText<HTMLTextAreaElement>("Exported scenario JSON");
    const parsed = parseScenarioJson(exportField.value);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.scenario.scenarioId).toBe("ed_chest_pain_priority_v1");
      expect(validateScenario(parsed.scenario)).toEqual({ ok: true });
    }
  });

  it("edits the title and reflects it in the exported JSON", () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);

    const titleInput = screen.getByLabelText<HTMLInputElement>("Case title");
    fireEvent.change(titleInput, { target: { value: "Edited Title In UI" } });

    const exportField = screen.getByLabelText<HTMLTextAreaElement>("Exported scenario JSON");
    const parsed = parseScenarioJson(exportField.value);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.scenario.title).toBe("Edited Title In UI");
      expect(validateScenario(parsed.scenario)).toEqual({ ok: true });
    }
  });

  it("surfaces authored touch-response trace tags for review", () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);
    const tagRegion = screen.getByLabelText("Touch response trace tags");
    expect(within(tagRegion).getByText("clinical_touch_guard_rlq")).toBeInTheDocument();
  });
});
