import type { ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import type { ExamForm, ExamStationRunQueue } from "@openclinxr/exam-assembly";
import type {
  AsyncDurableMultiActorSessionStore,
  DurableClinicalEventReviewProjection,
  DurableClinicalEventRecord,
  DurableConversationTurnRecord,
  DurableEmotionalStateTimelineRecord,
} from "@openclinxr/session-state";
import { projectDurableClinicalEventForReview } from "@openclinxr/session-state";
import type { Collection, Db } from "mongodb";

export type ExamStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
};

export type ScenarioReviewDecisionRecord = {
  scenarioId: string;
  version: number;
  reviewerRole: "clinical" | "psychometric" | "legal" | "simulationQa";
  reviewerId: string;
  decision: "approved" | "changes_requested";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

export const durableActorTurnPersistenceScope = {
  approvedProposal: "proposals/approved/proposal-durable-actor-turn-persistence-promotion.md",
  actorTurnScope: "conversation_turns_and_emotional_state_timeline_only",
  clinicalActionsIncluded: false,
  redisRedkaIncluded: false,
  databaseOnly: true,
  notEvidenceFor: [
    "api_runtime_wiring",
    "redis_redka_cache_layer",
    "realtime_synchronization",
    "clinical_record_retention_policy",
  ],
} as const;

export const durableClinicalEventPersistenceScope = {
  approvedProposal: "proposals/approved/proposal-durable-clinical-event-persistence.md",
  eventScope: "clinical_actions_orders_findings_checklists_rubric_and_case_progress",
  idempotencyBehavior: "clinical_event_id_is_insert_once_status_history_uses_distinct_event_ids",
  actorTurnScopeChanged: false,
  redisRedkaIncluded: false,
  databaseOnly: true,
  notEvidenceFor: [
    "api_runtime_wiring",
    "redis_redka_cache_layer",
    "realtime_synchronization",
    "clinical_record_retention_policy",
    "clinical_assessment_validity",
  ],
} as const;

export class MongoDurableConversationTurnRepository {
  private readonly collection: Collection<DurableConversationTurnRecord>;

  constructor(db: Db) {
    this.collection = db.collection<DurableConversationTurnRecord>("durable_conversation_turns");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stationRunId: 1, turnId: 1 }, { unique: true });
    await this.collection.createIndex({ stationRunId: 1, atSecond: 1, turnId: 1 });
    await this.collection.createIndex({ stationRunId: 1, actorId: 1, atSecond: 1 });
  }

  async save(record: DurableConversationTurnRecord): Promise<void> {
    assertDatabaseSourceOfTruth(record);
    const storedRecord = cloneConversationTurnForMongo(record);
    await this.collection.updateOne(
      { stationRunId: storedRecord.stationRunId, turnId: storedRecord.turnId },
      { $setOnInsert: storedRecord },
      { upsert: true },
    );
  }

  async listByStationRunId(stationRunId: string): Promise<DurableConversationTurnRecord[]> {
    return this.collection.find({ stationRunId }, { projection: { _id: 0 } })
      .sort({ atSecond: 1, turnId: 1 })
      .toArray();
  }
}

export class MongoDurableClinicalEventRepository {
  private readonly collection: Collection<DurableClinicalEventRecord>;

  constructor(db: Db) {
    this.collection = db.collection<DurableClinicalEventRecord>("durable_clinical_events");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stationRunId: 1, clinicalEventId: 1 }, { unique: true });
    await this.collection.createIndex({ stationRunId: 1, atSecond: 1, clinicalEventId: 1 });
    await this.collection.createIndex({ stationRunId: 1, eventKind: 1, atSecond: 1 });
    await this.collection.createIndex({ stationRunId: 1, traceTag: 1, atSecond: 1 });
  }

  async save(record: DurableClinicalEventRecord): Promise<void> {
    assertDatabaseSourceOfTruth(record);
    const storedRecord = cloneClinicalEventForMongo(record);
    await this.collection.updateOne(
      { stationRunId: storedRecord.stationRunId, clinicalEventId: storedRecord.clinicalEventId },
      { $setOnInsert: storedRecord },
      { upsert: true },
    );
  }

  async listByStationRunId(stationRunId: string): Promise<DurableClinicalEventRecord[]> {
    return this.collection.find({ stationRunId }, { projection: { _id: 0 } })
      .sort({ atSecond: 1, clinicalEventId: 1 })
      .toArray();
  }

  async listReviewProjectionsByStationRunId(stationRunId: string): Promise<DurableClinicalEventReviewProjection[]> {
    const records = await this.listByStationRunId(stationRunId);
    return records.map(projectDurableClinicalEventForReview);
  }
}

export class MongoDurableEmotionalStateTimelineRepository {
  private readonly collection: Collection<DurableEmotionalStateTimelineRecord>;

  constructor(db: Db) {
    this.collection = db.collection<DurableEmotionalStateTimelineRecord>("durable_emotional_state_timeline");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stationRunId: 1, actorId: 1, sourceTurnId: 1 }, { unique: true });
    await this.collection.createIndex({ stationRunId: 1, actorId: 1, atSecond: 1, sourceTurnId: 1 });
  }

  async save(record: DurableEmotionalStateTimelineRecord): Promise<void> {
    assertDatabaseSourceOfTruth(record);
    const storedRecord = { ...record };
    await this.collection.updateOne(
      {
        stationRunId: storedRecord.stationRunId,
        actorId: storedRecord.actorId,
        sourceTurnId: storedRecord.sourceTurnId,
      },
      { $setOnInsert: storedRecord },
      { upsert: true },
    );
  }

  async listByStationRunIdAndActorId(
    stationRunId: string,
    actorId: string,
  ): Promise<DurableEmotionalStateTimelineRecord[]> {
    return this.collection.find({ stationRunId, actorId }, { projection: { _id: 0 } })
      .sort({ atSecond: 1, sourceTurnId: 1 })
      .toArray();
  }
}

export class MongoDurableMultiActorSessionStore implements AsyncDurableMultiActorSessionStore {
  private readonly conversationTurns: MongoDurableConversationTurnRepository;
  private readonly emotionalStateTimeline: MongoDurableEmotionalStateTimelineRepository;
  private readonly clinicalEvents: MongoDurableClinicalEventRepository;

  constructor(db: Db) {
    this.conversationTurns = new MongoDurableConversationTurnRepository(db);
    this.emotionalStateTimeline = new MongoDurableEmotionalStateTimelineRepository(db);
    this.clinicalEvents = new MongoDurableClinicalEventRepository(db);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.conversationTurns.ensureIndexes(),
      this.emotionalStateTimeline.ensureIndexes(),
      this.clinicalEvents.ensureIndexes(),
    ]);
  }

  async saveConversationTurn(record: DurableConversationTurnRecord): Promise<void> {
    await this.conversationTurns.save(record);
  }

  async listConversationTurns(stationRunId: string): Promise<DurableConversationTurnRecord[]> {
    return this.conversationTurns.listByStationRunId(stationRunId);
  }

  async saveEmotionalStateTimeline(record: DurableEmotionalStateTimelineRecord): Promise<void> {
    await this.emotionalStateTimeline.save(record);
  }

  async listEmotionalStateTimeline(
    stationRunId: string,
    actorId: string,
  ): Promise<DurableEmotionalStateTimelineRecord[]> {
    return this.emotionalStateTimeline.listByStationRunIdAndActorId(stationRunId, actorId);
  }

  async saveClinicalEvent(record: DurableClinicalEventRecord): Promise<void> {
    await this.clinicalEvents.save(record);
  }

  async listClinicalEvents(stationRunId: string): Promise<DurableClinicalEventRecord[]> {
    return this.clinicalEvents.listByStationRunId(stationRunId);
  }

  async listClinicalEventReviewProjections(stationRunId: string): Promise<DurableClinicalEventReviewProjection[]> {
    return this.clinicalEvents.listReviewProjectionsByStationRunId(stationRunId);
  }
}

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

export class MongoScenarioReviewDecisionRepository {
  private readonly collection: Collection<ScenarioReviewDecisionRecord>;

  constructor(db: Db) {
    this.collection = db.collection<ScenarioReviewDecisionRecord>("scenario_review_decisions");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ scenarioId: 1, version: 1, reviewerRole: 1, reviewedAt: 1 }, { unique: true });
    await this.collection.createIndex({ scenarioId: 1, version: 1, reviewedAt: 1 });
  }

  async save(record: ScenarioReviewDecisionRecord): Promise<void> {
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
    return this.collection.find({}, { projection: { _id: 0 } }).sort({ reviewedAt: 1, scenarioId: 1, reviewerRole: 1 }).toArray();
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
  private readonly stationRunQueueSnapshots: MongoStationRunQueueRepository;
  private readonly traces: MongoTraceRepository;
  private readonly reviewPackets: MongoReviewPacketRepository;
  private readonly scenarioReviewDecisions: MongoScenarioReviewDecisionRepository;
  private readonly durableMultiActorSessions: MongoDurableMultiActorSessionStore;

  constructor(db: Db) {
    this.examForms = new MongoExamFormRepository(db);
    this.stationRunQueueSnapshots = new MongoStationRunQueueRepository(db);
    this.traces = new MongoTraceRepository(db);
    this.reviewPackets = new MongoReviewPacketRepository(db);
    this.scenarioReviewDecisions = new MongoScenarioReviewDecisionRepository(db);
    this.durableMultiActorSessions = new MongoDurableMultiActorSessionStore(db);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.examForms.ensureIndexes(),
      this.stationRunQueueSnapshots.ensureIndexes(),
      this.traces.ensureIndexes(),
      this.reviewPackets.ensureIndexes(),
      this.scenarioReviewDecisions.ensureIndexes(),
      this.durableMultiActorSessions.ensureIndexes(),
    ]);
  }

  async saveExamForm(form: ExamForm): Promise<void> {
    await this.examForms.save(form);
  }

  async saveStationRunQueueSnapshot(snapshot: ExamStationRunQueueSnapshot): Promise<void> {
    await this.stationRunQueueSnapshots.save(snapshot);
  }

  async listStationRunQueueSnapshots(blueprintId: string): Promise<ExamStationRunQueueSnapshot[]> {
    return this.stationRunQueueSnapshots.listByBlueprint(blueprintId);
  }

  async saveTraceEvents(_stationRunId: string, events: TraceEvent[]): Promise<void> {
    await this.traces.upsertMany(events);
  }

  async saveReviewPacket(_stationRunId: string, packet: ReviewPacket): Promise<void> {
    await this.reviewPackets.save(packet);
  }

  async saveScenarioReviewDecision(record: ScenarioReviewDecisionRecord): Promise<void> {
    await this.scenarioReviewDecisions.save(record);
  }

  async listScenarioReviewDecisions(): Promise<ScenarioReviewDecisionRecord[]> {
    return this.scenarioReviewDecisions.list();
  }

  async saveConversationTurn(record: DurableConversationTurnRecord): Promise<void> {
    await this.durableMultiActorSessions.saveConversationTurn(record);
  }

  async listConversationTurns(stationRunId: string): Promise<DurableConversationTurnRecord[]> {
    return this.durableMultiActorSessions.listConversationTurns(stationRunId);
  }

  async saveEmotionalStateTimeline(record: DurableEmotionalStateTimelineRecord): Promise<void> {
    await this.durableMultiActorSessions.saveEmotionalStateTimeline(record);
  }

  async listEmotionalStateTimeline(
    stationRunId: string,
    actorId: string,
  ): Promise<DurableEmotionalStateTimelineRecord[]> {
    return this.durableMultiActorSessions.listEmotionalStateTimeline(stationRunId, actorId);
  }

  async saveClinicalEvent(record: DurableClinicalEventRecord): Promise<void> {
    await this.durableMultiActorSessions.saveClinicalEvent(record);
  }

  async listClinicalEvents(stationRunId: string): Promise<DurableClinicalEventRecord[]> {
    return this.durableMultiActorSessions.listClinicalEvents(stationRunId);
  }

  async listClinicalEventReviewProjections(stationRunId: string): Promise<DurableClinicalEventReviewProjection[]> {
    return this.durableMultiActorSessions.listClinicalEventReviewProjections(stationRunId);
  }
}

export function createMongoApiPersistenceSink(db: Db): MongoApiPersistenceSink {
  return new MongoApiPersistenceSink(db);
}

export function createMongoDurableMultiActorSessionStore(db: Db): MongoDurableMultiActorSessionStore {
  return new MongoDurableMultiActorSessionStore(db);
}

function cloneConversationTurnForMongo(record: DurableConversationTurnRecord): DurableConversationTurnRecord {
  return {
    ...record,
    rawAudioStored: false,
    traceContextTags: [...record.traceContextTags],
    provenanceRefs: [...record.provenanceRefs],
  };
}

function assertDatabaseSourceOfTruth(record: { durableStore: string }): void {
  if (record.durableStore !== "database_source_of_truth") {
    throw new Error("durable Mongo records must use durableStore database_source_of_truth");
  }
}

function cloneClinicalEventForMongo(record: DurableClinicalEventRecord): DurableClinicalEventRecord {
  return {
    ...record,
    payload: {
      public: cloneJsonRecord(record.payload.public),
      ...(record.payload.private
        ? {
          private: {
            ...record.payload.private,
            hiddenFactRefs: [...(record.payload.private.hiddenFactRefs ?? [])],
            serverOnlyNotes: [...(record.payload.private.serverOnlyNotes ?? [])],
          },
        }
        : {}),
    },
    provenanceRefs: [...record.provenanceRefs],
  };
}

function cloneJsonRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}
