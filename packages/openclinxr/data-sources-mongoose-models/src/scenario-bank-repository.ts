import type { Model } from "mongoose";
import type { LearnerScenarioProjection, ScenarioBankRecord, ScenarioReviewerRole, ScenarioReviewDecision } from "./scenario-bank-model.js";
import { scenarioBankLearnerProjection } from "./scenario-bank-model.js";

export type ScenarioBankRepositoryFilters = {
  specialty?: string;
  environmentId?: string;
};

export type ScenarioReviewUpdate = {
  scenarioId: string;
  version: number;
  reviewerRole: ScenarioReviewerRole;
  decision: Exclude<ScenarioReviewDecision, "pending">;
};

export class ScenarioBankMongooseRepository {
  constructor(private readonly model: Model<ScenarioBankRecord>) {}

  async ensureIndexes(): Promise<void> {
    await this.model.syncIndexes();
  }

  async save(record: ScenarioBankRecord): Promise<void> {
    await this.model.updateOne(
      { scenarioId: record.scenarioId, version: record.version },
      { $set: record },
      { upsert: true, runValidators: true },
    ).exec();
  }

  async submitReviewDecision(input: ScenarioReviewUpdate): Promise<ScenarioBankRecord | null> {
    const existing = await this.model.findOne({ scenarioId: input.scenarioId, version: input.version }).exec();
    if (!existing) {
      return null;
    }

    existing.review[input.reviewerRole] = input.decision;
    existing.status = allReviewsApproved(existing.toObject().review) ? "approved" : "clinical-review";
    await existing.save();

    return existing.toObject();
  }

  async findLatestApprovedLearnerProjection(scenarioId: string): Promise<LearnerScenarioProjection | null> {
    const record = await this.model.findOne({ scenarioId, status: "approved" }).sort({ version: -1 }).exec();
    return record ? scenarioBankLearnerProjection(record.toObject()) : null;
  }

  async listApprovedLearnerProjections(filters: ScenarioBankRepositoryFilters = {}): Promise<LearnerScenarioProjection[]> {
    const records = await this.model.find({
      status: "approved",
      ...(filters.specialty ? { specialty: filters.specialty } : {}),
      ...(filters.environmentId ? { environmentId: filters.environmentId } : {}),
    }).sort({ scenarioId: 1, version: 1 }).exec();

    return records.map((record) => scenarioBankLearnerProjection(record.toObject()));
  }
}

function allReviewsApproved(review: ScenarioBankRecord["review"]): boolean {
  return review.clinical === "approved"
    && review.psychometric === "approved"
    && review.legal === "approved"
    && review.simulationQa === "approved";
}
