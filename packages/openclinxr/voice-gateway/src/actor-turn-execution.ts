/**
 * Compose a frozen ActorTurnPlan into one multimodal ActorTurnExecution.
 *
 * Voice, prosody, viseme, facial affect, gaze/posture, and motion resolve from
 * the same plan identity and start at timeline origin 0. Optional modalities
 * may drop with an explicit reason; spokenText stays learner-visible.
 *
 * Bounded execution matches DVA-6 (planId/turnId/interruption/prosody/fallback).
 * Extra timing/viseme/audio fields stay off the execution record.
 *
 * This package has no shared-schemas dependency: plan/execution shapes are
 * local structural seams, same as adapters.ts synthesizeActorSpeechFromFrozenPlan.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: clinical affect, Quest lip-sync, live paid TTS.
 */

import {
  synthesizeActorSpeechFromFrozenPlan,
  type ActorTurnPlanSpeech,
} from "./adapters.js";
import type { AudioEvent } from "./types.js";

/** Bounded DVA-6 execution. `fallback.tts` is true only when voice is dropped. */
export type BoundedActorTurnExecution = {
  planId: string;
  turnId: string;
  interruption: {
    kind: "none" | "truncated" | "replaced";
  };
  renderedProsodyTags: string[];
  droppedProsodyTags: string[];
  fallback: {
    language: boolean;
    tts: boolean;
  };
};

export const ACTOR_TURN_EXECUTION_SEAM = "executeFrozenActorTurn";
export const ACTOR_TURN_TIMELINE_ORIGIN_MS = 0;
export const FROZEN_PLAN_RENDER_GATE_MESSAGE = "ActorTurnPlan must be frozen before speech render";

export type ActorTurnModality =
  | "voice"
  | "prosody"
  | "viseme"
  | "facial_affect"
  | "gaze_posture"
  | "motion";

export type DroppedModalityReason = {
  modality: ActorTurnModality;
  reason: string;
};

export type ActorTurnTimelineLane = {
  modality: ActorTurnModality;
  startedAtMs: typeof ACTOR_TURN_TIMELINE_ORIGIN_MS;
  identity: string;
};

export type FrozenActorTurnPlanForExecution = ActorTurnPlanSpeech & {
  actorId: string;
  spokenText: string;
  voiceId: string;
  dialogueEmotionTo: string;
  facePresetId: string;
  posePresetId: string;
  performancePlanId: string;
};

export type ActorTurnExecutionStartContext = {
  planId: string;
  turnId: string;
  actorId: string;
  spokenText: string;
  voiceId: string;
  facePresetId: string;
  posePresetId: string;
  performancePlanId: string;
  timelineOriginMs: typeof ACTOR_TURN_TIMELINE_ORIGIN_MS;
};

export type ActorTurnExecutionAdapters = {
  startVoice?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  startProsody?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  startViseme?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  startFacialAffect?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  startGazePosture?: (ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>;
  startMotion?: (ctx: ActorTurnExecutionStartContext & { clipId: string }) => boolean | Promise<boolean>;
};

export type ExecuteFrozenActorTurnOptions = {
  bargeInAtChunkIndex?: number;
  available?: Partial<Record<ActorTurnModality, boolean>>;
  adapters?: ActorTurnExecutionAdapters;
};

export type ActorTurnExecutionEnvelope = {
  seam: typeof ACTOR_TURN_EXECUTION_SEAM;
  actorTurnExecution: BoundedActorTurnExecution;
  timelineOriginMs: typeof ACTOR_TURN_TIMELINE_ORIGIN_MS;
  lanes: readonly ActorTurnTimelineLane[];
  droppedModalities: readonly DroppedModalityReason[];
  audioEvents: readonly AudioEvent[];
  identity: {
    planId: string;
    turnId: string;
    actorId: string;
    spokenText: string;
    spokenTextForTts: string;
    voiceId: string;
    facePresetId: string;
    posePresetId: string;
    gestureClipIds: readonly string[];
    dialogueEmotionTo: string;
    performancePlanId: string;
  };
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

export async function executeFrozenActorTurn(
  plan: FrozenActorTurnPlanForExecution,
  options: ExecuteFrozenActorTurnOptions = {},
): Promise<ActorTurnExecutionEnvelope> {
  assertPlanFrozenForMultimodalExecution(plan);

  const available = options.available ?? {};
  const adapters = options.adapters ?? {};
  const droppedModalities: DroppedModalityReason[] = [];
  const lanes: ActorTurnTimelineLane[] = [];
  const ctx: ActorTurnExecutionStartContext = {
    planId: plan.planId,
    turnId: plan.turnId,
    actorId: plan.actorId,
    spokenText: plan.spokenText,
    voiceId: plan.voiceId,
    facePresetId: plan.facePresetId,
    posePresetId: plan.posePresetId,
    performancePlanId: plan.performancePlanId,
    timelineOriginMs: ACTOR_TURN_TIMELINE_ORIGIN_MS,
  };

  let audioEvents: readonly AudioEvent[] = [];
  let actorTurnExecution: BoundedActorTurnExecution;

  if (available.voice === false) {
    actorTurnExecution = freezeBoundedExecution({
      planId: plan.planId,
      turnId: plan.turnId,
      interruption: { kind: "none" },
      renderedProsodyTags: [...plan.prosody.wrapTags, ...plan.prosody.inlineTags],
      droppedProsodyTags: [...plan.prosody.droppedTags],
      fallback: {
        language: plan.languageProvenance.fallbackUsed,
        tts: true,
      },
    });
    droppedModalities.push({ modality: "voice", reason: "voice_provider_unavailable" });
  } else {
    const rendered = await synthesizeActorSpeechFromFrozenPlan({
      plan,
      ...(options.bargeInAtChunkIndex !== undefined
        ? { bargeInAtChunkIndex: options.bargeInAtChunkIndex }
        : {}),
    });
    audioEvents = rendered.audioEvents;
    actorTurnExecution = rendered.actorTurnExecution;
    const voiceAdapter = adapters.startVoice ?? (() => true);
    if (await startRuntimeAdapter(voiceAdapter, ctx)) {
      lanes.push({
        modality: "voice",
        startedAtMs: ACTOR_TURN_TIMELINE_ORIGIN_MS,
        identity: plan.voiceId,
      });
    } else {
      droppedModalities.push({ modality: "voice", reason: "adapter_failed" });
    }
  }

  await startRuntimeLane("prosody", `${plan.planId}:${plan.turnId}:prosody`, adapters.startProsody, ctx, lanes, droppedModalities);
  await startRuntimeLane("viseme", `${plan.planId}:${plan.turnId}:viseme`, adapters.startViseme, ctx, lanes, droppedModalities);
  await startRuntimeLane("facial_affect", plan.facePresetId, adapters.startFacialAffect, ctx, lanes, droppedModalities);
  await startRuntimeLane("gaze_posture", plan.posePresetId, adapters.startGazePosture, ctx, lanes, droppedModalities);

  const motionClipId = plan.gestureClipIds[0];
  if (available.motion === false) {
    droppedModalities.push({ modality: "motion", reason: "motion_unavailable" });
  } else if (typeof motionClipId !== "string" || motionClipId.length === 0) {
    droppedModalities.push({ modality: "motion", reason: "no_approved_gesture_clip" });
  } else if (!adapters.startMotion) {
    droppedModalities.push({ modality: "motion", reason: "adapter_missing" });
  } else if (await startRuntimeAdapter(adapters.startMotion, { ...ctx, clipId: motionClipId })) {
    lanes.push({
      modality: "motion",
      startedAtMs: ACTOR_TURN_TIMELINE_ORIGIN_MS,
      identity: motionClipId,
    });
  } else {
    droppedModalities.push({ modality: "motion", reason: "adapter_failed" });
  }

  return {
    seam: ACTOR_TURN_EXECUTION_SEAM,
    actorTurnExecution,
    timelineOriginMs: ACTOR_TURN_TIMELINE_ORIGIN_MS,
    lanes,
    droppedModalities,
    audioEvents,
    identity: {
      planId: plan.planId,
      turnId: plan.turnId,
      actorId: plan.actorId,
      spokenText: plan.spokenText,
      spokenTextForTts: plan.spokenTextForTts,
      voiceId: plan.voiceId,
      facePresetId: plan.facePresetId,
      posePresetId: plan.posePresetId,
      gestureClipIds: plan.gestureClipIds,
      dialogueEmotionTo: plan.dialogueEmotionTo,
      performancePlanId: plan.performancePlanId,
    },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...plan.notEvidenceFor],
  };
}

function assertPlanFrozenForMultimodalExecution(plan: FrozenActorTurnPlanForExecution): void {
  const nestedFrozen =
    Object.isFrozen(plan.gestureClipIds)
    && Object.isFrozen(plan.prosody.wrapTags)
    && Object.isFrozen(plan.prosody.inlineTags)
    && Object.isFrozen(plan.prosody.droppedTags)
    && Object.isFrozen(plan.prosody)
    && Object.isFrozen(plan.languageProvenance)
    && Object.isFrozen(plan.notEvidenceFor);
  if (!nestedFrozen || !Object.isFrozen(plan)) {
    throw new Error(FROZEN_PLAN_RENDER_GATE_MESSAGE);
  }
}

function freezeBoundedExecution(execution: BoundedActorTurnExecution): BoundedActorTurnExecution {
  Object.freeze(execution.interruption);
  Object.freeze(execution.renderedProsodyTags);
  Object.freeze(execution.droppedProsodyTags);
  Object.freeze(execution.fallback);
  return Object.freeze(execution);
}

async function startRuntimeLane(
  modality: ActorTurnModality,
  identity: string,
  adapter: ((ctx: ActorTurnExecutionStartContext) => boolean | Promise<boolean>) | undefined,
  ctx: ActorTurnExecutionStartContext,
  lanes: ActorTurnTimelineLane[],
  dropped: DroppedModalityReason[],
): Promise<void> {
  if (!adapter) {
    dropped.push({ modality, reason: "adapter_missing" });
    return;
  }
  if (await startRuntimeAdapter(adapter, ctx)) {
    lanes.push({ modality, startedAtMs: ACTOR_TURN_TIMELINE_ORIGIN_MS, identity });
    return;
  }
  dropped.push({ modality, reason: "adapter_failed" });
}

async function startRuntimeAdapter<T>(
  adapter: (ctx: T) => boolean | Promise<boolean>,
  ctx: T,
): Promise<boolean> {
  try {
    return (await adapter(ctx)) === true;
  } catch {
    return false;
  }
}
