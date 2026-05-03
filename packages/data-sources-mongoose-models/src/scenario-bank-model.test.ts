import { Mongoose } from "mongoose";
import { describe, expect, it } from "vitest";
import { createScenarioBankModel, scenarioBankLearnerProjection } from "./index.js";

describe("Scenario bank Mongoose model", () => {
  it("validates control-plane scenario records and declares publication indexes", async () => {
    const mongoose = new Mongoose();
    const ScenarioBankModel = createScenarioBankModel(mongoose);
    const document = new ScenarioBankModel({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      status: "clinical-review",
      specialty: ["emergency_medicine", "cardiology"],
      environmentId: "ed_bay_v1",
      learningTargets: ["history_physical", "urgent_care", "team_participation"],
      hiddenClinicalTruth: {
        primaryProblem: "acute coronary syndrome risk evaluation",
        mustNotMiss: ["STEMI", "aortic_dissection", "pulmonary_embolism"],
      },
      review: {
        clinical: "pending",
        psychometric: "pending",
        legal: "pending",
        simulationQa: "pending",
      },
      sourceIds: ["src-usmle-2020-bulletin-step2cs"],
    });

    await expect(document.validate()).resolves.toBeUndefined();
    expect(ScenarioBankModel.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ scenarioId: 1, version: 1 }, { unique: true }],
        [{ status: 1, specialty: 1 }, {}],
        [{ learningTargets: 1 }, {}],
      ]),
    );
  });

  it("redacts hidden clinical truth from learner-facing projections", () => {
    const projection = scenarioBankLearnerProjection({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain",
      status: "approved",
      specialty: ["emergency_medicine"],
      environmentId: "ed_bay_v1",
      learningTargets: ["urgent_care"],
      hiddenClinicalTruth: {
        primaryProblem: "acute coronary syndrome risk evaluation",
        mustNotMiss: ["STEMI"],
      },
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
      sourceIds: ["src-test"],
    });

    expect(projection).toEqual({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain",
      status: "approved",
      specialty: ["emergency_medicine"],
      environmentId: "ed_bay_v1",
      learningTargets: ["urgent_care"],
    });
    expect(JSON.stringify(projection)).not.toContain("STEMI");
  });
});
