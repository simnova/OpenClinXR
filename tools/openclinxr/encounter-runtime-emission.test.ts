import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runEncounterRuntimeEmission,
  summarizeReviewPacket,
  uniqueTraceEventTypes,
  type EncounterRuntimeEmissionArtifact,
} from "./encounter-runtime-emission.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("encounter-runtime-emission", () => {
  it("uniqueTraceEventTypes preserves first-seen order", () => {
    expect(
      uniqueTraceEventTypes([
        { eventType: "station.started" },
        { eventType: "consent.accepted" },
        { eventType: "station.started" },
        { eventType: "encounter.started" },
      ]),
    ).toEqual(["station.started", "consent.accepted", "encounter.started"]);
  });

  it("summarizeReviewPacket maps quality + tags", () => {
    const summary = summarizeReviewPacket({
      stationRunId: "run_x",
      scenarioId: "ed_chest_pain_priority_v1",
      observedTraceTags: ["history_opqrst"],
      missingRequiredTraceTags: ["ecg_request"],
      lateTraceTags: [],
      unsafeEvents: [],
      timeline: [],
      traceQuality: {
        eventCount: 4,
        modelGeneratedEventCount: 1,
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 1,
        hasPatientNote: true,
        hasModelProvenance: true,
      },
      facultyScoreDraft: {
        reviewerId: "faculty_001",
        status: "draft",
        comments: "test",
      },
    });

    expect(summary).toEqual({
      stationRunId: "run_x",
      scenarioId: "ed_chest_pain_priority_v1",
      eventCount: 4,
      observedTraceTags: ["history_opqrst"],
      missingRequiredTraceTags: ["ecg_request"],
    });
  });

  it("emits replay-safe artifact with ≥1 real actor turn + review packet + ledger traces", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "encounter-runtime-emission-"));
    tempDirs.push(dir);
    const outputPath = path.join(dir, "encounter-runtime-emission-latest.json");

    const { artifact, outputPath: writtenPath } = await runEncounterRuntimeEmission({
      outputPath,
      generatedAt: "2026-08-02T12:00:00.000Z",
      learnerId: "test_emission_learner",
    });

    expect(writtenPath).toBe(path.resolve(outputPath));
    expect(artifact.schemaVersion).toBe("openclinxr.encounter-runtime-emission.v1");
    expect(artifact.phase).toBe("review");
    expect(artifact.learnerId).toBe("test_emission_learner");
    expect(artifact.actorTurns.length).toBeGreaterThanOrEqual(1);
    expect(artifact.actorTurns[0]?.actorId).toBe("patient_robert_hayes_v1");
    expect(artifact.actorTurns[0]?.responseText.length).toBeGreaterThan(0);
    expect(artifact.reviewPacket.eventCount).toBeGreaterThan(0);
    expect(artifact.reviewPacket.stationRunId).toBe(artifact.stationRunId);
    expect(artifact.traceEventTypes).toEqual(
      expect.arrayContaining([
        "station.started",
        "consent.accepted",
        "encounter.started",
        "learner.utterance",
        "actor.response.generated",
        "clinical.touch.guarding",
      ]),
    );
    expect(artifact.clinicalTouchEvents.length).toBeGreaterThanOrEqual(1);
    expect(artifact.clinicalTouchEvents[0]).toMatchObject({
      eventType: "clinical.touch.guarding",
      region: "abdomen_rlq",
      responseKind: "guarding",
      actorId: "patient_robert_hayes_v1",
    });
    expect(artifact.clinicalTouchEvents[0]?.dialogueLine.length).toBeGreaterThan(0);
    expect(artifact.actorTurns.some((t) => t.traceContextTags.includes("clinical_touch_guard_rlq"))).toBe(
      true,
    );
    expect(artifact.durableStoreInvoked.saveActorTurnCount).toBeGreaterThanOrEqual(2);
    expect(artifact.durableStoreInvoked.saveReviewPacketCount).toBeGreaterThanOrEqual(1);
    expect(artifact.wiring.factory).toBe("createScenarioRuntimeWithPersistenceHooks");
    expect(artifact.claimBoundary).toBe(
      "encounter_runtime_emission_not_clinical_validity_or_production_readiness",
    );
    expect(artifact.notEvidenceFor).toEqual([
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "production_readiness",
    ]);

    const onDisk = JSON.parse(await readFile(outputPath, "utf8")) as EncounterRuntimeEmissionArtifact;
    expect(onDisk.actorTurns.length).toBe(artifact.actorTurns.length);
    expect(onDisk.clinicalTouchEvents.length).toBe(artifact.clinicalTouchEvents.length);
    expect(onDisk.schemaVersion).toBe("openclinxr.encounter-runtime-emission.v1");
  });
});
