import { createApiApp } from "@openclinxr/api";
import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
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
});
