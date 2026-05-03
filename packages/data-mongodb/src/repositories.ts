import type { ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import type { Collection, Db } from "mongodb";

export class MongoScenarioRepository {
  private readonly collection: Collection<Scenario>;

  constructor(db: Db) {
    this.collection = db.collection<Scenario>("scenarios");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ scenarioId: 1, version: 1 }, { unique: true });
    await this.collection.createIndex({ status: 1 });
  }

  async save(scenario: Scenario): Promise<void> {
    await this.collection.updateOne(
      { scenarioId: scenario.scenarioId, version: scenario.version },
      { $set: scenario },
      { upsert: true },
    );
  }

  async findByIdAndVersion(scenarioId: string, version: number): Promise<Scenario | null> {
    return this.collection.findOne({ scenarioId, version }, { projection: { _id: 0 } });
  }

  async approved(): Promise<Scenario[]> {
    return this.collection.find({ status: "approved" }, { projection: { _id: 0 } }).sort({ scenarioId: 1, version: 1 }).toArray();
  }
}

export class MongoTraceRepository {
  private readonly collection: Collection<TraceEvent>;

  constructor(db: Db) {
    this.collection = db.collection<TraceEvent>("trace_events");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stationRunId: 1, sequence: 1 }, { unique: true });
    await this.collection.createIndex({ stationRunId: 1, atSecond: 1 });
    await this.collection.createIndex({ stationRunId: 1, tag: 1 });
  }

  async append(event: TraceEvent): Promise<void> {
    await this.collection.insertOne(event);
  }

  async replay(stationRunId: string): Promise<TraceEvent[]> {
    return this.collection.find({ stationRunId }, { projection: { _id: 0 } }).sort({ sequence: 1 }).toArray();
  }
}

export class MongoReviewPacketRepository {
  private readonly collection: Collection<ReviewPacket>;

  constructor(db: Db) {
    this.collection = db.collection<ReviewPacket>("review_packets");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stationRunId: 1 }, { unique: true });
    await this.collection.createIndex({ scenarioId: 1 });
  }

  async save(packet: ReviewPacket): Promise<void> {
    await this.collection.updateOne(
      { stationRunId: packet.stationRunId },
      { $set: packet },
      { upsert: true },
    );
  }

  async findByStationRunId(stationRunId: string): Promise<ReviewPacket | null> {
    return this.collection.findOne({ stationRunId }, { projection: { _id: 0 } });
  }

  async listByScenario(scenarioId: string): Promise<ReviewPacket[]> {
    return this.collection.find({ scenarioId }, { projection: { _id: 0 } }).sort({ stationRunId: 1 }).toArray();
  }
}
