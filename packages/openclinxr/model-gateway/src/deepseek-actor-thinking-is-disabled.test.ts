import { describe, expect, it, vi } from "vitest";
import {
  OpenAiCompatibleModelProviderAdapter,
  type ActorResponseRequest,
} from "./index.js";

/**
 * OBSERVABLE: OpenAiCompatibleModelProviderAdapter.generateActorResponse POSTs
 * chat_completions without thinking: { type: "disabled" }. DeepSeek V4 thinking
 * is on by default; omitting the field is not thinking-off. Direction 2026-09-02
 * DVA-2: deepseek-actor-dialogue must send thinking.type disabled.
 *
 * MEASURED 2026-09-02. openai-compatible-adapter.ts:137-148 sends
 * reasoning:{effort:"low"} (or llama chat_template_kwargs), never thinking.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (DVA-2)
 * deepseek-actor-dialogue POSTs thinking: { type: "disabled" } and does not send
 * reasoning_effort on that rung.
 */

const TURN: ActorResponseRequest = {
  stationRunId: "run_dva2",
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

describe("deepseek actor thinking is disabled", () => {
  it("(0) COUNTERWEIGHT: a configured adapter still POSTs chat_completions", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "It started Tuesday night." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = new OpenAiCompatibleModelProviderAdapter({
      providerId: "deepseek-actor-dialogue",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await adapter.generateActorResponse(TURN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.responseKind).not.toBe("blocked_fallback");
  });

  it("(1) DeepSeek actor chat completions send thinking.type disabled", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "It started Tuesday night." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = new OpenAiCompatibleModelProviderAdapter({
      providerId: "deepseek-actor-dialogue",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.generateActorResponse(TURN);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      thinking?: { type?: string };
      reasoning?: { effort?: string };
    };
    expect(body.thinking, "DeepSeek thinking defaults on; omitting the field is not off").toEqual({
      type: "disabled",
    });
  });
});
