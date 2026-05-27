import { describe, expect, it } from "vitest";
import {
  createAzureStorageEncounterAssetGenerationQueueClient,
  createEncounterAssetGenerationQueueMessage,
  encodeAzureStorageQueueMessage,
  processNextEncounterAssetGenerationQueueMessage,
  type AzureStorageQueueClientLike,
} from "./index.js";

describe("Azure Storage Queue encounter asset generation client", () => {
  it("adapts one Azure/Azurite queue message into the encounter worker queue boundary", async () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_azure_queue_adapter",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: [
        "encounter-definition-ingested",
        "scene-manifest-freeze",
        "runtime-bundle-publication",
        "review-evidence-gate",
      ],
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 96, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    });
    const calls: unknown[] = [];
    const azureQueueClient: AzureStorageQueueClientLike = {
      async receiveMessages(options) {
        calls.push(["receiveMessages", options]);
        return {
          receivedMessageItems: [
            {
              messageId: "message-1",
              popReceipt: "receipt-1",
              messageText: encodeAzureStorageQueueMessage(message),
              dequeueCount: 1,
            },
          ],
        };
      },
      async deleteMessage(messageId, popReceipt) {
        calls.push(["deleteMessage", messageId, popReceipt]);
      },
    };

    const queueClient = createAzureStorageEncounterAssetGenerationQueueClient(azureQueueClient, {
      visibilityTimeoutSeconds: 600,
    });
    const result = await processNextEncounterAssetGenerationQueueMessage({
      queueClient,
      now: () => "2026-05-23T12:00:00.000Z",
      persistExecution: async () => undefined,
    });

    expect(result).toMatchObject({
      status: "processed",
      messageReceived: true,
      messageDeleted: true,
      envelope: {
        messageId: "message-1",
        popReceipt: "receipt-1",
        dequeueCount: 1,
      },
      execution: {
        requestId: "encounter_assets_azure_queue_adapter",
        status: "review_blocked",
      },
    });
    expect(calls).toEqual([
      ["receiveMessages", { numberOfMessages: 1, visibilityTimeout: 600 }],
      ["deleteMessage", "message-1", "receipt-1"],
    ]);
  });

  it("leaves the worker idle when the Azure/Azurite queue is empty", async () => {
    const azureQueueClient: AzureStorageQueueClientLike = {
      async receiveMessages() {
        return { receivedMessageItems: [] };
      },
      async deleteMessage() {
        throw new Error("delete should not be called");
      },
    };

    await expect(processNextEncounterAssetGenerationQueueMessage({
      queueClient: createAzureStorageEncounterAssetGenerationQueueClient(azureQueueClient),
      persistExecution: async () => undefined,
    })).resolves.toEqual({
      status: "idle",
      messageReceived: false,
    });
  });
});
