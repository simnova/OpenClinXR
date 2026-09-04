/**
 * Apply a learner barge-in cancellation directive to a started actor-turn
 * execution. Duplicate/late applications are idempotent. A directive that
 * names a stale turn never stops a newer turn's modalities.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: clinical affect, Quest lip-sync, live paid TTS, production latency.
 */

import type {
  ActorTurnExecutionEnvelope,
  ActorTurnExecutionStartContext,
  ActorTurnModality,
  BoundedActorTurnExecution,
} from "./actor-turn-execution.js";

export const ACTOR_TURN_CANCEL_MODALITIES = [
  "audio",
  "viseme",
  "gaze",
  "posture",
  "affect",
] as const;

export type ActorTurnCancelModality = (typeof ACTOR_TURN_CANCEL_MODALITIES)[number];

export type ActorTurnCancellationDirective = {
  interruptionId: string;
  turnId: string;
  planId?: string | null;
  clockMs: number;
  reason: "learner_barge_in";
  action: "audio.clear";
  cancelModalities: readonly ActorTurnCancelModality[];
};

export type ActorTurnCancellationAdapters = {
  stopVoice?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  stopViseme?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  stopFacialAffect?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  stopGaze?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  stopPosture?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  stopMotion?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
};

export type ApplyTurnCancellationOptions = {
  adapters?: ActorTurnCancellationAdapters;
  appliedInterruptionId?: string;
  /** Currently executing turn. Must not be cancelled unless it is the directive target. */
  activeTurnId?: string;
};

export type CancellationApplicationReason =
  | "applied"
  | "duplicate"
  | "late"
  | "stale_turn"
  | "newer_turn_protected";

export type PartialExecutionProvenance = {
  deliveredAudioChunkCount: number;
  startedLanes: readonly ActorTurnModality[];
  truncatedAtMs: number;
};

export type CancellationApplication = {
  accepted: boolean;
  reason: CancellationApplicationReason;
  interruptionId: string;
  turnId: string;
  clockMs: number;
  actorTurnExecution: BoundedActorTurnExecution;
  cancelledModalities: readonly ActorTurnCancelModality[];
  partialProvenance: PartialExecutionProvenance;
  replayKey: string;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

const NOT_EVIDENCE_FOR = [
  "clinical_affect_inference",
  "quest_lip_sync",
  "live_paid_tts",
  "production_latency",
] as const;

export function replayKeyForCancellation(parts: {
  planId: string;
  turnId: string;
  interruptionId: string;
  clockMs: number;
  deliveredAudioChunkCount: number;
}): string {
  return `${parts.planId}:${parts.turnId}:${parts.interruptionId}:${parts.clockMs}:${parts.deliveredAudioChunkCount}`;
}

export async function applyTurnCancellationDirective(
  envelope: ActorTurnExecutionEnvelope,
  directive: ActorTurnCancellationDirective,
  options: ApplyTurnCancellationOptions = {},
): Promise<CancellationApplication> {
  const provenance = partialProvenance(envelope, directive.clockMs);
  const replayKey = replayKeyForCancellation({
    planId: envelope.identity.planId,
    turnId: envelope.identity.turnId,
    interruptionId: directive.interruptionId,
    clockMs: directive.clockMs,
    deliveredAudioChunkCount: provenance.deliveredAudioChunkCount,
  });

  if (options.appliedInterruptionId === directive.interruptionId) {
    return freezeApplication({
      accepted: true,
      reason: "duplicate",
      interruptionId: directive.interruptionId,
      turnId: directive.turnId,
      clockMs: directive.clockMs,
      actorTurnExecution: truncatedExecution(envelope),
      cancelledModalities: [...ACTOR_TURN_CANCEL_MODALITIES],
      partialProvenance: provenance,
      replayKey,
    });
  }

  if (directive.turnId !== envelope.identity.turnId) {
    const liveTurnId = options.activeTurnId ?? envelope.identity.turnId;
    const liveIsThisEnvelope = liveTurnId === envelope.identity.turnId;
    return freezeApplication({
      accepted: false,
      reason: liveIsThisEnvelope ? "newer_turn_protected" : "stale_turn",
      interruptionId: directive.interruptionId,
      turnId: directive.turnId,
      clockMs: directive.clockMs,
      actorTurnExecution: envelope.actorTurnExecution,
      cancelledModalities: [],
      partialProvenance: provenance,
      replayKey,
    });
  }

  if (options.activeTurnId && options.activeTurnId !== directive.turnId) {
    return freezeApplication({
      accepted: false,
      reason: "newer_turn_protected",
      interruptionId: directive.interruptionId,
      turnId: directive.turnId,
      clockMs: directive.clockMs,
      actorTurnExecution: envelope.actorTurnExecution,
      cancelledModalities: [],
      partialProvenance: provenance,
      replayKey,
    });
  }

  if (envelope.actorTurnExecution.interruption.kind !== "none") {
    return freezeApplication({
      accepted: true,
      reason: "late",
      interruptionId: directive.interruptionId,
      turnId: directive.turnId,
      clockMs: directive.clockMs,
      actorTurnExecution: envelope.actorTurnExecution,
      cancelledModalities: [...ACTOR_TURN_CANCEL_MODALITIES],
      partialProvenance: provenance,
      replayKey,
    });
  }

  const ctx: ActorTurnExecutionStartContext = {
    planId: envelope.identity.planId,
    turnId: envelope.identity.turnId,
    actorId: envelope.identity.actorId,
    spokenText: envelope.identity.spokenText,
    voiceId: envelope.identity.voiceId,
    facePresetId: envelope.identity.facePresetId,
    posePresetId: envelope.identity.posePresetId,
    performancePlanId: envelope.identity.performancePlanId,
    timelineOriginMs: envelope.timelineOriginMs,
  };

  await stopModalities(directive.cancelModalities, options.adapters ?? {}, ctx);

  return freezeApplication({
    accepted: true,
    reason: "applied",
    interruptionId: directive.interruptionId,
    turnId: directive.turnId,
    clockMs: directive.clockMs,
    actorTurnExecution: truncatedExecution(envelope),
    cancelledModalities: [...ACTOR_TURN_CANCEL_MODALITIES],
    partialProvenance: provenance,
    replayKey,
  });
}

function partialProvenance(
  envelope: ActorTurnExecutionEnvelope,
  truncatedAtMs: number,
): PartialExecutionProvenance {
  return {
    deliveredAudioChunkCount: envelope.audioEvents.length,
    startedLanes: envelope.lanes.map((lane) => lane.modality),
    truncatedAtMs,
  };
}

function truncatedExecution(envelope: ActorTurnExecutionEnvelope): BoundedActorTurnExecution {
  const execution: BoundedActorTurnExecution = {
    planId: envelope.actorTurnExecution.planId,
    turnId: envelope.actorTurnExecution.turnId,
    interruption: { kind: "truncated" },
    renderedProsodyTags: [...envelope.actorTurnExecution.renderedProsodyTags],
    droppedProsodyTags: [...envelope.actorTurnExecution.droppedProsodyTags],
    fallback: { ...envelope.actorTurnExecution.fallback },
  };
  Object.freeze(execution.interruption);
  Object.freeze(execution.renderedProsodyTags);
  Object.freeze(execution.droppedProsodyTags);
  Object.freeze(execution.fallback);
  return Object.freeze(execution);
}

function freezeApplication(
  application: Omit<CancellationApplication, "claimScope" | "notEvidenceFor">,
): CancellationApplication {
  const full: CancellationApplication = {
    ...application,
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: NOT_EVIDENCE_FOR,
  };
  Object.freeze(full.cancelledModalities);
  Object.freeze(full.partialProvenance);
  Object.freeze(full.notEvidenceFor);
  return Object.freeze(full);
}

async function stopModalities(
  modalities: readonly ActorTurnCancelModality[],
  adapters: ActorTurnCancellationAdapters,
  ctx: ActorTurnExecutionStartContext,
): Promise<void> {
  const unique = new Set(modalities);
  if (unique.has("audio")) {
    await invokeStop(adapters.stopVoice, ctx);
  }
  if (unique.has("viseme")) {
    await invokeStop(adapters.stopViseme, ctx);
  }
  if (unique.has("affect")) {
    await invokeStop(adapters.stopFacialAffect, ctx);
  }
  if (unique.has("gaze")) {
    await invokeStop(adapters.stopGaze, ctx);
  }
  if (unique.has("posture")) {
    await invokeStop(adapters.stopPosture, ctx);
    await invokeStop(adapters.stopMotion, ctx);
  }
}

async function invokeStop(
  adapter: ((ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>) | undefined,
  ctx: ActorTurnExecutionStartContext,
): Promise<void> {
  if (!adapter) {
    return;
  }
  try {
    await adapter(ctx);
  } catch {
    // Fail-closed stop: a throwing adapter does not resume playback.
  }
}
