import {
  CONVERSATION_CLAIM_SCOPE,
  CONVERSATION_NOT_EVIDENCE_FOR,
  TURN_MODALITIES_CANCELLED_ON_BARGE_IN,
  type ActorTurnInProgress,
  type BargeInContext,
  type BargeInResolution,
  type CanonicalInterruptionIdentity,
  type LearnerBargeInInput,
  type TurnCancellationDirective,
} from "./types.js";

const UNSCOPED_RUN = "unscoped";
const NO_TURN = "no_turn";
export const CANONICAL_TURN_CLOCK_MS_PER_SECOND = 1000;

/** Station-run turn clock. Explicit atMs wins; otherwise atSecond * 1000. */
export function canonicalTurnClockMs(input: Pick<LearnerBargeInInput, "atSecond" | "atMs">): number {
  if (typeof input.atMs === "number" && Number.isFinite(input.atMs)) {
    return Math.max(0, Math.trunc(input.atMs));
  }
  return Math.max(0, Math.trunc(input.atSecond * CANONICAL_TURN_CLOCK_MS_PER_SECOND));
}

export function canonicalInterruptionId(parts: {
  stationRunId?: string;
  turnId?: string;
  clockMs: number;
}): string {
  const run = nonempty(parts.stationRunId) ?? UNSCOPED_RUN;
  const turn = nonempty(parts.turnId) ?? NO_TURN;
  return `${run}:${turn}:${parts.clockMs}:learner_barge_in`;
}

export function canonicalInterruptionIdentity(
  inProgress: ActorTurnInProgress | null | undefined,
  bargeInInput: LearnerBargeInInput,
): CanonicalInterruptionIdentity {
  const clockMs = canonicalTurnClockMs(bargeInInput);
  const stationRunId =
    nonempty(bargeInInput.stationRunId) ?? nonempty(inProgress?.stationRunId) ?? UNSCOPED_RUN;
  const turnId =
    nonempty(bargeInInput.turnId) ?? nonempty(inProgress?.turnId) ?? NO_TURN;
  const interruptionId =
    nonempty(bargeInInput.interruptionId) ??
    canonicalInterruptionId({ stationRunId, turnId, clockMs });
  return { interruptionId, turnId, stationRunId, clockMs };
}

export function buildTurnCancellationDirective(
  identity: CanonicalInterruptionIdentity,
  planId: string | null,
): TurnCancellationDirective {
  return {
    interruptionId: identity.interruptionId,
    turnId: identity.turnId,
    planId,
    clockMs: identity.clockMs,
    reason: "learner_barge_in",
    action: "audio.clear",
    cancelModalities: TURN_MODALITIES_CANCELLED_ON_BARGE_IN,
  };
}

export function resolveCanonicalLearnerInterruption(
  inProgress: ActorTurnInProgress | null | undefined,
  bargeInInput: LearnerBargeInInput,
  context: BargeInContext = {},
): BargeInResolution {
  const identity = canonicalInterruptionIdentity(inProgress, bargeInInput);
  const accepted = context.acceptedInterruption ?? acceptedFromTurn(inProgress);
  const activeTurnId = nonempty(context.activeTurnId) ?? nonempty(inProgress?.turnId);
  const targetTurnId = nonempty(bargeInInput.turnId) ?? nonempty(inProgress?.turnId);
  const completed = new Set(context.completedTurnIds ?? []);

  if (accepted && accepted.interruptionId === identity.interruptionId) {
    return resolution({
      outcome: "duplicate_interruption",
      identity,
      inProgress,
      bargeInInput,
      truncatedResponse: true,
      yieldedToLearner: true,
      cancellationDirective: buildTurnCancellationDirective(identity, inProgress?.planId ?? null),
    });
  }

  if (!inProgress) {
    if (targetTurnId && completed.has(targetTurnId)) {
      return resolution({
        outcome: "late_interruption",
        identity: { ...identity, turnId: targetTurnId },
        inProgress,
        bargeInInput,
        truncatedResponse: false,
        yieldedToLearner: false,
        cancellationDirective: null,
      });
    }
    return resolution({
      outcome: "no_active_turn_to_interrupt",
      identity,
      inProgress,
      bargeInInput,
      truncatedResponse: false,
      yieldedToLearner: false,
      cancellationDirective: null,
    });
  }

  if (targetTurnId && activeTurnId && targetTurnId !== activeTurnId) {
    return resolution({
      outcome: "newer_turn_protected",
      identity: { ...identity, turnId: targetTurnId },
      inProgress,
      bargeInInput,
      truncatedResponse: false,
      yieldedToLearner: false,
      cancellationDirective: null,
    });
  }

  if (targetTurnId && completed.has(targetTurnId)) {
    return resolution({
      outcome: "stale_turn_refused",
      identity: { ...identity, turnId: targetTurnId },
      inProgress,
      bargeInInput,
      truncatedResponse: false,
      yieldedToLearner: false,
      cancellationDirective: null,
    });
  }

  const acceptedTurnId = nonempty(inProgress.turnId) ?? identity.turnId;
  const acceptedIdentity: CanonicalInterruptionIdentity = {
    ...identity,
    turnId: acceptedTurnId,
  };
  return resolution({
    outcome: "actor_turn_interrupted",
    identity: acceptedIdentity,
    inProgress,
    bargeInInput,
    truncatedResponse: true,
    yieldedToLearner: true,
    cancellationDirective: buildTurnCancellationDirective(
      acceptedIdentity,
      inProgress.planId ?? null,
    ),
  });
}

function acceptedFromTurn(
  inProgress: ActorTurnInProgress | null | undefined,
): BargeInContext["acceptedInterruption"] {
  const interruptionId = nonempty(inProgress?.acceptedInterruptionId);
  if (!interruptionId || !inProgress) {
    return undefined;
  }
  return {
    interruptionId,
    turnId: nonempty(inProgress.turnId) ?? NO_TURN,
    clockMs: inProgress.acceptedInterruptionAtMs ?? 0,
  };
}

function resolution(args: {
  outcome: BargeInResolution["outcome"];
  identity: CanonicalInterruptionIdentity;
  inProgress: ActorTurnInProgress | null | undefined;
  bargeInInput: LearnerBargeInInput;
  truncatedResponse: boolean;
  yieldedToLearner: boolean;
  cancellationDirective: TurnCancellationDirective | null;
}): BargeInResolution {
  const interrupted =
    args.outcome === "actor_turn_interrupted" || args.outcome === "duplicate_interruption";
  return {
    outcome: args.outcome,
    bargeInTraceTag: "learner_barge_in",
    interruptedActorId: interrupted ? (args.inProgress?.actorId ?? null) : null,
    interruptedAtSecond: args.bargeInInput.atSecond,
    truncatedResponse: args.truncatedResponse,
    yieldedToLearner: args.yieldedToLearner,
    interruptionId: args.identity.interruptionId,
    turnId: args.identity.turnId === NO_TURN ? (args.inProgress?.turnId ?? null) : args.identity.turnId,
    planId: args.inProgress?.planId ?? null,
    clockMs: args.identity.clockMs,
    cancellationDirective: args.cancellationDirective,
    claimScope: CONVERSATION_CLAIM_SCOPE.bargeIn,
    notEvidenceFor: CONVERSATION_NOT_EVIDENCE_FOR,
  };
}

function nonempty(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
