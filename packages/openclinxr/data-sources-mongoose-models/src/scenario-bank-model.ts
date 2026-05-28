import { type Model, type Mongoose, Schema } from "mongoose";

export type ScenarioReviewDecision = "pending" | "approved" | "changes_requested";
export type ScenarioReviewerRole = "clinical" | "psychometric" | "legal" | "simulationQa";

export type ScenarioBankRecord = {
  scenarioId: string;
  version: number;
  title: string;
  status: "draft" | "clinical-review" | "approved" | "archived";
  specialty: string[];
  environmentId: string;
  learningTargets: string[];
  hiddenClinicalTruth: {
    primaryProblem: string;
    mustNotMiss: string[];
  };
  review: {
    clinical: ScenarioReviewDecision;
    psychometric: ScenarioReviewDecision;
    legal: ScenarioReviewDecision;
    simulationQa: ScenarioReviewDecision;
  };
  sourceIds: string[];
};

export type LearnerScenarioProjection = Pick<
  ScenarioBankRecord,
  "scenarioId" | "version" | "title" | "status" | "specialty" | "environmentId" | "learningTargets"
>;

const scenarioReviewDecisionValues = ["pending", "approved", "changes_requested"] as const;

export const scenarioBankSchema = new Schema<ScenarioBankRecord>(
  {
    scenarioId: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ["draft", "clinical-review", "approved", "archived"] },
    specialty: { type: [String], required: true, default: [] },
    environmentId: { type: String, required: true, trim: true },
    learningTargets: { type: [String], required: true, default: [] },
    hiddenClinicalTruth: {
      primaryProblem: { type: String, required: true, trim: true },
      mustNotMiss: { type: [String], required: true, default: [] },
    },
    review: {
      clinical: { type: String, required: true, enum: scenarioReviewDecisionValues },
      psychometric: { type: String, required: true, enum: scenarioReviewDecisionValues },
      legal: { type: String, required: true, enum: scenarioReviewDecisionValues },
      simulationQa: { type: String, required: true, enum: scenarioReviewDecisionValues },
    },
    sourceIds: { type: [String], required: true, default: [] },
  },
  {
    collection: "scenario_bank",
    timestamps: true,
    versionKey: false,
  },
);

scenarioBankSchema.index({ scenarioId: 1, version: 1 }, { unique: true });
scenarioBankSchema.index({ status: 1, specialty: 1 });
scenarioBankSchema.index({ learningTargets: 1 });

export function createScenarioBankModel(mongoose: Mongoose): Model<ScenarioBankRecord> {
  return mongoose.models.ScenarioBank as Model<ScenarioBankRecord> | undefined
    ?? mongoose.model<ScenarioBankRecord>("ScenarioBank", scenarioBankSchema);
}

export function scenarioBankLearnerProjection(record: ScenarioBankRecord): LearnerScenarioProjection {
  return {
    scenarioId: record.scenarioId,
    version: record.version,
    title: record.title,
    status: record.status,
    specialty: [...record.specialty],
    environmentId: record.environmentId,
    learningTargets: [...record.learningTargets],
  };
}
