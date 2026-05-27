import { validateReviewPacket, validateScenario, validateTraceEvent, type ReviewPacket, type Scenario, type TraceEvent } from "@openclinxr/shared-schemas";
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
import { promoteEncounterRuntimeAssetBundleForLocalUse } from "../../asset-registry/src/runtime-asset-review.js";
import type { EncounterRuntimeAssetBundle, LearnerRuntimeAssetBundle } from "../../asset-registry/src/runtime-bundles.js";

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
    assertValidConversationTurnForMongo(record);
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
    assertValidClinicalEventForMongo(record);
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
    assertValidEmotionalStateTimelineForMongo(record);
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

function assertValidTraceEvent(event: TraceEvent): void {
  const validation = validateTraceEvent(event);
  if (!validation.ok) {
    throw new Error(`Invalid trace event: ${validation.errors.join("; ")}`);
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

function assertValidScenarioReviewDecision(record: ScenarioReviewDecisionRecord): void {
  const errors = [
    ...(record.scenarioId.trim().length === 0 ? ["scenarioId is required"] : []),
    ...(record.reviewerId.trim().length === 0 ? ["reviewerId is required"] : []),
    ...(record.evidenceRefs.length === 0 || record.evidenceRefs.some((ref) => ref.trim().length === 0)
      ? ["nonblank evidenceRefs are required"]
      : []),
    ...(record.reviewedAt.trim().length === 0 ? ["reviewedAt is required"] : []),
  ];
  if (errors.length > 0) {
    throw new Error(`Invalid scenario review decision: ${errors.join("; ")}`);
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

export class MongoRuntimeAssetBundleRepository {
  private readonly collection: Collection<LearnerRuntimeAssetBundle>;

  constructor(db: Db) {
    this.collection = db.collection<LearnerRuntimeAssetBundle>("learner_runtime_asset_bundles");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ bundleId: 1 }, { unique: true });
    await this.collection.createIndex({ identityScope: 1, bundleId: 1 });
  }

  async saveLearnerBundle(bundle: LearnerRuntimeAssetBundle): Promise<void> {
    assertLearnerSafeRuntimeAssetBundle(bundle);
    await this.collection.updateOne(
      { bundleId: bundle.bundleId },
      { $set: cloneLearnerRuntimeAssetBundleForMongo(bundle) },
      { upsert: true },
    );
  }

  async findLearnerBundleById(bundleId: string): Promise<LearnerRuntimeAssetBundle | null> {
    return this.collection.findOne({ bundleId }, { projection: { _id: 0 } });
  }

  async listLearnerBundles(): Promise<LearnerRuntimeAssetBundle[]> {
    return this.collection.find({}, { projection: { _id: 0 } }).sort({ bundleId: 1 }).toArray();
  }
}

export async function saveLearnerRuntimeAssetBundleFromGeneratedReport(
  repository: MongoRuntimeAssetBundleRepository,
  reportValue: unknown,
): Promise<LearnerRuntimeAssetBundle> {
  if (!isRecord(reportValue)) {
    throw new Error("generated runtime bundle report must be an object");
  }
  if (reportValue.schemaVersion !== "openclinxr.generated-ed-station-runtime-bundle.v1") {
    throw new Error("generated runtime bundle report schemaVersion is unsupported");
  }
  if (reportValue.status !== "bundle_ready") {
    throw new Error(`generated runtime bundle report is not bundle_ready: ${String(reportValue.status)}`);
  }
  if (!isRecord(reportValue.learnerBundle)) {
    throw new Error("generated runtime bundle report requires learnerBundle");
  }
  if (isRecord(reportValue.bundle)) {
    const promotion = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle: reportValue.bundle as EncounterRuntimeAssetBundle,
      decisions: Array.isArray(reportValue.runtimeAssetReviewDecisions) ? reportValue.runtimeAssetReviewDecisions : [],
    });
    if (!promotion.promoted) {
      throw new Error(`generated runtime bundle report did not pass local runtime promotion: ${promotion.blockers.join(", ")}`);
    }
  }
  const learnerBundle = reportValue.learnerBundle as LearnerRuntimeAssetBundle;
  await repository.saveLearnerBundle(learnerBundle);
  return learnerBundle;
}

export class MongoApiPersistenceSink {
  private readonly examForms: MongoExamFormRepository;
  private readonly stationRunQueueSnapshots: MongoStationRunQueueRepository;
  private readonly traces: MongoTraceRepository;
  private readonly reviewPackets: MongoReviewPacketRepository;
  private readonly scenarioReviewDecisions: MongoScenarioReviewDecisionRepository;
  private readonly durableMultiActorSessions: MongoDurableMultiActorSessionStore;
  private readonly runtimeAssetBundles: MongoRuntimeAssetBundleRepository;

  constructor(db: Db) {
    this.examForms = new MongoExamFormRepository(db);
    this.stationRunQueueSnapshots = new MongoStationRunQueueRepository(db);
    this.traces = new MongoTraceRepository(db);
    this.reviewPackets = new MongoReviewPacketRepository(db);
    this.scenarioReviewDecisions = new MongoScenarioReviewDecisionRepository(db);
    this.durableMultiActorSessions = new MongoDurableMultiActorSessionStore(db);
    this.runtimeAssetBundles = new MongoRuntimeAssetBundleRepository(db);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.examForms.ensureIndexes(),
      this.stationRunQueueSnapshots.ensureIndexes(),
      this.traces.ensureIndexes(),
      this.reviewPackets.ensureIndexes(),
      this.scenarioReviewDecisions.ensureIndexes(),
      this.durableMultiActorSessions.ensureIndexes(),
      this.runtimeAssetBundles.ensureIndexes(),
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

  async saveTraceEvents(stationRunId: string, events: TraceEvent[]): Promise<void> {
    if (events.some((event) => event.stationRunId !== stationRunId)) {
      throw new Error("Trace event stationRunId must match sink stationRunId");
    }

    await this.traces.upsertMany(events);
  }

  async saveReviewPacket(stationRunId: string, packet: ReviewPacket): Promise<void> {
    if (packet.stationRunId !== stationRunId) {
      throw new Error("Review packet stationRunId must match sink stationRunId");
    }

    await this.reviewPackets.save(packet);
  }

  async saveScenarioReviewDecision(record: ScenarioReviewDecisionRecord): Promise<void> {
    await this.scenarioReviewDecisions.save(record);
  }

  async listScenarioReviewDecisions(): Promise<ScenarioReviewDecisionRecord[]> {
    return this.scenarioReviewDecisions.list();
  }

  async saveLearnerRuntimeAssetBundle(bundle: LearnerRuntimeAssetBundle): Promise<void> {
    await this.runtimeAssetBundles.saveLearnerBundle(bundle);
  }

  async getLearnerRuntimeAssetBundle(bundleId: string): Promise<LearnerRuntimeAssetBundle | undefined> {
    return (await this.runtimeAssetBundles.findLearnerBundleById(bundleId)) ?? undefined;
  }

  async listLearnerRuntimeAssetBundles(): Promise<LearnerRuntimeAssetBundle[]> {
    return this.runtimeAssetBundles.listLearnerBundles();
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

function cloneTraceEventForMongo(event: TraceEvent): TraceEvent {
  return {
    ...event,
    payload: cloneJsonRecord(event.payload),
  };
}

function cloneLearnerRuntimeAssetBundleForMongo(bundle: LearnerRuntimeAssetBundle): LearnerRuntimeAssetBundle {
  return JSON.parse(JSON.stringify(bundle)) as LearnerRuntimeAssetBundle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertLearnerSafeRuntimeAssetBundle(bundle: LearnerRuntimeAssetBundle): void {
  assertNonblankMongoField(bundle.bundleId, "bundleId");
  if (bundle.identityScope !== "learner_runtime_opaque_bundle") {
    throw new Error("learner runtime asset bundles must use identityScope learner_runtime_opaque_bundle");
  }
  const forbiddenIdentityFields = ["tenantId", "userId", "examRunId", "encounterId"];
  const leakedIdentityFields = forbiddenIdentityFields.filter((field) => field in (bundle as unknown as Record<string, unknown>));
  if (leakedIdentityFields.length > 0) {
    throw new Error(`learner runtime asset bundles must not expose identity fields: ${leakedIdentityFields.join(", ")}`);
  }
  if (!Array.isArray(bundle.actors) || bundle.actors.length === 0) {
    throw new Error("learner runtime asset bundles require actors");
  }
}

function assertDatabaseSourceOfTruth(record: { durableStore: string }): void {
  if (record.durableStore !== "database_source_of_truth") {
    throw new Error("durable Mongo records must use durableStore database_source_of_truth");
  }
}

function assertValidConversationTurnForMongo(record: DurableConversationTurnRecord): void {
  assertDatabaseSourceOfTruth(record);
  assertNonblankMongoField(record.turnId, "turnId");
  assertNonblankMongoField(record.stationRunId, "stationRunId");
  assertNonblankMongoField(record.actorId, "actorId");
  assertNonblankMongoField(record.text, "text");
  assertNonblankMongoField(record.emotionalState, "emotionalState");
  assertNonblankMongoField(record.routingReason, "routingReason");
  if (record.sourceKind !== "text" && record.sourceKind !== "voice_transcript") {
    throw new Error("durable Mongo conversation turns require a known sourceKind");
  }
  if (record.rawAudioStored !== false) {
    throw new Error("durable Mongo conversation turns must not store raw audio");
  }
  assertNonnegativeFiniteMongoSecond(record.atSecond, "conversation turns");
  assertNonblankMongoStringArray(record.traceContextTags, "traceContextTags");
  assertNonblankMongoStringArray(record.provenanceRefs, "provenanceRefs");
}

function assertValidEmotionalStateTimelineForMongo(record: DurableEmotionalStateTimelineRecord): void {
  assertDatabaseSourceOfTruth(record);
  assertNonblankMongoField(record.stationRunId, "stationRunId");
  assertNonblankMongoField(record.actorId, "actorId");
  assertNonblankMongoField(record.emotionalState, "emotionalState");
  assertNonblankMongoField(record.sourceTurnId, "sourceTurnId");
  assertNonnegativeFiniteMongoSecond(record.atSecond, "emotional-state timeline records");
}

function assertNonblankMongoField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`durable Mongo records require nonblank ${fieldName}`);
  }
}

function assertNonblankMongoStringArray(values: string[], fieldName: string): void {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`durable Mongo records require ${fieldName} to contain only nonblank strings`);
  }
}

function assertNonnegativeFiniteMongoSecond(value: number, recordLabel: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`durable Mongo ${recordLabel} require a nonnegative finite atSecond`);
  }
}

const durableClinicalEventKinds = new Set<DurableClinicalEventRecord["eventKind"]>([
  "clinical_action_recorded",
  "order_status_changed",
  "finding_recorded",
  "checklist_item_updated",
  "rubric_progress_updated",
  "case_status_changed",
]);

function assertValidClinicalEventForMongo(record: DurableClinicalEventRecord): void {
  assertDatabaseSourceOfTruth(record);
  assertNonblankClinicalEventField(record.clinicalEventId, "clinicalEventId");
  assertNonblankClinicalEventField(record.stationRunId, "stationRunId");
  assertNonblankClinicalEventField(record.label, "label");
  assertNonblankMongoStringArray(record.provenanceRefs, "provenanceRefs");
  assertClinicalEventProvenanceRefsMatchStationRun(record);
  if (record.actorId !== undefined) {
    assertNonblankClinicalEventField(record.actorId, "actorId");
  }
  if (record.traceTag !== undefined) {
    assertNonblankClinicalEventField(record.traceTag, "traceTag");
  }
  if (record.status !== undefined) {
    assertNonblankClinicalEventField(record.status, "status");
  }
  if (!durableClinicalEventKinds.has(record.eventKind)) {
    throw new Error("durable Mongo clinical-event records require a known eventKind");
  }
  if (!Number.isFinite(record.atSecond) || record.atSecond < 0) {
    throw new Error("durable Mongo clinical-event records require a nonnegative finite atSecond");
  }
}

function assertNonblankClinicalEventField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`durable Mongo clinical-event records require nonblank ${fieldName}`);
  }
}

function assertClinicalEventProvenanceRefsMatchStationRun(record: DurableClinicalEventRecord): void {
  const malformedTraceRef = record.provenanceRefs.find((ref) => {
    if (!ref.startsWith("trace:")) {
      return false;
    }
    const [, stationRunId, sequenceOrTimestamp] = ref.split(":");
    return !stationRunId || stationRunId.trim().length === 0 || !sequenceOrTimestamp || sequenceOrTimestamp.trim().length === 0;
  });
  if (malformedTraceRef) {
    throw new Error(`durable Mongo clinical-event provenanceRefs trace ref ${malformedTraceRef} must include stationRunId and sequence`);
  }
  const mismatchedTraceRef = record.provenanceRefs.find((ref) => {
    const [scheme, stationRunId] = ref.split(":");
    return scheme === "trace" && stationRunId !== record.stationRunId;
  });
  if (mismatchedTraceRef) {
    throw new Error(
      `durable Mongo clinical-event provenanceRefs trace ref ${mismatchedTraceRef} must match stationRunId ${record.stationRunId}`,
    );
  }
}

function cloneClinicalEventForMongo(record: DurableClinicalEventRecord): DurableClinicalEventRecord {
  return {
    ...record,
    payload: {
      public: cloneJsonRecord(record.payload.public),
      ...(record.payload.private
        ? {
          private: cloneClinicalEventPrivatePayload(record.payload.private),
        }
        : {}),
    },
    provenanceRefs: [...record.provenanceRefs],
  };
}

function cloneClinicalEventPrivatePayload(
  payload: NonNullable<DurableClinicalEventRecord["payload"]["private"]>,
): NonNullable<DurableClinicalEventRecord["payload"]["private"]> {
  return {
    ...(cloneJsonRecord(payload) as NonNullable<DurableClinicalEventRecord["payload"]["private"]>),
    hiddenFactRefs: [...(payload.hiddenFactRefs ?? [])],
    serverOnlyNotes: [...(payload.serverOnlyNotes ?? [])],
  };
}

function cloneJsonRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}
