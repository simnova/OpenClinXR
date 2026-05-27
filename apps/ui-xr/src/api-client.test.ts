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

  it("fetches learner runtime asset bundles by opaque bundle id", async () => {
    const requests: RecordedRequest[] = [];
    const client = createStationApiClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
        identityScope: "learner_runtime_opaque_bundle",
        actors: [],
        equipment: [],
        notEvidenceFor: ["quest_readiness"],
      }),
    });

    await expect(client.getLearnerRuntimeAssetBundle("bundle 1/#")).resolves.toMatchObject({
      identityScope: "learner_runtime_opaque_bundle",
    });
    expect(requests).toEqual([
      {
        url: "http://localhost:8787/runtime/asset-bundles/bundle%201%2F%23",
        method: "GET",
        body: undefined,
      },
    ]);
  });

  it("lists learner runtime asset bundle summaries", async () => {
    const requests: RecordedRequest[] = [];
    const client = createStationApiClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        productionCloudCall: false,
        bundles: [
          {
            bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
            scenarioId: "ed_chest_pain_priority_v1",
            stationId: "ed_chest_pain_station_v1",
            identityScope: "learner_runtime_opaque_bundle",
            actorCount: 3,
            equipmentCount: 2,
            retrievalMode: "local_fixture_fallback",
          },
        ],
        notEvidenceFor: ["quest_readiness"],
      }),
    });

    await expect(client.listLearnerRuntimeAssetBundles()).resolves.toMatchObject({
      productionCloudCall: false,
      bundles: [
        expect.objectContaining({
          bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
          actorCount: 3,
        }),
      ],
    });
    expect(requests).toEqual([
      {
        url: "http://localhost:8787/runtime/asset-bundles",
        method: "GET",
        body: undefined,
      },
    ]);
  });

  it("finds learner runtime asset bundle summaries by scenario and station", async () => {
    const requests: RecordedRequest[] = [];
    const client = createStationApiClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        productionCloudCall: false,
        bundles: [
          {
            bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
            scenarioId: "ed_chest_pain_priority_v1",
            stationId: "ed_chest_pain_station_v1",
            identityScope: "learner_runtime_opaque_bundle",
            actorCount: 3,
            equipmentCount: 2,
            retrievalMode: "local_fixture_fallback",
          },
        ],
        notEvidenceFor: ["quest_readiness"],
      }),
    });

    await expect(client.findLearnerRuntimeAssetBundleByScenarioStation({
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
    })).resolves.toMatchObject({
      bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
    });
    expect(requests).toEqual([
      {
        url: "http://localhost:8787/runtime/asset-bundles",
        method: "GET",
        body: undefined,
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
    await client.synthesizeActorSpeech("run_001", {
      actorId: "patient_robert_hayes_v1",
      voiceId: "mock-robert-hayes",
      text: "It started while I was walking upstairs.",
      atSecond: 121,
    });
    await client.listTraceEvents("run_001");

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
      {
        url: "http://localhost:8787/sessions/run_001/voice-synthesis",
        method: "POST",
        body: {
          actorId: "patient_robert_hayes_v1",
          voiceId: "mock-robert-hayes",
          text: "It started while I was walking upstairs.",
          atSecond: 121,
        },
      },
      {
        url: "http://localhost:8787/sessions/run_001/trace-events",
        method: "GET",
        body: undefined,
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
