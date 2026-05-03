import type { Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMongoMemoryTestContext,
  MongoScenarioRepository,
  MongoTraceRepository,
  type MongoMemoryTestContext,
} from "./index.js";

const scenario: Scenario = {
  scenarioId: "ed_chest_pain_priority_v1",
  version: 1,
  title: "ED Chest Pain",
  status: "approved",
  review: {
    clinical: "approved",
    psychometric: "approved",
    legal: "approved",
    simulationQa: "approved",
  },
  clinicalObjectives: ["Recognize possible ACS"],
  actors: [],
  requiredTraceTags: ["ecg_request"],
  eventSchedule: [],
  reviewRubric: [],
  governance: {
    scoreUseLabel: "formative_local_only",
    syntheticCaseDisclosure: "Synthetic repository-contract fixture.",
    validationStage: "stage_1_expert_reviewed",
    validationLimitations: ["Repository fixture only; no validity evidence."],
    requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
    sourceIds: ["src-test-fixture"],
    safetyCriticalTraceTags: ["ecg_request"],
    hiddenFactPolicy: {
      learnerView: "redact_hidden_facts",
      disclosureRequiresTrigger: true,
    },
  },
};

function trace(sequence: number, tag?: string): TraceEvent {
  const event: TraceEvent = {
    stationRunId: "run_001",
    sequence,
    eventType: "learner.action",
    occurredAt: new Date(Date.parse("2026-05-03T15:38:58.000Z") + sequence * 1000).toISOString(),
    atSecond: sequence,
    source: "learner",
    payload: {},
  };
  if (tag) {
    event.tag = tag;
  }
  return event;
}

describe("MongoDB memory repositories", () => {
  let context: MongoMemoryTestContext;

  beforeAll(async () => {
    context = await createMongoMemoryTestContext();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it("stores and retrieves versioned scenarios", async () => {
    const repository = new MongoScenarioRepository(context.db);
    await repository.ensureIndexes();
    await repository.save(scenario);

    await expect(repository.findByIdAndVersion("ed_chest_pain_priority_v1", 1)).resolves.toMatchObject({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      status: "approved",
    });

    await expect(repository.approved()).resolves.toHaveLength(1);
  });

  it("enforces trace sequence uniqueness and replays in order", async () => {
    const repository = new MongoTraceRepository(context.db);
    await repository.ensureIndexes();
    await repository.append(trace(0, "station_started"));
    await repository.append(trace(1, "ecg_request"));

    await expect(repository.append(trace(1, "duplicate_sequence"))).rejects.toThrow();
    await expect(repository.replay("run_001")).resolves.toEqual([expect.objectContaining({ sequence: 0 }), expect.objectContaining({ sequence: 1 })]);
  });
});
