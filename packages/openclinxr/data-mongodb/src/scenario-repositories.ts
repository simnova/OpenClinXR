import type { Collection, Db } from "mongodb";
import { type ReviewPacket, type Scenario, type TraceEvent, validateReviewPacket, validateScenario } from "@openclinxr/shared-schemas";
import {
  assertValidScenarioReviewDecision,
  assertValidTraceEvent,
  cloneTraceEventForMongo,
} from "./mongo-helpers.js";
import type { ScenarioReviewDecisionRecord } from "./records.js";

export class MongoScenarioRepository {
  private readonly collection: Collection<Scenario>;

  constructor(db: Db) {
    this.collection = db.collection<Scenario>("scenarios");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ scenarioId: 1, version: 1 }, { unique: true });
    await this.collection.createIndex({ status: 1 });
    // approved() / status-filtered bank list: equality on status + sort scenarioId, version
    await this.collection.createIndex({ status: 1, scenarioId: 1, version: 1 });
    await this.collection.createIndex({ "governance.sourceIds": 1, status: 1 });
  }

  async save(scenario: Scenario): Promise<void> {
    const validation = validateScenario(scenario);
    if (!validation.ok) {
      throw new Error(`Invalid scenario: ${validation.errors.join("; ")}`);
    }

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

  async listAll(): Promise<Scenario[]> {
    return this.collection.find({}, { projection: { _id: 0 } }).sort({ scenarioId: 1, version: 1 }).toArray();
  }

  async findLatestById(scenarioId: string): Promise<Scenario | null> {
    return this.collection.find({ scenarioId }, { projection: { _id: 0 } }).sort({ version: -1 }).limit(1).next();
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
    assertValidTraceEvent(event);
    await this.collection.insertOne(cloneTraceEventForMongo(event));
  }

  async upsertMany(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    events.forEach(assertValidTraceEvent);
    await this.collection.bulkWrite(
      events.map((event) => ({
        updateOne: {
          filter: { stationRunId: event.stationRunId, sequence: event.sequence },
          update: { $set: cloneTraceEventForMongo(event) },
          upsert: true,
        },
      })),
      { ordered: true },
    );
  }

  async replay(stationRunId: string): Promise<TraceEvent[]> {
    return this.collection.find({ stationRunId }, { projection: { _id: 0 } }).sort({ sequence: 1 }).toArray();
  }

  async latestSequence(stationRunId: string): Promise<number | null> {
    const latest = await this.collection.find({ stationRunId }, { projection: { _id: 0, sequence: 1 } }).sort({ sequence: -1 }).limit(1).next();
    return latest?.sequence ?? null;
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
    // listByScenario: equality on scenarioId + sort stationRunId
    await this.collection.createIndex({ scenarioId: 1, stationRunId: 1 });
    await this.collection.createIndex({ "facultyScoreDraft.status": 1, scenarioId: 1 });
  }

  async save(packet: ReviewPacket): Promise<void> {
    const validation = validateReviewPacket(packet);
    if (!validation.ok) {
      throw new Error(`Invalid review packet: ${validation.errors.join("; ")}`);
    }

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

export class MongoScenarioReviewDecisionRepository {
  private readonly collection: Collection<ScenarioReviewDecisionRecord>;

  constructor(db: Db) {
    this.collection = db.collection<ScenarioReviewDecisionRecord>("scenario_review_decisions");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ scenarioId: 1, version: 1, reviewerRole: 1, reviewedAt: 1 }, { unique: true });
    await this.collection.createIndex({ scenarioId: 1, version: 1, reviewedAt: 1, reviewerRole: 1, reviewerId: 1 });
  }

  async save(record: ScenarioReviewDecisionRecord): Promise<void> {
    assertValidScenarioReviewDecision(record);
    const storedRecord = {
      ...record,
      evidenceRefs: [...record.evidenceRefs],
    };
    await this.collection.updateOne(
      {
        scenarioId: storedRecord.scenarioId,
        version: storedRecord.version,
        reviewerRole: storedRecord.reviewerRole,
        reviewedAt: storedRecord.reviewedAt,
      },
      { $set: storedRecord },
      { upsert: true },
    );
  }

  async list(): Promise<ScenarioReviewDecisionRecord[]> {
    return this.collection.find({}, { projection: { _id: 0 } })
      .sort({ reviewedAt: 1, scenarioId: 1, version: 1, reviewerRole: 1, reviewerId: 1 })
      .toArray();
  }
}
