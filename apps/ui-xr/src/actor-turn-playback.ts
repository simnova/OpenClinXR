/**
 * Learner-visible playback of one frozen ActorTurnPlan across voice, viseme,
 * facial affect, gaze/posture, and motion. Join is planId+turnId. Captions
 * stay plan.spokenText. Motion plays only a clip the plan named — never a
 * stand-in from the mixer. Optional modalities drop with reasons; dialogue
 * remains usable.
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

export type PlayFrozenActorTurnOptions = {
  nowMs?: number;
  approvedMotionClipIds?: readonly string[];
  visemeAvailable?: boolean;
  voiceAvailable?: boolean;
  facialAffectAvailable?: boolean;
  gazePostureAvailable?: boolean;
  motionAvailable?: boolean;
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
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

export function playFrozenActorTurn(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null,
  options: PlayFrozenActorTurnOptions = {},
): ActorTurnPlayback {
  const nowMs = options.nowMs ?? 0;
  const consumption = consumeLiveActorTurn(plan, execution);
  const droppedModalities: ActorTurnPlaybackDroppedModality[] = [];
  const lanes: ActorTurnPlaybackLane[] = [];

  const voiceAvailable = options.voiceAvailable !== false;
  const visemeAvailable = options.visemeAvailable !== false;
  const facialAffectAvailable = options.facialAffectAvailable !== false;
  const gazePostureAvailable = options.gazePostureAvailable !== false;
  const motionAvailable = options.motionAvailable !== false;

  if (voiceAvailable) {
    lanes.push({ modality: "voice", startedAtMs: nowMs, identity: plan.voiceId });
  } else {
    droppedModalities.push({ modality: "voice", reason: "voice_provider_unavailable" });
  }

  const phonemeSequence = visemeAvailable ? phonemesForText(plan.spokenText) : [];
  const visemeSequence = visemeAvailable ? visemesForText(plan.spokenText) : [];
  if (visemeAvailable && visemeSequence.length > 0) {
    lanes.push({
      modality: "viseme",
      startedAtMs: nowMs,
      identity: `${plan.planId}:${plan.turnId}:viseme`,
    });
  } else {
    droppedModalities.push({
      modality: "viseme",
      reason: visemeAvailable ? "viseme_sequence_empty" : "viseme_unavailable",
    });
  }

  if (facialAffectAvailable) {
    lanes.push({
      modality: "facial_affect",
      startedAtMs: nowMs,
      identity: consumption.faceEmotion,
    });
  } else {
    droppedModalities.push({ modality: "facial_affect", reason: "facial_affect_unavailable" });
  }

  if (gazePostureAvailable) {
    lanes.push({
      modality: "gaze_posture",
      startedAtMs: nowMs,
      identity: plan.posePresetId,
    });
  } else {
    droppedModalities.push({ modality: "gaze_posture", reason: "gaze_posture_unavailable" });
  }

  const plannedClip = plan.gestureClipIds[0];
  const approved = options.approvedMotionClipIds;
  const clipApproved = typeof plannedClip === "string"
    && plannedClip.length > 0
    && (approved === undefined || approved.includes(plannedClip));
  const motionClipId = motionAvailable && clipApproved ? plannedClip : null;
  if (motionClipId) {
    lanes.push({ modality: "motion", startedAtMs: nowMs, identity: motionClipId });
  } else {
    droppedModalities.push({
      modality: "motion",
      reason: motionAvailable ? "no_approved_gesture_clip" : "motion_unavailable",
    });
  }

  return {
    seam: ACTOR_TURN_PLAYBACK_SEAM,
    planId: plan.planId,
    turnId: plan.turnId,
    actorId: plan.actorId,
    spokenText: consumption.caption,
    voiceId: plan.voiceId,
    faceEmotion: consumption.faceEmotion,
    posePresetId: plan.posePresetId,
    motionClipId,
    gestureClipIds: plan.gestureClipIds,
    phonemeSequence,
    visemeSequence,
    timelineOriginMs: nowMs,
    startedAtMs: nowMs,
    lanes,
    droppedModalities,
    consumption,
    execution: consumption.execution,
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...plan.notEvidenceFor],
  };
}
