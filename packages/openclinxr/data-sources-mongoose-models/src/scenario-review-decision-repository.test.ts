import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createScenarioReviewDecisionModel,
  ScenarioReviewDecisionMongooseRepository,
  type ScenarioReviewDecisionRecord,
} from "./index.js";
import { createMongooseMemoryTestContext, type MongooseMemoryTestContext } from "./mongoose-memory-context.js";

function decision(overrides: Partial<ScenarioReviewDecisionRecord> = {}): ScenarioReviewDecisionRecord {
  return {
    scenarioId: "peds_asthma_parent_anxiety_v1",
    version: 1,
    reviewerRole: "clinical",
    reviewerId: "pediatrician_001",
    decision: "approved",
    comments: "Clinical objectives are plausible for local formative review.",
    evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
    reviewedAt: "2026-05-04T09:00:00.000Z",
    ...overrides,
  };
}

describe("Scenario review decision Mongoose repository", () => {
  let context: MongooseMemoryTestContext;
  let repository: ScenarioReviewDecisionMongooseRepository;

  beforeAll(async () => {
    context = await createMongooseMemoryTestContext();
    repository = new ScenarioReviewDecisionMongooseRepository(createScenarioReviewDecisionModel(context.mongoose));
    await repository.ensureIndexes();
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  it("stores immutable review decisions and lists them in scenario order", async () => {
    await repository.save(decision({
      reviewerRole: "psychometric",
      reviewerId: "psychometrician_001",
      decision: "changes_requested",
      comments: "Rubric anchor wording needs more evidence.",
      evidenceRefs: ["evidence:peds:psychometric:2026-05-04"],
      reviewedAt: "2026-05-04T09:05:00.000Z",
    }));
    await repository.save(decision());

    await expect(repository.listByScenario("peds_asthma_parent_anxiety_v1", 1)).resolves.toEqual([
      decision(),
      decision({
        reviewerRole: "psychometric",
        reviewerId: "psychometrician_001",
        decision: "changes_requested",
        comments: "Rubric anchor wording needs more evidence.",
        evidenceRefs: ["evidence:peds:psychometric:2026-05-04"],
        reviewedAt: "2026-05-04T09:05:00.000Z",
      }),
    ]);
    await expect(repository.listAll()).resolves.toEqual([
      decision(),
      decision({
        reviewerRole: "psychometric",
        reviewerId: "psychometrician_001",
        decision: "changes_requested",
        comments: "Rubric anchor wording needs more evidence.",
        evidenceRefs: ["evidence:peds:psychometric:2026-05-04"],
        reviewedAt: "2026-05-04T09:05:00.000Z",
      }),
    ]);
  });

  it("returns the latest review decision per role for a scenario version", async () => {
    await repository.save(decision({
      reviewerRole: "legal",
      reviewerId: "legal_001",
      decision: "changes_requested",
      comments: "Add synthetic case disclosure evidence.",
      evidenceRefs: ["evidence:peds:legal:draft"],
      reviewedAt: "2026-05-04T09:10:00.000Z",
    }));
    await repository.save(decision({
      reviewerRole: "legal",
      reviewerId: "legal_001",
      decision: "approved",
      comments: "Disclosure evidence added.",
      evidenceRefs: ["evidence:peds:legal:approved"],
      reviewedAt: "2026-05-04T09:20:00.000Z",
    }));

    await expect(repository.listLatestByScenario("peds_asthma_parent_anxiety_v1", 1)).resolves.toEqual([
      decision(),
      decision({
        reviewerRole: "psychometric",
        reviewerId: "psychometrician_001",
        decision: "changes_requested",
        comments: "Rubric anchor wording needs more evidence.",
        evidenceRefs: ["evidence:peds:psychometric:2026-05-04"],
        reviewedAt: "2026-05-04T09:05:00.000Z",
      }),
      decision({
        reviewerRole: "legal",
        reviewerId: "legal_001",
        decision: "approved",
        comments: "Disclosure evidence added.",
        evidenceRefs: ["evidence:peds:legal:approved"],
        reviewedAt: "2026-05-04T09:20:00.000Z",
      }),
    ]);
  });
});
