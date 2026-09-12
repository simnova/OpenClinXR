import { describe, expect, it } from "vitest";
import {
  createImmutableAttemptManifest,
  LocalTestAttemptManifestStore,
} from "./durable-attempt-manifest.js";
import { reconstructOrderedAttemptSegmentsFromManifest } from "./replay-from-manifest.js";
import type { ReplayableAttemptManifest } from "./types.js";

describe("durable attempt manifests", () => {
  it("persists one immutable replay record for an exam run and returns defensive frozen clones", async () => {
    const store = new LocalTestAttemptManifestStore();
    const input = manifestFixture();

    const saved = await store.saveAttemptManifest(input);
    requireValue(
      requireValue(input.stations[0], "station").admittedPhaseRefs[0],
      "phase ref",
    ).durableEventRef = "mutated-after-save";
    const loaded = await store.loadAttemptManifestForExamRun("exam_run_manifest_001");

    expect(store.durableStore).toBe("test_local_memory");
    expect(saved).toEqual(loaded);
    expect(loaded?.stations[0]?.admittedPhaseRefs[0]?.durableEventRef).toBe(
      "durable://station-runs/station_run_manifest_001/events/10",
    );
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.stations)).toBe(true);
    expect(Object.isFrozen(saved.stations[0]?.admittedPhaseRefs)).toBe(true);
    expect(saved.examEquivalenceGate).toBe(false);
    expect(saved.clinicalValidityClaimed).toBe(false);
    expect(saved.scoringValidityClaimed).toBe(false);
    expect(saved.questReadinessClaimed).toBe(false);
  });

  it("is idempotent for the same seal and refuses manifest or exam-run identity rewrites", async () => {
    const store = new LocalTestAttemptManifestStore();
    const manifest = manifestFixture();
    const first = await store.saveAttemptManifest(manifest);
    const retry = await store.saveAttemptManifest(manifestFixture());

    expect(retry).toEqual(first);

    await expect(store.saveAttemptManifest({
      ...manifestFixture(),
      learnerId: "other_learner",
    })).rejects.toThrow("attempt manifest identity is immutable");

    await expect(store.saveAttemptManifest({
      ...manifestFixture(),
      manifestId: "attempt_manifest_replacement",
    })).rejects.toThrow("already has a sealed attempt manifest");
  });

  it("rejects terminal-history drift and any widened claim boundary before storage", async () => {
    const store = new LocalTestAttemptManifestStore();
    const terminalDrift = manifestFixture();
    requireValue(
      requireValue(terminalDrift.stations[0], "station").admittedPhaseRefs[4],
      "terminal phase ref",
    ).occurredAtIso = "2026-09-04T12:09:00.000Z";

    await expect(store.saveAttemptManifest(terminalDrift)).rejects.toThrow(
      "terminal history mismatch",
    );

    const widened = {
      ...manifestFixture(),
      examEquivalenceGate: true,
    } as unknown as ReplayableAttemptManifest;
    expect(() => createImmutableAttemptManifest(widened)).toThrow(
      "claim boundary cannot be widened",
    );
    expect(await store.loadAttemptManifestForExamRun("exam_run_manifest_001")).toBeNull();
  });

  it("replays ordered attempt segments from a JSON-cloned sealed manifest alone", () => {
    const sealed = twoStationManifestWithBreakFixture();
    const isolatedManifest = JSON.parse(JSON.stringify(sealed)) as ReplayableAttemptManifest;
    const reconstructed = reconstructOrderedAttemptSegmentsFromManifest(isolatedManifest);

    expect(reconstructOrderedAttemptSegmentsFromManifest.length).toBe(1);
    expect(reconstructed.map((segment) => segment.kind)).toEqual(["station", "break", "station"]);
    expect(reconstructed[0]).toMatchObject({
      kind: "station",
      stationOrder: 1,
      admittedPhaseRefs: sealed.stations[0]?.admittedPhaseRefs,
      learnerEventTraceRef: sealed.stations[0]?.learnerEventTraceRef,
      reviewPacketRef: sealed.stations[0]?.reviewPacketRef,
    });
    expect(reconstructed[1]).toMatchObject({
      kind: "break",
      afterStationOrder: 1,
      durationSeconds: 60,
    });
    expect(reconstructed[2]).toMatchObject({
      kind: "station",
      stationOrder: 2,
      admittedPhaseRefs: sealed.stations[1]?.admittedPhaseRefs,
      learnerEventTraceRef: sealed.stations[1]?.learnerEventTraceRef,
      reviewPacketRef: sealed.stations[1]?.reviewPacketRef,
    });
  });
});

function manifestFixture(): ReplayableAttemptManifest {
  const occurredAtIso = "2026-09-04T12:03:00.000Z";
  return {
    schemaVersion: "openclinxr.attempt-manifest.v1",
    manifestId: "attempt_manifest_exam_run_manifest_001",
    examRunId: "exam_run_manifest_001",
    examFormId: "exam_form_manifest_001",
    blueprintId: "blueprint_manifest_001",
    learnerId: "learner_001",
    status: "sealed",
    completedAtIso: occurredAtIso,
    sealedAtIso: "2026-09-04T12:03:01.000Z",
    stations: [stationFixture(1, "station_run_manifest_001", 10, 0, 1_560, occurredAtIso)],
    breaks: [],
    finalDisposition: {
      kind: "completed",
      dispositionRef: "durable://exam-runs/exam_run_manifest_001/dispositions/final",
      recordedAtIso: occurredAtIso,
    },
    sourceRunClaimBoundary: "learner_multi_station_runtime_skeleton_not_exam_equivalence",
    sourceRunNotEvidenceFor: [
      "exam_equivalence",
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "learner_readiness",
    ],
    claimBoundary: "sealed_replayable_attempt_manifest_not_exam_equivalence",
    notEvidenceFor: [
      "exam_equivalence",
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "learner_readiness",
      "production_deployment",
    ],
    examEquivalenceGate: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    questReadinessClaimed: false,
  };
}

function twoStationManifestWithBreakFixture(): ReplayableAttemptManifest {
  const firstEndedAtIso = "2026-09-04T12:01:00.000Z";
  const finalEndedAtIso = "2026-09-04T12:03:00.000Z";
  const first = stationFixture(1, "station_run_manifest_001", 10, 0, 1_560, firstEndedAtIso);
  const second = stationFixture(2, "station_run_manifest_002", 20, 1_620, 3_180, finalEndedAtIso);
  return {
    ...manifestFixture(),
    completedAtIso: finalEndedAtIso,
    stations: [first, second],
    breaks: [{
      afterStationOrder: 1,
      startsAtFormSecond: 1_560,
      endsAtFormSecond: 1_620,
      durationSeconds: 60,
      started: {
        eventType: "break.started",
        examRunId: "exam_run_manifest_001",
        sequence: 15,
        formAtSecond: 1_560,
        recordedAtIso: firstEndedAtIso,
        durableEventRef: "durable://exam-runs/exam_run_manifest_001/breaks/1/events/1",
      },
      ended: {
        eventType: "break.ended",
        examRunId: "exam_run_manifest_001",
        sequence: 16,
        formAtSecond: 1_620,
        recordedAtIso: "2026-09-04T12:02:00.000Z",
        durableEventRef: "durable://exam-runs/exam_run_manifest_001/breaks/1/events/2",
      },
    }],
  };
}

function stationFixture(
  stationOrder: number,
  stationRunId: string,
  sequenceStart: number,
  startedAtFormSecond: number,
  endedAtFormSecond: number,
  occurredAtIso: string,
): ReplayableAttemptManifest["stations"][number] {
  const phaseTypes = [
    "encounter.started",
    "encounter.ended",
    "note.started",
    "note.submitted",
    "station.advanced",
  ] as const;
  const encounterStart = startedAtFormSecond + 60;
  const encounterEnd = endedAtFormSecond - 600;
  const phaseTimes = [
    encounterStart,
    encounterEnd,
    encounterEnd,
    endedAtFormSecond,
    endedAtFormSecond,
  ];
  const slotId = `slot_manifest_${String(stationOrder).padStart(3, "0")}`;
  return {
    stationOrder,
    slotId,
    stationRunId,
    scenarioId: "scenario_manifest_001",
    scenarioVersion: 7,
    admittedPhaseRefs: phaseTypes.map((eventType, index) => ({
      eventType,
      stationRunId,
      sequence: sequenceStart + index,
      formAtSecond: requireValue(phaseTimes[index], "phase time"),
      occurredAtIso: eventType === "station.advanced"
        ? occurredAtIso
        : "2026-09-04T12:00:00.000Z",
      durableEventRef: `durable://station-runs/${stationRunId}/events/${sequenceStart + index}`,
    })),
    learnerEventTraceRef: `durable://station-runs/${stationRunId}/trace`,
    reviewPacketRef: `durable://station-runs/${stationRunId}/review-packet`,
    outcome: {
      stationOrder,
      slotId,
      scenarioId: "scenario_manifest_001",
      scenarioVersion: 7,
      phase: "complete",
      noteSubmitted: true,
      startedAtFormSecond,
      endedAtFormSecond,
      advanceReason: stationOrder === 2
        ? "last_station_note_submitted_exam_complete"
        : "patient_note_submitted_advancing",
      recordedAtIso: occurredAtIso,
    },
  };
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`test setup requires ${label}`);
  }
  return value;
}
