import type { Model } from "mongoose";
import type { ScenarioReviewDecisionRecord } from "./scenario-review-decision-model.js";

type LeanScenarioReviewDecisionRecord = ScenarioReviewDecisionRecord & { _id?: unknown };

export class ScenarioReviewDecisionMongooseRepository {
  constructor(private readonly model: Model<ScenarioReviewDecisionRecord>) {}

  async ensureIndexes(): Promise<void> {
    await this.model.syncIndexes();
  }

  async save(record: ScenarioReviewDecisionRecord): Promise<void> {
    await this.model.create({
      ...record,
      evidenceRefs: [...record.evidenceRefs],
    });
  }

  async listAll(): Promise<ScenarioReviewDecisionRecord[]> {
    const records = await this.model.find()
      .sort({ scenarioId: 1, version: 1, reviewedAt: 1, reviewerRole: 1 })
      .lean<LeanScenarioReviewDecisionRecord[]>()
      .exec();

    return records.map(withoutMongoId);
  }

  async listByScenario(scenarioId: string, version: number): Promise<ScenarioReviewDecisionRecord[]> {
    const records = await this.model.find({ scenarioId, version })
      .sort({ reviewedAt: 1, reviewerRole: 1 })
      .lean<LeanScenarioReviewDecisionRecord[]>()
      .exec();

    return records.map(withoutMongoId);
  }

  async listLatestByScenario(scenarioId: string, version: number): Promise<ScenarioReviewDecisionRecord[]> {
    const latestByRole = new Map<string, ScenarioReviewDecisionRecord>();
    for (const record of await this.listByScenario(scenarioId, version)) {
      latestByRole.set(record.reviewerRole, record);
    }

    return Array.from(latestByRole.values()).sort((left, right) =>
      Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt)
      || left.reviewerRole.localeCompare(right.reviewerRole)
    );
  }
}

function withoutMongoId(record: LeanScenarioReviewDecisionRecord): ScenarioReviewDecisionRecord {
  const { _id: _ignored, ...rest } = record;
  return {
    ...rest,
    evidenceRefs: [...rest.evidenceRefs],
  };
}
