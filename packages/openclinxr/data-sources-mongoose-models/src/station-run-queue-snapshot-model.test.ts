import { Mongoose } from "mongoose";
import { describe, expect, it } from "vitest";
import { createStationRunQueueSnapshotModel, type StationRunQueueSnapshotRecord } from "./index.js";

describe("Station run queue snapshot Mongoose model", () => {
  it("validates reviewer snapshot records and declares launch-gating indexes", async () => {
    const mongoose = new Mongoose();
    const StationRunQueueSnapshotModel = createStationRunQueueSnapshotModel(mongoose);
    const record: StationRunQueueSnapshotRecord = {
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
    };

    await expect(new StationRunQueueSnapshotModel(record).validate()).resolves.toBeUndefined();
    expect(StationRunQueueSnapshotModel.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ snapshotId: 1 }, { unique: true }],
        [{ "queue.blueprintId": 1, createdAt: -1 }, {}],
        [{ "queue.stationQueue.scenarioId": 1 }, {}],
        [{ "queue.canStartLearnerExam": 1 }, {}],
      ]),
    );
  });
});
