import { describe, expect, it } from "vitest";
import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql/documents";
import { createAdminControlPlaneClient } from "./api-client.js";

describe("admin control-plane API client", () => {
  it("reads readiness through stable REST routes and queue snapshots through GraphQL", async () => {
    const listSnapshotsDocument = adminGraphqlDocumentByOperationName("StationRunQueueSnapshots");
    const createSnapshotDocument = adminGraphqlDocumentByOperationName("CreateStationRunQueueSnapshot");
    const requests: RecordedRequest[] = [];
    const queueSnapshot = {
      snapshotId: "queue_snapshot_ui_001",
      createdAt: "2026-05-03T17:00:00.000Z",
      reviewerId: "psychometrician_001",
      queue: { canStartLearnerExam: false, stationQueue: new Array(12).fill(null), summary: { activationReady: 1, draftBlocked: 11 } },
    };
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        "/exam-blueprints/step2cs-seed": { stationSlots: new Array(12).fill(null), timing: { breakAfterStationOrders: [3, 6, 9] } },
        "/exam-blueprints/step2cs-seed/readiness": { canAssembleReadyForm: false, blockedScenarioIds: new Array(11).fill(null) },
        "/exam-blueprints/step2cs-seed/timing-plan": { stationWindows: new Array(12).fill(null), totalStationTimeSeconds: 18720 },
        "/exam-blueprints/step2cs-seed/station-run-queue": { canStartLearnerExam: false, stationQueue: new Array(12).fill(null) },
        "/admin/graphql#StationRunQueueSnapshots": { data: { stationRunQueueSnapshots: [queueSnapshot] } },
        "/admin/graphql#CreateStationRunQueueSnapshot": { data: { createStationRunQueueSnapshot: queueSnapshot } },
        "/scenario-bank/assets/readiness": [{ scenarioId: "ed_chest_pain_priority_v1", devReady: true, productionReady: false }],
      }),
    });

    await client.getStep2CsSeedBlueprint();
    await client.getStep2CsSeedBlueprintReadiness();
    await client.getStep2CsSeedTimingPlan();
    await client.getStep2CsSeedStationRunQueue();
    await expect(client.listStep2CsSeedStationRunQueueSnapshots()).resolves.toEqual([queueSnapshot]);
    await expect(client.createStep2CsSeedStationRunQueueSnapshot({
      snapshotId: "queue_snapshot_ui_001",
      reviewerId: "psychometrician_001",
      createdAt: "2026-05-03T17:00:00.000Z",
    })).resolves.toEqual(queueSnapshot);
    await client.getScenarioBankAssetReadiness();

    expect(requests).toEqual([
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/readiness", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/timing-plan", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/station-run-queue", method: "GET" },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "StationRunQueueSnapshots",
          query: listSnapshotsDocument.source,
          variables: {
            blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "CreateStationRunQueueSnapshot",
          query: createSnapshotDocument.source,
          variables: {
            input: {
              snapshotId: "queue_snapshot_ui_001",
              reviewerId: "psychometrician_001",
              createdAt: "2026-05-03T17:00:00.000Z",
            },
          },
        }),
      },
      { url: "http://localhost:8787/scenario-bank/assets/readiness", method: "GET" },
    ]);
  });

  it("throws an actionable error when GraphQL returns errors", async () => {
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787",
      fetch: recordingFetch([], {
        "/admin/graphql#CreateStationRunQueueSnapshot": {
          errors: [{ message: "reviewer_not_authorized" }],
        },
      }),
    });

    await expect(client.createStep2CsSeedStationRunQueueSnapshot({
          snapshotId: "queue_snapshot_ui_001",
          reviewerId: "psychometrician_001",
          createdAt: "2026-05-03T17:00:00.000Z",
    })).rejects.toThrow("OpenClinXR admin GraphQL request failed: CreateStationRunQueueSnapshot reviewer_not_authorized");
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
  body?: unknown;
};

function recordingFetch(requests: RecordedRequest[], responseByPath: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requests.push({
      url,
      method: init?.method ?? "GET",
      ...(body !== undefined ? { body } : {}),
    });
    const responseKey = requestUrl.pathname === "/admin/graphql" && isRecord(body) && typeof body.operationName === "string"
      ? `${requestUrl.pathname}#${body.operationName}`
      : requestUrl.pathname;

    return new Response(JSON.stringify(responseByPath[responseKey] ?? { ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
