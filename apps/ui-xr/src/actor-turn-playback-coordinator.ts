/**
 * End-to-end multimodal playback around playIdentityBoundActorTurn.
 * Synthesized audio time is the authoritative clock for viseme cues.
 * Gaze, posture, and emotion share one schedule and one cancellation.
 * Missing audio or cue artifacts fall back visibly through playFrozenActorTurn.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: Quest readiness, live speech provider, clinical affect,
 * headset audio latency (unmeasured; evidence names the synthetic clock).
 */

import type { ActorTurnExecution, ActorTurnPlan, DialogueEmotion } from "@openclinxr/shared-schemas";
import {
  ACTOR_TURN_PLAYBACK_CLOCK_KIND,
  ACTOR_TURN_PLAYBACK_DRIFT_TOLERANCE_MS,
  cleanupActorTurnLiveSlot,
  playFrozenActorTurn,
  type ActorTurnLiveSlot,
  type ActorTurnPlayback,
  type ActorTurnPlaybackAdapters,
} from "./actor-turn-playback.js";
import {
  playIdentityBoundActorTurn,
  type ActorTurnExecutionArtifacts,
  type ActorTurnPlayerAdapters,
  type ActorTurnPlayerBlockReason,
  type ActorTurnPlayerResult,
  type GazeTargetKind,
} from "./actor-turn-player.js";

export const ACTOR_TURN_PLAYBACK_COORDINATOR_SEAM = "coordinateActorTurnPlayback";

export const COORDINATOR_CLOCK_KIND = ACTOR_TURN_PLAYBACK_CLOCK_KIND;
export const SYNTHETIC_AUDIO_CLOCK_DRIFT_TOLERANCE_MS = ACTOR_TURN_PLAYBACK_DRIFT_TOLERANCE_MS;

const NOT_EVIDENCE_FOR = [
  "quest_readiness",
  "live_speech_provider",
  "clinical_affect_inference",
  "headset_audio_latency",
] as const;

const ARTIFACT_FALLBACK_REASONS = new Set<ActorTurnPlayerBlockReason>([
  "missing_audio",
  "missing_viseme_cues",
  "empty_viseme_cues",
  "missing_gaze",
  "missing_emotion",
]);

export type CoordinatorModality = "viseme" | "gaze" | "posture" | "emotion";

export type CoordinatorScheduleEvent = {
  modality: CoordinatorModality;
  scheduledAtAudioMs: number;
  appliedAtAudioMs: number | null;
  cancelled: boolean;
  identity: string;
  driftMs: number | null;
};

export type CoordinatorTimingEvidence = {
  clockKind: typeof COORDINATOR_CLOCK_KIND;
  driftToleranceMs: number;
  headsetAudioLatencyUnmeasured: true;
  events: CoordinatorScheduleEvent[];
};

export type CoordinatorTickSnapshot = {
  audioTimeMs: number;
  visemePhoneme: string;
  gazeTargetKind: GazeTargetKind | null;
  posturePresetId: string | null;
  emotion: DialogueEmotion | null;
  maxDriftMs: number;
  withinDriftTolerance: boolean;
};

export type CoordinatorStatus = "playing" | "paused" | "interrupted" | "completed" | "fallback";

export type CoordinateActorTurnPlaybackOptions = {
  nowMs?: number;
  adapters?: ActorTurnPlayerAdapters;
  frozenAdapters?: ActorTurnPlaybackAdapters;
  approvedMotionClipIds?: readonly string[];
  liveSlot?: ActorTurnLiveSlot;
};

export type ActorTurnPlaybackCoordinator = {
  seam: typeof ACTOR_TURN_PLAYBACK_COORDINATOR_SEAM;
  status: CoordinatorStatus;
  clockKind: typeof COORDINATOR_CLOCK_KIND;
  driftToleranceMs: number;
  headsetAudioLatencyUnmeasured: true;
  fallbackVisible: boolean;
  fallbackReason: ActorTurnPlayerBlockReason | null;
  actorId: string;
  turnId: string;
  player: ActorTurnPlayerResult;
  frozenPlayback: ActorTurnPlayback | null;
  evidence: CoordinatorTimingEvidence;
  tick(audioTimeMs: number): CoordinatorTickSnapshot;
  pause(audioTimeMs: number): void;
  resume(audioTimeMs: number): void;
  interrupt(kind: "truncated" | "replaced", audioTimeMs: number): void;
  cleanup(): void;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

const FALLBACK_ADAPTERS: ActorTurnPlayerAdapters = {
  startAudio: () => true,
  startViseme: () => true,
  startGaze: () => true,
  startEmotion: () => true,
};

let activeCoordinator: ActorTurnPlaybackCoordinator | null = null;

export function resetActorTurnPlaybackCoordinator(): void {
  activeCoordinator?.cleanup();
  activeCoordinator = null;
}

export function coordinateActorTurnPlayback(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null,
  artifacts: ActorTurnExecutionArtifacts,
  options: CoordinateActorTurnPlaybackOptions = {},
): ActorTurnPlaybackCoordinator {
  if (activeCoordinator && (activeCoordinator.turnId !== plan.turnId || activeCoordinator.actorId !== plan.actorId)) {
    activeCoordinator.cleanup();
  }

  const player = playIdentityBoundActorTurn(plan, artifacts, {
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    adapters: options.adapters ?? FALLBACK_ADAPTERS,
  });

  const fallbackVisible = player.status === "blocked" && ARTIFACT_FALLBACK_REASONS.has(player.reason);
  const frozenPlayback = fallbackVisible
    ? playFrozenActorTurn(plan, execution, {
        ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
        ...(options.frozenAdapters === undefined ? {} : { adapters: options.frozenAdapters }),
        ...(options.approvedMotionClipIds === undefined
          ? {}
          : { approvedMotionClipIds: options.approvedMotionClipIds }),
      })
    : null;

  if (fallbackVisible && options.liveSlot) {
    options.liveSlot.root.userData.openClinXrActorTurnPlaybackFallback = true;
    options.liveSlot.root.userData.openClinXrActorTurnPlaybackFallbackReason = player.reason;
  }

  const events = fallbackVisible ? scheduleFallback(plan, frozenPlayback) : scheduleFromPlayer(plan, player);
  const evidence: CoordinatorTimingEvidence = {
    clockKind: COORDINATOR_CLOCK_KIND,
    driftToleranceMs: SYNTHETIC_AUDIO_CLOCK_DRIFT_TOLERANCE_MS,
    headsetAudioLatencyUnmeasured: true,
    events,
  };

  const state = {
    paused: false,
    lastAudioMs: 0,
    visemePhoneme: "sil",
    gazeTargetKind: null as GazeTargetKind | null,
    posturePresetId: null as string | null,
    emotion: null as DialogueEmotion | null,
    maxDriftMs: 0,
  };

  const coordinator: ActorTurnPlaybackCoordinator = {
    seam: ACTOR_TURN_PLAYBACK_COORDINATOR_SEAM,
    status: fallbackVisible ? "fallback" : player.status === "playing" ? "playing" : "fallback",
    clockKind: COORDINATOR_CLOCK_KIND,
    driftToleranceMs: SYNTHETIC_AUDIO_CLOCK_DRIFT_TOLERANCE_MS,
    headsetAudioLatencyUnmeasured: true,
    fallbackVisible,
    fallbackReason: player.status === "blocked" ? player.reason : null,
    actorId: plan.actorId,
    turnId: plan.turnId,
    player,
    frozenPlayback,
    evidence,
    tick(audioTimeMs: number): CoordinatorTickSnapshot {
      if (coordinator.status === "interrupted" || coordinator.status === "completed") {
        return snapshot(state, audioTimeMs);
      }
      if (state.paused || coordinator.status === "paused") {
        return snapshot(state, state.lastAudioMs);
      }
      applyDueEvents(events, audioTimeMs, state);
      state.lastAudioMs = audioTimeMs;
      if (player.status === "playing" && audioTimeMs >= player.audio.durationMs) {
        coordinator.status = "completed";
      }
      return snapshot(state, audioTimeMs);
    },
    pause(audioTimeMs: number): void {
      if (coordinator.status !== "playing" && coordinator.status !== "fallback") {
        return;
      }
      applyDueEvents(events, audioTimeMs, state);
      state.paused = true;
      state.lastAudioMs = audioTimeMs;
      coordinator.status = "paused";
    },
    resume(audioTimeMs: number): void {
      if (coordinator.status !== "paused") {
        return;
      }
      state.paused = false;
      state.lastAudioMs = audioTimeMs;
      coordinator.status = fallbackVisible ? "fallback" : "playing";
    },
    interrupt(_kind: "truncated" | "replaced", audioTimeMs: number): void {
      applyDueEvents(events, audioTimeMs, state);
      cancelRemaining(events);
      restFace(state, plan, options.liveSlot);
      state.lastAudioMs = audioTimeMs;
      coordinator.status = "interrupted";
    },
    cleanup(): void {
      cancelRemaining(events);
      restFace(state, plan, options.liveSlot);
      coordinator.status = coordinator.status === "fallback" ? "fallback" : "interrupted";
    },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...NOT_EVIDENCE_FOR, ...plan.notEvidenceFor],
  };

  const barge = execution?.interruption.kind;
  if (barge === "truncated" || barge === "replaced") {
    coordinator.interrupt(barge, 0);
  }

  activeCoordinator = coordinator;
  publishCoordinator(coordinator);
  return coordinator;
}

function scheduleFromPlayer(
  plan: ActorTurnPlan,
  player: ActorTurnPlayerResult,
): CoordinatorScheduleEvent[] {
  if (player.status !== "playing") {
    return [];
  }
  const events: CoordinatorScheduleEvent[] = [];
  for (const cue of player.viseme.cues) {
    events.push(event("viseme", cue.atSecond * 1000, cue.phoneme));
  }
  events.push(event("gaze", 0, player.gaze.gazeTargetKind));
  events.push(event("posture", 0, plan.posePresetId));
  events.push(event("emotion", 0, player.emotion.from));
  events.push(event("emotion", player.audio.durationMs, player.emotion.to));
  events.sort((a, b) => a.scheduledAtAudioMs - b.scheduledAtAudioMs);
  return events;
}

function scheduleFallback(
  plan: ActorTurnPlan,
  frozen: ActorTurnPlayback | null,
): CoordinatorScheduleEvent[] {
  const events: CoordinatorScheduleEvent[] = [];
  const visemes = frozen?.visemeSequence ?? [];
  const stepMs = visemes.length > 0 ? 80 : 0;
  visemes.forEach((phoneme, index) => {
    events.push(event("viseme", index * stepMs, phoneme));
  });
  events.push(event("gaze", 0, "learner_camera"));
  events.push(event("posture", 0, plan.posePresetId));
  events.push(event("emotion", 0, plan.dialogueEmotionFrom));
  events.push(event("emotion", Math.max(stepMs * visemes.length, 0), plan.dialogueEmotionTo));
  events.sort((a, b) => a.scheduledAtAudioMs - b.scheduledAtAudioMs);
  return events;
}

function event(modality: CoordinatorModality, atMs: number, identity: string): CoordinatorScheduleEvent {
  return {
    modality,
    scheduledAtAudioMs: atMs,
    appliedAtAudioMs: null,
    cancelled: false,
    identity,
    driftMs: null,
  };
}

function applyDueEvents(
  events: CoordinatorScheduleEvent[],
  audioTimeMs: number,
  state: {
    visemePhoneme: string;
    gazeTargetKind: GazeTargetKind | null;
    posturePresetId: string | null;
    emotion: DialogueEmotion | null;
    maxDriftMs: number;
  },
): void {
  for (const item of events) {
    if (item.cancelled || item.appliedAtAudioMs !== null) {
      continue;
    }
    if (item.scheduledAtAudioMs > audioTimeMs) {
      continue;
    }
    const driftMs = audioTimeMs - item.scheduledAtAudioMs;
    item.appliedAtAudioMs = audioTimeMs;
    item.driftMs = driftMs;
    if (driftMs > state.maxDriftMs) {
      state.maxDriftMs = driftMs;
    }
    if (item.modality === "viseme") {
      state.visemePhoneme = item.identity;
    } else if (item.modality === "gaze") {
      state.gazeTargetKind = item.identity as GazeTargetKind;
    } else if (item.modality === "posture") {
      state.posturePresetId = item.identity;
    } else {
      state.emotion = item.identity as DialogueEmotion;
    }
  }
}

function cancelRemaining(events: CoordinatorScheduleEvent[]): void {
  for (const item of events) {
    if (item.appliedAtAudioMs === null) {
      item.cancelled = true;
    }
  }
}

function restFace(
  state: {
    visemePhoneme: string;
    gazeTargetKind: GazeTargetKind | null;
    posturePresetId: string | null;
    emotion: DialogueEmotion | null;
  },
  plan: ActorTurnPlan,
  slot: ActorTurnLiveSlot | undefined,
): void {
  state.visemePhoneme = "sil";
  state.gazeTargetKind = null;
  state.posturePresetId = plan.posePresetId;
  state.emotion = plan.dialogueEmotionFrom;
  if (slot) {
    cleanupActorTurnLiveSlot(slot, plan.dialogueEmotionFrom);
  }
}

function snapshot(
  state: {
    visemePhoneme: string;
    gazeTargetKind: GazeTargetKind | null;
    posturePresetId: string | null;
    emotion: DialogueEmotion | null;
    maxDriftMs: number;
  },
  audioTimeMs: number,
): CoordinatorTickSnapshot {
  return {
    audioTimeMs,
    visemePhoneme: state.visemePhoneme,
    gazeTargetKind: state.gazeTargetKind,
    posturePresetId: state.posturePresetId,
    emotion: state.emotion,
    maxDriftMs: state.maxDriftMs,
    withinDriftTolerance: state.maxDriftMs <= SYNTHETIC_AUDIO_CLOCK_DRIFT_TOLERANCE_MS,
  };
}

function publishCoordinator(coordinator: ActorTurnPlaybackCoordinator): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__openClinXrActorTurnPlaybackCoordinator = coordinator;
}

declare global {
  interface Window {
    __openClinXrActorTurnPlaybackCoordinator?: ActorTurnPlaybackCoordinator;
  }
}
