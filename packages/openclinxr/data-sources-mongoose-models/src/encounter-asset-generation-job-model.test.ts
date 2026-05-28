import { Mongoose } from "mongoose";
import { describe, expect, it } from "vitest";
import { createEncounterAssetGenerationJobModel } from "./encounter-asset-generation-job-model.js";

describe("Encounter asset generation job Mongoose model", () => {
  it("defines durable indexes for Azure Queue backed long-running generation", () => {
    const mongoose = new Mongoose();
    const model = createEncounterAssetGenerationJobModel(mongoose);

    expect(model.collection.name).toBe("encounter_asset_generation_jobs");
    expect(model.schema.indexes()).toEqual(expect.arrayContaining([
      [{ requestId: 1 }, { unique: true }],
      [{ tenantId: 1, examRunId: 1, encounterId: 1 }, {}],
      [{ queueName: 1, status: 1, updatedAt: 1 }, {}],
      [{ scenarioId: 1, stationId: 1 }, {}],
    ]));
  });

  it("validates queued jobs with multi-day optimization windows and no production claims", () => {
    const mongoose = new Mongoose();
    const model = createEncounterAssetGenerationJobModel(mongoose);
    const record = new model({
      requestId: "encounter_assets_ed_chest_pain_001",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      queueName: "encounter-asset-generation",
      status: "queued",
      createdAt: "2026-05-23T10:00:00.000Z",
      updatedAt: "2026-05-23T10:00:00.000Z",
      optimizationWindow: {
        expectedMinimumHours: 2,
        expectedMaximumHours: 72,
        mayRunForDays: true,
        checkpointIntervalMinutes: 30,
      },
      targetAssetStore: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/",
      },
      requestedStages: ["character-generation", "scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
      checkpoints: [
        {
          stage: "encounter-definition-ingested",
          status: "queued",
          at: "2026-05-23T10:00:00.000Z",
          artifactRefs: [],
        },
      ],
      productionReadinessClaimed: false,
    });

    expect(record.validateSync()).toBeUndefined();
    expect(record.toObject()).toMatchObject({
      queueName: "encounter-asset-generation",
      productionReadinessClaimed: false,
      optimizationWindow: {
        expectedMaximumHours: 72,
        mayRunForDays: true,
      },
    });
  });
});
