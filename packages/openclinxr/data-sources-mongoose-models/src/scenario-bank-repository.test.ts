import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMongooseMemoryTestContext, type MongooseMemoryTestContext } from "./mongoose-memory-context.js";
import { createScenarioBankModel, ScenarioBankMongooseRepository, type ScenarioBankRecord } from "./index.js";

function scenario(overrides: Partial<ScenarioBankRecord> = {}): ScenarioBankRecord {
  return {
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
    ...overrides,
  };
}

describe("Scenario bank Mongoose repository", () => {
  let context: MongooseMemoryTestContext;
  let repository: ScenarioBankMongooseRepository;

  beforeAll(async () => {
    context = await createMongooseMemoryTestContext();
    repository = new ScenarioBankMongooseRepository(createScenarioBankModel(context.mongoose));
    await repository.ensureIndexes();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it("promotes scenarios only after clinical, psychometric, legal, and simulation QA approvals", async () => {
    await repository.save(scenario());

    await expect(repository.listApprovedLearnerProjections()).resolves.toEqual([]);
    await repository.submitReviewDecision({ scenarioId: "ed_chest_pain_priority_v1", version: 1, reviewerRole: "clinical", decision: "approved" });
    await repository.submitReviewDecision({ scenarioId: "ed_chest_pain_priority_v1", version: 1, reviewerRole: "psychometric", decision: "approved" });
    await repository.submitReviewDecision({ scenarioId: "ed_chest_pain_priority_v1", version: 1, reviewerRole: "legal", decision: "approved" });
    const approved = await repository.submitReviewDecision({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      reviewerRole: "simulationQa",
      decision: "approved",
    });

    expect(approved).toMatchObject({
      scenarioId: "ed_chest_pain_priority_v1",
      status: "approved",
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
    });

    const learnerProjection = await repository.findLatestApprovedLearnerProjection("ed_chest_pain_priority_v1");
    expect(learnerProjection).toEqual({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      status: "approved",
      specialty: ["emergency_medicine", "cardiology"],
      environmentId: "ed_bay_v1",
      learningTargets: ["history_physical", "urgent_care", "team_participation"],
    });
    expect(JSON.stringify(learnerProjection)).not.toContain("STEMI");
  });

  it("keeps change-requested scenarios out of learner projections and returns latest approved versions", async () => {
    await repository.save(scenario({
      scenarioId: "abdominal_pain_surgery_v1",
      version: 1,
      title: "Abdominal Pain Surgical Triage",
      specialty: ["surgery"],
      review: {
        clinical: "approved",
        psychometric: "changes_requested",
        legal: "pending",
        simulationQa: "pending",
      },
    }));
    await repository.save(scenario({
      version: 2,
      title: "ED Chest Pain Version Two",
      status: "approved",
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
    }));

    await expect(repository.listApprovedLearnerProjections({ specialty: "surgery" })).resolves.toEqual([]);
    await expect(repository.findLatestApprovedLearnerProjection("ed_chest_pain_priority_v1")).resolves.toMatchObject({
      version: 2,
      title: "ED Chest Pain Version Two",
    });
  });

  it("returns null when review updates target a missing scenario version", async () => {
    await expect(repository.submitReviewDecision({
      scenarioId: "missing",
      version: 1,
      reviewerRole: "legal",
      decision: "approved",
    })).resolves.toBeNull();
  });
});
