import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildMoonbridgeDeepSeekDirectProbe,
  validateMoonbridgeDeepSeekDirectProbe,
} from "./moonbridge-deepseek-direct-probe.js";

describe("Moonbridge DeepSeek direct probe", () => {
  it("exposes package scripts for the local model-assist probe", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["local:moonbridge:probe"]).toBe("tsx tools/openclinxr/evidence/moonbridge-deepseek-direct-probe.ts");
    expect(rootPackage.scripts["local:moonbridge:validate"]).toBe("tsx tools/openclinxr/evidence/moonbridge-deepseek-direct-probe.ts --validate-latest");
  });

  it("builds the durable Moonbridge probe through the swappable provider boundary", async () => {
    const probe = await buildMoonbridgeDeepSeekDirectProbe({
      now: "2026-06-05T12:00:00.000Z",
      baseUrl: "http://127.0.0.1:38440/v1/",
      prompt: "Boundary check",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          model: "moonbridge",
          output_text: "Acceptable for first-pass advisory review only; key boundary is no readiness evidence.",
          usage: { input_tokens: 5, output_tokens: 8, total_tokens: 13 },
        }),
      } as Response),
    });

    expect(probe).toMatchObject({
      schemaVersion: "openclinxr.moonbridge-deepseek-direct-probe.v1",
      generatedAt: "2026-06-05T12:00:00.000Z",
      providerBoundary: "local_http_bridge_exception_approved_by_operator",
      providerId: "moonbridge_deepseek",
      baseUrl: "http://127.0.0.1:38440/v1",
      endpoint: "/v1/responses",
      requestShape: "openai_responses_json",
      responseShape: "openai_responses_json",
      requestedModel: "moonbridge",
      responseModel: "moonbridge",
      status: "completed",
      grade: { result: "useful_first_pass" },
      providerExecutionAllowed: true,
      externalPaidApiUsed: false,
      credentialsRequired: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    });
    expect(probe.notEvidenceFor).toEqual([
      "runtime_readiness",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "learner_launch_readiness",
    ]);
    expect(validateMoonbridgeDeepSeekDirectProbe(probe)).toEqual({ ok: true, errors: [] });
  });

  it("keeps the durable probe valid but blocked when the provider bridge is unavailable", async () => {
    const probe = await buildMoonbridgeDeepSeekDirectProbe({
      now: "2026-06-05T12:00:00.000Z",
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "offline" }),
      } as Response),
    });

    expect(probe).toMatchObject({
      status: "blocked",
      responseShape: "invalid_or_unavailable",
      grade: {
        result: "blocked",
        recommendedUse: "skip_until_bridge_recovers",
      },
      runtimeExecutionAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    });
    expect(validateMoonbridgeDeepSeekDirectProbe(probe)).toEqual({ ok: true, errors: [] });
  });
});
