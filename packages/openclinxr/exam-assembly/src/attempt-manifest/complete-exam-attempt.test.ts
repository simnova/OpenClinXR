import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it, vi } from "vitest";
import {
  advanceExamFormRunBreak,
  advanceExamFormRunStation,
  createDefaultClinicalSkillsBlueprint,
  createExamFormRun,
  currentExamFormRunStation,
  startExamFormRun,
} from "../index.js";
import { completeExamFormRunWithAttemptManifest } from "./complete-exam-attempt.js";
import type {
  AttemptManifestBreakEvidenceInput,
  AttemptManifestPersistenceSink,
  AttemptManifestStationEvidenceInput,
  CompleteExamFormRunWithAttemptManifestInput,
} from "./types.js";

const FIRST_ADVANCED_AT = "2026-09-04T12:01:00.000Z";
const BREAK_ENDED_AT = "2026-09-04T12:02:00.000Z";
const FINAL_ADVANCED_AT = "2026-09-04T12:03:00.000Z";

describe("attempt manifest exam completion", () => {
  it("seals every station, timed break, trace, review packet, and disposition on the terminal transition", async () => {
    const prepared = preparedTerminalRun();
    const saveAttemptManifest = vi.fn<AttemptManifestPersistenceSink["saveAttemptManifest"]>();

    const completed = await completeExamFormRunWithAttemptManifest(
      completionInput(prepared, { saveAttemptManifest }),
    );

    expect(completed.run.status).toBe("complete");
    expect(saveAttemptManifest).toHaveBeenCalledOnce();
    expect(saveAttemptManifest).toHaveBeenCalledWith(completed.manifest);
    expect(completed.manifest).toMatchObject({
      manifestId: "attempt_manifest_exam_run_manifest_001",
      examRunId: "exam_run_manifest_001",
      examFormId: "exam_form_manifest_001",
      learnerId: "learner_001",
      status: "sealed",
      completedAtIso: FINAL_ADVANCED_AT,
      finalDisposition: {
        kind: "completed",
        dispositionRef: "durable://exam-runs/exam_run_manifest_001/dispositions/final",
      },
      examEquivalenceGate: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      questReadinessClaimed: false,
    });
    expect(completed.manifest.stations).toHaveLength(2);
    expect(completed.manifest.stations.map((station) => station.stationRunId)).toEqual([
      "station_run_manifest_001",
      "station_run_manifest_002",
    ]);
    expect(
      completed.manifest.stations.map((station) => station.admittedPhaseRefs.map((ref) => ref.eventType)),
    ).toEqual([
      ["encounter.started", "encounter.ended", "note.started", "note.submitted", "station.advanced"],
      ["encounter.started", "encounter.ended", "note.started", "note.submitted", "station.advanced"],
    ]);
    expect(completed.manifest.stations.map((station) => station.learnerEventTraceRef)).toEqual([
      "durable://station-runs/station_run_manifest_001/trace",
      "durable://station-runs/station_run_manifest_002/trace",
    ]);
    expect(completed.manifest.stations.map((station) => station.reviewPacketRef)).toEqual([
      "durable://station-runs/station_run_manifest_001/review-packet",
      "durable://station-runs/station_run_manifest_002/review-packet",
    ]);
    expect(completed.manifest.breaks).toEqual([
      expect.objectContaining({
        afterStationOrder: 1,
        durationSeconds: 60,
        started: expect.objectContaining({ eventType: "break.started" }),
        ended: expect.objectContaining({ eventType: "break.ended" }),
      }),
    ]);
    expect(Object.isFrozen(completed.manifest)).toBe(true);
    expect(Object.isFrozen(completed.manifest.stations[0]?.admittedPhaseRefs)).toBe(true);
    expect(completed.manifest.sourceRunClaimBoundary).toBe(
      "learner_multi_station_runtime_skeleton_not_exam_equivalence",
    );
    expect(completed.manifest.notEvidenceFor).toContain("exam_equivalence");
    expect(completed.manifest.notEvidenceFor).toContain("scoring_validity");
  });

  it("does not publish a completed run when immutable evidence identity is incomplete or stale", async () => {
    const prepared = preparedTerminalRun();
    const saveAttemptManifest = vi.fn<AttemptManifestPersistenceSink["saveAttemptManifest"]>();
    const input = completionInput(prepared, { saveAttemptManifest });
    const staleStation = {
      ...requireValue(input.stationEvidence[1], "second station evidence"),
      scenarioVersion: 999,
    };

    await expect(
      completeExamFormRunWithAttemptManifest({
        ...input,
        stationEvidence: [requireValue(input.stationEvidence[0], "first station evidence"), staleStation],
      }),
    ).rejects.toThrow("immutable identity mismatch");
    expect(prepared.run.status).toBe("in_progress");
    expect(saveAttemptManifest).not.toHaveBeenCalled();

    await expect(
      completeExamFormRunWithAttemptManifest({
        ...input,
        breakEvidence: [],
      }),
    ).rejects.toThrow("evidence for every timed break");
    expect(saveAttemptManifest).not.toHaveBeenCalled();
  });

  it("returns no completion result when durable manifest persistence refuses the seal", async () => {
    const prepared = preparedTerminalRun();
    const persistence: AttemptManifestPersistenceSink = {
      saveAttemptManifest: async () => {
        throw new Error("durable manifest write failed");
      },
    };

    await expect(
      completeExamFormRunWithAttemptManifest(completionInput(prepared, persistence)),
    ).rejects.toThrow("durable manifest write failed");
    expect(prepared.run.status).toBe("in_progress");
  });
});

type PreparedTerminalRun = ReturnType<typeof preparedTerminalRun>;

function preparedTerminalRun() {
  const scenarios = [edChestPainScenario, edChestPainScenario];
  const baseBlueprint = createDefaultClinicalSkillsBlueprint(scenarios, { stationCount: 2 });
  const blueprint = {
    ...baseBlueprint,
    timing: {
      ...baseBlueprint.timing,
      breakAfterStationOrders: [1],
    },
  };
  let run = startExamFormRun(createExamFormRun({
    examRunId: "exam_run_manifest_001",
    examFormId: "exam_form_manifest_001",
    blueprint,
    scenarios,
    breakDurationSeconds: 60,
  }));
  const firstStation = requireValue(currentExamFormRunStation(run), "first station");
  run = advanceExamFormRunStation(run, {
    phase: "complete",
    noteSubmitted: true,
    advanceReason: "patient_note_submitted_advancing",
    endedAtFormSecond: firstStation.timing.note.endsAtSecond,
    recordedAtIso: FIRST_ADVANCED_AT,
  });
  const breakWindow = requireValue(run.queue.breakWindows[0], "break window");
  run = advanceExamFormRunBreak(run, {
    endedAtFormSecond: breakWindow.endsAtSecond,
    recordedAtIso: BREAK_ENDED_AT,
  });
  const finalStation = requireValue(currentExamFormRunStation(run), "final station");
  return { run, firstStation, finalStation };
}

function completionInput(
  prepared: PreparedTerminalRun,
  persistence: AttemptManifestPersistenceSink,
): CompleteExamFormRunWithAttemptManifestInput {
  return {
    run: prepared.run,
    finalStationCompletion: {
      phase: "complete",
      noteSubmitted: true,
      advanceReason: "last_station_note_submitted_exam_complete",
      endedAtFormSecond: prepared.finalStation.timing.note.endsAtSecond,
      recordedAtIso: FINAL_ADVANCED_AT,
    },
    manifestId: "attempt_manifest_exam_run_manifest_001",
    learnerId: "learner_001",
    stationEvidence: [
      stationEvidence(prepared.firstStation, "station_run_manifest_001", FIRST_ADVANCED_AT, 10),
      stationEvidence(prepared.finalStation, "station_run_manifest_002", FINAL_ADVANCED_AT, 20),
    ],
    breakEvidence: breakEvidence(prepared),
    finalDisposition: {
      kind: "completed",
      dispositionRef: "durable://exam-runs/exam_run_manifest_001/dispositions/final",
      recordedAtIso: FINAL_ADVANCED_AT,
    },
    sealedAtIso: "2026-09-04T12:03:01.000Z",
    persistence,
  };
}

function stationEvidence(
  station: PreparedTerminalRun["firstStation"],
  stationRunId: string,
  advancedAtIso: string,
  sequenceStart: number,
): AttemptManifestStationEvidenceInput {
  const phaseTimes = [
    station.timing.encounter.startsAtSecond,
    station.timing.encounter.endsAtSecond,
    station.timing.note.startsAtSecond,
    station.timing.note.endsAtSecond,
    station.timing.note.endsAtSecond,
  ];
  const phaseTypes = [
    "encounter.started",
    "encounter.ended",
    "note.started",
    "note.submitted",
    "station.advanced",
  ] as const;
  return {
    stationOrder: station.stationOrder,
    slotId: station.slotId,
    stationRunId,
    scenarioId: requireValue(station.scenarioId, "scenarioId"),
    scenarioVersion: requireValue(station.scenarioVersion, "scenarioVersion"),
    admittedPhaseRefs: phaseTypes.map((eventType, index) => ({
      eventType,
      stationRunId,
      sequence: sequenceStart + index,
      formAtSecond: requireValue(phaseTimes[index], "phase time"),
      occurredAtIso: eventType === "station.advanced"
        ? advancedAtIso
        : "2026-09-04T12:00:00.000Z",
      durableEventRef: `durable://station-runs/${stationRunId}/events/${sequenceStart + index}`,
    })),
    learnerEventTraceRef: `durable://station-runs/${stationRunId}/trace`,
    reviewPacketRef: `durable://station-runs/${stationRunId}/review-packet`,
  };
}

function breakEvidence(prepared: PreparedTerminalRun): AttemptManifestBreakEvidenceInput[] {
  const started = requireValue(
    prepared.run.breakPhaseTransitions.find(
      (transition) => transition.eventType === "break.started",
    ),
    "break.started transition",
  );
  const ended = requireValue(
    prepared.run.breakPhaseTransitions.find(
      (transition) => transition.eventType === "break.ended",
    ),
    "break.ended transition",
  );
  return [{
    afterStationOrder: 1,
    started: {
      eventType: "break.started",
      examRunId: prepared.run.examRunId,
      sequence: started.sequence,
      formAtSecond: started.formAtSecond,
      recordedAtIso: started.recordedAtIso,
      durableEventRef: "durable://exam-runs/exam_run_manifest_001/breaks/1/events/1",
    },
    ended: {
      eventType: "break.ended",
      examRunId: prepared.run.examRunId,
      sequence: ended.sequence,
      formAtSecond: ended.formAtSecond,
      recordedAtIso: ended.recordedAtIso,
      durableEventRef: "durable://exam-runs/exam_run_manifest_001/breaks/1/events/2",
    },
  }];
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`test setup requires ${label}`);
  }
  return value;
}
