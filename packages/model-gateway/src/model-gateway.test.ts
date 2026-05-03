import { describe, expect, it } from "vitest";
import { createDefaultModelGateway, LocalModelProviderAdapter, MockModelProviderAdapter } from "./index.js";

describe("model gateway", () => {
  it("routes actor response requests to a deterministic auditable mock provider", async () => {
    const gateway = createDefaultModelGateway({
      adapters: [new MockModelProviderAdapter()],
      routeId: "actor-dialogue-offline-v1",
    });

    const result = await gateway.generateActorResponse({
      stationRunId: "run_001",
      scenarioId: "ed_chest_pain_priority",
      scenarioVersion: 1,
      actorId: "patient_robert_hayes_v1",
      actorDisplayName: "Robert Hayes",
      actorRole: "patient",
      conversationTurn: 3,
      learnerUtterance: "When did the chest pressure start?",
      visibleFacts: ["Crushing substernal chest pressure."],
      hiddenFacts: ["Pain began while walking upstairs."],
      retrievedMemoryIds: ["scenario:ed_chest_pain_priority:v1", "actor:patient_robert_hayes_v1"],
      traceContextTags: ["history_opqrst"],
      policy: {
        requestPolicyId: "actor-dialogue-offline-v1",
        promptTemplateId: "mock-actor-response-v1",
        safetyPolicyVersion: "clinical-simulation-safety-v1",
      },
    });

    expect(result.text).toContain("Robert Hayes");
    expect(result.traceTags).toContain("history_opqrst");
    expect(result.provenance).toMatchObject({
      providerId: "mock-model",
      modelId: "deterministic-mock",
      modelVersion: "1.0.0",
      requestPolicyId: "actor-dialogue-offline-v1",
      promptTemplateId: "mock-actor-response-v1",
      scenarioId: "ed_chest_pain_priority",
      scenarioVersion: 1,
      actorId: "patient_robert_hayes_v1",
      safetyPolicyVersion: "clinical-simulation-safety-v1",
      guardrail: { status: "pass", reason: "deterministic mock response" },
    });
    expect(result.provenance.retrievedMemoryIds).toEqual(["scenario:ed_chest_pain_priority:v1", "actor:patient_robert_hayes_v1"]);
    expect(result.provenance.costEstimateUsd).toBe(0);
  });

  it("reports local model adapters as not configured until a runtime command is provided", async () => {
    const gateway = createDefaultModelGateway({
      adapters: [new LocalModelProviderAdapter({ providerId: "local-qwen-mlx" })],
      routeId: "actor-dialogue-local-v1",
    });

    expect(await gateway.health()).toEqual([
      {
        providerId: "local-qwen-mlx",
        status: "not_configured",
      },
    ]);

    await expect(
      gateway.generateActorResponse({
        stationRunId: "run_001",
        scenarioId: "ed_chest_pain_priority",
        scenarioVersion: 1,
        actorId: "patient_robert_hayes_v1",
        actorDisplayName: "Robert Hayes",
        actorRole: "patient",
        conversationTurn: 1,
        learnerUtterance: "Hello",
        visibleFacts: [],
        hiddenFacts: [],
        retrievedMemoryIds: [],
        traceContextTags: [],
        policy: {
          requestPolicyId: "actor-dialogue-local-v1",
          promptTemplateId: "local-actor-response-v1",
          safetyPolicyVersion: "clinical-simulation-safety-v1",
        },
      }),
    ).rejects.toThrow("No ready model provider");
  });
});
