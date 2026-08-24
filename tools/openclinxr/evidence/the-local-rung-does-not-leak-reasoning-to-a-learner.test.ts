import { describe, expect, it, vi } from "vitest";
import * as gateway from "../../../packages/openclinxr/model-gateway/src/index.js";

/**
 * OBSERVABLE: a learner never sees the model's reasoning, even when the reply is cut short.
 *
 * MEASURED 2026-08-24 against the live local rung (Qwen3-8B-Q4_K_M on llama-server), do not re-derive.
 * #623 fixed ox and left the local rung leaking. The cause is NOT the adapter's strip — it is the
 * request budget:
 *
 *   max_tokens=128  comp=128  finish=length   <think> present, </think> MISSING
 *   max_tokens=256  comp=188  finish=stop     closed        <- 1 of 3
 *   max_tokens=256  comp=256  finish=length   NOT closed    <- 2 of 3
 *   max_tokens=512  comp=173  finish=stop     closed
 *
 * The adapter hardcodes `max_tokens: 256` (`openai-compatible-adapter.ts:140`). At that budget the
 * model is still reasoning when it runs out, so no closing tag arrives and a strip keyed on
 * `<think>…</think>` has nothing to match. **Intermittent, 2 in 3** — worse than deterministic,
 * because a spot check passes and a learner still sees it.
 *
 * THE ONE-PARAMETER FIX, measured 6/6 at the SAME 256 budget:
 *   chat_template_kwargs {enable_thinking:false}
 *     0.67–1.00 s, comp 30–32, finish=stop, closed=True, leak=False — six for six.
 * That is also ~8x faster than the 5.75 s the adapter currently takes on this rung.
 *
 * The adapter today sends `reasoning: {effort: "low"}` — an OpenRouter parameter. llama-server does
 * not honour it; its control is `chat_template_kwargs`. So the local rung has NO thinking control at
 * all, which is why only it leaks.
 *
 * KNOWN-GOOD COLUMN — clause (2): ox must keep working. #623 landed it (live: 10.68 s, clean, no
 * wrapper) and a local-rung fix must not regress the provider that is currently correct.
 *
 * COUNTERWEIGHT — clause (3): defence in depth. Even if the suppression parameter is dropped, changed
 * upstream, or unsupported by a future server, an UNTERMINATED `<think>` must never reach the learner.
 * Clause (1) alone could be satisfied by sending the parameter and trusting it; clause (3) refuses that.
 *
 * claimScope: what the adapter emits for the two local response shapes measured on this machine.
 * notEvidenceFor: latency budgets; which rung should be primary; ox's behaviour beyond not regressing;
 * the confabulated-negative risk, which is separate and larger.
 */

type AdapterCtor = new (opts: {
  providerId: string; baseUrl: string; model: string; apiKey?: string; fetchImpl?: typeof fetch;
}) => gateway.ModelProviderAdapter;

const TURN: gateway.ActorResponseRequest = {
  stationRunId: "run_001", scenarioId: "ed_chest_pain_priority_v1", scenarioVersion: 1,
  actorId: "patient_robert_hayes_v1", actorDisplayName: "Robert Hayes", actorRole: "patient",
  conversationTurn: 2, learnerUtterance: "Can you describe the pain?",
  visibleFacts: ["It feels heavy, like someone is sitting on my chest."],
  hiddenFacts: ["HIDDEN_DIAGNOSIS_ACUTE_CORONARY_SYNDROME"],
  retrievedMemoryIds: [], traceContextTags: ["hpi_quality"],
  clinicalState: { completedTraceTags: [], openOrders: [] },
  policy: { requestPolicyId: "p", promptTemplateId: "t", safetyPolicyVersion: "2026-08-24" },
};

function local(fetchImpl: typeof fetch): gateway.ModelProviderAdapter {
  const Ctor = (gateway as unknown as Record<string, AdapterCtor>)["OpenAiCompatibleModelProviderAdapter"];
  expect(Ctor).toBeDefined();
  return new Ctor!({ providerId: "local-llama", baseUrl: "http://127.0.0.1:8080/v1",
    model: "qwen3-8b", fetchImpl });
}
const reply = (content: string) => async () =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } });

describe("the local rung does not leak reasoning to a learner", () => {
  it("(1) the local request carries a thinking-suppression the server actually honours", async () => {
    const fetchImpl = vi.fn(reply("It feels heavy."));
    await local(fetchImpl as unknown as typeof fetch).generateActorResponse(TURN);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(
      body["chat_template_kwargs"]?.["enable_thinking"],
      "the local rung sends `reasoning:{effort:low}` — an OpenRouter parameter llama-server ignores. "
        + "Its control is chat_template_kwargs.enable_thinking, measured 6/6 clean at the same budget.",
    ).toBe(false);
  });

  it("(3) COUNTERWEIGHT: an UNTERMINATED think block never reaches the learner", async () => {
    // Measured live at max_tokens 256, 2 runs in 3: the budget runs out mid-reasoning and no closing
    // tag is emitted. A strip keyed on <think>…</think> matches nothing and the reasoning ships.
    const truncated = "<think>\nOkay, the user is asking me to describe the pain. Let me recall the "
      + "scenario. The patient mentioned it feels heavy, like someone is sitting on";
    const res = await local(vi.fn(reply(truncated)) as unknown as typeof fetch).generateActorResponse(TURN);
    expect(
      res.text,
      "an unterminated <think> reached the learner verbatim; suppression is a parameter that can be "
        + "dropped or unsupported, so extraction must not depend on the model closing its own tag",
    ).not.toContain("<think>");
    expect(res.text).not.toContain("the user is asking me");
  });

  it("(2) KNOWN-GOOD COLUMN: ox still works — #623's fix must not regress", async () => {
    const Ctor = (gateway as unknown as Record<string, AdapterCtor>)["OpenAiCompatibleModelProviderAdapter"];
    const ox = new Ctor!({ providerId: "ox-alpha", baseUrl: "https://openrouter.ai/api/v1",
      model: "stealth/ox-alpha", apiKey: "k",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: null,
          reasoning: "thinking about the pain" } }],
      }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch });
    const res = await ox.generateActorResponse(TURN);
    expect(res.text?.trim()).toBeTruthy();
    expect(res.responseKind).toBe("spoken_actor_response");
  });
});

/**
 * ## FIXED (#624)
 *
 * Implementation (2026-08-24): two changes in
 * `packages/openclinxr/model-gateway/src/openai-compatible-adapter.ts`.
 *
 * Request (clause 1): the thinking control is now rung-specific. llama-server is controlled by
 * `chat_template_kwargs.enable_thinking` (measured 6/6 clean at the SAME 256 budget); OpenRouter
 * honours `reasoning:{effort:"low"}` and must not receive the llama parameter. The adapter
 * discriminates on `providerId === "local-llama"` — the id `createActorDialogueModelGateway`
 * assigns the local rung (`index.ts:478`) — and sends each rung its own control. The request
 * body is a plain object literal passed straight to `JSON.stringify`
 * (`openai-compatible-adapter.ts:130-142`), so unknown keys are NOT dropped during
 * serialisation; there is no builder defect — the key was simply never added.
 *
 * Response (clause 3, the counterweight): `normaliseAssistantText` first strips closed
 * `<think>…</think>` blocks, then drops everything from an UNTERMINATED `<think>` tag to the
 * end of the string, so a budget-truncated reasoning block (no closing tag, measured 2 in 3 at
 * 256) cannot reach the learner even if suppression is dropped, changed upstream, or
 * unsupported by a future server. When normalisation empties the response entirely (the reply
 * WAS reasoning), the adapter returns the same in-character `blocked_fallback` the guardrail
 * refusal uses, with guardrail reason `reasoning_only_response_suppressed` and the measured
 * latency, instead of throwing — a learner gets a safe line, never a crash and never the
 * reasoning.
 *
 * Unlocked decisions, recorded per the brief:
 *  - Suppression parameter: sent ONLY to the local-llama rung. Sending `chat_template_kwargs`
 *    to OpenRouter could 400 the rung #623 made work.
 *  - max_tokens: NOT raised. The measured fix is 6/6 at the same 256 budget (comp 30-32), so
 *    there is no budget pressure once thinking is off.
 *  - The unterminated-block guard lives in the SAME normaliser as the closed-block strip, so
 *    every candidate from every provider passes through it.
 */
