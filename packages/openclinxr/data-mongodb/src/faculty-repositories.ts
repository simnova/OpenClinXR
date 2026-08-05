import type { Collection, Db } from "mongodb";
import {
  assertValidFacultyReviewDecisionRecord,
  assertValidFacultyScoreDraftRecord,
  cloneFacultyReviewDecisionRecord,
  cloneFacultyScoreDraftRecord,
} from "./mongo-helpers.js";
import type { FacultyReviewDecisionRecord, FacultyScoreDraftRecord } from "./records.js";

export class MongoFacultyScoreDraftRepository {
  private readonly collection: Collection<FacultyScoreDraftRecord>;

  constructor(db: Db) {
    this.collection = db.collection<FacultyScoreDraftRecord>("faculty_score_drafts");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stationRunId: 1, draftId: 1 }, { unique: true });
    await this.collection.createIndex({ stationRunId: 1, savedAt: 1 });
    // listByStationRunId: equality on stationRunId + sort savedAt, draftId
    await this.collection.createIndex({ stationRunId: 1, savedAt: 1, draftId: 1 });
    await this.collection.createIndex({ scenarioId: 1, savedAt: 1 });
  }

  async save(record: FacultyScoreDraftRecord): Promise<void> {
    assertValidFacultyScoreDraftRecord(record);
    const stored = cloneFacultyScoreDraftRecord(record);
    await this.collection.updateOne(
      { stationRunId: stored.stationRunId, draftId: stored.draftId },
      { $set: stored },
      { upsert: true },
    );
  }

  async listByStationRunId(stationRunId: string): Promise<FacultyScoreDraftRecord[]> {
    const rows = await this.collection.find({ stationRunId }, { projection: { _id: 0 } })
      .sort({ savedAt: 1, draftId: 1 })
      .toArray();
    return rows.map(cloneFacultyScoreDraftRecord);
  }
}

export class MongoFacultyReviewDecisionRepository {
  private readonly collection: Collection<FacultyReviewDecisionRecord>;

  constructor(db: Db) {
    this.collection = db.collection<FacultyReviewDecisionRecord>("faculty_review_decisions");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stationRunId: 1, decisionId: 1 }, { unique: true });
    await this.collection.createIndex({ stationRunId: 1, savedAt: 1 });
    // listByStationRunId: equality on stationRunId + sort savedAt, decisionId
    await this.collection.createIndex({ stationRunId: 1, savedAt: 1, decisionId: 1 });
    await this.collection.createIndex({ scenarioId: 1, savedAt: 1 });
  }

  async save(record: FacultyReviewDecisionRecord): Promise<void> {
    assertValidFacultyReviewDecisionRecord(record);
    const stored = cloneFacultyReviewDecisionRecord(record);
    await this.collection.updateOne(
      { stationRunId: stored.stationRunId, decisionId: stored.decisionId },
      { $set: stored },
      { upsert: true },
    );
  }

  async listByStationRunId(stationRunId: string): Promise<FacultyReviewDecisionRecord[]> {
    const rows = await this.collection.find({ stationRunId }, { projection: { _id: 0 } })
      .sort({ savedAt: 1, decisionId: 1 })
      .toArray();
    return rows.map(cloneFacultyReviewDecisionRecord);
  }
}
