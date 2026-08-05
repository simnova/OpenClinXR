import type { Collection, Db } from "mongodb";
import type {
  DurableClinicalEventRecord,
  DurableClinicalEventReviewProjection,
  DurableConversationTurnRecord,
  DurableEmotionalStateTimelineRecord,
} from "@openclinxr/session-state";
import { projectDurableClinicalEventForReview } from "@openclinxr/session-state";
import type { AsyncDurableMultiActorSessionStore } from "@openclinxr/session-state";
import {
  assertValidClinicalEventForMongo,
  assertValidConversationTurnForMongo,
  assertValidEmotionalStateTimelineForMongo,
  cloneConversationTurnForMongo,
  cloneClinicalEventForMongo,
} from "./mongo-helpers.js";

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

export function createMongoDurableMultiActorSessionStore(db: Db): MongoDurableMultiActorSessionStore {
  return new MongoDurableMultiActorSessionStore(db);
}
