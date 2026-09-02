import { describe, expect, it, vi } from "vitest";
import {
  OpenAiCompatibleModelProviderAdapter,
  type ActorResponseRequest,
} from "./index.js";

/**
 * Muse Spark contributor (OpenRouter, cheapest actor rung) must POST chat_completions
 * with NEITHER DeepSeek's `thinking` field NOR OpenRouter's `reasoning` block — either
 * shape 400/403s Muse (measured 2026-09-02 alongside the 18+ attestation 403). Today
 * the non-llama OpenRouter branch sends reasoning:{effort:"low"} for ox; Muse must not
 * inherit it.
 *
 * Prices verified 2026-09-02 against live GET https://openrouter.ai/api/v1/models:
 * contributor $0.10 / $0.20 per 1M (cache read $0.002/M) vs DeepSeek Flash DIRECT
 * official off-peak $0.22 / $0.66. OpenRouter's own deepseek flash ($0.079/$0.159) is
 * cheaper but is NOT this rung — actor dialogue stays off OpenRouter DeepSeek.
 *
 * claimScope: Muse rungs (providerId muse-spark-contributor OR a model id containing
 * muse-spark) send no thinking/reasoning/chat_template_kwargs; the DeepSeek rung still
 * sends thinking.type disabled (deepseek-actor-thinking-is-disabled.test.ts stays green).
 * notEvidenceFor: live Muse completions (403 until the operator confirms 18+ at
 * openrouter.ai/settings/preferences).
 */

const TURN: ActorResponseRequest = {
  stationRunId: "run_muse",
  scenarioId: "peds_asthma_parent_anxiety_v1",
  scenarioVersion: 1,
  actorId: "patient_maya_johnson_v1",
  actorDisplayName: "Maya Johnson",
  actorRole: "patient",
  conversationTurn: 3,
  learnerUtterance: "When did the wheezing start?",
  visibleFacts: ["She has been coughing since Tuesday."],
  hiddenFacts: ["HIDDEN_DIAGNOSIS_MODERATE_PERSISTENT_ASTHMA"],
  retrievedMemoryIds: [],
  traceContextTags: ["hpi_onset"],
  clinicalState: { completedTraceTags: [], openOrders: [] },
  policy: {
    requestPolicyId: "policy_actor_response_v1",
    promptTemplateId: "tmpl_actor_response_v1",
    safetyPolicyVersion: "2026-09-02",
  },
};

function museFetch() {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "It started Tuesday night." } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

type MuseBody = {
  model?: string;
  thinking?: unknown;
  reasoning?: unknown;
  chat_template_kwargs?: unknown;
};

describe("muse spark contributor sends no thinking or reasoning", () => {
  it("(0) COUNTERWEIGHT: a configured Muse adapter still POSTs chat_completions", async () => {
    const fetchImpl = museFetch();
    const adapter = new OpenAiCompatibleModelProviderAdapter({
      providerId: "muse-spark-contributor",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta/muse-spark-1.3-contributor",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await adapter.generateActorResponse(TURN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.responseKind).not.toBe("blocked_fallback");
  });

  it("(1) Muse POST body carries neither thinking nor reasoning nor chat_template_kwargs", async () => {
    const fetchImpl = museFetch();
    const adapter = new OpenAiCompatibleModelProviderAdapter({
      providerId: "muse-spark-contributor",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta/muse-spark-1.3-contributor",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.generateActorResponse(TURN);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as MuseBody;
    expect(body.model).toBe("meta/muse-spark-1.3-contributor");
    expect(body.thinking, "Muse rejects DeepSeek's thinking field (400/403)").toBeUndefined();
    expect(body.reasoning, "Muse rejects OpenRouter's reasoning block (400/403)").toBeUndefined();
    expect(body.chat_template_kwargs, "Muse takes no llama chat_template_kwargs either").toBeUndefined();
  });

  it("(2) the model-id guard also strips the extras when providerId is not the muse rung", async () => {
    // isMuseSparkRung matches providerId "muse-spark-contributor" OR a model containing
    // muse-spark, so a differently-id'd adapter pointing at the same wire model is safe.
    const fetchImpl = museFetch();
    const adapter = new OpenAiCompatibleModelProviderAdapter({
      providerId: "openrouter-fallback",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta/muse-spark-1.3-contributor",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.generateActorResponse(TURN);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as MuseBody;
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });
});
