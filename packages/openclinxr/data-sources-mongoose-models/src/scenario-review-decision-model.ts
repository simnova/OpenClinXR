import { type Model, type Mongoose, Schema } from "mongoose";

export type ScenarioReviewDecisionValue = "approved" | "changes_requested";
export type ScenarioReviewDecisionReviewerRole = "clinical" | "psychometric" | "legal" | "simulationQa";

export type ScenarioReviewDecisionRecord = {
  scenarioId: string;
  version: number;
  reviewerRole: ScenarioReviewDecisionReviewerRole;
  reviewerId: string;
  decision: ScenarioReviewDecisionValue;
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

const scenarioReviewDecisionValues = ["approved", "changes_requested"] as const;
const scenarioReviewReviewerRoleValues = ["clinical", "psychometric", "legal", "simulationQa"] as const;

export const scenarioReviewDecisionSchema = new Schema<ScenarioReviewDecisionRecord>(
  {
    scenarioId: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    reviewerRole: { type: String, required: true, enum: scenarioReviewReviewerRoleValues },
    reviewerId: { type: String, required: true, trim: true },
    decision: { type: String, required: true, enum: scenarioReviewDecisionValues },
    comments: { type: String, required: true, trim: true },
    evidenceRefs: { type: [String], required: true, default: [] },
    reviewedAt: { type: String, required: true, trim: true },
  },
  {
    collection: "scenario_review_decisions",
    timestamps: false,
    versionKey: false,
  },
);

scenarioReviewDecisionSchema.index({ scenarioId: 1, version: 1, reviewerRole: 1, reviewedAt: -1 });
scenarioReviewDecisionSchema.index({ reviewerId: 1, reviewedAt: -1 });
scenarioReviewDecisionSchema.index({ evidenceRefs: 1 });

export function createScenarioReviewDecisionModel(mongoose: Mongoose): Model<ScenarioReviewDecisionRecord> {
  return mongoose.models.ScenarioReviewDecision as Model<ScenarioReviewDecisionRecord> | undefined
    ?? mongoose.model<ScenarioReviewDecisionRecord>("ScenarioReviewDecision", scenarioReviewDecisionSchema);
}
