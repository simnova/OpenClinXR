import { describe, expect, it } from "vitest";
import { arbitrateTurnTaking } from "./turn-taking.js";
import { CONVERSATION_CLAIM_SCOPE, CONVERSATION_NOT_EVIDENCE_FOR } from "./types.js";

const actors = [
  { actorId: "patient_maya_johnson_v1", role: "patient" },
  { actorId: "parent_jordan_johnson_v1", role: "parent" },
  { actorId: "nurse_kevin_chen_v1", role: "nurse" },
] as const;

describe("arbitrateTurnTaking", () => {
  it("selects explicit_addressed_actor from routedActorId", () => {
    const decision = arbitrateTurnTaking({
      actors,
      lastActorId: "patient_maya_johnson_v1",
      routedActorId: "nurse_kevin_chen_v1",
      learnerUtterance: "hello",
      conversationTurn: 2,
    });
    expect(decision).toMatchObject({
      nextActorId: "nurse_kevin_chen_v1",
      reason: "explicit_addressed_actor",
      conversationTurn: 2,
      traceTag: "turn_taking_arbitrated",
      claimScope: CONVERSATION_CLAIM_SCOPE.turnTaking,
      notEvidenceFor: [...CONVERSATION_NOT_EVIDENCE_FOR],
    });
  });

  it("selects explicit_addressed_actor from utterance role keyword (stable order tie-break)", () => {
    const decision = arbitrateTurnTaking({
      actors,
      lastActorId: null,
      learnerUtterance: "Nurse, can you check oxygen?",
      conversationTurn: 1,
    });
    expect(decision.reason).toBe("explicit_addressed_actor");
    expect(decision.nextActorId).toBe("nurse_kevin_chen_v1");
  });

  it("continues_prior_actor when no explicit address", () => {
    const decision = arbitrateTurnTaking({
      actors,
      lastActorId: "parent_jordan_johnson_v1",
      learnerUtterance: "Tell me more about tonight.",
      conversationTurn: 3,
    });
    expect(decision).toMatchObject({
      nextActorId: "parent_jordan_johnson_v1",
      reason: "continues_prior_actor",
    });
  });

  it("default_primary_actor picks patient when no last speaker", () => {
    const decision = arbitrateTurnTaking({
      actors,
      lastActorId: null,
      learnerUtterance: "Hello everyone.",
      conversationTurn: 1,
    });
    expect(decision).toMatchObject({
      nextActorId: "patient_maya_johnson_v1",
      reason: "default_primary_actor",
    });
  });

  it("round_robin_fallback when last speaker is no longer in the actor roster", () => {
    const decision = arbitrateTurnTaking({
      actors,
      lastActorId: "unknown_actor",
      learnerUtterance: "Continue.",
      conversationTurn: 4,
    });
    expect(decision.reason).toBe("round_robin_fallback");
    // Stable order: index 0 when last is unknown.
    expect(decision.nextActorId).toBe("patient_maya_johnson_v1");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      actors: [...actors],
      lastActorId: "patient_maya_johnson_v1" as string | null,
      learnerUtterance: "Nurse please",
      conversationTurn: 7,
    };
    expect(arbitrateTurnTaking(input)).toEqual(arbitrateTurnTaking(input));
  });
});
