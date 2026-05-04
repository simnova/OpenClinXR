import { Mongoose } from "mongoose";
import { describe, expect, it } from "vitest";
import { createScenarioReviewDecisionModel } from "./index.js";

describe("Scenario review decision Mongoose model", () => {
  it("validates review decision audit records and declares reviewer indexes", async () => {
    const mongoose = new Mongoose();
    const ScenarioReviewDecisionModel = createScenarioReviewDecisionModel(mongoose);
    const document = new ScenarioReviewDecisionModel({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      version: 1,
      reviewerRole: "clinical",
      reviewerId: "pediatrician_001",
      decision: "approved",
      comments: "Clinical objectives are plausible for local formative review.",
      evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
      reviewedAt: "2026-05-04T09:00:00.000Z",
    });

    await expect(document.validate()).resolves.toBeUndefined();
    expect(ScenarioReviewDecisionModel.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ scenarioId: 1, version: 1, reviewerRole: 1, reviewedAt: -1 }, {}],
        [{ reviewerId: 1, reviewedAt: -1 }, {}],
        [{ evidenceRefs: 1 }, {}],
      ]),
    );
  });

  it("rejects unsupported reviewer roles before records enter the audit trail", async () => {
    const mongoose = new Mongoose();
    const ScenarioReviewDecisionModel = createScenarioReviewDecisionModel(mongoose);
    const document = new ScenarioReviewDecisionModel({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      version: 1,
      reviewerRole: "unapproved_role",
      reviewerId: "reviewer_001",
      decision: "approved",
      comments: "Invalid reviewer role should fail validation.",
      evidenceRefs: ["evidence:test"],
      reviewedAt: "2026-05-04T09:00:00.000Z",
    });

    await expect(document.validate()).rejects.toThrow("unapproved_role");
  });
});
