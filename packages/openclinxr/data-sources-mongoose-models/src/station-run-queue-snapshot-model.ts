import { type Model, type Mongoose, Schema } from "mongoose";

export type StationRunQueueSnapshotStatus = "activation_ready" | "draft_blocked" | "governance_blocked" | "missing_scenario";

export type StationRunQueueSnapshotItemRecord = {
  stationOrder: number;
  slotId: string;
  label: string;
  scenarioId: string | null;
  scenarioVersion: number | null;
  status: StationRunQueueSnapshotStatus;
  blockers: string[];
};

export type StationRunQueueSnapshotRecord = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: {
    blueprintId: string;
    canStartLearnerExam: boolean;
    stationQueue: StationRunQueueSnapshotItemRecord[];
    summary: {
      activationReady: number;
      draftBlocked: number;
      governanceBlocked: number;
      missingScenario: number;
    };
  };
};

const stationRunQueueSnapshotStatusValues = ["activation_ready", "draft_blocked", "governance_blocked", "missing_scenario"] as const;

const stationRunQueueItemSchema = new Schema<StationRunQueueSnapshotItemRecord>(
  {
    stationOrder: { type: Number, required: true, min: 1 },
    slotId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    scenarioId: { type: String, required: false, trim: true, default: null },
    scenarioVersion: { type: Number, required: false, min: 1, default: null },
    status: { type: String, required: true, enum: stationRunQueueSnapshotStatusValues },
    blockers: { type: [String], required: true, default: [] },
  },
  { _id: false },
);

export const stationRunQueueSnapshotSchema = new Schema<StationRunQueueSnapshotRecord>(
  {
    snapshotId: { type: String, required: true, trim: true },
    createdAt: { type: String, required: true, trim: true },
    reviewerId: { type: String, required: false, trim: true },
    queue: {
      blueprintId: { type: String, required: true, trim: true },
      canStartLearnerExam: { type: Boolean, required: true },
      stationQueue: { type: [stationRunQueueItemSchema], required: true, default: [] },
      summary: {
        activationReady: { type: Number, required: true, min: 0 },
        draftBlocked: { type: Number, required: true, min: 0 },
        governanceBlocked: { type: Number, required: true, min: 0 },
        missingScenario: { type: Number, required: true, min: 0 },
      },
    },
  },
  {
    collection: "station_run_queue_snapshots",
    timestamps: false,
    versionKey: false,
  },
);

stationRunQueueSnapshotSchema.index({ snapshotId: 1 }, { unique: true });
stationRunQueueSnapshotSchema.index({ "queue.blueprintId": 1, createdAt: -1 });
stationRunQueueSnapshotSchema.index({ "queue.stationQueue.scenarioId": 1 });
stationRunQueueSnapshotSchema.index({ "queue.canStartLearnerExam": 1 });

export function createStationRunQueueSnapshotModel(mongoose: Mongoose): Model<StationRunQueueSnapshotRecord> {
  return mongoose.models.StationRunQueueSnapshot as Model<StationRunQueueSnapshotRecord> | undefined
    ?? mongoose.model<StationRunQueueSnapshotRecord>("StationRunQueueSnapshot", stationRunQueueSnapshotSchema);
}
