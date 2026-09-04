import { describe, expect, it } from "vitest";
import {
  createImmutableAttemptManifest,
  LocalTestAttemptManifestStore,
} from "./durable-attempt-manifest.js";
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
});

function manifestFixture(): ReplayableAttemptManifest {
  const stationRunId = "station_run_manifest_001";
  const occurredAtIso = "2026-09-04T12:03:00.000Z";
  const phaseTypes = [
    "encounter.started",
    "encounter.ended",
    "note.started",
    "note.submitted",
    "station.advanced",
  ] as const;
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
    stations: [{
      stationOrder: 1,
      slotId: "slot_manifest_001",
      stationRunId,
      scenarioId: "scenario_manifest_001",
      scenarioVersion: 7,
      admittedPhaseRefs: phaseTypes.map((eventType, index) => ({
        eventType,
        stationRunId,
        sequence: 10 + index,
        formAtSecond: requireValue([60, 960, 960, 1_560, 1_560][index], "phase time"),
        occurredAtIso: eventType === "station.advanced"
          ? occurredAtIso
          : "2026-09-04T12:00:00.000Z",
        durableEventRef: `durable://station-runs/${stationRunId}/events/${10 + index}`,
      })),
      learnerEventTraceRef: `durable://station-runs/${stationRunId}/trace`,
      reviewPacketRef: `durable://station-runs/${stationRunId}/review-packet`,
      outcome: {
        stationOrder: 1,
        slotId: "slot_manifest_001",
        scenarioId: "scenario_manifest_001",
        scenarioVersion: 7,
        phase: "complete",
        noteSubmitted: true,
        startedAtFormSecond: 0,
        endedAtFormSecond: 1_560,
        advanceReason: "last_station_note_submitted_exam_complete",
        recordedAtIso: occurredAtIso,
      },
    }],
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

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`test setup requires ${label}`);
  }
  return value;
}
