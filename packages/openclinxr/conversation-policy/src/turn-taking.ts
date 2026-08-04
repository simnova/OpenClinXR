import {
  CONVERSATION_CLAIM_SCOPE,
  CONVERSATION_NOT_EVIDENCE_FOR,
  type ConversationActorRef,
  type TurnTakingDecision,
  type TurnTakingReason,
} from "./types.js";

export type ArbitrateTurnTakingInput = {
  actors: readonly ConversationActorRef[];
  lastActorId: string | null | undefined;
  /** Routed/target actor when the learner explicitly addressed someone. */
  routedActorId?: string | null;
  learnerUtterance?: string;
  conversationTurn: number;
};

/**
 * Deterministic who-speaks-next arbitration.
 * Tie-breaks use stable actor list order (index). No randomness, no Date.now.
 */
export function arbitrateTurnTaking(input: ArbitrateTurnTakingInput): TurnTakingDecision {
  const actors = input.actors.filter((actor) => actor.actorId.trim().length > 0);
  if (actors.length === 0) {
    throw new Error("arbitrateTurnTaking requires at least one actor");
  }

  let nextActorId: string;
  let reason: TurnTakingReason;

  const explicit = resolveExplicitAddressedActor(actors, input.routedActorId, input.learnerUtterance);
  if (explicit) {
    nextActorId = explicit;
    reason = "explicit_addressed_actor";
  } else if (input.lastActorId && actors.some((actor) => actor.actorId === input.lastActorId)) {
    nextActorId = input.lastActorId;
    reason = "continues_prior_actor";
  } else if (!input.lastActorId) {
    const primary = actors.find((actor) => actor.role === "patient") ?? actors[0]!;
    nextActorId = primary.actorId;
    reason = "default_primary_actor";
  } else {
    // Last speaker left the roster: advance by stable index (round-robin fallback).
    const lastIndex = actors.findIndex((actor) => actor.actorId === input.lastActorId);
    const nextIndex = lastIndex >= 0 ? (lastIndex + 1) % actors.length : 0;
    nextActorId = actors[nextIndex]!.actorId;
    reason = "round_robin_fallback";
  }

  return {
    nextActorId,
    reason,
    conversationTurn: input.conversationTurn,
    traceTag: "turn_taking_arbitrated",
    claimScope: CONVERSATION_CLAIM_SCOPE.turnTaking,
    notEvidenceFor: CONVERSATION_NOT_EVIDENCE_FOR,
  };
}

function resolveExplicitAddressedActor(
  actors: readonly ConversationActorRef[],
  routedActorId: string | null | undefined,
  learnerUtterance: string | undefined,
): string | null {
  if (routedActorId && actors.some((actor) => actor.actorId === routedActorId)) {
    return routedActorId;
  }

  const utterance = (learnerUtterance ?? "").toLowerCase();
  if (utterance.length === 0) {
    return null;
  }

  // First match in stable actor order (deterministic tie-break).
  for (const actor of actors) {
    const idHint = actor.actorId.toLowerCase().replace(/_v\d+$/, "").replaceAll("_", " ");
    const roleHint = actor.role.toLowerCase();
    if (utterance.includes(roleHint) || utterance.includes(idHint)) {
      return actor.actorId;
    }
  }
  return null;
}
