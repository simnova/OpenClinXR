import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "@testing-library/jest-dom/vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AuthoredDialogueSeedDraft,
  DialogueSeedAuthoringPreviewRequest,
  DialogueSeedAuthoringPreviewResult,
  FrozenActorTurnPlanPreview,
} from "./dialogue-seed-authoring-panel.js";
import {
  AUTHORED_LOCAL_FIXTURE_PROVIDER_ID,
  DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY,
} from "./dialogue-seed-authoring-panel.js";
import { ScenarioAuthoringWorkspace } from "./scenario-authoring-workspace.js";

/**
 * Author-facing workflow must fail closed before publication using the
 * landed faculty preview route. Duplicate keys, hidden-fact leakage,
 * unknown actors, and live-provider claims are server-returned structured
 * failures. Safe unique seeds display the exact frozen ActorTurnPlan JSON.
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

const HIDDEN_CANARY = "Father died of myocardial infarction at 54";

const safeOnset: AuthoredDialogueSeedDraft = {
  seedId: "patient_onset_history",
  actorId: "patient_robert_hayes_v1",
  turnIndex: 0,
  learnerUtterance: "When did the chest pressure start?",
  visibleFacts: ["Crushing substernal chest pressure while walking upstairs."],
  hiddenFactCanaries: [HIDDEN_CANARY],
  safetyExpectation: "responds_from_visible_facts",
  spokenText: "It started while I was walking upstairs. It feels like pressure.",
  affect: "anxious",
};

function uniquenessKey(seed: Pick<AuthoredDialogueSeedDraft, "actorId" | "learnerUtterance" | "turnIndex">): string {
  return `${seed.actorId}\u0000${seed.learnerUtterance}\u0000${seed.turnIndex}`;
}

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

/**
 * Stands in for the landed API route. Mirrors its structured errors so the
 * authoring workflow can be tested without importing capability-gateway.
 */
function respondLikeLandedPreviewRoute(
  input: DialogueSeedAuthoringPreviewRequest,
): DialogueSeedAuthoringPreviewResult {
  if (input.request.claimLiveProvider === true) {
    return { ok: false, error: "fabricated_provider_claim", reason: "fabricated_provider_claim:live_provider" };
  }
  if (input.request.providerId !== undefined && input.request.providerId !== AUTHORED_LOCAL_FIXTURE_PROVIDER_ID) {
    return {
      ok: false,
      error: "fabricated_provider_claim",
      reason: `fabricated_provider_claim:${input.request.providerId}`,
    };
  }
  const actorIds = new Set(input.actors.map((actor) => actor.actorId));
  for (const seed of input.seeds) {
    if (!actorIds.has(seed.actorId)) {
      return { ok: false, error: "unknown_actor", reason: `unknown_actor:${seed.actorId}` };
    }
  }
  if (!actorIds.has(input.request.actorId)) {
    return { ok: false, error: "unknown_actor", reason: `unknown_actor:${input.request.actorId}` };
  }
  const grouped = new Map<string, AuthoredDialogueSeedDraft[]>();
  for (const seed of input.seeds) {
    const key = uniquenessKey(seed);
    const bucket = grouped.get(key) ?? [];
    bucket.push(seed);
    grouped.set(key, bucket);
  }
  for (const bucket of grouped.values()) {
    if (bucket.length > 1) {
      const sample = bucket[0];
      return {
        ok: false,
        error: "ambiguous_dialogue_seed",
        reason: `ambiguous_dialogue_seed:${input.scenarioId}:${sample?.actorId}:${sample?.turnIndex}`,
      };
    }
  }
  const matched = input.seeds.find((seed) =>
    seed.actorId === input.request.actorId
    && seed.learnerUtterance === input.request.learnerUtterance
    && seed.turnIndex === input.request.turnIndex
  );
  if (!matched) {
    return {
      ok: false,
      error: "no_matching_dialogue_seed",
      reason: `no_matching_dialogue_seed:${input.scenarioId}:${input.request.actorId}`,
    };
  }
  const haystack = (matched.spokenText ?? "").toLowerCase();
  const leaks = matched.hiddenFactCanaries.some((canary) => {
    const needle = canary.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
  if (leaks && matched.safetyExpectation !== "blocks_hidden_truth_probe") {
    return { ok: false, error: "hidden_fact_leakage", reason: "hidden_fact_leakage" };
  }
  return {
    ok: true,
    preview: frozenPreviewFromServer(matched),
    catalog: {
      scenarioId: input.scenarioId,
      version: input.version,
      actorIds: input.actors.map((actor) => actor.actorId),
      seedIds: input.seeds.map((seed) => seed.seedId),
    },
    liveProviderEnabled: false,
    providerExecutionAllowed: false,
    claimBoundary: DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY,
  };
}

describe("the dialogue authoring workflow rejects unsafe seeds", () => {
  it("does not pull capability-gateway into the authoring workspace", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const workspace = readFileSync(join(here, "scenario-authoring-workspace.tsx"), "utf8");
    const panel = readFileSync(join(here, "dialogue-seed-authoring-panel.tsx"), "utf8");
    expect(workspace).not.toMatch(/capability-gateway/);
    expect(panel).not.toMatch(/capability-gateway/);
  });

  it("blocks publication when two seeds share scenario, actor, prompt, and actor-local turn", async () => {
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
        previewCatalog={async (input) => respondLikeLandedPreviewRoute(input)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent(
        "ambiguous_dialogue_seed:ed_chest_pain_priority_v1:patient_robert_hayes_v1:0",
      );
    });
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked");
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("ambiguous_dialogue_seed");
  });

  it("exposes hidden-fact leakage in authored spoken text before publication", async () => {
    render(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[
          {
            ...safeOnset,
            spokenText: "Father died of myocardial infarction at 54 after the stairs.",
          },
        ]}
        previewCatalog={async (input) => respondLikeLandedPreviewRoute(input)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent("hidden_fact_leakage");
    });
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked: hidden_fact_leakage");
  });

  it("rejects unknown actors and fabricated live-provider claims", async () => {
    const { rerender } = render(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[
          {
            ...safeOnset,
            actorId: "consultant_not_in_cast_v1",
          },
        ]}
        previewCatalog={async (input) => respondLikeLandedPreviewRoute(input)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent(
        "unknown_actor:consultant_not_in_cast_v1",
      );
    });
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("blocked");

    rerender(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[safeOnset]}
        claimLiveProvider
        previewCatalog={async (input) => respondLikeLandedPreviewRoute(input)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent(
        "fabricated_provider_claim:live_provider",
      );
    });

    rerender(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[safeOnset]}
        providerId="grok-reasoning-provider"
        previewCatalog={async (input) => respondLikeLandedPreviewRoute(input)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seed validation failures")).toHaveTextContent(
        "fabricated_provider_claim:grok-reasoning-provider",
      );
    });
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent("fabricated_provider_claim");
    expect(screen.getByLabelText("Dialogue seed claim boundary")).toHaveTextContent("Live provider disabled");
    expect(screen.getByLabelText("Dialogue seed publication gate")).not.toHaveTextContent("live provider enabled");
  });

  it("previews the exact frozen ActorTurnPlan for a unique safe seed and keeps existing authoring", async () => {
    render(
      <ScenarioAuthoringWorkspace
        initialScenario={edChestPainScenario}
        initialSeeds={[safeOnset]}
        previewCatalog={async (input) => respondLikeLandedPreviewRoute(input)}
      />,
    );

    expect(screen.getByLabelText("Scenario authoring workspace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Encounter Case Authoring" })).toBeInTheDocument();
    expect(screen.getByLabelText("Disclosure rules")).toHaveTextContent("redact_hidden_facts");
    await waitFor(() => {
      const preview = screen.getByLabelText<HTMLTextAreaElement>("Frozen ActorTurnPlan preview");
      expect(preview.value).toContain(
        "plan_ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient_onset_history:turn-0",
      );
    });
    const preview = screen.getByLabelText<HTMLTextAreaElement>("Frozen ActorTurnPlan preview");
    expect(preview.value).toContain("authored-local-fixture");
    expect(preview.value).toContain("It started while I was walking upstairs. It feels like pressure.");
    expect(preview.value).not.toContain(HIDDEN_CANARY);
    expect(screen.getByLabelText("Dialogue seed publication gate")).toHaveTextContent(
      "ready for review (authored-local-fixture only)",
    );
  });
});
