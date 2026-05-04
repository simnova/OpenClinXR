import { describe, expect, it } from "vitest";
import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import { createOpenClinXrApiStartup, createNodeServerConfig } from "./index.js";

describe("OpenClinXR API startup", () => {
  it("starts through a CellixJS-inspired fluent bootstrap with Azure-compatible handler metadata", async () => {
    const startup = createOpenClinXrApiStartup().startUp();

    expect(startup.infrastructureServiceIds).toEqual(["scenarioRuntime", "apiPersistence", "telemetry"]);
    expect(startup.handlerSpecs).toEqual([
      {
        name: "graphql-contract",
        trigger: {
          route: "admin/graphql/{*segments}",
          methods: ["GET", "POST", "OPTIONS"],
        },
      },
      {
        name: "rest",
        trigger: {
          route: "{*rest}",
          methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
        },
      },
    ]);

    const response = await startup.fetch(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "openclinxr-api",
    });
  });

  it("creates a local Node server config from the same startup path", async () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createNodeServerConfig(startup, { port: 4321 });

    expect(config.port).toBe(4321);
    const response = await config.fetch(new Request("http://localhost/providers/health"));
    await expect(response.json()).resolves.toMatchObject({
      model: { providerId: "mock-model", status: "ready" },
    });
  });

  it("persists station run queue review snapshots in the default single-user startup", async () => {
    const startup = createOpenClinXrApiStartup().startUp();

    const createResponse = await startup.fetch(
      new Request("http://localhost/exam-blueprints/step2cs-seed/station-run-queue/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshotId: "queue_snapshot_startup_001",
          createdAt: "2026-05-03T18:00:00.000Z",
          reviewerId: "admin_seed_reviewer",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);

    const listResponse = await startup.fetch(new Request("http://localhost/exam-blueprints/step2cs-seed/station-run-queue/snapshots"));
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotId: "queue_snapshot_startup_001",
          reviewerId: "admin_seed_reviewer",
        }),
      ]),
    );
  });

  it("persists scenario review decisions in the default single-user startup", async () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const submitScenarioReviewDocument = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
    const scenarioDetailDocument = adminGraphqlDocumentByOperationName("ScenarioDetail");

    const reviewResponse = await startup.fetch(new Request("http://localhost/admin/graphql", {
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
            comments: "Clinical approval recorded in the default startup sink.",
            evidenceRefs: ["evidence:peds:clinical:startup"],
          },
        },
      }),
    }));

    expect(reviewResponse.status).toBe(200);

    const detailResponse = await startup.fetch(new Request("http://localhost/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: scenarioDetailDocument.source,
        operationName: "ScenarioDetail",
        variables: { scenarioId: "peds_asthma_parent_anxiety_v1", version: 1 },
      }),
    }));

    await expect(detailResponse.json()).resolves.toMatchObject({
      data: {
        scenario: {
          status: "READY_FOR_REVIEW",
          review: {
            clinical: "approved",
          },
        },
      },
    });
  });
});
