import { describe, expect, it, vi } from "vitest";
import type { ActorTurnInProgress } from "@openclinxr/conversation-policy";
import {
  executeFrozenActorTurn,
  type ActorTurnExecutionAdapters,
  type FrozenActorTurnPlanForExecution,
} from "./actor-turn-execution.js";
import { carryLearnerSttInterruptionOntoActorTurn } from "./carry-learner-stt-interruption.js";
import type { ActorTurnCancellationAdapters } from "./actor-turn-cancellation.js";
import { transcribeLearnerAudio } from "./learner-stt-adapter.js";

const SPOKEN = "The inhaler is in my backpack.";

function planFixture(): FrozenActorTurnPlanForExecution {
  return {
    planId: "plan_maya_wob_001",
    turnId: "turn_maya_wob_001",
    actorId: "patient_maya_johnson_v1",
    spokenText: SPOKEN,
    spokenTextForTts: `<soft>${SPOKEN} [breath]</soft>`,
    voiceId: "mock-maya-johnson",
    dialogueEmotionTo: "anxious",
    facePresetId: "face.anxious",
    posePresetId: "pose_upright_child",
    performancePlanId: "perf_anxious_child_mid",
    gestureClipIds: ["gesture_clasp_v1"],
    prosody: {
      wrapTags: ["<soft>"],
      inlineTags: ["[breath]"],
      speed: 0.95,
      droppedTags: ["[cry]"],
    },
    languageProvenance: { fallbackUsed: false, providerId: "mock-model" },
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
  };
}

function deepFreezePlan(plan: FrozenActorTurnPlanForExecution): FrozenActorTurnPlanForExecution {
  Object.freeze(plan.gestureClipIds);
  Object.freeze(plan.prosody.wrapTags);
  Object.freeze(plan.prosody.inlineTags);
  Object.freeze(plan.prosody.droppedTags);
  Object.freeze(plan.prosody);
  Object.freeze(plan.languageProvenance);
  Object.freeze(plan.notEvidenceFor);
  return Object.freeze(plan);
}

function runtimeAdapters(): ActorTurnExecutionAdapters {
  return {
    startVoice: vi.fn(() => true),
    startProsody: vi.fn(() => true),
    startViseme: vi.fn(() => true),
    startFacialAffect: vi.fn(() => true),
    startGazePosture: vi.fn(() => true),
    startMotion: vi.fn(() => true),
  };
}

function stopAdapters(): ActorTurnCancellationAdapters {
  return {
    stopVoice: vi.fn(() => true),
    stopViseme: vi.fn(() => true),
    stopFacialAffect: vi.fn(() => true),
    stopGaze: vi.fn(() => true),
    stopPosture: vi.fn(() => true),
    stopMotion: vi.fn(() => true),
  };
}

function inProgressTurn(): ActorTurnInProgress {
  return {
    actorId: "patient_maya_johnson_v1",
    conversationTurn: 2,
    startedAtSecond: 100,
    startedAtMs: 100_000,
    stationRunId: "run_barge_001",
    turnId: "turn_maya_wob_001",
    planId: "plan_maya_wob_001",
  };
}

function bargeInStt(overrides: { turnId?: string; atMs?: number } = {}) {
  return transcribeLearnerAudio({
    stationRunId: "run_barge_001",
    streamId: "learner-mic-001",
    pcmOrFixtureId: "fixture:chest-onset",
    isFinal: false,
    bargeIn: true,
    atMs: overrides.atMs ?? 105_250,
    turnId: overrides.turnId ?? "turn_maya_wob_001",
  });
}

describe("carryLearnerSttInterruptionOntoActorTurn", () => {
  it("carries STT barge-in through policy onto the execution envelope and appends a replayable event", async () => {
    const stops = stopAdapters();
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
      learnerBargeIn: {
        stt: bargeInStt(),
        inProgress: inProgressTurn(),
        adapters: stops,
      },
    });

    const carry = envelope.learnerBargeIn;
    expect(carry).toBeDefined();
    expect(carry?.resolution.outcome).toBe("actor_turn_interrupted");
    expect(carry?.event.eventType).toBe("actor_turn.learner_barge_in");
    expect(carry?.event.interruptionId).toBe("run_barge_001:turn_maya_wob_001:105250:learner_barge_in");
    expect(carry?.event.turnId).toBe("turn_maya_wob_001");
    expect(carry?.event.planId).toBe("plan_maya_wob_001");
    expect(carry?.event.clockMs).toBe(105_250);
    expect(carry?.event.cancelledModalities).toEqual(["audio", "viseme", "gaze", "posture", "affect"]);
    expect(carry?.event.actorTurnExecution.interruption.kind).toBe("truncated");
    expect(carry?.event.partialProvenance.startedLanes).toContain("voice");
    expect(carry?.event.partialProvenance.truncatedAtMs).toBe(105_250);
    expect(Object.isFrozen(carry?.event)).toBe(true);
    expect(envelope.actorTurnExecution.interruption.kind).toBe("none");
    expect(stops.stopVoice).toHaveBeenCalledTimes(1);
    expect(stops.stopGaze).toHaveBeenCalledTimes(1);
  });

  it("replays the same STT interruption onto the same envelope equivalently", async () => {
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const input = {
      stt: bargeInStt(),
      inProgress: inProgressTurn(),
      envelope,
      adapters: stopAdapters(),
    };
    const first = await carryLearnerSttInterruptionOntoActorTurn(input);
    const second = await carryLearnerSttInterruptionOntoActorTurn({
      ...input,
      adapters: stopAdapters(),
    });
    expect(second.event).toEqual(first.event);
    expect(second.resolution.interruptionId).toBe(first.resolution.interruptionId);
  });

  it("treats a duplicate STT interruption as idempotent on the composed path", async () => {
    const stops = stopAdapters();
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const stt = bargeInStt();
    const first = await carryLearnerSttInterruptionOntoActorTurn({
      stt,
      inProgress: inProgressTurn(),
      envelope,
      adapters: stops,
    });
    const duplicate = await carryLearnerSttInterruptionOntoActorTurn({
      stt,
      inProgress: inProgressTurn(),
      envelope,
      adapters: stops,
      appliedInterruptionId: first.resolution.interruptionId,
      context: {
        acceptedInterruption: {
          interruptionId: first.resolution.interruptionId,
          turnId: "turn_maya_wob_001",
          clockMs: 105_250,
        },
      },
    });
    expect(duplicate.resolution.outcome).toBe("duplicate_interruption");
    expect(duplicate.application?.reason).toBe("duplicate");
    expect(duplicate.event.cancelledModalities).toEqual(first.event.cancelledModalities);
    expect(stops.stopVoice).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale completed turn on the composed path without cancelling modalities", async () => {
    const stops = stopAdapters();
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const result = await carryLearnerSttInterruptionOntoActorTurn({
      stt: bargeInStt(),
      inProgress: inProgressTurn(),
      envelope,
      adapters: stops,
      context: { completedTurnIds: ["turn_maya_wob_001"] },
    });
    expect(result.resolution.outcome).toBe("stale_turn_refused");
    expect(result.application).toBeNull();
    expect(result.event.cancelledModalities).toEqual([]);
    expect(result.event.actorTurnExecution.interruption.kind).toBe("none");
    expect(stops.stopVoice).not.toHaveBeenCalled();
  });

  it("does not cancel a newer actor turn when STT names an older turn", async () => {
    const stops = stopAdapters();
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const newer: ActorTurnInProgress = {
      ...inProgressTurn(),
      conversationTurn: 3,
      turnId: "turn_maya_wob_001",
      startedAtSecond: 110,
    };
    const result = await carryLearnerSttInterruptionOntoActorTurn({
      stt: bargeInStt({ turnId: "turn_maya_wob_000" }),
      inProgress: newer,
      envelope,
      adapters: stops,
      activeTurnId: "turn_maya_wob_001",
      context: {
        activeTurnId: "turn_maya_wob_001",
        completedTurnIds: ["turn_maya_wob_000"],
      },
    });
    expect(result.resolution.outcome).toBe("newer_turn_protected");
    expect(result.application).toBeNull();
    expect(result.event.cancelledModalities).toEqual([]);
    expect(stops.stopVoice).not.toHaveBeenCalled();
    expect(stops.stopFacialAffect).not.toHaveBeenCalled();
  });

  it("treats a late STT interruption on a completed turn as an idempotent no-op", async () => {
    const stops = stopAdapters();
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const result = await carryLearnerSttInterruptionOntoActorTurn({
      stt: bargeInStt({ atMs: 130_000 }),
      inProgress: null,
      envelope,
      adapters: stops,
      context: {
        completedTurnIds: ["turn_maya_wob_001"],
        acceptedInterruption: {
          interruptionId: "run_barge_001:turn_maya_wob_001:105250:learner_barge_in",
          turnId: "turn_maya_wob_001",
          clockMs: 105_250,
        },
      },
    });
    expect(result.resolution.outcome).toBe("late_interruption");
    expect(result.application).toBeNull();
    expect(result.event.cancelledModalities).toEqual([]);
    expect(stops.stopVoice).not.toHaveBeenCalled();
  });
});
