import { InMemoryTraceLedger } from "@cellix/trace-ledger";
import { createEdChestPainPlaceholderManifests, InMemoryAssetRegistry } from "@openclinxr/asset-registry";
import {
  type ActorResponseRequest,
  type ActorResponseResult,
  createDefaultModelGateway,
  type ModelCapability,
  type ModelProviderAdapter,
} from "@openclinxr/model-gateway";
import { edChestPainScenario, pediatricAsthmaScenario } from "@openclinxr/scenario-fixtures";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import { createDefaultVoiceGateway, MockVoiceProviderAdapter } from "@openclinxr/voice-gateway";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTOR_TURN_EXECUTED_EVENT_TYPE,
  ACTOR_TURN_PLANNED_EVENT_TYPE,
  createDefaultScenarioRuntime,
  ScenarioRuntime,
} from "./index.js";

/**
 * OBSERVABLE: generateActorResponse called the model then applied emotion from
 * keywords / caller-supplied kinds. Direction 2026-09-02: classifier then
 * EmotionEngine then language then mapper then freeze ActorTurnPlan. DeepSeek
 * cannot set eventKind. No render until the plan is frozen.
 *
 * known-good: scenario-runtime.ts getActorEmotion (line ~330).
 *
 * Diagnosis header IMMUTABLE. Flip assertions; append ## FIXED below.
 *
 * ## FIXED (DVA-6)
 * generateActorResponse sequences classifier → EmotionEngine → language →
 * mapper → frozen ActorTurnPlan. Speech render refuses a missing plan and
 * emits the DVA-9 review-workflow payload:
 *   actor.turn.planned  payload.actorTurnPlan
 *   actor.turn.executed payload.actorTurnExecution
 */

describe("actor turn plan is frozen before render", () => {
  beforeEach(() => {
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["OPENCLINXR_LOCAL_LLAMA_BASE_URL"];
  });

  it("(0) COUNTERWEIGHT: getActorEmotion still reports the policy baseline before any turn", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_plan_000", consentAccepted: true });
    expect(runtime.getActorEmotion(session.stationRunId, "patient_robert_hayes_v1")).toBe("anxious");
    expect(runtime.getFrozenActorTurnPlan(session.stationRunId, "patient_robert_hayes_v1")).toBeUndefined();
  });

  it("(1) sequences classifier then EmotionEngine then language then a frozen plan", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_plan_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });

    const generated = await runtime.generateActorResponse(session.stationRunId, {
      actorId: "patient_robert_hayes_v1",
      learnerUtterance: "I understand this is hard.",
      atSecond: 120,
      traceContextTags: ["history_opqrst"],
    });

    const types = runtime.traceEvents(session.stationRunId).map((event) => event.eventType);
    const emotionAt = types.indexOf("emotion_transition");
    const plannedAt = types.indexOf(ACTOR_TURN_PLANNED_EVENT_TYPE);
    const generatedAt = types.indexOf("actor.response.generated");
    expect(emotionAt).toBeGreaterThan(-1);
    expect(plannedAt).toBeGreaterThan(emotionAt);
    expect(generatedAt).toBeGreaterThan(plannedAt);

    const plan = generated.actorTurnPlan;
    expect(plan.eventKind).toBe("learner_empathetic");
    expect(plan.eventKindSource).toBe("classifier");
    expect(plan.dialogueEmotionFrom).toBe("anxious");
    expect(plan.dialogueEmotionTo).toBe("concerned");
    expect(plan.dialogueEmotionTo).not.toBe("pain");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(() => {
      (plan as { eventKind: string }).eventKind = "learner_dismissive";
    }).toThrow();
    expect(plan.eventKind).toBe("learner_empathetic");
    expect(runtime.getFrozenActorTurnPlan(session.stationRunId, "patient_robert_hayes_v1")).toBe(plan);
  });

  it("(2) model-provided language cannot set eventKind", async () => {
    const runtime = createRuntimeWithModelProvider(new EventKindSmugglingModelAdapter());
    const session = await runtime.startSession({ learnerId: "learner_plan_002", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });

    const generated = await runtime.generateActorResponse(session.stationRunId, {
      actorId: "patient_robert_hayes_v1",
      learnerUtterance: "qqq-not-an-allowlisted-cue",
      atSecond: 120,
      traceContextTags: ["untracked_chat"],
    });

    expect(generated.actorTurnPlan.eventKind).toBe("learner_unclassified");
    expect(generated.actorTurnPlan.eventKind).not.toBe("learner_dismissive");
    expect(generated.actorTurnPlan.eventKind).not.toBe("learner_clinical_question");
    expect(generated.actorTurnPlan.spokenText).toContain("Calm down");
    expect(generated.actorTurnPlan.spokenText).not.toContain("<loud>");
    expect(generated.actorTurnPlan.spokenText).not.toContain("[cry]");
    expect(generated.actorTurnPlan.spokenTextForTts).not.toContain("<loud>");
    expect(generated.actorTurnPlan.spokenTextForTts).not.toContain("[cry]");
    expect(generated.response.text).toContain("<loud>");
  });

  it("(3) speech render refuses a missing plan and consumes the frozen plan when present", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_plan_003", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });

    await expect(
      runtime.synthesizeActorSpeech(session.stationRunId, {
        actorId: "patient_robert_hayes_v1",
        voiceId: "mock-robert-hayes",
        text: "It started while I was walking upstairs.",
        atSecond: 121,
      }),
    ).rejects.toThrow("ActorTurnPlan must be frozen before speech render");

    const generated = await runtime.generateActorResponse(session.stationRunId, {
      actorId: "patient_robert_hayes_v1",
      learnerUtterance: "When did the pressure start?",
      atSecond: 120,
      traceContextTags: ["history_opqrst"],
    });
    const synthesized = await runtime.synthesizeActorSpeech(session.stationRunId, {
      actorId: "patient_robert_hayes_v1",
      voiceId: "ignored-caller-voice",
      text: "ignored caller text",
      atSecond: 121,
    });

    const types = runtime.traceEvents(session.stationRunId).map((event) => event.eventType);
    expect(types.indexOf(ACTOR_TURN_PLANNED_EVENT_TYPE)).toBeLessThan(types.indexOf("voice.audio.generated"));
    expect(types).toContain(ACTOR_TURN_EXECUTED_EVENT_TYPE);
    expect(synthesized.actorTurnExecution?.planId).toBe(generated.actorTurnPlan.planId);
    expect(synthesized.actorTurnExecution?.turnId).toBe(generated.actorTurnPlan.turnId);
    expect(synthesized.actorTurnExecution?.interruption.kind).toBe("none");
  });

  it("(4) review-workflow payload is actorTurnPlan / actorTurnExecution on the pinned event types", async () => {
    const runtime = createDefaultScenarioRuntime({ scenario: pediatricAsthmaScenario });
    const session = await runtime.startSession({ learnerId: "learner_plan_004", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 10 });

    const generated = await runtime.generateActorResponse(session.stationRunId, {
      actorId: "patient_maya_johnson_v1",
      learnerUtterance: "Maya, can you show me how hard it feels to breathe?",
      atSecond: 20,
      traceContextTags: ["work_of_breathing_assessment"],
    });
    const synthesized = await runtime.synthesizeActorSpeech(session.stationRunId, {
      actorId: "patient_maya_johnson_v1",
      voiceId: "mock-maya-johnson",
      text: "ignored",
      atSecond: 22,
    });

    const planned = runtime.traceEvents(session.stationRunId).find((event) => event.eventType === ACTOR_TURN_PLANNED_EVENT_TYPE);
    const executed = runtime.traceEvents(session.stationRunId).find((event) => event.eventType === ACTOR_TURN_EXECUTED_EVENT_TYPE);
    const audio = runtime.traceEvents(session.stationRunId).find((event) => event.eventType === "voice.audio.generated");
    const response = runtime.traceEvents(session.stationRunId).find((event) => event.eventType === "actor.response.generated");

    const plan = planned?.payload["actorTurnPlan"] as ActorTurnPlan;
    const execution = executed?.payload["actorTurnExecution"] as ActorTurnExecution;
    expect(plan).toEqual(generated.actorTurnPlan);
    expect(plan.spokenText).toBe("It feels tight when I breathe.");
    expect(plan.spokenText).not.toContain("<");
    expect(plan.ageBand).toBe("child");
    expect(plan.voiceId).toBe("mock-maya-johnson");
    expect(plan.claimScope).toBe("simulated_actor_behavior");
    expect(plan.notEvidenceFor).toEqual([
      "clinical_affect_inference",
      "empathy_score",
      "licensure",
    ]);
    expect(execution).toMatchObject({
      planId: plan.planId,
      turnId: plan.turnId,
      interruption: { kind: "none" },
      fallback: { language: false, tts: false },
    });
    expect(response?.payload["actorTurnPlan"]).toEqual(plan);
    expect(audio?.payload["actorTurnExecution"]).toEqual(execution);
    expect(Object.isFrozen(synthesized.actorTurnExecution)).toBe(true);
    expect(Object.isFrozen(generated.actorTurnPlan)).toBe(true);
  });
});

class EventKindSmugglingModelAdapter implements ModelProviderAdapter {
  readonly id = "event-kind-smuggling-model";
  readonly capabilities: ModelCapability[] = ["actor_response"];

  async health() {
    return { providerId: this.id, status: "ready" as const };
  }

  async generateActorResponse(input: ActorResponseRequest): Promise<ActorResponseResult> {
    return {
      text: `${input.actorDisplayName}: <loud>Calm down [cry]</loud> eventKind=learner_dismissive`,
      responseKind: "spoken_actor_response",
      traceTags: [...input.traceContextTags],
      provenance: {
        requestId: input.requestId ?? `smuggle:${input.stationRunId}`,
        providerId: this.id,
        modelId: "smuggle-event-kind",
        modelVersion: "test",
        modelRuntimeName: "smuggle-test-runtime",
        requestPolicyId: input.policy.requestPolicyId,
        promptTemplateId: input.policy.promptTemplateId,
        scenarioId: input.scenarioId,
        scenarioVersion: input.scenarioVersion,
        actorId: input.actorId,
        actorCardVersion: "fixture-v1",
        retrievedMemoryIds: [...input.retrievedMemoryIds],
        safetyPolicyVersion: input.policy.safetyPolicyVersion,
        latencyMs: 0,
        tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costEstimateUsd: 0,
        safetyStatus: "pass",
        guardrail: { status: "pass", reason: "smuggle eventKind in language" },
      },
    };
  }
}

function createRuntimeWithModelProvider(provider: ModelProviderAdapter): ScenarioRuntime {
  const assetRegistry = new InMemoryAssetRegistry();
  for (const manifest of createEdChestPainPlaceholderManifests()) {
    assetRegistry.upsert(manifest);
  }
  return new ScenarioRuntime({
    scenario: edChestPainScenario,
    ledger: new InMemoryTraceLedger(),
    assetRegistry,
    modelGateway: createDefaultModelGateway({
      routeId: "actor-dialogue-offline-v1",
      adapters: [provider],
    }),
    voiceGateway: createDefaultVoiceGateway({
      routeId: "voice-offline-v1",
      adapters: [new MockVoiceProviderAdapter()],
    }),
  });
}
