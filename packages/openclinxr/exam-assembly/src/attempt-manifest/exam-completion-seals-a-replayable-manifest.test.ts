import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it, vi } from "vitest";
import {
  advanceExamFormRunStation,
  createDefaultClinicalSkillsBlueprint,
  createExamFormRun,
  currentExamFormRunStation,
  startExamFormRun,
  type ExamFormRunState,
} from "../index.js";
import { completeExamFormRunWithAttemptManifest } from "../exam-form-run.js";
import {
  reconstructOrderedAttemptSegmentsFromManifest,
  type ReconstructedAttemptSegment,
} from "./replay-from-manifest.js";
import type {
  AttemptManifestBreakEvidenceInput,
  AttemptManifestPersistenceSink,
  AttemptManifestStationEvidenceInput,
  CompleteExamFormRunWithAttemptManifestInput,
  ReplayableAttemptManifest,
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

  it("replays ordered attempt segments from a JSON-cloned sealed manifest alone", async () => {
    const prepared = preparedTerminalRun();
    const input = completionInput(prepared, {
      saveAttemptManifest: vi.fn<AttemptManifestPersistenceSink["saveAttemptManifest"]>(),
    });
    const completed = await completeExamFormRunWithAttemptManifest(input);
    const produced = orderedAttemptSegmentsFromCompletedRun(completed.run, input);

    const isolatedManifest = JSON.parse(
      JSON.stringify(completed.manifest),
    ) as ReplayableAttemptManifest;
    const reconstructed = reconstructOrderedAttemptSegmentsFromManifest(isolatedManifest);

    expect(reconstructOrderedAttemptSegmentsFromManifest.length).toBe(1);
    expect(reconstructed.map((segment) => segment.kind)).toEqual(["station", "break", "station"]);
    expect(reconstructed).toEqual(produced);
  });

  it("seals a two-station run with no break through the same path", async () => {
    const saveWithBreak = vi.fn<AttemptManifestPersistenceSink["saveAttemptManifest"]>();
    const saveNoBreak = vi.fn<AttemptManifestPersistenceSink["saveAttemptManifest"]>();
    const withBreak = await completeExamFormRunWithAttemptManifest(
      completionInput(preparedTerminalRun(), { saveAttemptManifest: saveWithBreak }),
    );
    const noBreak = await completeExamFormRunWithAttemptManifest(
      completionInput(preparedTerminalRun({ breakAfterStationOrders: [] }), {
        saveAttemptManifest: saveNoBreak,
      }),
    );

    expect(noBreak.run.status).toBe("complete");
    expect(noBreak.manifest.status).toBe("sealed");
    expect(noBreak.manifest.breaks).toEqual([]);
    expect(saveNoBreak).toHaveBeenCalledOnce();
    expect(saveNoBreak).toHaveBeenCalledWith(noBreak.manifest);
    expect(saveWithBreak).toHaveBeenCalledOnce();
    expect(stationSegmentShape(noBreak.manifest.stations)).toEqual(
      stationSegmentShape(withBreak.manifest.stations),
    );
    expect(Object.isFrozen(noBreak.manifest)).toBe(true);
    expect(noBreak.manifest.examEquivalenceGate).toBe(withBreak.manifest.examEquivalenceGate);
    expect(noBreak.manifest.claimBoundary).toBe(withBreak.manifest.claimBoundary);
  });
});

type PreparedTerminalRun = ReturnType<typeof preparedTerminalRun>;

function preparedTerminalRun(
  options: { breakAfterStationOrders?: readonly number[] } = { breakAfterStationOrders: [1] },
) {
  const scenarios = [edChestPainScenario, edChestPainScenario];
  const baseBlueprint = createDefaultClinicalSkillsBlueprint(scenarios, { stationCount: 2 });
  const blueprint = {
    ...baseBlueprint,
    timing: {
      ...baseBlueprint.timing,
      breakAfterStationOrders: [...(options.breakAfterStationOrders ?? [])],
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
  const finalStation = requireValue(run.queue.stationQueue[1], "final station");
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
    breakEvidence: prepared.run.queue.breakWindows.length === 0 ? [] : breakEvidence(prepared),
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
  const breakWindow = requireValue(prepared.run.queue.breakWindows[0], "break window");
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
      sequence: started.sequence + 1,
      formAtSecond: breakWindow.endsAtSecond,
      recordedAtIso: BREAK_ENDED_AT,
      durableEventRef: "durable://exam-runs/exam_run_manifest_001/breaks/1/events/2",
    },
  }];
}

function orderedAttemptSegmentsFromCompletedRun(
  run: ExamFormRunState,
  input: CompleteExamFormRunWithAttemptManifestInput,
): ReconstructedAttemptSegment[] {
  const segments: ReconstructedAttemptSegment[] = [];
  for (const station of run.queue.stationQueue) {
    const evidence = requireValue(
      input.stationEvidence.find((entry) => entry.stationOrder === station.stationOrder),
      `station ${station.stationOrder} evidence`,
    );
    segments.push({
      kind: "station",
      stationOrder: station.stationOrder,
      slotId: station.slotId,
      stationRunId: evidence.stationRunId,
      admittedPhaseRefs: evidence.admittedPhaseRefs,
      learnerEventTraceRef: evidence.learnerEventTraceRef,
      reviewPacketRef: evidence.reviewPacketRef,
    });
    const window = run.queue.breakWindows.find(
      (entry) => entry.afterStationOrder === station.stationOrder,
    );
    if (!window) {
      continue;
    }
    const breakEntry = requireValue(
      input.breakEvidence.find((entry) => entry.afterStationOrder === window.afterStationOrder),
      `break after station ${window.afterStationOrder} evidence`,
    );
    segments.push({
      kind: "break",
      afterStationOrder: window.afterStationOrder,
      durationSeconds: window.durationSeconds,
      started: breakEntry.started,
      ended: breakEntry.ended,
    });
  }
  return segments;
}

function stationSegmentShape(stations: ReplayableAttemptManifest["stations"]) {
  return stations.map((station) => ({
    stationOrder: station.stationOrder,
    fieldNames: Object.keys(station).sort(),
    phaseTypes: station.admittedPhaseRefs.map((ref) => ref.eventType),
    phaseFieldNames: Object.keys(station.admittedPhaseRefs[0] ?? {}).sort(),
    outcomeFieldNames: Object.keys(station.outcome).sort(),
    outcomePhase: station.outcome.phase,
    noteSubmitted: station.outcome.noteSubmitted,
    hasTraceRef: station.learnerEventTraceRef.startsWith("durable://station-runs/"),
    hasReviewPacketRef: station.reviewPacketRef.startsWith("durable://station-runs/"),
  }));
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`test setup requires ${label}`);
  }
  return value;
}
