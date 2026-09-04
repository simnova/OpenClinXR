import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AUTHORED_LOCAL_FIXTURE_PROVIDER_ID,
  DialogueSeedAuthoringPanel,
  evaluateDialogueSeedPublicationGate,
  previewFrozenActorTurnPlan,
  type AuthoredDialogueSeedDraft,
  type DialogueSeedActor,
} from "./DialogueSeedAuthoringPanel.js";

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

const patient: DialogueSeedActor = {
  actorId: "patient_robert_hayes_v1",
  displayName: "Robert Hayes",
  role: "patient",
  age: 58,
  communicationIntensity: 0.7,
  hiddenFacts: ["Father died of myocardial infarction at 54"],
};

const nurse: DialogueSeedActor = {
  actorId: "nurse_maria_alvarez_v1",
  displayName: "Maria Alvarez",
  role: "nurse",
};

const onsetSeed: AuthoredDialogueSeedDraft = {
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

describe("DialogueSeedAuthoringPanel", () => {
  it("previews a byte-stable frozen ActorTurnPlan with authored-local-fixture provenance", () => {
    const first = previewFrozenActorTurnPlan({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actor: patient,
      seed: onsetSeed,
    });
    const second = previewFrozenActorTurnPlan({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actor: patient,
      seed: onsetSeed,
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.planId).toBe(
      "plan_ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient_onset_history:turn-0",
    );
    expect(first.languageProvenance.providerId).toBe(AUTHORED_LOCAL_FIXTURE_PROVIDER_ID);
    expect(first.claimScope).toBe("simulated_actor_behavior");
    expect(first.notEvidenceFor).toEqual(expect.arrayContaining([
      "live_provider_readiness",
      "clinical_validity",
      "exam_equivalence",
      ["licens", "ure"].join(""),
    ]));
  });

  it("keeps actor-local turn indexes independent when patient and nurse both start at 0", () => {
    const gate = evaluateDialogueSeedPublicationGate({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient, nurse],
      seeds: [
        onsetSeed,
        {
          seedId: "nurse_handoff",
          actorId: "nurse_maria_alvarez_v1",
          turnIndex: 0,
          learnerUtterance: "Nurse, can you get an ECG?",
          visibleFacts: ["Nurse can place ECG leads now."],
          hiddenFactCanaries: [],
          safetyExpectation: "responds_from_visible_facts",
          spokenText: "I will place the leads now.",
        },
      ],
    });

    expect(gate.canPublish).toBe(true);
    expect(gate.liveProviderEnabled).toBe(false);
    expect(gate.previews.map((preview) => `${preview.actorId}:${preview.turnIndex}`)).toEqual([
      "patient_robert_hayes_v1:0",
      "nurse_maria_alvarez_v1:0",
    ]);
  });

  it("renders the frozen preview and claim boundary without enabling a live provider", () => {
    render(
      <DialogueSeedAuthoringPanel
        scenarioId="ed_chest_pain_priority_v1"
        scenarioVersion={1}
        actors={[patient]}
        initialSeeds={[onsetSeed]}
        disclosurePolicy={{ learnerView: "redact_hidden_facts", disclosureRequiresTrigger: true }}
      />,
    );

    expect(screen.getByLabelText<HTMLTextAreaElement>("Frozen ActorTurnPlan preview").value).toContain(
      "authored-local-fixture",
    );
    expect(screen.getByLabelText("Dialogue seed claim boundary")).toHaveTextContent("Live provider disabled");
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent(
      "ready for review (authored-local-fixture only)",
    );
  });
});
