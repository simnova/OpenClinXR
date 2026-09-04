import { describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  assembleActorTurnReplay,
  assembledActorTurnReplayClaimBoundary,
  assembledActorTurnReplayNotEvidenceFor,
  facultyTraceEventsFromActorTurnRecords,
  stripPrivateHiddenFactPayload,
  type ActorTurnExecutionLedgerRecord,
} from "./assembled-actor-turn-replay.js";

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

function sampleRecord(
  overrides: Partial<ActorTurnExecutionLedgerRecord> = {},
): ActorTurnExecutionLedgerRecord {
  const plan = samplePlan();
  const execution = sampleExecution();
  return {
    identity: { stationRunId: STATION, planId: PLAN_ID, turnId: TURN_ID },
    plan,
    execution,
    actorId: plan.actorId,
    respondingActorId: plan.respondingActorId,
    turnIndex: plan.turnIndex,
    atSecond: 22,
    modalityProvenance: {
      voiceId: plan.voiceId,
      languageFallback: false,
      ttsFallback: false,
      providerId: "mock-model",
    },
    durableEventRef: `durable://station-runs/${STATION}/actor-turns/${PLAN_ID}/${TURN_ID}`,
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_validity"],
    ...overrides,
  };
}

describe("assembled actor-turn replay", () => {
  it("keeps ActorTurnPlan distinct from ActorTurnExecution in faculty projection", () => {
    const assembled = assembleActorTurnReplay(STATION, [sampleRecord()]);
    expect(assembled.turns).toHaveLength(1);
    const turn = assembled.turns[0];
    expect(turn?.plan).toBeDefined();
    expect(turn?.execution).toBeDefined();
    expect(turn?.plan).not.toBe(turn?.execution);
    expect(turn?.plan.spokenText).toBe("It feels tight when I breathe.");
    expect(turn?.execution?.interruption.kind).toBe("truncated");
    expect(turn?.caption).toBe("It feels tight when I breathe.");
    expect(turn?.caption).not.toContain("<soft>");
    expect(assembled.timeline.map((entry) => entry.kind)).toEqual(["plan", "execution"]);
    expect(assembled.examEquivalenceGate).toBe(false);
    expect(assembled.claimBoundary).toBe(assembledActorTurnReplayClaimBoundary);
    expect(assembled.notEvidenceFor).toEqual(assembledActorTurnReplayNotEvidenceFor);
  });

  it("emits planned then executed faculty traces without flattening plan into execution", () => {
    const events = facultyTraceEventsFromActorTurnRecords([sampleRecord()]);
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe("actor.turn.planned");
    expect(events[1]?.eventType).toBe("actor.turn.executed");
    expect(events[0]?.payload).toHaveProperty("actorTurnPlan");
    expect(events[0]?.payload).not.toHaveProperty("actorTurnExecution");
    expect(events[1]?.payload).toHaveProperty("actorTurnExecution");
    expect(events[1]?.payload).not.toHaveProperty("actorTurnPlan");
  });

  it("never projects private hidden-fact payloads into faculty JSON", () => {
    const plan = {
      ...samplePlan(),
      hiddenFacts: [HIDDEN],
      privateFacts: [HIDDEN],
    } as ActorTurnPlan & { hiddenFacts: string[]; privateFacts: string[] };
    const execution = {
      ...sampleExecution(),
      hiddenFactRefs: [HIDDEN],
      serverOnlyNotes: [HIDDEN],
    } as ActorTurnExecution & { hiddenFactRefs: string[]; serverOnlyNotes: string[] };
    const assembled = assembleActorTurnReplay(STATION, [
      sampleRecord({
        plan,
        execution,
      }),
    ]);
    const json = JSON.stringify(assembled);
    expect(json).not.toContain(HIDDEN);
    expect(json).not.toContain("hiddenFacts");
    expect(json).not.toContain("hiddenFactRefs");
    expect(json).not.toContain("privateFacts");
    expect(json).not.toContain("serverOnlyNotes");
    expect(assembled.turns[0]?.plan.spokenText).toBe("It feels tight when I breathe.");
    expect(assembled.turns[0]?.execution?.interruption.kind).toBe("truncated");
  });

  it("strips nested private keys while leaving public modality fields", () => {
    const stripped = stripPrivateHiddenFactPayload({
      voiceId: "mock-maya-johnson",
      hiddenFacts: [HIDDEN],
      nested: { providerId: "mock-model", confidentialNote: HIDDEN },
    }) as Record<string, unknown>;
    expect(stripped).toEqual({
      voiceId: "mock-maya-johnson",
      nested: { providerId: "mock-model" },
    });
  });
});
