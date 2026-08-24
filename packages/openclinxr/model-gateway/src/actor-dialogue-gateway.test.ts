import { describe, expect, it } from "vitest";
import { createActorDialogueModelGateway, type ModelGateway } from "./index.js";

const ENV_KEYS = ["OPENROUTER_API_KEY", "OPENCLINXR_LOCAL_LLAMA_BASE_URL"] as const;

/** Run `run` with a controlled env for the gateway's config keys, then restore. */
async function withGatewayEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<(typeof ENV_KEYS)[number], string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
  }
  try {
    for (const key of ENV_KEYS) {
      const value = values[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await run();
  } finally {
    for (const key of ENV_KEYS) {
      const prev = previous.get(key);
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}

async function providerIds(gw: ModelGateway): Promise<string[]> {
  return (await gw.health()).map((health) => health.providerId);
}

const OFFLINE_TURN = {
  stationRunId: "run_001",
  scenarioId: "ed_chest_pain_priority_v1",
  scenarioVersion: 1,
  actorId: "patient_robert_hayes_v1",
  actorDisplayName: "Robert Hayes",
  actorRole: "patient",
  conversationTurn: 1,
  learnerUtterance: "Can you describe the pain?",
  visibleFacts: ["It feels heavy, like someone is sitting on my chest."],
  hiddenFacts: ["HIDDEN_DIAGNOSIS_ACUTE_CORONARY_SYNDROME"],
  retrievedMemoryIds: [],
  traceContextTags: [],
  clinicalState: { completedTraceTags: [], openOrders: [] },
  policy: {
    requestPolicyId: "policy_actor_response_v1",
    promptTemplateId: "tmpl_actor_response_v1",
    safetyPolicyVersion: "2026-08-24",
  },
};

describe("createActorDialogueModelGateway", () => {
  it("composes ox then local llama-server from env, with the mock last", async () => {
    await withGatewayEnv(
      {
        OPENROUTER_API_KEY: "env-key",
        OPENCLINXR_LOCAL_LLAMA_BASE_URL: "http://127.0.0.1:8080/v1",
      },
      async () => {
        const gw = createActorDialogueModelGateway();
        expect(await providerIds(gw)).toEqual(["ox-alpha", "local-llama", "mock-model", "local-model"]);
      },
    );
  });

  it("keeps the offline pair with neither configured: the mock answers and never throws", async () => {
    await withGatewayEnv({}, async () => {
      const gw = createActorDialogueModelGateway();
      expect(await providerIds(gw)).toEqual(["mock-model", "local-model"]);
      const res = await gw.generateActorResponse(OFFLINE_TURN);
      expect(res.text).toBe("Robert Hayes: It feels heavy, like someone is sitting on my chest.");
      expect(res.responseKind).toBe("spoken_actor_response");
    });
  });
});
