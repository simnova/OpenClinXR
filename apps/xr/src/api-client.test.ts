import { describe, expect, it } from "vitest";
import { createStationApiClient } from "./api-client.js";

describe("XR station API client", () => {
  it("starts a consented session and encounter through the API contract", async () => {
    const requests: RecordedRequest[] = [];
    const client = createStationApiClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
        scenarioId: "ed_chest_pain_priority_v1",
        phase: "doorway",
      }),
    });

    await client.startSession({ learnerId: "learner_001", consentAccepted: true });
    await client.startEncounter("run_ed_chest_pain_priority_v1_learner_001", { atSecond: 60 });

    expect(requests).toEqual([
      {
        url: "http://localhost:8787/sessions",
        method: "POST",
        body: { learnerId: "learner_001", consentAccepted: true },
      },
      {
        url: "http://localhost:8787/sessions/run_ed_chest_pain_priority_v1_learner_001/start-encounter",
        method: "POST",
        body: { atSecond: 60 },
      },
    ]);
  });

  it("records learner trace actions and actor-response requests without hidden facts", async () => {
    const requests: RecordedRequest[] = [];
    const client = createStationApiClient({
      baseUrl: "http://localhost:8787",
      fetch: recordingFetch(requests, { ok: true }),
    });

    await client.recordTraceAction("run_001", {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
      actorId: "nurse_maria_alvarez_v1",
    });
    await client.requestActorResponse("run_001", {
      actorId: "patient_robert_hayes_v1",
      learnerUtterance: "When did this start?",
      atSecond: 120,
      traceContextTags: ["history_opqrst"],
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:8787/sessions/run_001/events",
        method: "POST",
        body: {
          eventType: "learner.order",
          atSecond: 480,
          tag: "ecg_request",
          actorId: "nurse_maria_alvarez_v1",
        },
      },
      {
        url: "http://localhost:8787/sessions/run_001/actor-response",
        method: "POST",
        body: {
          actorId: "patient_robert_hayes_v1",
          learnerUtterance: "When did this start?",
          atSecond: 120,
          traceContextTags: ["history_opqrst"],
        },
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain("hiddenFacts");
  });

  it("throws a useful error when the API returns a non-2xx response", async () => {
    const client = createStationApiClient({
      baseUrl: "http://localhost:8787",
      fetch: async () => new Response(JSON.stringify({ error: "session_not_found" }), { status: 404 }),
    });

    await expect(client.recordTraceAction("missing-run", { eventType: "learner.order", atSecond: 1 })).rejects.toThrow(
      "OpenClinXR API request failed: POST http://localhost:8787/sessions/missing-run/events 404 session_not_found",
    );
  });
});

type RecordedRequest = {
  url: string;
  method: string;
  body: unknown;
};

function recordingFetch(requests: RecordedRequest[], responseBody: unknown): typeof fetch {
  return async (input, init) => {
    requests.push({
      url: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body.toString()) : undefined,
    });

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
