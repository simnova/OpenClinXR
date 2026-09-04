/**
 * Package-level composition: STT barge-in → conversation-policy → cancellation
 * applied to the exact ActorTurnExecution envelope, appending a replayable event.
 */

import {
  resolveLearnerBargeInFromStt,
  type ActorTurnInProgress,
  type BargeInContext,
  type BargeInOutcome,
  type BargeInResolution,
  type LearnerSttBargeInRecord,
  type TurnCancellationDirective,
} from "@openclinxr/conversation-policy";
import type { ActorTurnExecutionEnvelope, BoundedActorTurnExecution } from "./actor-turn-execution.js";
import {
  applyTurnCancellationDirective,
  type ActorTurnCancelModality,
  type ActorTurnCancellationAdapters,
  type ActorTurnCancellationDirective,
  type CancellationApplication,
  type PartialExecutionProvenance,
} from "./actor-turn-cancellation.js";

export const LEARNER_BARGE_IN_EXECUTION_EVENT = "actor_turn.learner_barge_in" as const;

export type LearnerBargeInExecutionEvent = {
  eventType: typeof LEARNER_BARGE_IN_EXECUTION_EVENT;
  interruptionId: string;
  turnId: string | null;
  planId: string | null;
  clockMs: number;
  outcome: BargeInOutcome;
  cancelledModalities: readonly ActorTurnCancelModality[];
  partialProvenance: PartialExecutionProvenance;
  actorTurnExecution: BoundedActorTurnExecution;
  replayKey: string;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

export type CarryLearnerSttInterruptionInput = {
  stt: LearnerSttBargeInRecord;
  inProgress: ActorTurnInProgress | null | undefined;
  envelope: ActorTurnExecutionEnvelope;
  context?: BargeInContext;
  adapters?: ActorTurnCancellationAdapters;
  appliedInterruptionId?: string;
  activeTurnId?: string;
};

export type CarryLearnerSttInterruptionResult = {
  resolution: BargeInResolution;
  application: CancellationApplication | null;
  event: LearnerBargeInExecutionEvent;
};

export async function carryLearnerSttInterruptionOntoActorTurn(
  input: CarryLearnerSttInterruptionInput,
): Promise<CarryLearnerSttInterruptionResult> {
  const resolution = resolveLearnerBargeInFromStt(
    input.stt,
    input.inProgress,
    input.context ?? {},
  );

  let application: CancellationApplication | null = null;
  if (resolution.cancellationDirective) {
    application = await applyTurnCancellationDirective(
      input.envelope,
      toVoiceDirective(resolution.cancellationDirective),
      {
        ...(input.adapters ? { adapters: input.adapters } : {}),
        ...(input.appliedInterruptionId ? { appliedInterruptionId: input.appliedInterruptionId } : {}),
        ...(input.activeTurnId ? { activeTurnId: input.activeTurnId } : {}),
      },
    );
  }

  const event = freezeEvent({
    eventType: LEARNER_BARGE_IN_EXECUTION_EVENT,
    interruptionId: resolution.interruptionId,
    turnId: resolution.turnId,
    planId: resolution.planId ?? input.envelope.identity.planId,
    clockMs: resolution.clockMs,
    outcome: resolution.outcome,
    cancelledModalities: application?.cancelledModalities ?? [],
    partialProvenance: application?.partialProvenance ?? {
      deliveredAudioChunkCount: input.envelope.audioEvents.length,
      startedLanes: input.envelope.lanes.map((lane) => lane.modality),
      truncatedAtMs: resolution.clockMs,
    },
    actorTurnExecution: application?.actorTurnExecution ?? input.envelope.actorTurnExecution,
    replayKey: application?.replayKey
      ?? `${input.envelope.identity.planId}:${input.envelope.identity.turnId}:${resolution.interruptionId}:${resolution.clockMs}:${input.envelope.audioEvents.length}`,
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: application?.notEvidenceFor ?? input.envelope.notEvidenceFor,
  });

  return { resolution, application, event };
}

function toVoiceDirective(directive: TurnCancellationDirective): ActorTurnCancellationDirective {
  return {
    interruptionId: directive.interruptionId,
    turnId: directive.turnId,
    planId: directive.planId,
    clockMs: directive.clockMs,
    reason: directive.reason,
    action: directive.action,
    cancelModalities: directive.cancelModalities,
  };
}

function freezeEvent(event: LearnerBargeInExecutionEvent): LearnerBargeInExecutionEvent {
  Object.freeze(event.cancelledModalities);
  Object.freeze(event.partialProvenance);
  Object.freeze(event.notEvidenceFor);
  return Object.freeze(event);
}
