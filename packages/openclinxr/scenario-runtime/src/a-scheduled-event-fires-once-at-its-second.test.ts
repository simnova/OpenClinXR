import { InMemoryTraceLedger } from "@cellix/trace-ledger";
import { createEdChestPainPlaceholderManifests, InMemoryAssetRegistry } from "@openclinxr/asset-registry";
import {
  createDefaultModelGateway,
  LocalModelProviderAdapter,
  MockModelProviderAdapter,
} from "@openclinxr/model-gateway";
import { createDefaultVoiceGateway, LocalVoiceProviderAdapter, MockVoiceProviderAdapter } from "@openclinxr/voice-gateway";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ScenarioRuntime,
  type ScheduledEvent,
  type Scenario,
} from "./index.js";
// getScheduledEventsDue lives in @openclinxr/domain (station-state.ts:104-111), which
// scenario-runtime already depends on. It is NOT re-exported from this package's index.
import { createStationRun, getScheduledEventsDue } from "@openclinxr/domain";

describe("An authored scheduled event reaches a runtime dispatcher", () => {
  // Build a minimal scenario with ONE eventSchedule entry at atSecond: 30
  const scenarioWithEventAt30: Scenario = {
    scenarioId: "test_scheduled_event_at_30",
    version: 1,
    title: "Test Scenario - Scheduled Event at Second 30",
    status: "approved",
    review: {
      clinical: "approved",
      psychometric: "approved",
      legal: "approved",
      simulationQa: "approved",
    },
    clinicalObjectives: ["Test scheduled event dispatch"],
    actors: [
      {
        actorId: "test_actor_v1",
        role: "patient",
        displayName: "Test Actor",
        demeanor: "neutral",
        openingUtterance: "Hello.",
        communicationProfile: {
          styleFamily: "satir",
          style: "neutral",
          intensity: 0.5,
          baselineMood: ["neutral"],
          communicativeness: "Responds normally.",
          topicsToAvoid: [],
          adverseResponse: "",
          deescalationTriggers: [],
          escalationTriggers: [],
          culturalLanguageNotes: [],
        },
        hiddenFacts: [],
      },
    ],
    requiredTraceTags: [],
    eventSchedule: [
      {
        eventId: "test_scheduled_event_30",
        atSecond: 30,
        actorId: "test_actor_v1",
        tag: "test_scheduled_event",
      },
    ] as ScheduledEvent[],
    reviewRubric: [],
    governance: {
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure: "Test scenario for scheduled event dispatch.",
      validationStage: "stage_1_expert_reviewed",
      validationLimitations: [],
      requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
      sourceIds: [],
      safetyCriticalTraceTags: [],
      hiddenFactPolicy: {
        learnerView: "redact_hidden_facts",
        disclosureRequiresTrigger: true,
      },
    },
    environment: {
      environmentId: "test_environment_v1",
      name: "Test Environment",
      description: "Test environment.",
    },
    equipment: [],
    assetNeeds: [],
  };

  function buildRuntime(scenario: Scenario): ScenarioRuntime {
    const assetRegistry = new InMemoryAssetRegistry();
    for (const manifest of createEdChestPainPlaceholderManifests()) {
      assetRegistry.upsert(manifest);
    }
    return new ScenarioRuntime({
      scenario,
      ledger: new InMemoryTraceLedger(),
      assetRegistry,
      modelGateway: createDefaultModelGateway({
        routeId: "actor-dialogue-offline-v1",
        adapters: [new MockModelProviderAdapter(), new LocalModelProviderAdapter({ providerId: "local-model" })],
      }),
      voiceGateway: createDefaultVoiceGateway({
        routeId: "voice-offline-v1",
        adapters: [new MockVoiceProviderAdapter(), new LocalVoiceProviderAdapter({ providerId: "local-voice" })],
      }),
    });
  }

  beforeEach(() => {
    // Pin offline defaults
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["OPENCLINXR_LOCAL_LLAMA_BASE_URL"];
  });

  it.fails("(1) does NOT appear at second 29", async () => {
    const runtime = buildRuntime(scenarioWithEventAt30);
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 0 });

    // Call the method at second 29 - the event at 30 should NOT be emitted
    // We need to access advanceScheduledEvents which doesn't exist yet
    // This test will fail because the method doesn't exist
    const mod = await import("./scenario-runtime.js");
    const fn = (mod as Record<string, unknown>).ScenarioRuntime?.prototype?.advanceScheduledEvents;
    expect(typeof fn).toBe("function");

    const emitted = runtime.advanceScheduledEvents(session.stationRunId, 29);
    expect(emitted).toEqual([]);
  });

  it.fails("(2) appears EXACTLY ONCE at second 30", async () => {
    const runtime = buildRuntime(scenarioWithEventAt30);
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 0 });

    const mod = await import("./scenario-runtime.js");
    const fn = (mod as Record<string, unknown>).ScenarioRuntime?.prototype?.advanceScheduledEvents;
    expect(typeof fn).toBe("function");

    const emitted = runtime.advanceScheduledEvents(session.stationRunId, 30);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.eventId).toBe("test_scheduled_event_30");
    expect(emitted[0]?.atSecond).toBe(30);
  });

  it.fails("(3) does NOT reappear at second 31", async () => {
    const runtime = buildRuntime(scenarioWithEventAt30);
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 0 });

    const mod = await import("./scenario-runtime.js");
    const fn = (mod as Record<string, unknown>).ScenarioRuntime?.prototype?.advanceScheduledEvents;
    expect(typeof fn).toBe("function");

    // First call at 30 emits the event
    const first = runtime.advanceScheduledEvents(session.stationRunId, 30);
    expect(first).toHaveLength(1);

    // Second call at 31 should NOT re-emit
    const second = runtime.advanceScheduledEvents(session.stationRunId, 31);
    expect(second).toEqual([]);
  });

  it.fails("(4) the emitted set is read from the SESSION RECORD, not passed in by the test", async () => {
    const runtime = buildRuntime(scenarioWithEventAt30);
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 0 });

    const mod = await import("./scenario-runtime.js");
    const fn = (mod as Record<string, unknown>).ScenarioRuntime?.prototype?.advanceScheduledEvents;
    expect(typeof fn).toBe("function");

    // First call at second 30
    const first = runtime.advanceScheduledEvents(session.stationRunId, 30);
    expect(first).toHaveLength(1);

    // Second call at the SAME second 30 - should emit nothing because the session record tracks it
    const second = runtime.advanceScheduledEvents(session.stationRunId, 30);
    expect(second).toEqual([]);
  });

  // Known-good control: getScheduledEventsDue is sound and tested
  it.fails("(5) getScheduledEventsDue is reachable from the @openclinxr/domain ENTRYPOINT. MEASURED: domain/src/index.ts:15-19 re-exports only createStationRun, evaluateRequiredTraceTags and transitionStation from station-state.js. The helper this card wires is not exported at all, so no consumer outside the package can call it. Exporting it is part of the slice; domain/src/index.ts is in the write roots for that reason.", () => {
    const scenario = { eventSchedule: [{ eventId: "test", atSecond: 30, actorId: "a", tag: "t" }] as ScheduledEvent[] };
    const emitted = new Set<string>();
    const due = getScheduledEventsDue(scenario, 30, emitted);
    expect(due).toHaveLength(1);
    expect(due[0]?.eventId).toBe("test");
  });

  it("known-good control (GREEN ON HEAD): the @openclinxr/domain entrypoint is importable and its station-state exports resolve. This is the control that proves the import path in this file is sound, so a red above is about the missing export and not about module resolution.", () => {
    expect(typeof createStationRun).toBe("function");
    const run = createStationRun("ed_chest_pain_priority_v1", "learner_control");
    expect(run.stationRunId).toBeTruthy();
  });
});
