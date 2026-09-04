import { describe, expect, it } from "vitest";
import {
  learnerBargeInInputFromStt,
  resolveLearnerBargeInFromStt,
} from "./learner-stt-barge-in.js";
import type { ActorTurnInProgress } from "./types.js";

describe("resolveLearnerBargeInFromStt", () => {
  const inProgress: ActorTurnInProgress = {
    actorId: "patient_maya_johnson_v1",
    conversationTurn: 2,
    startedAtSecond: 100,
    startedAtMs: 100_000,
    stationRunId: "run_barge_001",
    turnId: "turn_maya_002",
    planId: "plan_maya_002",
  };

  const stt = {
    stationRunId: "run_barge_001",
    transcript: "Wait — how long has this been going on?",
    interruption: {
      interruptionId: "run_barge_001:turn_maya_002:105250:learner_barge_in",
      turnId: "turn_maya_002",
      clockMs: 105_250,
    },
  };

  it("carries STT interruption identity into a policy cancellation directive", () => {
    const input = learnerBargeInInputFromStt(stt);
    expect(input).toEqual({
      atSecond: 105,
      atMs: 105_250,
      interruptionId: stt.interruption.interruptionId,
      stationRunId: "run_barge_001",
      turnId: "turn_maya_002",
      learnerUtterance: stt.transcript,
    });
    const resolution = resolveLearnerBargeInFromStt(stt, inProgress);
    expect(resolution.outcome).toBe("actor_turn_interrupted");
    expect(resolution.interruptionId).toBe(stt.interruption.interruptionId);
    expect(resolution.clockMs).toBe(105_250);
    expect(resolution.cancellationDirective?.action).toBe("audio.clear");
    expect(resolution.cancellationDirective?.cancelModalities).toEqual([
      "audio",
      "viseme",
      "gaze",
      "posture",
      "affect",
    ]);
  });

  it("does not interrupt when STT has no barge-in interruption", () => {
    const resolution = resolveLearnerBargeInFromStt(
      { stationRunId: "run_barge_001", interruption: null },
      inProgress,
    );
    expect(resolution.outcome).toBe("no_active_turn_to_interrupt");
    expect(resolution.cancellationDirective).toBeNull();
  });
});
