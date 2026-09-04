import { describe, expect, it, vi } from "vitest";
import {
  ACTOR_TURN_TIMELINE_ORIGIN_MS,
  executeFrozenActorTurn,
  type ActorTurnExecutionAdapters,
  type FrozenActorTurnPlanForExecution,
} from "./actor-turn-execution.js";
import {
  ACTOR_TURN_CANCEL_MODALITIES,
  applyTurnCancellationDirective,
  replayKeyForCancellation,
  type ActorTurnCancellationAdapters,
  type ActorTurnCancellationDirective,
} from "./actor-turn-cancellation.js";

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

function directive(
  overrides: Partial<ActorTurnCancellationDirective> = {},
): ActorTurnCancellationDirective {
  return {
    interruptionId: "run_barge_001:turn_maya_wob_001:420:learner_barge_in",
    turnId: "turn_maya_wob_001",
    planId: "plan_maya_wob_001",
    clockMs: 420,
    reason: "learner_barge_in",
    action: "audio.clear",
    cancelModalities: ACTOR_TURN_CANCEL_MODALITIES,
    ...overrides,
  };
}

describe("applyTurnCancellationDirective", () => {
  it("stops audio, viseme, gaze, posture, and affect on one canonical clock and keeps partial provenance", async () => {
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const stops = stopAdapters();
    const applied = await applyTurnCancellationDirective(envelope, directive(), { adapters: stops });

    expect(applied.accepted).toBe(true);
    expect(applied.reason).toBe("applied");
    expect(applied.clockMs).toBe(420);
    expect(applied.cancelledModalities).toEqual(["audio", "viseme", "gaze", "posture", "affect"]);
    expect(applied.actorTurnExecution.interruption.kind).toBe("truncated");
    expect(applied.actorTurnExecution).not.toBe(envelope.actorTurnExecution);
    expect(applied.partialProvenance.deliveredAudioChunkCount).toBe(envelope.audioEvents.length);
    expect(applied.partialProvenance.startedLanes).toEqual([
      "voice",
      "prosody",
      "viseme",
      "facial_affect",
      "gaze_posture",
      "motion",
    ]);
    expect(applied.partialProvenance.truncatedAtMs).toBe(420);
    expect(stops.stopVoice).toHaveBeenCalledWith(expect.objectContaining({
      planId: envelope.identity.planId,
      turnId: envelope.identity.turnId,
      timelineOriginMs: ACTOR_TURN_TIMELINE_ORIGIN_MS,
    }));
    expect(stops.stopViseme).toHaveBeenCalledTimes(1);
    expect(stops.stopGaze).toHaveBeenCalledTimes(1);
    expect(stops.stopPosture).toHaveBeenCalledTimes(1);
    expect(stops.stopFacialAffect).toHaveBeenCalledTimes(1);
    expect(envelope.actorTurnExecution.interruption.kind).toBe("none");
    expect(envelope.identity.spokenText).toBe(SPOKEN);
  });

  it("replay of the same directive on the same envelope is equivalent", async () => {
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const first = await applyTurnCancellationDirective(envelope, directive(), { adapters: stopAdapters() });
    const second = await applyTurnCancellationDirective(envelope, directive(), { adapters: stopAdapters() });
    expect(second).toEqual(first);
    expect(first.replayKey).toBe(replayKeyForCancellation({
      planId: envelope.identity.planId,
      turnId: envelope.identity.turnId,
      interruptionId: directive().interruptionId,
      clockMs: 420,
      deliveredAudioChunkCount: envelope.audioEvents.length,
    }));
  });

  it("duplicate interruption id is idempotent and does not stop modalities again", async () => {
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const stops = stopAdapters();
    const first = await applyTurnCancellationDirective(envelope, directive(), { adapters: stops });
    const again = await applyTurnCancellationDirective(envelope, directive(), {
      adapters: stops,
      appliedInterruptionId: first.interruptionId,
    });
    expect(again.reason).toBe("duplicate");
    expect(again.accepted).toBe(true);
    expect(again.actorTurnExecution).toEqual(first.actorTurnExecution);
    expect(stops.stopVoice).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale turn and does not cancel the envelope modalities", async () => {
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const stops = stopAdapters();
    const refused = await applyTurnCancellationDirective(
      envelope,
      directive({ turnId: "turn_maya_wob_000" }),
      { adapters: stops, activeTurnId: "turn_maya_wob_002" },
    );
    expect(refused.accepted).toBe(false);
    expect(refused.reason).toBe("stale_turn");
    expect(refused.cancelledModalities).toEqual([]);
    expect(refused.actorTurnExecution.interruption.kind).toBe("none");
    expect(stops.stopVoice).not.toHaveBeenCalled();
    expect(stops.stopViseme).not.toHaveBeenCalled();
  });

  it("treats a late interruption on an already truncated execution as idempotent", async () => {
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      bargeInAtChunkIndex: 2,
      adapters: runtimeAdapters(),
    });
    const stops = stopAdapters();
    expect(envelope.actorTurnExecution.interruption.kind).toBe("truncated");
    const late = await applyTurnCancellationDirective(
      envelope,
      directive({ interruptionId: "run_barge_001:turn_maya_wob_001:900:learner_barge_in", clockMs: 900 }),
      { adapters: stops },
    );
    expect(late.accepted).toBe(true);
    expect(late.reason).toBe("late");
    expect(late.actorTurnExecution).toBe(envelope.actorTurnExecution);
    expect(stops.stopVoice).not.toHaveBeenCalled();
  });

  it("does not cancel a newer actor turn when the directive names an older turn", async () => {
    const envelope = await executeFrozenActorTurn(deepFreezePlan(planFixture()), {
      adapters: runtimeAdapters(),
    });
    const stops = stopAdapters();
    const refused = await applyTurnCancellationDirective(
      envelope,
      directive({ turnId: "turn_maya_wob_000" }),
      { adapters: stops },
    );
    expect(refused.accepted).toBe(false);
    expect(refused.reason).toBe("newer_turn_protected");
    expect(refused.actorTurnExecution).toBe(envelope.actorTurnExecution);
    expect(refused.actorTurnExecution.interruption.kind).toBe("none");
    expect(stops.stopVoice).not.toHaveBeenCalled();
    expect(stops.stopGaze).not.toHaveBeenCalled();
    expect(stops.stopPosture).not.toHaveBeenCalled();
    expect(stops.stopFacialAffect).not.toHaveBeenCalled();
  });
});
