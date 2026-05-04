import type { ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import type { ExamForm, ExamStationRunQueue } from "@openclinxr/exam-assembly";
import type { Collection, Db } from "mongodb";

export type ExamStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
};

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

  async upsertMany(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.collection.bulkWrite(
      events.map((event) => ({
        updateOne: {
          filter: { stationRunId: event.stationRunId, sequence: event.sequence },
          update: { $set: event },
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

export class MongoExamFormRepository {
  private readonly collection: Collection<ExamForm>;

  constructor(db: Db) {
    this.collection = db.collection<ExamForm>("exam_forms");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ examFormId: 1 }, { unique: true });
    await this.collection.createIndex({ blueprintId: 1, status: 1 });
  }

  async save(form: ExamForm): Promise<void> {
    await this.collection.updateOne(
      { examFormId: form.examFormId },
      { $set: form },
      { upsert: true },
    );
  }

  async findById(examFormId: string): Promise<ExamForm | null> {
    return this.collection.findOne({ examFormId }, { projection: { _id: 0 } });
  }

  async listByBlueprint(blueprintId: string): Promise<ExamForm[]> {
    return this.collection.find({ blueprintId }, { projection: { _id: 0 } }).sort({ examFormId: 1 }).toArray();
  }
}

export class MongoStationRunQueueRepository {
  private readonly collection: Collection<ExamStationRunQueueSnapshot>;

  constructor(db: Db) {
    this.collection = db.collection<ExamStationRunQueueSnapshot>("station_run_queue_snapshots");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ snapshotId: 1 }, { unique: true });
    await this.collection.createIndex({ "queue.blueprintId": 1, createdAt: -1 });
    await this.collection.createIndex({ "queue.stationQueue.scenarioId": 1 });
  }

  async save(snapshot: ExamStationRunQueueSnapshot): Promise<void> {
    await this.collection.updateOne(
      { snapshotId: snapshot.snapshotId },
      { $set: snapshot },
      { upsert: true },
    );
  }

  async findById(snapshotId: string): Promise<ExamStationRunQueueSnapshot | null> {
    return this.collection.findOne({ snapshotId }, { projection: { _id: 0 } });
  }

  async listByBlueprint(blueprintId: string): Promise<ExamStationRunQueueSnapshot[]> {
    return this.collection.find({ "queue.blueprintId": blueprintId }, { projection: { _id: 0 } }).sort({ createdAt: -1, snapshotId: 1 }).toArray();
  }
}

export class MongoApiPersistenceSink {
  private readonly examForms: MongoExamFormRepository;
  private readonly traces: MongoTraceRepository;
  private readonly reviewPackets: MongoReviewPacketRepository;

  constructor(db: Db) {
    this.examForms = new MongoExamFormRepository(db);
    this.traces = new MongoTraceRepository(db);
    this.reviewPackets = new MongoReviewPacketRepository(db);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([this.examForms.ensureIndexes(), this.traces.ensureIndexes(), this.reviewPackets.ensureIndexes()]);
  }

  async saveExamForm(form: ExamForm): Promise<void> {
    await this.examForms.save(form);
  }

  async saveTraceEvents(_stationRunId: string, events: TraceEvent[]): Promise<void> {
    await this.traces.upsertMany(events);
  }

  async saveReviewPacket(_stationRunId: string, packet: ReviewPacket): Promise<void> {
    await this.reviewPackets.save(packet);
  }
}

export function createMongoApiPersistenceSink(db: Db): MongoApiPersistenceSink {
  return new MongoApiPersistenceSink(db);
}
