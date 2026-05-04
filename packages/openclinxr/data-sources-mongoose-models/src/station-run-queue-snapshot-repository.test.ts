import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMongooseMemoryTestContext, type MongooseMemoryTestContext } from "./mongoose-memory-context.js";
import {
  createStationRunQueueSnapshotModel,
  StationRunQueueSnapshotMongooseRepository,
  type StationRunQueueSnapshotRecord,
} from "./index.js";

function snapshot(overrides: Partial<StationRunQueueSnapshotRecord> = {}): StationRunQueueSnapshotRecord {
  return {
    snapshotId: "queue_snapshot_seed_001",
    createdAt: "2026-05-03T17:30:00.000Z",
    reviewerId: "psychometrician_001",
    queue: {
      blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      canStartLearnerExam: false,
      summary: {
        activationReady: 1,
        draftBlocked: 11,
        governanceBlocked: 0,
        missingScenario: 0,
      },
      stationQueue: [
        {
          stationOrder: 1,
          slotId: "station_001_ed_chest_pain_priority_v1",
          label: "ED chest pain",
          scenarioId: "ed_chest_pain_priority_v1",
          scenarioVersion: 1,
          status: "activation_ready",
          blockers: [],
        },
        {
          stationOrder: 9,
          slotId: "station_009_clinic_abdominal_pain_interpreter_v1",
          label: "Clinic abdominal pain with interpreter",
          scenarioId: "clinic_abdominal_pain_interpreter_v1",
          scenarioVersion: 1,
          status: "draft_blocked",
          blockers: ["scenario_not_approved"],
        },
      ],
    },
    ...overrides,
  };
}

describe("Station run queue snapshot Mongoose repository", () => {
  let context: MongooseMemoryTestContext;
  let repository: StationRunQueueSnapshotMongooseRepository;

  beforeAll(async () => {
    context = await createMongooseMemoryTestContext();
    repository = new StationRunQueueSnapshotMongooseRepository(createStationRunQueueSnapshotModel(context.mongoose));
    await repository.ensureIndexes();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it("upserts reviewer queue snapshots and lists them by blueprint newest first", async () => {
    await repository.save(snapshot());
    await repository.save(snapshot({
      snapshotId: "queue_snapshot_seed_002",
      createdAt: "2026-05-03T18:00:00.000Z",
      reviewerId: "legal_001",
    }));

    await expect(repository.findById("queue_snapshot_seed_001")).resolves.toMatchObject({
      snapshotId: "queue_snapshot_seed_001",
      reviewerId: "psychometrician_001",
      queue: {
        canStartLearnerExam: false,
        summary: { activationReady: 1, draftBlocked: 11 },
        stationQueue: expect.arrayContaining([
          expect.objectContaining({
            stationOrder: 9,
            scenarioId: "clinic_abdominal_pain_interpreter_v1",
            blockers: ["scenario_not_approved"],
          }),
        ]),
      },
    });

    await expect(repository.listByBlueprint("blueprint_openclinxr_step2cs_style_seed_v1")).resolves.toEqual([
      expect.objectContaining({ snapshotId: "queue_snapshot_seed_002" }),
      expect.objectContaining({ snapshotId: "queue_snapshot_seed_001" }),
    ]);
  });
});
