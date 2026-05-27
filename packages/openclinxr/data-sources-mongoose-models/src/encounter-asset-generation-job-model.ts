import { Schema, type Model, type Mongoose } from "mongoose";

export type EncounterAssetGenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "review_blocked";

export type EncounterAssetGenerationJobCheckpointRecord = {
  stage: string;
  status: EncounterAssetGenerationJobStatus;
  at: string;
  artifactRefs: string[];
  message?: string;
};

export type EncounterAssetGenerationJobEvidenceGateRefRecord = {
  gateId: string;
  status: "pending" | "attached" | "blocked";
  evidenceRefs: string[];
  requiredSignalIds: string[];
  blockers: string[];
  notEvidenceFor: string[];
};

export type EncounterAssetGenerationJobRecord = {
  requestId: string;
  tenantId: string;
  examRunId: string;
  encounterId: string;
  scenarioId: string;
  stationId: string;
  queueName: "encounter-asset-generation";
  azureQueueMessageId?: string;
  status: EncounterAssetGenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  optimizationWindow: {
    expectedMinimumHours: number;
    expectedMaximumHours: number;
    mayRunForDays: boolean;
    checkpointIntervalMinutes: number;
  };
  targetAssetStore: {
    storeKind: "azurite_blob" | "azure_blob";
    containerName: string;
    blobPrefix: string;
  };
  requestedStages: string[];
  checkpoints: EncounterAssetGenerationJobCheckpointRecord[];
  evidenceGateRefs: EncounterAssetGenerationJobEvidenceGateRefRecord[];
  generatedSceneManifestBlobName?: string;
  learnerRuntimeBundleId?: string;
  productionReadinessClaimed: false;
};

const encounterAssetGenerationJobStatusValues = ["queued", "running", "succeeded", "failed", "canceled", "review_blocked"] as const;

const encounterAssetGenerationCheckpointSchema = new Schema<EncounterAssetGenerationJobCheckpointRecord>(
  {
    stage: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: encounterAssetGenerationJobStatusValues },
    at: { type: String, required: true, trim: true },
    artifactRefs: { type: [String], required: true, default: [] },
    message: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const encounterAssetGenerationEvidenceGateRefSchema = new Schema<EncounterAssetGenerationJobEvidenceGateRefRecord>(
  {
    gateId: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ["pending", "attached", "blocked"] },
    evidenceRefs: { type: [String], required: true, default: [] },
    requiredSignalIds: { type: [String], required: true, default: [] },
    blockers: { type: [String], required: true, default: [] },
    notEvidenceFor: { type: [String], required: true, default: [] },
  },
  { _id: false },
);

export const encounterAssetGenerationJobSchema = new Schema<EncounterAssetGenerationJobRecord>(
  {
    requestId: { type: String, required: true, trim: true },
    tenantId: { type: String, required: true, trim: true },
    examRunId: { type: String, required: true, trim: true },
    encounterId: { type: String, required: true, trim: true },
    scenarioId: { type: String, required: true, trim: true },
    stationId: { type: String, required: true, trim: true },
    queueName: { type: String, required: true, enum: ["encounter-asset-generation"] },
    azureQueueMessageId: { type: String, required: false, trim: true },
    status: { type: String, required: true, enum: encounterAssetGenerationJobStatusValues },
    createdAt: { type: String, required: true, trim: true },
    updatedAt: { type: String, required: true, trim: true },
    optimizationWindow: {
      expectedMinimumHours: { type: Number, required: true, min: 0 },
      expectedMaximumHours: { type: Number, required: true, min: 1 },
      mayRunForDays: { type: Boolean, required: true },
      checkpointIntervalMinutes: { type: Number, required: true, min: 1 },
    },
    targetAssetStore: {
      storeKind: { type: String, required: true, enum: ["azurite_blob", "azure_blob"] },
      containerName: { type: String, required: true, trim: true },
      blobPrefix: { type: String, required: true, trim: true },
    },
    requestedStages: { type: [String], required: true, default: [] },
    checkpoints: { type: [encounterAssetGenerationCheckpointSchema], required: true, default: [] },
    evidenceGateRefs: { type: [encounterAssetGenerationEvidenceGateRefSchema], required: true, default: [] },
    generatedSceneManifestBlobName: { type: String, required: false, trim: true },
    learnerRuntimeBundleId: { type: String, required: false, trim: true },
    productionReadinessClaimed: { type: Boolean, required: true, default: false },
  },
  {
    collection: "encounter_asset_generation_jobs",
    timestamps: false,
    versionKey: false,
  },
);

encounterAssetGenerationJobSchema.index({ requestId: 1 }, { unique: true });
encounterAssetGenerationJobSchema.index({ tenantId: 1, examRunId: 1, encounterId: 1 });
encounterAssetGenerationJobSchema.index({ queueName: 1, status: 1, updatedAt: 1 });
encounterAssetGenerationJobSchema.index({ scenarioId: 1, stationId: 1 });

export function createEncounterAssetGenerationJobModel(mongoose: Mongoose): Model<EncounterAssetGenerationJobRecord> {
  return mongoose.models.EncounterAssetGenerationJob as Model<EncounterAssetGenerationJobRecord> | undefined
    ?? mongoose.model<EncounterAssetGenerationJobRecord>("EncounterAssetGenerationJob", encounterAssetGenerationJobSchema);
}
