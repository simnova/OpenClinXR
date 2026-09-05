import "@testing-library/jest-dom/vitest";
import { STALE_REVIEW_IDENTITY_REFUSAL } from "@openclinxr/ui-route-admin";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseAuthoringWorkbench } from "../case-authoring-workbench.js";

describe("the authoring form updates the live preview delta", () => {
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

  it("changes equipment through the form and shows the asset delta with stale-review refusal", async () => {
    render(<CaseAuthoringWorkbench initialScenario={edChestPainScenario} />);

    expect(await screen.findByLabelText("Authoring preview")).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getByLabelText("Reviewed runtime delta").textContent).toMatch(
          /No actor, dialogue, emotion, or asset changes versus the approved revision/,
        );
      },
      { timeout: 15_000 },
    );

    const equipmentInput = screen.getByRole("combobox", { name: /equipment/i }) as HTMLInputElement;
    fireEvent.change(equipmentInput, { target: { value: "preview-knee-brace" } });
    fireEvent.keyDown(equipmentInput, { key: "Enter", code: "Enter", keyCode: 13 });

    await waitFor(
      () => {
        expect(screen.getByLabelText("Reviewed runtime delta").textContent).toMatch(/Asset/);
      },
      { timeout: 15_000 },
    );
    expect(screen.getByText(STALE_REVIEW_IDENTITY_REFUSAL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote scenario" })).toBeDisabled();
  }, 45_000);
});
