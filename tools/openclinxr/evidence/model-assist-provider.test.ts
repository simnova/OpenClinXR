import { describe, expect, it } from "vitest";
import {
  createModelAssistProvider,
  validateModelAssistResponse,
} from "./model-assist-provider.js";

describe("model assist provider boundary", () => {
  it("wraps Moonbridge DeepSeek as a swappable local model-assist provider", async () => {
    const requests: unknown[] = [];
    const provider = createModelAssistProvider({
      providerId: "moonbridge_deepseek",
      baseUrl: "http://127.0.0.1:38440/v1/",
      model: "moonbridge",
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as unknown);
        return jsonResponse({
          model: "moonbridge",
          output_text: "Acceptable for first-pass advisory review only; key boundary is local model-assist, not readiness evidence.",
          usage: { input_tokens: 12, output_tokens: 10, total_tokens: 22 },
        });
      },
    });

    const response = await provider.run({
      taskKind: "bounded_policy_contract_probe",
      prompt: "Check boundary.",
      maxOutputTokens: 128,
    });

    expect(requests).toEqual([{ model: "moonbridge", input: "Check boundary.", max_output_tokens: 128 }]);
    expect(response).toMatchObject({
      providerId: "moonbridge_deepseek",
      status: "completed",
      endpoint: "/v1/responses",
      requestShape: "openai_responses_json",
      responseShape: "openai_responses_json",
      requestedModel: "moonbridge",
      responseModel: "moonbridge",
      grade: { result: "useful_first_pass" },
      boundary: {
        localOnly: true,
        localHttpBridgeExceptionApproved: true,
        externalNetworkUsed: false,
        externalPaidApiUsed: false,
        credentialsRequired: false,
        runtimeExecutionAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
      },
    });
    expect(response.boundary.notEvidenceFor).toEqual([
      "runtime_readiness",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "learner_launch_readiness",
    ]);
    expect(validateModelAssistResponse(response)).toEqual({ ok: true });
  });

  it("extracts nested OpenAI-style response content without making the probe Moonbridge-only", async () => {
    const provider = createModelAssistProvider({
      providerId: "moonbridge_deepseek",
      fetchImpl: async () => jsonResponse({
        model: "moonbridge",
        output: [{
          content: [{ type: "output_text", text: "Nested envelope stays local and advisory only." }],
        }],
      }),
    });

    const response = await provider.run({
      taskKind: "asset_pipeline_first_pass_review",
      prompt: "Summarize.",
    });

    expect(response.outputText).toBe("Nested envelope stays local and advisory only.");
    expect(response.grade.result).toBe("useful_first_pass");
  });

  it("fails closed for HTTP and invalid JSON responses", async () => {
    const httpFailure = createModelAssistProvider({
      providerId: "moonbridge_deepseek",
      fetchImpl: async () => jsonResponse({ error: "nope" }, { ok: false, status: 503 }),
    });
    const invalidJson = createModelAssistProvider({
      providerId: "moonbridge_deepseek",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      } as Response),
    });

    await expect(httpFailure.run({ taskKind: "bounded_policy_contract_probe", prompt: "x" })).resolves.toMatchObject({
      status: "blocked",
      responseShape: "invalid_or_unavailable",
      grade: { result: "blocked" },
    });
    await expect(invalidJson.run({ taskKind: "bounded_policy_contract_probe", prompt: "x" })).resolves.toMatchObject({
      status: "blocked",
      responseShape: "invalid_or_unavailable",
      grade: { result: "blocked" },
    });
  });

  it("rejects responses that loosen protected readiness gates", async () => {
    const response = await createModelAssistProvider({
      providerId: "moonbridge_deepseek",
      fetchImpl: async () => jsonResponse({
        model: "moonbridge",
        output_text: "Local advisory only.",
      }),
    }).run({ taskKind: "bounded_policy_contract_probe", prompt: "x" });

    response.boundary.runtimeExecutionAllowed = true as never;
    response.boundary.notEvidenceFor = response.boundary.notEvidenceFor.filter((gate) => gate !== "clinical_validity") as never;

    expect(validateModelAssistResponse(response)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/boundary/runtimeExecutionAllowed must be false",
        "/boundary/notEvidenceFor must include clinical_validity",
      ]),
    });
  });
});

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}
