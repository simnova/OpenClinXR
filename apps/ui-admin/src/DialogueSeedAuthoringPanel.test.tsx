import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AUTHORED_LOCAL_FIXTURE_PROVIDER_ID,
  DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY,
  DIALOGUE_SEED_AUTHORING_PREVIEW_PATH,
  DialogueSeedAuthoringPanel,
  previewAuthoredDialogueCatalog,
  type AuthoredDialogueSeedDraft,
  type DialogueSeedActor,
  type DialogueSeedAuthoringPreviewRequest,
  type DialogueSeedAuthoringPreviewResult,
  type FrozenActorTurnPlanPreview,
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

const nurseSeed: AuthoredDialogueSeedDraft = {
  seedId: "nurse_handoff",
  actorId: "nurse_maria_alvarez_v1",
  turnIndex: 0,
  learnerUtterance: "Nurse, can you get an ECG?",
  visibleFacts: ["Nurse can place ECG leads now."],
  hiddenFactCanaries: [],
  safetyExpectation: "responds_from_visible_facts",
  spokenText: "I will place the leads now.",
};

function frozenPreviewFromServer(seed: AuthoredDialogueSeedDraft): FrozenActorTurnPlanPreview {
  const turnId = `ed_chest_pain_priority_v1:${seed.actorId}:${seed.seedId}:turn-${seed.turnIndex}`;
  return {
    planId: `plan_${turnId}`,
    planVersion: 1,
    turnId,
    stationRunId: "deterministic-replay:ed_chest_pain_priority_v1",
    actorId: seed.actorId,
    respondingActorId: seed.actorId,
    turnIndex: seed.turnIndex,
    spokenText: seed.spokenText ?? "",
    spokenTextForTts: seed.spokenText ?? "",
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: seed.affect ?? "neutral",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "high",
    ageBand: "adult",
    performancePlanId: `fixture:${seed.actorId}:${seed.affect ?? "neutral"}`,
    facePresetId: `fixture-face:${seed.affect ?? "neutral"}`,
    posePresetId: `fixture-pose:${seed.affect ?? "neutral"}`,
    gestureClipIds: [],
    prosody: { wrapTags: [], inlineTags: [], speed: 1, droppedTags: [] },
    voiceId: `fixture-${seed.actorId}`,
    languageProvenance: { fallbackUsed: false, providerId: AUTHORED_LOCAL_FIXTURE_PROVIDER_ID },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["live_provider_readiness", "clinical_validity", "exam_equivalence"],
  };
}

function successFromServer(seed: AuthoredDialogueSeedDraft) {
  const preview = frozenPreviewFromServer(seed);
  return {
    ok: true as const,
    preview,
    catalog: {
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actorIds: [seed.actorId],
      seedIds: [seed.seedId],
    },
    liveProviderEnabled: false as const,
    providerExecutionAllowed: false as const,
    claimBoundary: DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY,
  };
}

describe("DialogueSeedAuthoringPanel", () => {
  it("does not import capability-gateway or reconstruct ActorTurnPlan locally", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "DialogueSeedAuthoringPanel.tsx"), "utf8");
    expect(source).not.toMatch(/capability-gateway/);
    expect(source).not.toMatch(/previewFrozenActorTurnPlan/);
    expect(source).not.toMatch(/evaluateDialogueSeedPublicationGate/);
    expect(source).not.toMatch(/createDeterministicDialogueAdapter/);
  });

  it("POSTs the catalog to the landed preview route and renders the exact server preview", async () => {
    const serverPreview = frozenPreviewFromServer(onsetSeed);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(DIALOGUE_SEED_AUTHORING_PREVIEW_PATH);
      return new Response(JSON.stringify(successFromServer(onsetSeed)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const first = await previewAuthoredDialogueCatalog({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient],
      seeds: [onsetSeed],
      request: {
        actorId: onsetSeed.actorId,
        learnerUtterance: onsetSeed.learnerUtterance,
        turnIndex: 0,
      },
    }, { fetch: fetchImpl as unknown as typeof fetch });
    const second = await previewAuthoredDialogueCatalog({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient],
      seeds: [onsetSeed],
      request: {
        actorId: onsetSeed.actorId,
        learnerUtterance: onsetSeed.learnerUtterance,
        turnIndex: 0,
      },
    }, { fetch: fetchImpl as unknown as typeof fetch });

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.preview).toEqual(serverPreview);
      expect(first.preview.languageProvenance.providerId).toBe(AUTHORED_LOCAL_FIXTURE_PROVIDER_ID);
      expect(first.claimBoundary).toBe(DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps actor-local turn indexes independent when patient and nurse both start at 0", async () => {
    const previewCatalog = vi.fn(async (input: DialogueSeedAuthoringPreviewRequest) => {
      const seed = input.seeds.find((entry) =>
        entry.actorId === input.request.actorId && entry.turnIndex === input.request.turnIndex
      ) ?? onsetSeed;
      return successFromServer(seed);
    });

    render(
      <DialogueSeedAuthoringPanel
        scenarioId="ed_chest_pain_priority_v1"
        scenarioVersion={1}
        actors={[patient, nurse]}
        initialSeeds={[onsetSeed, nurseSeed]}
        previewCatalog={previewCatalog}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent(
        "ready for review (authored-local-fixture only)",
      );
    });
    const preview = screen.getByLabelText<HTMLTextAreaElement>("Frozen ActorTurnPlan preview").value;
    expect(preview).toContain("patient_robert_hayes_v1");
    expect(preview).toContain("nurse_maria_alvarez_v1");
    expect(preview).toContain('"turnIndex": 0');
    expect(previewCatalog).toHaveBeenCalled();
  });

  it("rejects an empty preview object as invalid_body and blocks publication", async () => {
    const spoof = {
      ...successFromServer(onsetSeed),
      preview: {},
    };
    const result = await previewAuthoredDialogueCatalog({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient],
      seeds: [onsetSeed],
      request: {
        actorId: onsetSeed.actorId,
        learnerUtterance: onsetSeed.learnerUtterance,
        turnIndex: 0,
      },
    }, {
      fetch: (async () => new Response(JSON.stringify(spoof), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, error: "invalid_body", reason: "preview_identity_blank" });

    render(
      <DialogueSeedAuthoringPanel
        scenarioId="ed_chest_pain_priority_v1"
        scenarioVersion={1}
        actors={[patient]}
        initialSeeds={[onsetSeed]}
        previewCatalog={async () => spoof as DialogueSeedAuthoringPreviewResult}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked: invalid_body");
    });
    expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent("preview_identity_blank");
  });

  it("rejects a cross-actor or cross-turn preview as invalid_body", async () => {
    const crossActor = {
      ...successFromServer(onsetSeed),
      preview: {
        ...frozenPreviewFromServer(onsetSeed),
        actorId: nurse.actorId,
        respondingActorId: nurse.actorId,
      },
    };
    const crossTurn = {
      ...successFromServer(onsetSeed),
      preview: {
        ...frozenPreviewFromServer(onsetSeed),
        turnIndex: 7,
      },
    };
    const actorResult = await previewAuthoredDialogueCatalog({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient],
      seeds: [onsetSeed],
      request: {
        actorId: onsetSeed.actorId,
        learnerUtterance: onsetSeed.learnerUtterance,
        turnIndex: 0,
      },
    }, {
      fetch: (async () => new Response(JSON.stringify(crossActor), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
    });
    const turnResult = await previewAuthoredDialogueCatalog({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient],
      seeds: [onsetSeed],
      request: {
        actorId: onsetSeed.actorId,
        learnerUtterance: onsetSeed.learnerUtterance,
        turnIndex: 0,
      },
    }, {
      fetch: (async () => new Response(JSON.stringify(crossTurn), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
    });
    expect(actorResult).toEqual({ ok: false, error: "invalid_body", reason: "preview_actor_mismatch" });
    expect(turnResult).toEqual({ ok: false, error: "invalid_body", reason: "preview_turn_mismatch" });
  });

  it("rejects a fabricated enabled-provider or claim-boundary success as invalid_body", async () => {
    const enabledProvider = {
      ...successFromServer(onsetSeed),
      liveProviderEnabled: true,
      providerExecutionAllowed: true,
    };
    const wrongBoundary = {
      ...successFromServer(onsetSeed),
      claimBoundary: "ui_xr_consumer_workflow_submit_preview_metadata_only",
    };
    const enabledResult = await previewAuthoredDialogueCatalog({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient],
      seeds: [onsetSeed],
      request: {
        actorId: onsetSeed.actorId,
        learnerUtterance: onsetSeed.learnerUtterance,
        turnIndex: 0,
      },
    }, {
      fetch: (async () => new Response(JSON.stringify(enabledProvider), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
    });
    const boundaryResult = await previewAuthoredDialogueCatalog({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      actors: [patient],
      seeds: [onsetSeed],
      request: {
        actorId: onsetSeed.actorId,
        learnerUtterance: onsetSeed.learnerUtterance,
        turnIndex: 0,
      },
    }, {
      fetch: (async () => new Response(JSON.stringify(wrongBoundary), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
    });
    expect(enabledResult).toEqual({ ok: false, error: "invalid_body", reason: "live_provider_must_be_disabled" });
    expect(boundaryResult).toEqual({ ok: false, error: "invalid_body", reason: "claim_boundary_mismatch" });

    render(
      <DialogueSeedAuthoringPanel
        scenarioId="ed_chest_pain_priority_v1"
        scenarioVersion={1}
        actors={[patient]}
        initialSeeds={[onsetSeed]}
        previewCatalog={async () => enabledProvider as DialogueSeedAuthoringPreviewResult}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked: invalid_body");
    });
    expect(screen.getByLabelText("Dialogue seed publication gate")).not.toHaveTextContent("ready for review");
  });

  it("renders the frozen preview and claim boundary without enabling a live provider", async () => {
    render(
      <DialogueSeedAuthoringPanel
        scenarioId="ed_chest_pain_priority_v1"
        scenarioVersion={1}
        actors={[patient]}
        initialSeeds={[onsetSeed]}
        disclosurePolicy={{ learnerView: "redact_hidden_facts", disclosureRequiresTrigger: true }}
        previewCatalog={async () => successFromServer(onsetSeed)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLTextAreaElement>("Frozen ActorTurnPlan preview").value).toContain(
        "authored-local-fixture",
      );
    });
    expect(screen.getByLabelText("Dialogue seed claim boundary")).toHaveTextContent("Live provider disabled");
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent(
      "ready for review (authored-local-fixture only)",
    );
  });
});
