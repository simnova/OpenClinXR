import { describe, expect, it, vi } from "vitest";
import { print } from "graphql";
import { CreateStationRunQueueSnapshotDocument, ScenarioBankDocument, ScenarioDetailDocument, StationRunQueueSnapshotsDocument, SubmitScenarioReviewDocument } from "@openclinxr/graphql/client";
import { buildAdminGraphqlEndpoint, createAdminControlPlaneClient, type AdminApolloGraphqlClient } from "./api-client.js";

describe("admin control-plane API client", () => {
  it("builds the Apollo endpoint from the same base URL as fetch-backed GraphQL requests", () => {
    expect(buildAdminGraphqlEndpoint("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001/admin/graphql");
    expect(buildAdminGraphqlEndpoint("")).toBe("/admin/graphql");
  });

  it("reads readiness through stable REST routes and queue snapshots through GraphQL", async () => {
    const listSnapshotsDocument = print(StationRunQueueSnapshotsDocument);
    const createSnapshotDocument = print(CreateStationRunQueueSnapshotDocument);
    const scenarioBankDocument = print(ScenarioBankDocument);
    const scenarioDetailDocument = print(ScenarioDetailDocument);
    const submitScenarioReviewDocument = print(SubmitScenarioReviewDocument);
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
        "/admin/graphql#ScenarioBank": {
          data: {
            scenarios: [
              {
                scenarioId: "ed_chest_pain_priority_v1",
                version: 1,
                title: "ED Chest Pain With Nurse Interruption And Family Pressure",
                status: "APPROVED",
                clinicalObjectives: ["Elicit focused chest pain history and risk factors"],
                requiredTraceTags: ["ecg_request", "urgent_escalation"],
                review: { clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
                governance: {
                  scoreUseLabel: "formative_local_only",
                  syntheticCaseDisclosure: "Synthetic local training scenario; not a validated summative assessment.",
                  validationStage: "stage_1_expert_reviewed",
                  requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
                  sourceIds: ["src-step2cs-public-archive"],
                },
                actors: [
                  { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious" },
                ],
                assetNeeds: [
                  { assetId: "ed_exam_bay_environment", assetType: "environment", licenseStatus: "placeholder-approved" },
                ],
              },
            ],
          },
        },
        "/admin/graphql#ScenarioDetail": {
          data: {
            scenario: {
              scenarioId: "ed_chest_pain_priority_v1",
              version: 1,
              title: "ED Chest Pain With Nurse Interruption And Family Pressure",
              status: "APPROVED",
              clinicalObjectives: ["Elicit focused chest pain history and risk factors"],
              requiredTraceTags: ["ecg_request", "urgent_escalation"],
              review: { clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
              governance: {
                scoreUseLabel: "formative_local_only",
                syntheticCaseDisclosure: "Synthetic local training scenario; not a validated summative assessment.",
                validationStage: "stage_1_expert_reviewed",
                requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
                sourceIds: ["src-step2cs-public-archive"],
              },
              environment: {
                environmentId: "ed_exam_bay_v1",
                name: "Emergency department exam bay",
                description: "Busy ED bay with monitor alarms and nurse interruptions",
              },
              equipment: ["12-lead ECG machine"],
              actors: [
                { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious" },
              ],
              assetNeeds: [
                { assetId: "ed_exam_bay_environment", assetType: "environment", description: "ED bay", licenseStatus: "placeholder-approved" },
              ],
            },
            assetReadiness: {
              scenarioId: "ed_chest_pain_priority_v1",
              devReady: true,
              productionReady: false,
              missingRequiredAssetIds: [],
              blockedAssets: [],
              productionBlockedAssets: [
                { assetId: "patient_robert_hayes_character", blockers: ["placeholder_asset_not_clinical_release_ready"] },
              ],
            },
          },
        },
        "/admin/graphql#StationRunQueueSnapshots": { data: { stationRunQueueSnapshots: [queueSnapshot] } },
        "/admin/graphql#CreateStationRunQueueSnapshot": { data: { createStationRunQueueSnapshot: queueSnapshot } },
        "/admin/graphql#SubmitScenarioReview": {
          data: {
            submitScenarioReview: {
              scenarioId: "peds_asthma_parent_anxiety_v1",
              version: 1,
              title: "Pediatric Asthma With Parent Anxiety",
              status: "READY_FOR_REVIEW",
              clinicalObjectives: ["Assess pediatric respiratory distress"],
              requiredTraceTags: ["oxygen_request"],
              review: { clinical: "approved", psychometric: "draft", legal: "draft", simulationQa: "draft" },
              governance: {
                scoreUseLabel: "formative_local_only",
                syntheticCaseDisclosure: "Synthetic local training scenario.",
                validationStage: "stage_0_synthetic_draft",
                requiredReviewerRoles: ["pediatrician", "psychometrician", "legal", "simulation_qa"],
                sourceIds: ["src-openclinxr-sample-case-bank-v1"],
              },
              environment: null,
              equipment: [],
              actors: [],
              assetNeeds: [],
            },
          },
        },
        "/scenario-bank/assets/readiness": [{ scenarioId: "ed_chest_pain_priority_v1", devReady: true, productionReady: false }],
      }),
    });

    await client.getStep2CsSeedBlueprint();
    await client.getStep2CsSeedBlueprintReadiness();
    await client.getStep2CsSeedTimingPlan();
    await client.getStep2CsSeedStationRunQueue();
    await expect(client.listScenarios({ status: "APPROVED" })).resolves.toEqual([
      expect.objectContaining({
        scenarioId: "ed_chest_pain_priority_v1",
        status: "APPROVED",
        actors: [expect.objectContaining({ displayName: "Robert Hayes" })],
      }),
    ]);
    await expect(client.getScenarioDetail({ scenarioId: "ed_chest_pain_priority_v1", version: 1 })).resolves.toEqual({
      scenario: expect.objectContaining({
        scenarioId: "ed_chest_pain_priority_v1",
        equipment: ["12-lead ECG machine"],
      }),
      assetReadiness: expect.objectContaining({
        devReady: true,
        productionReady: false,
      }),
    });
    await expect(client.submitScenarioReview({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      version: 1,
      reviewerRole: "clinical",
      reviewerId: "pediatrician_001",
      decision: "APPROVED",
      comments: "Clinical review complete.",
      evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
    })).resolves.toEqual(expect.objectContaining({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      status: "READY_FOR_REVIEW",
      review: expect.objectContaining({ clinical: "approved" }),
    }));
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
          operationName: "ScenarioBank",
          query: scenarioBankDocument,
          variables: {
            status: "APPROVED",
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "ScenarioDetail",
          query: scenarioDetailDocument,
          variables: {
            scenarioId: "ed_chest_pain_priority_v1",
            version: 1,
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "SubmitScenarioReview",
          query: submitScenarioReviewDocument,
          variables: {
            input: {
              scenarioId: "peds_asthma_parent_anxiety_v1",
              version: 1,
              reviewerRole: "clinical",
              reviewerId: "pediatrician_001",
              decision: "APPROVED",
              comments: "Clinical review complete.",
              evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
            },
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "StationRunQueueSnapshots",
          query: listSnapshotsDocument,
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
          query: createSnapshotDocument,
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

  it("uses Apollo Client for generated queue snapshot operations when provided", async () => {
    const queueSnapshot = {
      snapshotId: "queue_snapshot_apollo_001",
      createdAt: "2026-05-04T02:30:00.000Z",
      reviewerId: null,
      queue: { canStartLearnerExam: false, stationQueue: [], summary: { activationReady: 1, draftBlocked: 11 } },
    };
    const scenario = {
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      status: "APPROVED",
      clinicalObjectives: [],
      requiredTraceTags: [],
      review: { clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
      governance: {
        scoreUseLabel: "formative_local_only",
        syntheticCaseDisclosure: "Synthetic local training scenario.",
        validationStage: "stage_1_expert_reviewed",
        requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
        sourceIds: ["src-step2cs-public-archive"],
      },
      actors: [],
      environment: null,
      equipment: [],
      assetNeeds: [],
    };
    const apolloClient = {
      query: vi.fn(async ({ query }) => {
        if (query === ScenarioDetailDocument) {
          return {
            data: {
              scenario,
              assetReadiness: {
                scenarioId: "ed_chest_pain_priority_v1",
                devReady: true,
                productionReady: false,
                missingRequiredAssetIds: [],
                blockedAssets: [],
                productionBlockedAssets: [],
              },
            },
          };
        }
        if (query === ScenarioBankDocument) {
          return { data: { scenarios: [scenario] } };
        }
        return { data: { stationRunQueueSnapshots: [queueSnapshot] } };
      }),
      mutate: vi.fn(async ({ mutation }) => {
        if (mutation === SubmitScenarioReviewDocument) {
          return { data: { submitScenarioReview: scenario } };
        }
        return { data: { createStationRunQueueSnapshot: queueSnapshot } };
      }),
    } as unknown as AdminApolloGraphqlClient;
    const fetcher = vi.fn<typeof fetch>();
    const client = createAdminControlPlaneClient({
      apolloClient,
      baseUrl: "http://localhost:8787",
      fetch: fetcher,
    });

    await expect(client.listScenarios({ status: "APPROVED" })).resolves.toEqual([scenario]);
    await expect(client.getScenarioDetail({ scenarioId: "ed_chest_pain_priority_v1", version: 1 })).resolves.toEqual({
      scenario,
      assetReadiness: expect.objectContaining({ devReady: true }),
    });
    await expect(client.submitScenarioReview({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      reviewerRole: "clinical",
      reviewerId: "clinician_001",
      decision: "APPROVED",
      comments: "Approved.",
      evidenceRefs: ["evidence:clinical:2026-05-04"],
    })).resolves.toEqual(scenario);
    await expect(client.listStep2CsSeedStationRunQueueSnapshots()).resolves.toEqual([queueSnapshot]);
    await expect(client.createStep2CsSeedStationRunQueueSnapshot({
      createdAt: "2026-05-04T02:30:00.000Z",
    })).resolves.toEqual(queueSnapshot);

    expect(apolloClient.query).toHaveBeenCalledWith({
      query: ScenarioBankDocument,
      variables: {
        status: "APPROVED",
      },
      fetchPolicy: "network-only",
    });
    expect(apolloClient.query).toHaveBeenCalledWith({
      query: ScenarioDetailDocument,
      variables: {
        scenarioId: "ed_chest_pain_priority_v1",
        version: 1,
      },
      fetchPolicy: "network-only",
    });
    expect(apolloClient.query).toHaveBeenCalledWith({
      query: StationRunQueueSnapshotsDocument,
      variables: {
        blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      },
      fetchPolicy: "network-only",
    });
    expect(apolloClient.mutate).toHaveBeenCalledWith({
      mutation: SubmitScenarioReviewDocument,
      variables: {
        input: {
          scenarioId: "ed_chest_pain_priority_v1",
          version: 1,
          reviewerRole: "clinical",
          reviewerId: "clinician_001",
          decision: "APPROVED",
          comments: "Approved.",
          evidenceRefs: ["evidence:clinical:2026-05-04"],
        },
      },
    });
    expect(apolloClient.mutate).toHaveBeenCalledWith({
      mutation: CreateStationRunQueueSnapshotDocument,
      variables: {
        input: {
          createdAt: "2026-05-04T02:30:00.000Z",
        },
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
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
