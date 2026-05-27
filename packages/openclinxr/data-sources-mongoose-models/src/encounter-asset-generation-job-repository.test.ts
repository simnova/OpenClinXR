import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEncounterAssetGenerationJobModel,
  EncounterAssetGenerationJobMongooseRepository,
} from "./index.js";
import {
  createEncounterAssetGenerationQueueMessage,
  encodeAzureStorageQueueMessage,
  processEncounterAssetGenerationQueueMessage,
  type EncounterAssetGenerationQueueMessageEnvelope,
} from "../../capability-gateway/src/index.js";
import { createMongooseMemoryTestContext, type MongooseMemoryTestContext } from "./mongoose-memory-context.js";

describe("Encounter asset generation job Mongoose repository", () => {
  let context: MongooseMemoryTestContext;
  let repository: EncounterAssetGenerationJobMongooseRepository;

  beforeAll(async () => {
    context = await createMongooseMemoryTestContext();
    repository = new EncounterAssetGenerationJobMongooseRepository(createEncounterAssetGenerationJobModel(context.mongoose));
    await repository.ensureIndexes();
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  it("persists queue worker execution checkpoints before queue deletion", async () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_ed_chest_pain_001",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/",
      },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: [
        "encounter-definition-ingested",
        "character-generation",
        "scene-manifest-freeze",
        "runtime-bundle-publication",
        "review-evidence-gate",
      ],
      optimizationWindow: {
        expectedMinimumHours: 2,
        expectedMaximumHours: 96,
        mayRunForDays: true,
        checkpointIntervalMinutes: 30,
      },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: {
        allowPaidCloudApis: false,
        allowProductionDeployment: false,
        productionReadinessClaimed: false,
      },
    });
    let clock = 0;
    const execution = await processEncounterAssetGenerationQueueMessage(encodeAzureStorageQueueMessage(message), {
      now: () => `2026-05-23T12:${String(clock++).padStart(2, "0")}:00.000Z`,
    });
    const envelope: EncounterAssetGenerationQueueMessageEnvelope = {
      messageId: "queue-message-1",
      popReceipt: "receipt-1",
      messageText: encodeAzureStorageQueueMessage(message),
      dequeueCount: 1,
    };

    await repository.saveWorkerExecution(message, envelope, execution);

    await expect(repository.findByRequestId("encounter_assets_ed_chest_pain_001")).resolves.toMatchObject({
      requestId: "encounter_assets_ed_chest_pain_001",
      azureQueueMessageId: "queue-message-1",
      status: "review_blocked",
      createdAt: "2026-05-23T12:00:00.000Z",
      updatedAt: "2026-05-23T12:09:00.000Z",
      optimizationWindow: {
        expectedMaximumHours: 96,
        mayRunForDays: true,
      },
      targetAssetStore: {
        storeKind: "azurite_blob",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/",
      },
      generatedSceneManifestBlobName: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/scene-manifest.v1.json",
      learnerRuntimeBundleId: "encounter_1:learner-runtime-bundle:v1",
      productionReadinessClaimed: false,
      evidenceGateRefs: [
        expect.objectContaining({
          gateId: "asset_production_review",
          status: "pending",
          blockers: ["asset_production_review_not_attached_to_generation_job"],
        }),
        expect.objectContaining({
          gateId: "runtime_realism_evidence",
          status: "pending",
          requiredSignalIds: expect.arrayContaining(["animated_humanoid_runtime_playback"]),
        }),
        expect.objectContaining({
          gateId: "visual_qa_evidence",
          status: "pending",
        }),
        expect.objectContaining({
          gateId: "quest_runtime_evidence",
          status: "pending",
        }),
      ],
    });
    const persisted = await repository.findByRequestId("encounter_assets_ed_chest_pain_001");
    expect(persisted?.checkpoints.at(-1)).toMatchObject({
      stage: "review-evidence-gate",
      status: "review_blocked",
      artifactRefs: ["scenario-assets/ed_chest_pain_priority_v1/encounter_1/review-gate.required.json"],
    });
    persisted?.evidenceGateRefs[0]?.blockers.push("mutated");
    const reloaded = await repository.findByRequestId("encounter_assets_ed_chest_pain_001");
    expect(reloaded?.evidenceGateRefs[0]?.blockers).not.toContain("mutated");
  });
});
