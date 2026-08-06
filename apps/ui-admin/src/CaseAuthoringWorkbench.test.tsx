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

  /**
   * PLANTED CONTRACT (#69) — a case author picks a room and is never shown one.
   *
   * THE SINGLE `it.fails` BELOW FLIPS. Every other test in this file is LIVE and must keep passing.
   * This comment is THE RECORD, not scratch — flip it, append a `## FIXED (#69)` note, and leave the
   * measurement intact.
   *
   * MEASURED: `grep -n "environment" apps/ui-admin/src/CaseAuthoringWorkbench.tsx` returns NOTHING.
   * The workbench edits a scenario whose `environment.environmentId` is a required schema field
   * (`shared-schemas/src/schemas.ts:218`) and never surfaces it, so an author choosing
   * `behavioral_health_private_room_v1` over `oncology_consult_room_v1` is choosing between two
   * strings.
   *
   * #44 made that field real: it now resolves to a shell descriptor
   * (`asset-registry/src/environment-descriptors.ts`) that drives both the runtime room and the
   * factory's spatial-zone plan. Fourteen shipped environments have their own dimensions and floor
   * colour. None of that reaches the person authoring the case.
   *
   * WHAT THIS IS NOT: a 3D preview. Rendering the room in the admin app is a much larger slice and is
   * NOT what this contract asks for. Shell FACTS — which room, how big, what it looks like in
   * summary — are enough for an author to tell two settings apart, and they are what the descriptor
   * already carries.
   *
   * THE CONTRACT PULLS BOTH WAYS. It requires the ED bay's real dimensions to appear for the ED
   * scenario, so a hardcoded panel fails; and it requires them to CHANGE when the environment does,
   * so a static "Environment: <id>" label fails too. Together they require the descriptor to be read.
   *
   * SIGNATURE IS THE IMPLEMENTER'S CHOICE — where the panel lives, what it is labelled, and whether
   * it reads the descriptor directly or through a helper. What must not change: the author sees
   * facts about the room, and the facts follow the environment.
   *
   * SCOPE: the authoring surface. The runtime capture half of #69 is contracted separately in
   * `tools/openclinxr/evidence/ui-xr-environment-room-capture.test.ts`; both are required and neither
   * closes the issue alone.
   *
   * ## FIXED (#69)
   * - `CaseAuthoringWorkbench` renders an "Encounter environment" panel (aria-label) driven by
   *   `baseDraft.environment.environmentId` + `ENVIRONMENT_SHELL_DESCRIPTORS` (displayName, width,
   *   depth, height, floor colour). Facts change when the loaded case's environmentId changes.
   * - Not a 3D preview. Measured absence (`grep environment` was empty) is the pre-fix record above.
   */
  it("the authoring workbench shows which room the selected environment is", async () => {
    const { ENVIRONMENT_SHELL_DESCRIPTORS } = await import("@openclinxr/asset-registry");
    const descriptors = ENVIRONMENT_SHELL_DESCRIPTORS as Record<string, { roomDepthMeters: number; roomWidthMeters: number }>;

    expect(edChestPainScenario.environment, "ED fixture must carry environment").toBeDefined();
    const edEnvironment = edChestPainScenario.environment!;
    const edEnvironmentId = edEnvironment.environmentId;
    const edShell = descriptors[edEnvironmentId];
    expect(edShell, `no descriptor for ${edEnvironmentId} — fixture drifted`).toBeDefined();

    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);

    const panel = await screen.findByLabelText("Encounter environment");
    // The id alone is not "showing which room it is" — the author must see something about the space.
    expect(within(panel).getByText(new RegExp(edEnvironmentId, "i"))).toBeInTheDocument();
    expect(
      within(panel).getByText(new RegExp(String(edShell!.roomWidthMeters))),
      "the author must see the room's real dimensions, not a hardcoded blurb",
    ).toBeInTheDocument();

    // And it must follow the environment, or a static panel about the ED bay passes the above.
    cleanup();
    const homeVisit = {
      ...edChestPainScenario,
      environment: { ...edEnvironment, environmentId: "telehealth_home_visit_v1" },
    };
    const homeShell = descriptors["telehealth_home_visit_v1"];
    expect(homeShell).toBeDefined();

    render(<CaseAuthoringWorkbench initialScenario={homeVisit as typeof edChestPainScenario} />);
    const homePanel = await screen.findByLabelText("Encounter environment");
    expect(within(homePanel).getByText(/telehealth_home_visit_v1/i)).toBeInTheDocument();
    expect(within(homePanel).getByText(new RegExp(String(homeShell!.roomWidthMeters)))).toBeInTheDocument();
  });

});
