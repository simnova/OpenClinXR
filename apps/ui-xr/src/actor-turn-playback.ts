/**
 * Learner-visible playback of one frozen ActorTurnPlan across voice, viseme,
 * facial affect, gaze/posture, and motion. Join is planId+turnId. Captions
 * stay plan.spokenText. A lane is started only after its runtime adapter
 * returns true for that plan identity on one timeline. Motion plays only the
 * clip the plan named — never a stand-in from the mixer. Missing adapters or
 * unavailable named clips drop; dialogue remains usable.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: clinical affect inference, Quest lip-sync quality, live TTS.
 */

import type { ActorTurnExecution, ActorTurnPlan, DialogueEmotion } from "@openclinxr/shared-schemas";
import {
  consumeLiveActorTurn,
  type LiveActorTurnConsumption,
} from "./actor-turn-plan-consumption.js";
import { phonemesForText, visemesForText } from "./dialogue-visemes.js";

export const ACTOR_TURN_PLAYBACK_SEAM = "playFrozenActorTurn";

/** Synthetic audio clock — headset audio latency is unmeasured (not-tested). */
export const ACTOR_TURN_PLAYBACK_CLOCK_KIND = "synthetic_audio_time" as const;
/** One 60 Hz display frame. Not a headset-measured latency bound. */
export const ACTOR_TURN_PLAYBACK_DRIFT_TOLERANCE_MS = 1000 / 60;

export type ActorTurnPlaybackModality =
  | "voice"
  | "viseme"
  | "facial_affect"
  | "gaze_posture"
  | "motion";

export type ActorTurnPlaybackDroppedModality = {
  modality: ActorTurnPlaybackModality;
  reason: string;
};

export type ActorTurnPlaybackLane = {
  modality: ActorTurnPlaybackModality;
  startedAtMs: number;
  identity: string;
};

export type ActorTurnPlaybackStartContext = {
  planId: string;
  turnId: string;
  actorId: string;
  spokenText: string;
  voiceId: string;
  faceEmotion: DialogueEmotion;
  posePresetId: string;
  performancePlanId: string;
  phonemeSequence: readonly string[];
  visemeSequence: readonly string[];
  timelineOriginMs: number;
};

export type ActorTurnPlaybackAdapters = {
  startVoice?: (ctx: ActorTurnPlaybackStartContext) => boolean;
  startViseme?: (ctx: ActorTurnPlaybackStartContext) => boolean;
  startFacialAffect?: (ctx: ActorTurnPlaybackStartContext) => boolean;
  startGazePosture?: (ctx: ActorTurnPlaybackStartContext) => boolean;
  startMotion?: (ctx: ActorTurnPlaybackStartContext & { clipId: string }) => boolean;
};

export type PlayFrozenActorTurnOptions = {
  nowMs?: number;
  approvedMotionClipIds?: readonly string[];
  adapters?: ActorTurnPlaybackAdapters;
};

export type ActorTurnPlayback = {
  seam: typeof ACTOR_TURN_PLAYBACK_SEAM;
  planId: string;
  turnId: string;
  actorId: string;
  spokenText: string;
  voiceId: string;
  faceEmotion: DialogueEmotion;
  posePresetId: string;
  performancePlanId: string;
  motionClipId: string | null;
  gestureClipIds: readonly string[];
  phonemeSequence: readonly string[];
  visemeSequence: readonly string[];
  timelineOriginMs: number;
  startedAtMs: number;
  lanes: readonly ActorTurnPlaybackLane[];
  droppedModalities: readonly ActorTurnPlaybackDroppedModality[];
  consumption: LiveActorTurnConsumption;
  execution: ActorTurnExecution | null;
  clockKind: typeof ACTOR_TURN_PLAYBACK_CLOCK_KIND;
  driftToleranceMs: number;
  headsetAudioLatencyUnmeasured: true;
  cancelled: boolean;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

const ACTOR_TURN_PLAYBACK_RETENTION = 32;
const startedPlaybackByJoin = new Map<string, ActorTurnPlayback>();
let activePlaybackStationRunId: string | null = null;

export function actorTurnPlaybackJoinKey(plan: Pick<ActorTurnPlan, "stationRunId" | "planId" | "turnId">): string {
  return `${plan.stationRunId}::${plan.planId}::${plan.turnId}`;
}

/** Encounter boundary: a new station run drops prior playback starts. Production path, not tests. */
export function beginActorTurnPlaybackStation(stationRunId: string): void {
  if (activePlaybackStationRunId === stationRunId) {
    return;
  }
  startedPlaybackByJoin.clear();
  activePlaybackStationRunId = stationRunId;
}

export function resetActorTurnPlaybackStarts(): void {
  startedPlaybackByJoin.clear();
  activePlaybackStationRunId = null;
}

/** Drop a started join so a later play of the same plan/turn can start again. */
export function cancelStartedActorTurnPlayback(joinKey: string): ActorTurnPlayback | undefined {
  const started = startedPlaybackByJoin.get(joinKey);
  if (!started) {
    return undefined;
  }
  startedPlaybackByJoin.delete(joinKey);
  return { ...started, cancelled: true, lanes: [] };
}

/** Clear live facial / speech state so an interrupted turn cannot leave a stale viseme. */
export function cleanupActorTurnLiveSlot(
  slot: ActorTurnLiveSlot,
  restEmotion: DialogueEmotion = "neutral",
): void {
  slot.activeSpeech = undefined;
  slot.emotionExpression.targetEmotion = restEmotion;
  slot.root.userData.openClinXrActorTurnVisemePhoneme = "sil";
  slot.root.userData.openClinXrActorTurnPlaybackCancelled = true;
}

export function playFrozenActorTurn(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null,
  options: PlayFrozenActorTurnOptions = {},
): ActorTurnPlayback {
  beginActorTurnPlaybackStation(plan.stationRunId);
  const joinKey = actorTurnPlaybackJoinKey(plan);
  const barge = execution?.interruption.kind;
  if (barge === "truncated" || barge === "replaced") {
    cancelStartedActorTurnPlayback(joinKey);
  }
  const alreadyStarted = startedPlaybackByJoin.get(joinKey);
  if (alreadyStarted) {
    return alreadyStarted;
  }
  const nowMs = options.nowMs ?? 0;
  const consumption = consumeLiveActorTurn(plan, execution);
  const droppedModalities: ActorTurnPlaybackDroppedModality[] = [];
  const lanes: ActorTurnPlaybackLane[] = [];
  const adapters = options.adapters ?? {};
  const phonemeSequence = phonemesForText(plan.spokenText);
  const visemeSequence = visemesForText(plan.spokenText);
  const ctx: ActorTurnPlaybackStartContext = {
    planId: plan.planId,
    turnId: plan.turnId,
    actorId: plan.actorId,
    spokenText: consumption.caption,
    voiceId: plan.voiceId,
    faceEmotion: consumption.faceEmotion,
    posePresetId: plan.posePresetId,
    performancePlanId: plan.performancePlanId,
    phonemeSequence,
    visemeSequence,
    timelineOriginMs: nowMs,
  };

  startAdapterLane("voice", plan.voiceId, adapters.startVoice, ctx, lanes, droppedModalities);
  startAdapterLane(
    "viseme",
    `${plan.planId}:${plan.turnId}:viseme`,
    adapters.startViseme,
    ctx,
    lanes,
    droppedModalities,
  );
  startAdapterLane(
    "facial_affect",
    consumption.faceEmotion,
    adapters.startFacialAffect,
    ctx,
    lanes,
    droppedModalities,
  );
  startAdapterLane(
    "gaze_posture",
    plan.posePresetId,
    adapters.startGazePosture,
    ctx,
    lanes,
    droppedModalities,
  );

  const plannedClip = plan.gestureClipIds[0];
  const approved = options.approvedMotionClipIds;
  const clipApproved = typeof plannedClip === "string"
    && plannedClip.length > 0
    && (approved === undefined || approved.includes(plannedClip));
  let motionClipId: string | null = null;
  if (!clipApproved) {
    droppedModalities.push({ modality: "motion", reason: "no_approved_gesture_clip" });
  } else if (!adapters.startMotion) {
    droppedModalities.push({ modality: "motion", reason: "adapter_missing" });
  } else if (startAdapter(adapters.startMotion, { ...ctx, clipId: plannedClip })) {
    motionClipId = plannedClip;
    lanes.push({ modality: "motion", startedAtMs: nowMs, identity: plannedClip });
  } else {
    droppedModalities.push({ modality: "motion", reason: "adapter_failed" });
  }

  const playback: ActorTurnPlayback = {
    seam: ACTOR_TURN_PLAYBACK_SEAM,
    planId: plan.planId,
    turnId: plan.turnId,
    actorId: plan.actorId,
    spokenText: consumption.caption,
    voiceId: plan.voiceId,
    faceEmotion: consumption.faceEmotion,
    posePresetId: plan.posePresetId,
    performancePlanId: plan.performancePlanId,
    motionClipId,
    gestureClipIds: plan.gestureClipIds,
    phonemeSequence,
    visemeSequence,
    timelineOriginMs: nowMs,
    startedAtMs: nowMs,
    lanes: barge === "truncated" || barge === "replaced" ? [] : lanes,
    droppedModalities,
    consumption,
    execution: consumption.execution,
    clockKind: ACTOR_TURN_PLAYBACK_CLOCK_KIND,
    driftToleranceMs: ACTOR_TURN_PLAYBACK_DRIFT_TOLERANCE_MS,
    headsetAudioLatencyUnmeasured: true,
    cancelled: barge === "truncated" || barge === "replaced",
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...plan.notEvidenceFor],
  };
  publishActorTurnPlayback(playback);
  if (!playback.cancelled) {
    startedPlaybackByJoin.set(joinKey, playback);
  }
  while (startedPlaybackByJoin.size > ACTOR_TURN_PLAYBACK_RETENTION) {
    const oldest = startedPlaybackByJoin.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    startedPlaybackByJoin.delete(oldest);
  }
  return playback;
}

function startAdapterLane(
  modality: ActorTurnPlaybackModality,
  identity: string,
  adapter: ((ctx: ActorTurnPlaybackStartContext) => boolean) | undefined,
  ctx: ActorTurnPlaybackStartContext,
  lanes: ActorTurnPlaybackLane[],
  dropped: ActorTurnPlaybackDroppedModality[],
): void {
  if (!adapter) {
    dropped.push({ modality, reason: "adapter_missing" });
    return;
  }
  if (startAdapter(adapter, ctx)) {
    lanes.push({ modality, startedAtMs: ctx.timelineOriginMs, identity });
    return;
  }
  dropped.push({ modality, reason: "adapter_failed" });
}

function startAdapter<T>(adapter: (ctx: T) => boolean, ctx: T): boolean {
  try {
    return adapter(ctx) === true;
  } catch {
    return false;
  }
}

export type ActorTurnLiveSlot = {
  activeSpeech?: { actorId: string; text: string; visemeSequence: readonly string[] } | undefined;
  emotionExpression: { targetEmotion: string };
  root: { userData: Record<string, unknown> };
};

export function playFrozenActorTurnOnSlot(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null,
  host: {
    nowMs: number;
    clipNames: readonly string[];
    getSlot: (actorId: string) => ActorTurnLiveSlot | undefined;
    speak: (ctx: ActorTurnPlaybackStartContext) => boolean;
    playClip: (actorId: string, clipId: string) => boolean;
    startFaceTransition: (actorId: string, emotion: DialogueEmotion, nowMs: number) => void;
  },
): ActorTurnPlayback {
  const playback = playFrozenActorTurn(plan, execution, {
    nowMs: host.nowMs,
    approvedMotionClipIds: host.clipNames,
    adapters: {
      startVoice: (ctx) => {
        if (!host.speak(ctx)) return false;
        const live = host.getSlot(ctx.actorId);
        if (!live?.activeSpeech || live.activeSpeech.text !== ctx.spokenText) return false;
        live.root.userData.openClinXrActorTurnVoiceId = ctx.voiceId;
        live.root.userData.openClinXrActorTurnPerformancePlanId = ctx.performancePlanId;
        return live.activeSpeech.actorId === ctx.actorId;
      },
      startViseme: (ctx) => Boolean(host.getSlot(ctx.actorId)?.activeSpeech?.visemeSequence.length),
      startFacialAffect: (ctx) => {
        const live = host.getSlot(ctx.actorId);
        if (!live) return false;
        host.startFaceTransition(ctx.actorId, ctx.faceEmotion, host.nowMs);
        return live.emotionExpression.targetEmotion === ctx.faceEmotion;
      },
      startGazePosture: (ctx) => {
        const live = host.getSlot(ctx.actorId);
        if (!live) return false;
        live.root.userData.openClinXrActorTurnPosePresetId = ctx.posePresetId;
        return true;
      },
      startMotion: (ctx) => host.playClip(ctx.actorId, ctx.clipId),
    },
  });
  if (playback.cancelled) {
    const live = host.getSlot(plan.actorId);
    if (live) {
      cleanupActorTurnLiveSlot(live, plan.dialogueEmotionFrom);
    }
  }
  return playback;
}

function publishActorTurnPlayback(playback: ActorTurnPlayback): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__openClinXrActorTurnPlayback = playback;
  window.__openClinXrLiveActorTurnConsumption = playback.consumption;
}

declare global {
  interface Window {
    __openClinXrActorTurnPlayback?: ActorTurnPlayback;
    __openClinXrLiveActorTurnConsumption?: LiveActorTurnConsumption;
  }
}
