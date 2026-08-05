import type { Db } from "mongodb";
import type { ExamForm } from "@openclinxr/exam-assembly";
import type {
  DurableClinicalEventRecord,
  DurableClinicalEventReviewProjection,
  DurableConversationTurnRecord,
  DurableEmotionalStateTimelineRecord,
} from "@openclinxr/session-state";
import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { type ReviewPacket, type Scenario, type TraceEvent } from "@openclinxr/shared-schemas";
import { MongoExamFormRepository, MongoRuntimeAssetBundleRepository, MongoStationRunQueueRepository } from "./exam-repositories.js";
import { MongoFacultyReviewDecisionRepository, MongoFacultyScoreDraftRepository } from "./faculty-repositories.js";
import { MongoDurableMultiActorSessionStore } from "./conversation-repositories.js";
import { MongoReviewPacketRepository, MongoScenarioRepository, MongoScenarioReviewDecisionRepository, MongoTraceRepository } from "./scenario-repositories.js";
import type { ExamStationRunQueueSnapshot, FacultyReviewDecisionRecord, FacultyScoreDraftRecord, ScenarioReviewDecisionRecord } from "./records.js";

export class MongoApiPersistenceSink {
  private readonly examForms: MongoExamFormRepository;
  private readonly stationRunQueueSnapshots: MongoStationRunQueueRepository;
  private readonly traces: MongoTraceRepository;
  private readonly reviewPackets: MongoReviewPacketRepository;
  private readonly scenarioReviewDecisions: MongoScenarioReviewDecisionRepository;
  private readonly facultyScoreDrafts: MongoFacultyScoreDraftRepository;
  private readonly facultyReviewDecisions: MongoFacultyReviewDecisionRepository;
  private readonly durableMultiActorSessions: MongoDurableMultiActorSessionStore;
  private readonly runtimeAssetBundles: MongoRuntimeAssetBundleRepository;
  private readonly scenarios: MongoScenarioRepository;

  constructor(db: Db) {
    this.examForms = new MongoExamFormRepository(db);
    this.stationRunQueueSnapshots = new MongoStationRunQueueRepository(db);
    this.traces = new MongoTraceRepository(db);
    this.reviewPackets = new MongoReviewPacketRepository(db);
    this.scenarioReviewDecisions = new MongoScenarioReviewDecisionRepository(db);
    this.facultyScoreDrafts = new MongoFacultyScoreDraftRepository(db);
    this.facultyReviewDecisions = new MongoFacultyReviewDecisionRepository(db);
    this.durableMultiActorSessions = new MongoDurableMultiActorSessionStore(db);
    this.runtimeAssetBundles = new MongoRuntimeAssetBundleRepository(db);
    this.scenarios = new MongoScenarioRepository(db);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.examForms.ensureIndexes(),
      this.stationRunQueueSnapshots.ensureIndexes(),
      this.traces.ensureIndexes(),
      this.reviewPackets.ensureIndexes(),
      this.scenarioReviewDecisions.ensureIndexes(),
      this.facultyScoreDrafts.ensureIndexes(),
      this.facultyReviewDecisions.ensureIndexes(),
      this.durableMultiActorSessions.ensureIndexes(),
      this.runtimeAssetBundles.ensureIndexes(),
      this.scenarios.ensureIndexes(),
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

  /**
   * Map ScenarioRuntime actor turns into durable conversation turns.
   * Structural type avoids coupling data-mongodb → scenario-runtime package graph.
   * claimScope: conversation_turns only — not clinical validity / scoring.
   */
  async saveActorTurn(
    stationRunId: string,
    turn: {
      turnId: string;
      stationRunId: string;
      actorId: string;
      atSecond: number;
      responseText: string;
      learnerUtterance?: string;
      traceContextTags?: string[];
      durableEventRef?: string;
    },
  ): Promise<void> {
    if (turn.stationRunId !== stationRunId) {
      throw new Error("Actor turn stationRunId must match sink stationRunId");
    }
    const text = turn.responseText.trim().length > 0 ? turn.responseText : (turn.learnerUtterance ?? "").trim();
    if (text.length === 0) {
      throw new Error("Actor turn requires non-empty responseText or learnerUtterance");
    }
    await this.saveConversationTurn({
      turnId: turn.turnId,
      stationRunId,
      actorId: turn.actorId,
      atSecond: turn.atSecond,
      sourceKind: "text",
      text,
      traceContextTags: [...(turn.traceContextTags ?? [])],
      emotionalState: "neutral",
      routingReason: "single_patient_default",
      rawAudioStored: false,
      provenanceRefs: turn.durableEventRef ? [turn.durableEventRef] : [`runtime_actor_turn:${turn.turnId}`],
      durableStore: "database_source_of_truth",
    });
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

  async saveAuthoredScenario(scenario: Scenario): Promise<void> {
    await this.scenarios.save(scenario);
  }

  async listAuthoredScenarios(): Promise<Scenario[]> {
    return this.scenarios.listAll();
  }

  async getAuthoredScenario(scenarioId: string): Promise<Scenario | undefined> {
    return (await this.scenarios.findLatestById(scenarioId)) ?? undefined;
  }

  async saveFacultyScoreDraft(record: FacultyScoreDraftRecord): Promise<void> {
    await this.facultyScoreDrafts.save(record);
  }

  async listFacultyScoreDrafts(stationRunId: string): Promise<FacultyScoreDraftRecord[]> {
    return this.facultyScoreDrafts.listByStationRunId(stationRunId);
  }

  async saveFacultyReviewDecision(record: FacultyReviewDecisionRecord): Promise<void> {
    await this.facultyReviewDecisions.save(record);
  }

  async listFacultyReviewDecisions(stationRunId: string): Promise<FacultyReviewDecisionRecord[]> {
    return this.facultyReviewDecisions.listByStationRunId(stationRunId);
  }
}

export function createMongoApiPersistenceSink(db: Db): MongoApiPersistenceSink {
  return new MongoApiPersistenceSink(db);
}
