import { describe, expect, it } from "vitest";
import { createAdminControlPlaneClient } from "./api-client.js";

describe("admin control-plane API client", () => {
  it("reads the seed exam blueprint, timing plan, and scenario-bank asset readiness through stable REST routes", async () => {
    const requests: RecordedRequest[] = [];
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        "/exam-blueprints/step2cs-seed": { stationSlots: new Array(12).fill(null), timing: { breakAfterStationOrders: [3, 6, 9] } },
        "/exam-blueprints/step2cs-seed/readiness": { canAssembleReadyForm: false, blockedScenarioIds: new Array(11).fill(null) },
        "/exam-blueprints/step2cs-seed/timing-plan": { stationWindows: new Array(12).fill(null), totalStationTimeSeconds: 18720 },
        "/scenario-bank/assets/readiness": [{ scenarioId: "ed_chest_pain_priority_v1", devReady: true, productionReady: false }],
      }),
    });

    await client.getStep2CsSeedBlueprint();
    await client.getStep2CsSeedBlueprintReadiness();
    await client.getStep2CsSeedTimingPlan();
    await client.getScenarioBankAssetReadiness();

    expect(requests).toEqual([
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/readiness", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/timing-plan", method: "GET" },
      { url: "http://localhost:8787/scenario-bank/assets/readiness", method: "GET" },
    ]);
  });

  it("throws an actionable error when a control-plane request fails", async () => {
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787",
      fetch: async () =>
        new Response(JSON.stringify({ error: "route_not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.getStep2CsSeedTimingPlan()).rejects.toThrow(
      "OpenClinXR admin API request failed: GET http://localhost:8787/exam-blueprints/step2cs-seed/timing-plan 404 route_not_found",
    );
  });
});

type RecordedRequest = {
  url: string;
  method: string;
};

function recordingFetch(requests: RecordedRequest[], responseByPath: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);
    requests.push({
      url,
      method: init?.method ?? "GET",
    });

    return new Response(JSON.stringify(responseByPath[requestUrl.pathname] ?? { ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
