import type { Model } from "mongoose";
import type {
  AzureStorageQueueEncounterAssetMessage,
  EncounterAssetGenerationQueueMessageEnvelope,
  EncounterAssetGenerationWorkerExecution,
} from "../../capability-gateway/src/index.js";
import type {
  EncounterAssetGenerationJobCheckpointRecord,
  EncounterAssetGenerationJobEvidenceGateRefRecord,
  EncounterAssetGenerationJobRecord,
} from "./encounter-asset-generation-job-model.js";

type LeanEncounterAssetGenerationJobRecord = EncounterAssetGenerationJobRecord & { _id?: unknown };

export class EncounterAssetGenerationJobMongooseRepository {
  constructor(private readonly model: Model<EncounterAssetGenerationJobRecord>) {}

  async ensureIndexes(): Promise<void> {
    await this.model.syncIndexes();
  }

  async saveWorkerExecution(
    message: AzureStorageQueueEncounterAssetMessage,
    envelope: EncounterAssetGenerationQueueMessageEnvelope,
    execution: EncounterAssetGenerationWorkerExecution,
  ): Promise<void> {
    const createdAt = execution.checkpoints[0]?.at ?? new Date().toISOString();
    const updatedAt = execution.checkpoints.at(-1)?.at ?? createdAt;
    const record: EncounterAssetGenerationJobRecord = {
      requestId: message.request.requestId,
      tenantId: message.request.tenantId,
      examRunId: message.request.examRunId,
      encounterId: message.request.encounterId,
      scenarioId: message.request.scenarioId,
      stationId: message.request.stationId,
      queueName: message.queueName,
      azureQueueMessageId: envelope.messageId,
      status: execution.status,
      createdAt,
      updatedAt,
      optimizationWindow: {
        ...message.request.optimizationWindow,
      },
      targetAssetStore: {
        ...message.request.targetAssetStore,
      },
      requestedStages: [...message.request.requestedStages],
      checkpoints: execution.checkpoints.map(toCheckpointRecord),
      evidenceGateRefs: execution.evidenceGateRefs.map(toEvidenceGateRefRecord),
      ...(execution.generatedSceneManifestBlobName
        ? { generatedSceneManifestBlobName: execution.generatedSceneManifestBlobName }
        : {}),
      ...(execution.learnerRuntimeBundleId ? { learnerRuntimeBundleId: execution.learnerRuntimeBundleId } : {}),
      productionReadinessClaimed: false,
    };

    await this.model.findOneAndUpdate(
      { requestId: record.requestId },
      { $set: record },
      { upsert: true, runValidators: true },
    ).exec();
  }

  async findByRequestId(requestId: string): Promise<EncounterAssetGenerationJobRecord | undefined> {
    const record = await this.model.findOne({ requestId })
      .lean<LeanEncounterAssetGenerationJobRecord | null>()
      .exec();
    return record ? withoutMongoId(record) : undefined;
  }
}

function toCheckpointRecord(
  checkpoint: EncounterAssetGenerationWorkerExecution["checkpoints"][number],
): EncounterAssetGenerationJobCheckpointRecord {
  return {
    stage: checkpoint.stage,
    status: checkpoint.status,
    at: checkpoint.at,
    artifactRefs: [...checkpoint.artifactRefs],
    ...(checkpoint.message ? { message: checkpoint.message } : {}),
  };
}

function toEvidenceGateRefRecord(
  gateRef: EncounterAssetGenerationWorkerExecution["evidenceGateRefs"][number],
): EncounterAssetGenerationJobEvidenceGateRefRecord {
  return {
    gateId: gateRef.gateId,
    status: gateRef.status,
    evidenceRefs: [...gateRef.evidenceRefs],
    requiredSignalIds: [...gateRef.requiredSignalIds],
    blockers: [...gateRef.blockers],
    notEvidenceFor: [...gateRef.notEvidenceFor],
  };
}

function withoutMongoId(record: LeanEncounterAssetGenerationJobRecord): EncounterAssetGenerationJobRecord {
  const { _id: _ignored, ...rest } = record;
  return {
    ...rest,
    requestedStages: [...rest.requestedStages],
    checkpoints: rest.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      artifactRefs: [...checkpoint.artifactRefs],
    })),
    evidenceGateRefs: rest.evidenceGateRefs.map((gateRef) => ({
      ...gateRef,
      evidenceRefs: [...gateRef.evidenceRefs],
      requiredSignalIds: [...gateRef.requiredSignalIds],
      blockers: [...gateRef.blockers],
      notEvidenceFor: [...gateRef.notEvidenceFor],
    })),
  };
}
