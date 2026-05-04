import type { Model } from "mongoose";
import type { StationRunQueueSnapshotRecord } from "./station-run-queue-snapshot-model.js";

type LeanStationRunQueueSnapshotRecord = StationRunQueueSnapshotRecord & { _id?: unknown };

export class StationRunQueueSnapshotMongooseRepository {
  constructor(private readonly model: Model<StationRunQueueSnapshotRecord>) {}

  async ensureIndexes(): Promise<void> {
    await this.model.syncIndexes();
  }

  async save(record: StationRunQueueSnapshotRecord): Promise<void> {
    await this.model.updateOne(
      { snapshotId: record.snapshotId },
      { $set: record },
      { upsert: true, runValidators: true },
    ).exec();
  }

  async findById(snapshotId: string): Promise<StationRunQueueSnapshotRecord | null> {
    const record = await this.model.findOne({ snapshotId }).lean<LeanStationRunQueueSnapshotRecord>().exec();
    return withoutMongoId(record);
  }

  async listByBlueprint(blueprintId: string): Promise<StationRunQueueSnapshotRecord[]> {
    const records = await this.model.find({ "queue.blueprintId": blueprintId })
      .sort({ createdAt: -1, snapshotId: 1 })
      .lean<LeanStationRunQueueSnapshotRecord[]>()
      .exec();

    return records.map((record) => withoutMongoId(record)).filter((record): record is StationRunQueueSnapshotRecord => Boolean(record));
  }
}

function withoutMongoId(record: LeanStationRunQueueSnapshotRecord | null): StationRunQueueSnapshotRecord | null {
  if (!record) {
    return null;
  }

  const { _id: _ignored, ...rest } = record;
  return rest;
}
