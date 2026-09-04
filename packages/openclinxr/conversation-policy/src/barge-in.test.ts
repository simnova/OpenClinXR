import { describe, expect, it } from "vitest";
import { resolveLearnerBargeIn } from "./barge-in.js";
import {
  canonicalInterruptionId,
  canonicalTurnClockMs,
} from "./canonical-interruption.js";
import {
  CONVERSATION_CLAIM_SCOPE,
  CONVERSATION_NOT_EVIDENCE_FOR,
  TURN_MODALITIES_CANCELLED_ON_BARGE_IN,
  type ActorTurnInProgress,
} from "./types.js";

describe("resolveLearnerBargeIn", () => {
  const inProgress: ActorTurnInProgress = {
    actorId: "patient_maya_johnson_v1",
    conversationTurn: 2,
    startedAtSecond: 100,
    expectedResponseText: "It feels tight when I breathe.",
  };

  it("interrupts an active actor turn with distinct learner_barge_in tag", () => {
    const resolution = resolveLearnerBargeIn(inProgress, {
      atSecond: 105,
      learnerUtterance: "Wait — how long has this been going on?",
    });
    expect(resolution).toEqual({
      outcome: "actor_turn_interrupted",
      bargeInTraceTag: "learner_barge_in",
      interruptedActorId: "patient_maya_johnson_v1",
      interruptedAtSecond: 105,
      truncatedResponse: true,
      yieldedToLearner: true,
      interruptionId: canonicalInterruptionId({ clockMs: 105_000 }),
      turnId: null,
      planId: null,
      clockMs: 105_000,
      cancellationDirective: {
        interruptionId: canonicalInterruptionId({ clockMs: 105_000 }),
        turnId: "no_turn",
        planId: null,
        clockMs: 105_000,
        reason: "learner_barge_in",
        action: "audio.clear",
        cancelModalities: TURN_MODALITIES_CANCELLED_ON_BARGE_IN,
      },
      claimScope: CONVERSATION_CLAIM_SCOPE.bargeIn,
      notEvidenceFor: CONVERSATION_NOT_EVIDENCE_FOR,
    });
  });

  it("returns no_active_turn_to_interrupt when no in-progress turn", () => {
    const resolution = resolveLearnerBargeIn(null, { atSecond: 40 });
    expect(resolution).toEqual({
      outcome: "no_active_turn_to_interrupt",
      bargeInTraceTag: "learner_barge_in",
      interruptedActorId: null,
      interruptedAtSecond: 40,
      truncatedResponse: false,
      yieldedToLearner: false,
      interruptionId: canonicalInterruptionId({ clockMs: 40_000 }),
      turnId: null,
      planId: null,
      clockMs: 40_000,
      cancellationDirective: null,
      claimScope: CONVERSATION_CLAIM_SCOPE.bargeIn,
      notEvidenceFor: CONVERSATION_NOT_EVIDENCE_FOR,
    });
  });

  it("uses a distinct barge-in tag separate from normal learner/actor turns", () => {
    const resolution = resolveLearnerBargeIn(inProgress, { atSecond: 110 });
    expect(resolution.bargeInTraceTag).toBe("learner_barge_in");
    expect(resolution.bargeInTraceTag).not.toBe("learner.utterance");
    expect(resolution.outcome).toBe("actor_turn_interrupted");
  });
});

describe("canonical interruption identity and turn clock", () => {
  const clockedTurn: ActorTurnInProgress = {
    actorId: "patient_maya_johnson_v1",
    conversationTurn: 2,
    startedAtSecond: 100,
    startedAtMs: 100_000,
    stationRunId: "run_barge_001",
    turnId: "turn_maya_002",
    planId: "plan_maya_002",
  };

  it("mints identity from run, turn, and canonical clock", () => {
    const resolution = resolveLearnerBargeIn(clockedTurn, { atSecond: 105, atMs: 105_250 });
    expect(canonicalTurnClockMs({ atSecond: 105, atMs: 105_250 })).toBe(105_250);
    expect(resolution.interruptionId).toBe("run_barge_001:turn_maya_002:105250:learner_barge_in");
    expect(resolution.clockMs).toBe(105_250);
    expect(resolution.turnId).toBe("turn_maya_002");
    expect(resolution.planId).toBe("plan_maya_002");
    expect(resolution.cancellationDirective?.cancelModalities).toEqual([
      "audio",
      "viseme",
      "gaze",
      "posture",
      "affect",
    ]);
    expect(resolution.cancellationDirective?.action).toBe("audio.clear");
  });

  it("treats a duplicate interruption id as idempotent", () => {
    const input = {
      atSecond: 105,
      atMs: 105_250,
      interruptionId: "run_barge_001:turn_maya_002:105250:learner_barge_in",
      turnId: "turn_maya_002",
    };
    const first = resolveLearnerBargeIn(clockedTurn, input);
    const second = resolveLearnerBargeIn(clockedTurn, input, {
      acceptedInterruption: {
        interruptionId: first.interruptionId,
        turnId: "turn_maya_002",
        clockMs: 105_250,
      },
    });
    expect(first.outcome).toBe("actor_turn_interrupted");
    expect(second.outcome).toBe("duplicate_interruption");
    expect(second.interruptionId).toBe(first.interruptionId);
    expect(second.cancellationDirective).toEqual(first.cancellationDirective);
    expect(second.truncatedResponse).toBe(true);
  });

  it("refuses a stale completed turn and does not emit a cancellation directive", () => {
    const resolution = resolveLearnerBargeIn(clockedTurn, {
      atSecond: 120,
      turnId: "turn_maya_002",
    }, {
      completedTurnIds: ["turn_maya_002"],
    });
    expect(resolution.outcome).toBe("stale_turn_refused");
    expect(resolution.cancellationDirective).toBeNull();
    expect(resolution.yieldedToLearner).toBe(false);
    expect(resolution.truncatedResponse).toBe(false);
  });

  it("does not cancel a newer actor turn when the interruption names an older turn", () => {
    const newerTurn: ActorTurnInProgress = {
      ...clockedTurn,
      conversationTurn: 3,
      turnId: "turn_maya_003",
      planId: "plan_maya_003",
      startedAtSecond: 110,
      startedAtMs: 110_000,
    };
    const resolution = resolveLearnerBargeIn(newerTurn, {
      atSecond: 112,
      turnId: "turn_maya_002",
      stationRunId: "run_barge_001",
    }, {
      activeTurnId: "turn_maya_003",
      completedTurnIds: ["turn_maya_002"],
    });
    expect(resolution.outcome).toBe("newer_turn_protected");
    expect(resolution.cancellationDirective).toBeNull();
    expect(resolution.interruptedActorId).toBeNull();
    expect(resolution.turnId).toBe("turn_maya_002");
  });

  it("treats a late interruption on a completed turn as an idempotent no-op", () => {
    const resolution = resolveLearnerBargeIn(null, {
      atSecond: 130,
      turnId: "turn_maya_002",
      stationRunId: "run_barge_001",
    }, {
      completedTurnIds: ["turn_maya_002"],
      acceptedInterruption: {
        interruptionId: "other_interruption",
        turnId: "turn_maya_002",
        clockMs: 105_250,
      },
    });
    expect(resolution.outcome).toBe("late_interruption");
    expect(resolution.cancellationDirective).toBeNull();
    expect(resolution.yieldedToLearner).toBe(false);
  });
});
