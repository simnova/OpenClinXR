import { describe, expect, it } from "vitest";
import { resolveLearnerBargeIn } from "./barge-in.js";
import { CONVERSATION_CLAIM_SCOPE, CONVERSATION_NOT_EVIDENCE_FOR, type ActorTurnInProgress } from "./types.js";

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
