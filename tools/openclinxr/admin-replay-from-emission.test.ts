import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mapActorTurnsToRefs,
  mapActorTurnsToTimeline,
  mapEmissionToAdminReplayProjection,
  mapEmissionToAdminReplayProps,
  runAdminReplayFromEmission,
  type EmissionActorTurn,
  type AdminReplayFromEmissionProjection,
} from "./admin-replay-from-emission.js";
import type { EncounterRuntimeEmissionArtifact } from "./encounter-runtime-emission.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sampleTurn(overrides: Partial<EmissionActorTurn> = {}): EmissionActorTurn {
  return {
    turnId: "turn_1_patient_robert_hayes_v1_120",
    stationRunId: "run_ed_chest_pain_priority_v1_test",
    actorId: "patient_robert_hayes_v1",
    atSecond: 120,
    conversationTurn: 1,
    learnerUtterance: "When did the chest pressure start?",
    responseText: "Robert Hayes: Demeanor: anxious, diaphoretic, protective of chest",
    responseKind: "spoken_actor_response",
    traceContextTags: ["history_opqrst"],
    durableEventRef: "durable://station-runs/run_ed_chest_pain_priority_v1_test/events/4",
    learnerEventSequence: 3,
    actorResponseEventSequence: 4,
    ...overrides,
  };
}

function sampleEmission(
  overrides: Partial<EncounterRuntimeEmissionArtifact> = {},
): EncounterRuntimeEmissionArtifact {
  const turn = sampleTurn();
  return {
    schemaVersion: "openclinxr.encounter-runtime-emission.v1",
    generatedAt: "2026-08-02T00:00:00.000Z",
    stationRunId: turn.stationRunId,
    scenarioId: "ed_chest_pain_priority_v1",
    scenarioVersion: 1,
    phase: "review",
    learnerId: "runtime_emission_learner_001",
    actorTurns: [turn],
    reviewPacket: {
      stationRunId: turn.stationRunId,
      scenarioId: "ed_chest_pain_priority_v1",
      eventCount: 8,
      observedTraceTags: ["history_opqrst", "ecg_request"],
      missingRequiredTraceTags: ["risk_factor_question"],
    },
    traceEventTypes: [
      "station.started",
      "consent.accepted",
      "encounter.started",
      "learner.utterance",
      "actor.response.generated",
      "clinical.touch.guarding",
    ],
    clinicalTouchEvents: [
      {
        atSecond: 210,
        eventType: "clinical.touch.guarding",
        actorId: "patient_robert_hayes_v1",
        tag: "clinical_touch_guard_rlq",
        region: "abdomen_rlq",
        responseKind: "guarding",
        dialogueLine: "Ow— that hurts a lot, please don't push there.",
        summary:
          "patient_robert_hayes_v1 physical exam touch: guarding at abdomen_rlq; tag clinical_touch_guard_rlq; dialogue Ow— that hurts a lot, please don't push there.; notEvidenceFor clinical_validity/scoring",
      },
    ],
    durableStoreInvoked: {
      saveActorTurnCount: 1,
      saveReviewPacketCount: 1,
    },
    wiring: {
      factory: "createScenarioRuntimeWithPersistenceHooks",
      hooksShape: "DurableStorePersistenceHooks",
      emissionPath:
        "startSession→startEncounter→generateActorResponse→clinicalTouch→submitNote→reviewPacketAndPersist",
    },
    claimBoundary: "encounter_runtime_emission_not_clinical_validity_or_production_readiness",
    notEvidenceFor: [
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "production_readiness",
    ],
    ...overrides,
  };
}

describe("admin-replay-from-emission mapper", () => {
  it("mapActorTurnsToRefs builds actor_turn refs from real turns", () => {
    const refs = mapActorTurnsToRefs([
      sampleTurn(),
      sampleTurn({
        turnId: "turn_2_nurse_maria_alvarez_v1_200",
        stationRunId: "run_x",
      }),
    ]);
    expect(refs).toEqual([
      "actor_turn:run_ed_chest_pain_priority_v1_test:turn_1_patient_robert_hayes_v1_120",
      "actor_turn:run_x:turn_2_nurse_maria_alvarez_v1_200",
    ]);
  });

  it("mapActorTurnsToTimeline projects learner utterance + actor response pairs", () => {
    const timeline = mapActorTurnsToTimeline([sampleTurn()]);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      sequence: 0,
      eventType: "learner.utterance",
      source: "learner",
      actorId: "patient_robert_hayes_v1",
      tag: "history_opqrst",
      atSecond: 120,
    });
    expect(timeline[0]?.summary).toContain("When did the chest pressure start?");
    expect(timeline[1]).toMatchObject({
      sequence: 1,
      eventType: "actor.response.generated",
      source: "runtime_emission",
      actorId: "patient_robert_hayes_v1",
      tag: "history_opqrst",
    });
    expect(timeline[1]?.summary).toContain("spoken_actor_response");
  });

  it("mapActorTurnsToTimeline projects clinical-touch turns as touch→guard→dialogue with region", () => {
    const touchTurn = sampleTurn({
      turnId: "turn_2_patient_robert_hayes_v1_210",
      atSecond: 210,
      conversationTurn: 2,
      learnerUtterance: "[physical exam palpation at abdomen_rlq]",
      responseText: "Ow— that hurts a lot, please don't push there.",
      traceContextTags: ["clinical_touch_guard_rlq"],
    });
    const timeline = mapActorTurnsToTimeline(
      [sampleTurn(), touchTurn],
      [
        {
          atSecond: 210,
          eventType: "clinical.touch.guarding",
          actorId: "patient_robert_hayes_v1",
          tag: "clinical_touch_guard_rlq",
          region: "abdomen_rlq",
          responseKind: "guarding",
          dialogueLine: "Ow— that hurts a lot, please don't push there.",
          summary: "patient_robert_hayes_v1 physical exam touch: guarding at abdomen_rlq",
        },
      ],
    );
    expect(timeline.some((e) => e.eventType === "clinical.touch.guarding")).toBe(true);
    const touchEntry = timeline.find((e) => e.eventType === "clinical.touch.guarding");
    expect(touchEntry?.summary).toContain("abdomen_rlq");
    expect(touchEntry?.summary).toMatch(/touch→guard→dialogue/);
    expect(touchEntry?.tag).toBe("clinical_touch_guard_rlq");
  });

  it("mapEmissionToAdminReplayProjection requires ≥1 real turn and sets claim boundary", () => {
    const projection = mapEmissionToAdminReplayProjection({
      emission: sampleEmission(),
      sourceEmissionPath: "/tmp/emission.json",
      generatedAt: "2026-08-02T12:00:00.000Z",
    });

    expect(projection.schemaVersion).toBe("openclinxr.admin-replay-from-emission.v1");
    expect(projection.actorTurnCount).toBeGreaterThanOrEqual(1);
    expect(projection.actorTurnRefs.length).toBe(projection.actorTurnCount);
    // History pair (2) + orphan clinical.touch ledger entry (1) when no matching touch turn.
    expect(projection.timelineEntryCount).toBeGreaterThanOrEqual(2);
    expect(projection.timeline.length).toBe(projection.timelineEntryCount);
    expect(projection.timeline.some((e) => e.eventType === "clinical.touch.guarding")).toBe(true);
    expect(
      projection.timeline.find((e) => e.eventType === "clinical.touch.guarding")?.summary,
    ).toContain("abdomen_rlq");
    expect(projection.traceEventTypes).toEqual(
      expect.arrayContaining(["learner.utterance", "actor.response.generated"]),
    );
    expect(projection.turnSource).toBe("runtime_emission_real_turns");
    expect(projection.privatePayloadRedacted).toBe(true);
    expect(projection.claimBoundary).toBe(
      "admin_replay_from_runtime_emission_not_clinical_validity",
    );
    expect(projection.notEvidenceFor).toEqual([
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "production_readiness",
    ]);
    expect(projection.reviewPacket.scenarioId).toBe("ed_chest_pain_priority_v1");
  });

  it("mapEmissionToAdminReplayProjection rejects empty actorTurns (seeds-only guard)", () => {
    expect(() =>
      mapEmissionToAdminReplayProjection({
        emission: sampleEmission({ actorTurns: [] }),
        sourceEmissionPath: "/tmp/empty.json",
      }),
    ).toThrow(/no actorTurns/);
  });

  it("mapEmissionToAdminReplayProps returns ui-admin-friendly props with real turn counts", () => {
    const props = mapEmissionToAdminReplayProps(sampleEmission());
    expect(props.actorTurnCount).toBeGreaterThanOrEqual(1);
    expect(props.actorTurnRefs[0]).toMatch(/^actor_turn:/);
    expect(props.timelineEntryCount).toBeGreaterThanOrEqual(2);
    expect(props.claimBoundary).toBe(
      "admin_replay_from_runtime_emission_not_clinical_validity",
    );
    expect(props.turnSource).toBe("runtime_emission_real_turns");
  });

  it("runAdminReplayFromEmission writes artifact with actorTurnCount≥1 from emission file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "admin-replay-from-emission-"));
    tempDirs.push(dir);
    const inputPath = path.join(dir, "encounter-runtime-emission-latest.json");
    const outputPath = path.join(dir, "admin-replay-from-emission-latest.json");

    await writeFile(inputPath, `${JSON.stringify(sampleEmission(), null, 2)}\n`, "utf8");

    const { artifact, generatedEmission } = await runAdminReplayFromEmission({
      inputPath,
      outputPath,
      generatedAt: "2026-08-02T12:00:00.000Z",
      generateIfMissing: false,
    });

    expect(generatedEmission).toBe(false);
    expect(artifact.actorTurnCount).toBeGreaterThanOrEqual(1);
    expect(artifact.schemaVersion).toBe("openclinxr.admin-replay-from-emission.v1");
    expect(artifact.claimBoundary).toBe(
      "admin_replay_from_runtime_emission_not_clinical_validity",
    );

    const onDisk = JSON.parse(await readFile(outputPath, "utf8")) as AdminReplayFromEmissionProjection;
    expect(onDisk.actorTurnCount).toBe(artifact.actorTurnCount);
    expect(onDisk.actorTurnRefs).toEqual(artifact.actorTurnRefs);
    expect(onDisk.timelineEntryCount).toBeGreaterThanOrEqual(2);
    expect(onDisk.traceEventTypes.length).toBeGreaterThan(0);
  });

  it("runAdminReplayFromEmission generates emission when missing then projects", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "admin-replay-gen-"));
    tempDirs.push(dir);
    const inputPath = path.join(dir, "encounter-runtime-emission-latest.json");
    const outputPath = path.join(dir, "admin-replay-from-emission-latest.json");

    const { artifact, generatedEmission } = await runAdminReplayFromEmission({
      inputPath,
      outputPath,
      generateIfMissing: true,
    });

    expect(generatedEmission).toBe(true);
    expect(artifact.actorTurnCount).toBeGreaterThanOrEqual(1);
    expect(artifact.timelineEntryCount).toBeGreaterThanOrEqual(2);
    expect(artifact.traceEventTypes).toEqual(
      expect.arrayContaining(["actor.response.generated", "learner.utterance"]),
    );

    const emissionOnDisk = JSON.parse(
      await readFile(inputPath, "utf8"),
    ) as EncounterRuntimeEmissionArtifact;
    expect(emissionOnDisk.actorTurns.length).toBeGreaterThanOrEqual(1);
  });
});
