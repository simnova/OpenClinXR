import "@testing-library/jest-dom/vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthoredDialogueSeedDraft } from "./DialogueSeedAuthoringPanel.js";
import { ScenarioAuthoringWorkspace } from "./ScenarioAuthoringWorkspace.js";

/**
 * Author-facing workflow must fail closed before publication:
 * duplicate scenario/actor/prompt/actor-local-turn keys, hidden-fact leakage,
 * unknown actors, and live-provider claims. Safe unique seeds preview the
 * byte-stable frozen ActorTurnPlan with authored-local-fixture provenance.
 */

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

const safeOnset: AuthoredDialogueSeedDraft = {
  seedId: "patient_onset_history",
  actorId: "patient_robert_hayes_v1",
  turnIndex: 0,
  learnerUtterance: "When did the chest pressure start?",
  visibleFacts: ["Crushing substernal chest pressure while walking upstairs."],
  hiddenFactCanaries: ["Father died of myocardial infarction at 54"],
  safetyExpectation: "responds_from_visible_facts",
  spokenText: "It started while I was walking upstairs. It feels like pressure.",
  affect: "anxious",
};

describe("the dialogue authoring workflow rejects unsafe seeds", () => {
  it("blocks publication when two seeds share scenario, actor, prompt, and actor-local turn", () => {
    render(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[
          safeOnset,
          {
            ...safeOnset,
            seedId: "patient_onset_history_dup",
            spokenText: "It started on the stairs.",
          },
        ]}
      />,
    );

    const failures = screen.getByLabelText("Seed validation failures");
    expect(failures).toHaveTextContent("ambiguous_dialogue_seed:ed_chest_pain_priority_v1:patient_robert_hayes_v1:0");
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked");
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("ambiguous_dialogue_seed");
  });

  it("exposes hidden-fact leakage in authored spoken text before publication", () => {
    render(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[
          {
            ...safeOnset,
            spokenText: "Father died of myocardial infarction at 54 after the stairs.",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent("hidden_fact_leakage");
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked: hidden_fact_leakage");
  });

  it("rejects unknown actors and fabricated live-provider claims", () => {
    const { rerender } = render(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[
          {
            ...safeOnset,
            actorId: "consultant_not_in_cast_v1",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent(
      "unknown_actor:consultant_not_in_cast_v1",
    );
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked");

    rerender(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[safeOnset]}
        claimLiveProvider
        providerId="grok-reasoning-provider"
      />,
    );

    expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent(
      "fabricated_provider_claim:live_provider",
    );
    expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent(
      "fabricated_provider_claim:grok-reasoning-provider",
    );
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("fabricated_provider_claim");
    expect(screen.getByLabelText("Dialogue seed claim boundary")).toHaveTextContent("Live provider disabled");
    expect(screen.getByLabelText("Dialogue seed publication gate")).not.toHaveTextContent("live provider enabled");
  });

  it("previews the exact frozen ActorTurnPlan for a unique safe seed and keeps existing authoring", () => {
    render(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[safeOnset]}
      />,
    );

    expect(screen.getByLabelText("Scenario authoring workspace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Encounter Case Authoring" })).toBeInTheDocument();
    expect(screen.getByLabelText("Disclosure rules")).toHaveTextContent("redact_hidden_facts");
    const preview = screen.getByLabelText<HTMLTextAreaElement>("Frozen ActorTurnPlan preview");
    expect(preview.value).toContain(
      "plan_ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient_onset_history:turn-0",
    );
    expect(preview.value).toContain("authored-local-fixture");
    expect(preview.value).toContain("It started while I was walking upstairs. It feels like pressure.");
    expect(preview.value).not.toContain("Father died of myocardial infarction at 54");
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent(
      "ready for review (authored-local-fixture only)",
    );
  });
});
