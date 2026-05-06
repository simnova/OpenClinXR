import { createApiApp } from "@openclinxr/api";
import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import type { AsyncDurableMultiActorSessionStore } from "@openclinxr/session-state";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMongoApiPersistenceSink } from "./index.js";
import { createMongoMemoryTestContext, type MongoMemoryTestContext } from "./mongo-memory-context.js";

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

describe("Mongo-backed API persistence sink", () => {
  let context: MongoMemoryTestContext;

  beforeAll(async () => {
    context = await createMongoMemoryTestContext();
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  it("replays scenario review decisions after API app recreation", async () => {
    const sink = createMongoApiPersistenceSink(context.db);
    await sink.ensureIndexes();

    const submitScenarioReviewDocument = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
    const scenarioReviewDecisionsDocument = adminGraphqlDocumentByOperationName("ScenarioReviewDecisions");
    const scenarioDetailDocument = adminGraphqlDocumentByOperationName("ScenarioDetail");
    const app = createApiApp(undefined, sink);
    const reviewResponse = await app.request("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: submitScenarioReviewDocument.source,
        operationName: "SubmitScenarioReview",
        variables: {
          input: {
            scenarioId: "peds_asthma_parent_anxiety_v1",
            version: 1,
            reviewerRole: "clinical",
            reviewerId: "pediatrician_001",
            decision: "APPROVED",
            comments: "Clinical objectives are plausible for local formative review.",
            evidenceRefs: ["evidence:peds:clinical:mongo-restart"],
          },
        },
      }),
    });

    expect(reviewResponse.status).toBe(200);
    await expect(json(reviewResponse)).resolves.toMatchObject({
      data: {
        submitScenarioReview: {
          scenarioId: "peds_asthma_parent_anxiety_v1",
          review: { clinical: "approved" },
        },
      },
    });

    const restartedSink = createMongoApiPersistenceSink(context.db);
    await restartedSink.ensureIndexes();
    const restartedApp = createApiApp(undefined, restartedSink);
    const restartedDetailResponse = await restartedApp.request("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: scenarioDetailDocument.source,
        operationName: "ScenarioDetail",
        variables: { scenarioId: "peds_asthma_parent_anxiety_v1", version: 1 },
      }),
    });
    const restartedDetail = await json(restartedDetailResponse) as {
      data?: {
        scenario: {
          scenarioId: string;
          status: string;
          review: { clinical: string; psychometric: string; legal: string; simulationQa: string };
          actors: Array<{ hiddenFacts?: string[] }>;
        } | null;
      };
      errors?: Array<{ message: string }>;
    };

    expect(restartedDetailResponse.status).toBe(200);
    expect(restartedDetail.errors).toBeUndefined();
    expect(restartedDetail.data?.scenario).toMatchObject({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      status: "READY_FOR_REVIEW",
      review: {
        clinical: "approved",
        psychometric: "draft",
        legal: "draft",
        simulationQa: "draft",
      },
    });
    expect(JSON.stringify(restartedDetail)).not.toContain("hiddenFacts");

    const restartedDecisionsResponse = await restartedApp.request("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: scenarioReviewDecisionsDocument.source,
        operationName: "ScenarioReviewDecisions",
        variables: { scenarioId: "peds_asthma_parent_anxiety_v1", version: 1 },
      }),
    });
    const restartedDecisions = await json(restartedDecisionsResponse) as {
      data?: {
        scenarioReviewDecisions: Array<{
          scenarioId: string;
          reviewerRole: string;
          reviewerId: string;
          decision: string;
          evidenceRefs: string[];
        }>;
      };
      errors?: Array<{ message: string }>;
    };

    expect(restartedDecisionsResponse.status).toBe(200);
    expect(restartedDecisions.errors).toBeUndefined();
    expect(restartedDecisions.data?.scenarioReviewDecisions).toEqual([
      expect.objectContaining({
        scenarioId: "peds_asthma_parent_anxiety_v1",
        reviewerRole: "clinical",
        reviewerId: "pediatrician_001",
        decision: "approved",
        evidenceRefs: ["evidence:peds:clinical:mongo-restart"],
      }),
    ]);
    expect(JSON.stringify(restartedDecisions)).not.toContain("hiddenFacts");
  });

  it("replays durable multi-actor records after persistence sink recreation without API route wiring", async () => {
    const stationRunId = "station_run_api_sink_restart_durable_multi_actor_001";
    const sink: AsyncDurableMultiActorSessionStore = createMongoApiPersistenceSink(context.db);
    await sink.ensureIndexes?.();
    await sink.saveConversationTurn({
      turnId: "turn_001_spouse_anna_hayes_v1_120",
      stationRunId,
      actorId: "spouse_anna_hayes_v1",
      atSecond: 120,
      sourceKind: "voice_transcript",
      text: "Anna, what happened right before he came in?",
      traceContextTags: ["history_onset", "family_collateral"],
      emotionalState: "anxious",
      routingReason: "addressed_actor_name",
      rawAudioStored: false,
      provenanceRefs: ["trace:voice_stream_station_001:segment_0008_final"],
      durableStore: "database_source_of_truth",
    });
    await sink.saveClinicalEvent({
      clinicalEventId: "event_001_ecg_order",
      stationRunId,
      actorId: "nurse_maria_alvarez_v1",
      atSecond: 180,
      eventKind: "order_status_changed",
      traceTag: "ecg_request",
      label: "12-lead ECG",
      status: "requested",
      payload: {
        public: {
          orderId: "order_1_ecg_request",
          requestedOrder: "12-lead ECG",
        },
        private: {
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
          serverOnlyNotes: ["Recent cocaine use remains hidden until elicited."],
        },
      },
      provenanceRefs: ["trace:station_run_api_sink_restart_durable_multi_actor_001:180"],
      durableStore: "database_source_of_truth",
    });

    const restartedSink: AsyncDurableMultiActorSessionStore = createMongoApiPersistenceSink(context.db);
    await restartedSink.ensureIndexes?.();

    await expect(restartedSink.listConversationTurns(stationRunId)).resolves.toEqual([
      expect.objectContaining({
        turnId: "turn_001_spouse_anna_hayes_v1_120",
        stationRunId,
        actorId: "spouse_anna_hayes_v1",
        rawAudioStored: false,
        durableStore: "database_source_of_truth",
      }),
    ]);
    await expect(restartedSink.listClinicalEventReviewProjections(stationRunId)).resolves.toEqual([
      expect.objectContaining({
        clinicalEventId: "event_001_ecg_order",
        stationRunId,
        privatePayloadRedacted: true,
        payload: {
          orderId: "order_1_ecg_request",
          requestedOrder: "12-lead ECG",
        },
      }),
    ]);
    expect(JSON.stringify(await restartedSink.listClinicalEventReviewProjections(stationRunId))).not.toContain("Recent cocaine use");
  });
});
