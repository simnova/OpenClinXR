import "@testing-library/jest-dom/vitest";
import { authoredContentIdentity, previewAuthoringRevision, STALE_REVIEW_IDENTITY_REFUSAL } from "@openclinxr/ui-route-admin";
import { clinicKneePainScenario } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScenarioAuthoringPreviewPanel } from "./ScenarioAuthoringPreviewPanel.js";

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
});

afterEach(() => {
  cleanup();
});

function mutateDraft(approved: Scenario): Scenario {
  const patient = approved.actors[0];
  if (!patient) {
    throw new Error("approved revision has no actors");
  }
  return {
    ...approved,
    actors: [
      {
        ...patient,
        displayName: `${patient.displayName} (revised)`,
        openingUtterance: "The knee locked when I landed.",
      },
      ...approved.actors.slice(1),
    ],
    emotionPolicy: {
      baseline: "concerned",
      upperBound: "anxious",
      lowerBound: "neutral",
      transitions: [{ from: "concerned", triggeredBy: "learner_empathetic", to: "reassured" }],
    },
    equipment: [...(approved.equipment ?? []), "knee_immobilizer"],
  };
}

describe("authoring preview panel consumes the ui-route-admin contract", () => {
  it("renders actor, dialogue, emotion, and asset changes from the package preview", () => {
    const approved = clinicKneePainScenario;
    const draft = mutateDraft(approved);
    const preview = previewAuthoringRevision({
      draft,
      approved,
      reviewIdentity: authoredContentIdentity(approved),
    });
    render(<ScenarioAuthoringPreviewPanel draft={draft} approved={approved} preview={preview} />);
    expect(screen.getByLabelText("Authoring preview")).toBeInTheDocument();
    expect(screen.getByLabelText("Reviewed runtime delta").textContent).toMatch(/Actor/);
    expect(screen.getByLabelText("Reviewed runtime delta").textContent).toMatch(/Dialogue/);
    expect(screen.getByLabelText("Reviewed runtime delta").textContent).toMatch(/Emotion/);
    expect(screen.getByLabelText("Reviewed runtime delta").textContent).toMatch(/Asset/);
    expect(screen.getByRole("button", { name: "Promote scenario" })).toBeDisabled();
  });

  it("disables promote while review identity is stale and enables it when identity matches", () => {
    const approved = clinicKneePainScenario;
    const onPromote = vi.fn();
    render(
      <ScenarioAuthoringPreviewPanel
        draft={approved}
        approved={approved}
        reviewIdentity={authoredContentIdentity({ ...approved, title: "stale" })}
        onPromote={onPromote}
      />,
    );
    expect(screen.getByText(STALE_REVIEW_IDENTITY_REFUSAL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote scenario" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Promote scenario" }));
    expect(onPromote).not.toHaveBeenCalled();
    cleanup();

    render(
      <ScenarioAuthoringPreviewPanel
        draft={approved}
        approved={approved}
        reviewIdentity={authoredContentIdentity(approved)}
        onPromote={onPromote}
      />,
    );
    const readyButton = screen.getByRole("button", { name: "Promote scenario" });
    expect(readyButton).toBeEnabled();
    fireEvent.click(readyButton);
    expect(onPromote).toHaveBeenCalledOnce();
  });
});
