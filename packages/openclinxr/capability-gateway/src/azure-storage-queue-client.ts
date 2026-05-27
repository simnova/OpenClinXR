import { QueueServiceClient } from "@azure/storage-queue";
import type {
  EncounterAssetGenerationQueueClient,
  EncounterAssetGenerationQueueMessageEnvelope,
} from "./asset-generation-jobs.js";

type AzureReceivedQueueMessageLike = {
  messageId: string;
  popReceipt: string;
  messageText?: string;
  dequeueCount?: number;
};

export type AzureStorageQueueClientLike = {
  receiveMessages(options?: {
    numberOfMessages?: number;
    visibilityTimeout?: number;
  }): Promise<{
    receivedMessageItems: AzureReceivedQueueMessageLike[];
  }>;
  deleteMessage(messageId: string, popReceipt: string): Promise<unknown>;
};

export function createAzureStorageEncounterAssetGenerationQueueClient(
  queueClient: AzureStorageQueueClientLike,
  options: {
    visibilityTimeoutSeconds?: number;
  } = {},
): EncounterAssetGenerationQueueClient {
  return {
    async receiveEncounterAssetGenerationMessage(): Promise<EncounterAssetGenerationQueueMessageEnvelope | undefined> {
      const response = await queueClient.receiveMessages({
        numberOfMessages: 1,
        ...(options.visibilityTimeoutSeconds ? { visibilityTimeout: options.visibilityTimeoutSeconds } : {}),
      });
      const message = response.receivedMessageItems[0];
      if (!message) {
        return undefined;
      }
      if (!message.messageText) {
        throw new Error("Azure Storage Queue message did not include messageText");
      }
      return {
        messageId: message.messageId,
        popReceipt: message.popReceipt,
        messageText: message.messageText,
        ...(typeof message.dequeueCount === "number" ? { dequeueCount: message.dequeueCount } : {}),
      };
    },
    async deleteEncounterAssetGenerationMessage(messageId: string, popReceipt: string): Promise<void> {
      await queueClient.deleteMessage(messageId, popReceipt);
    },
  };
}

export function createAzureStorageEncounterAssetGenerationQueueClientFromConnectionString(
  connectionString: string,
  options: {
    queueName?: "encounter-asset-generation";
    visibilityTimeoutSeconds?: number;
  } = {},
): EncounterAssetGenerationQueueClient {
  const queueClient = QueueServiceClient
    .fromConnectionString(connectionString)
    .getQueueClient(options.queueName ?? "encounter-asset-generation");
  return createAzureStorageEncounterAssetGenerationQueueClient(queueClient, {
    ...(options.visibilityTimeoutSeconds ? { visibilityTimeoutSeconds: options.visibilityTimeoutSeconds } : {}),
  });
}
