import { describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  createActorTurnExecutionLedger,
  MemoryActorTurnExecutionLedger,
  actorTurnExecutionLedgerClaimBoundary,
  actorTurnExecutionLedgerNotEvidenceFor,
} from "./actor-turn-execution-ledger.js";

const STATION = "run_peds_001";
const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";
const HIDDEN = "HIDDEN_DIAGNOSIS_MODERATE_PERSISTENT_ASTHMA";

function samplePlan(overrides: Partial<ActorTurnPlan> = {}): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: STATION,
    actorId: "patient_maya_johnson_v1",
    respondingActorId: "patient_maya_johnson_v1",
    turnIndex: 0,
    spokenText: "It feels tight when I breathe.",
    spokenTextForTts: "<soft>It feels tight when I breathe. [breath]</soft>",
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "anxious",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "child",
    performancePlanId: "perf_anxious_child_mid",
    facePresetId: "face_anxious_child",
    posePresetId: "pose_upright_child",
    gestureClipIds: [],
    prosody: {
      wrapTags: ["<soft>"],
      inlineTags: ["[breath]"],
      speed: 0.95,
      droppedTags: ["[cry]"],
    },
    voiceId: "mock-maya-johnson",
    languageProvenance: { fallbackUsed: false, providerId: "mock-model" },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
    ...overrides,
  };
}

function sampleExecution(overrides: Partial<ActorTurnExecution> = {}): ActorTurnExecution {
  return {
    planId: PLAN_ID,
    turnId: TURN_ID,
    interruption: { kind: "truncated" },
    renderedProsodyTags: ["<soft>"],
    droppedProsodyTags: ["[breath]"],
    fallback: { language: false, tts: false },
    ...overrides,
  };
}

describe("actor-turn execution ledger", () => {
  it("uses an honest in-memory backend when no Mongo db is provided", async () => {
    const ledger = createActorTurnExecutionLedger();
    expect(ledger.backend).toBe("memory");
    expect(ledger).toBeInstanceOf(MemoryActorTurnExecutionLedger);
    await ledger.ensureIndexes();
  });

  it("persists frozen plan and execution as distinct immutable station-run records", async () => {
    const ledger = createActorTurnExecutionLedger();
    const admitted = await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
    });
    expect(admitted.identity).toEqual({ stationRunId: STATION, planId: PLAN_ID, turnId: TURN_ID });
    expect(admitted.plan).not.toBe(admitted.execution);
    expect(admitted.plan.spokenText).toBe("It feels tight when I breathe.");
    expect(admitted.execution.interruption.kind).toBe("truncated");
    expect(admitted.modalityProvenance.voiceId).toBe("mock-maya-johnson");
    expect(admitted.durableEventRef).toBe(
      `durable://station-runs/${STATION}/actor-turns/${PLAN_ID}/${TURN_ID}`,
    );
    expect(Object.isFrozen(admitted.plan)).toBe(true);
    expect(Object.isFrozen(admitted.execution)).toBe(true);
    expect(admitted.notEvidenceFor).toEqual(actorTurnExecutionLedgerNotEvidenceFor);
    const listed = await ledger.listByStationRun(STATION);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.durableEventRef).toBe(admitted.durableEventRef);
  });

  it("retries with byte-equivalent identity are idempotent", async () => {
    const ledger = createActorTurnExecutionLedger();
    const first = await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
    });
    const second = await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
    });
    expect(second.durableEventRef).toBe(first.durableEventRef);
    expect(await ledger.listByStationRun(STATION)).toHaveLength(1);
  });

  it("fail-closes mutated text under an existing execution identity", async () => {
    const ledger = createActorTurnExecutionLedger();
    await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
    });
    await expect(
      ledger.admit({
        stationRunId: STATION,
        plan: samplePlan({ spokenText: "It does not hurt." }),
        execution: sampleExecution(),
        atSecond: 22,
      }),
    ).rejects.toThrow(/mutated text/);
  });

  it("fail-closes mutated actor under an existing execution identity", async () => {
    const ledger = createActorTurnExecutionLedger();
    await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
    });
    await expect(
      ledger.admit({
        stationRunId: STATION,
        plan: samplePlan({ actorId: "parent_aisha_johnson_v1" }),
        execution: sampleExecution(),
        atSecond: 22,
      }),
    ).rejects.toThrow(/mutated actor/);
  });

  it("fail-closes mutated modality provenance under an existing execution identity", async () => {
    const ledger = createActorTurnExecutionLedger();
    await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
    });
    await expect(
      ledger.admit({
        stationRunId: STATION,
        plan: samplePlan({ languageProvenance: { fallbackUsed: true, providerId: "other" } }),
        execution: sampleExecution(),
        atSecond: 22,
      }),
    ).rejects.toThrow(/mutated modality provenance/);
  });

  it("fail-closes mutated timing under an existing execution identity", async () => {
    const ledger = createActorTurnExecutionLedger();
    await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
    });
    await expect(
      ledger.admit({
        stationRunId: STATION,
        plan: samplePlan(),
        execution: sampleExecution(),
        atSecond: 40,
      }),
    ).rejects.toThrow(/mutated timing/);
  });

  it("fail-closes mutated plan binding on admit", async () => {
    const ledger = createActorTurnExecutionLedger();
    await expect(
      ledger.admit({
        stationRunId: STATION,
        plan: samplePlan(),
        execution: sampleExecution({ planId: "plan_other" }),
        atSecond: 22,
      }),
    ).rejects.toThrow(/mutated plan binding/);
  });

  it("projects faculty replay without flattening plan versus execution and without hidden facts", async () => {
    const ledger = createActorTurnExecutionLedger();
    await ledger.admit({
      stationRunId: STATION,
      plan: samplePlan(),
      execution: sampleExecution(),
      atSecond: 22,
      privatePayload: { hiddenFacts: [HIDDEN], hiddenFactRefs: [HIDDEN] },
    });
    const faculty = await ledger.projectFaculty(STATION);
    expect(faculty.turns).toHaveLength(1);
    expect(faculty.turns[0]?.plan.spokenText).toBe("It feels tight when I breathe.");
    expect(faculty.turns[0]?.execution?.interruption.kind).toBe("truncated");
    expect(faculty.turns[0]?.plan).not.toBe(faculty.turns[0]?.execution);
    expect(faculty.timeline.map((entry) => entry.kind)).toEqual(["plan", "execution"]);
    expect(faculty.claimBoundary).toContain("not_exam_equivalence");
    expect(faculty.examEquivalenceGate).toBe(false);
    const json = JSON.stringify(faculty);
    expect(json).not.toContain(HIDDEN);
    expect(json).not.toContain("hiddenFacts");
    expect(actorTurnExecutionLedgerClaimBoundary).toContain("not_exam_equivalence");
  });
});
