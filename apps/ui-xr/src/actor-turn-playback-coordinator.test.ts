import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  ACTOR_TURN_PLAYBACK_CLOCK_KIND,
  ACTOR_TURN_PLAYBACK_DRIFT_TOLERANCE_MS,
  cleanupActorTurnLiveSlot,
  resetActorTurnPlaybackStarts,
  type ActorTurnLiveSlot,
} from "./actor-turn-playback.js";
import {
  ACTOR_TURN_PLAYBACK_COORDINATOR_SEAM,
  COORDINATOR_CLOCK_KIND,
  SYNTHETIC_AUDIO_CLOCK_DRIFT_TOLERANCE_MS,
  coordinateActorTurnPlayback,
  resetActorTurnPlaybackCoordinator,
} from "./actor-turn-playback-coordinator.js";
import { expressionWeightsForEmotion } from "./actor-turn-plan-consumption.js";
import {
  digestActorTurnPlan,
  playIdentityBoundActorTurn,
  type ActorTurnExecutionArtifacts,
  type IdentityBoundRef,
} from "./actor-turn-player.js";

/**
 * Audio time is the one clock for viseme, gaze, posture, and affect.
 * known-good: identity-bound player blocks missing audio; anxious brow 0.62.
 */

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";
const ACTOR_ID = "patient_maya_johnson_v1";
const SPOKEN = "The inhaler is in my backpack.";
const AUDIO_URI = "fixture://actor-turn/plan_maya_wob_001.wav";
const AUDIO_DURATION_MS = 1_200;
const RHUBARB_CUES = [
  { start: 0, end: 0.12, value: "X" },
  { start: 0.12, end: 0.28, value: "A" },
  { start: 0.28, end: 0.44, value: "B" },
] as const;

function samplePlan(overrides: Partial<ActorTurnPlan> = {}): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: "run_peds",
    actorId: ACTOR_ID,
    respondingActorId: ACTOR_ID,
    turnIndex: 0,
    spokenText: SPOKEN,
    spokenTextForTts: `<soft>${SPOKEN} [breath]</soft>`,
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "anxious",
    somaticEmotion: null,
    eventKind: "learner_dismissive",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "child",
    performancePlanId: "perf_anxious_child_mid",
    facePresetId: "face.anxious",
    posePresetId: "pose_upright_child",
    gestureClipIds: [],
    prosody: {
      wrapTags: ["<soft>"],
      inlineTags: ["[breath]"],
      speed: 0.95,
      droppedTags: ["[cry]"],
    },
    voiceId: "mock-maya-johnson",
    languageProvenance: { fallbackUsed: false, providerId: "mock-model" },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
    ...overrides,
  };
}

function sampleExecution(overrides: Partial<ActorTurnExecution> = {}): ActorTurnExecution {
  return {
    planId: PLAN_ID,
    turnId: TURN_ID,
    interruption: { kind: "none" },
    renderedProsodyTags: ["<soft>"],
    droppedProsodyTags: ["[breath]"],
    fallback: { language: false, tts: false },
    ...overrides,
  };
}

function identityFor(plan: ActorTurnPlan): IdentityBoundRef {
  return {
    actorId: plan.actorId,
    turnId: plan.turnId,
    planDigest: digestActorTurnPlan(plan),
  };
}

function matchingArtifacts(
  plan: ActorTurnPlan,
  overrides: Partial<ActorTurnExecutionArtifacts> = {},
): ActorTurnExecutionArtifacts {
  const id = identityFor(plan);
  return {
    audio: { ...id, audioUri: AUDIO_URI, durationMs: AUDIO_DURATION_MS },
    visemeCues: { ...id, baker: "rhubarb", mouthCues: [...RHUBARB_CUES] },
    gaze: { ...id, gazeTargetKind: "learner_camera", gazeTargetActorId: null },
    emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
    ...overrides,
  };
}

function liveSlot(): ActorTurnLiveSlot {
  return {
    activeSpeech: { actorId: ACTOR_ID, text: SPOKEN, visemeSequence: ["AA"] },
    emotionExpression: { targetEmotion: "anxious" },
    root: { userData: {} },
  };
}

describe("actor turn playback coordinator", () => {
  beforeEach(() => {
    resetActorTurnPlaybackStarts();
    resetActorTurnPlaybackCoordinator();
  });

  it("(0) COUNTERWEIGHT: player still blocks missing audio; anxious brow stays 0.62", () => {
    const plan = samplePlan();
    const blocked = playIdentityBoundActorTurn(plan, matchingArtifacts(plan, { audio: null }));
    expect(blocked).toMatchObject({ status: "blocked", reason: "missing_audio", fallbackToPerLetterVisemes: false });
    expect(expressionWeightsForEmotion("anxious").browConcern).toBe(0.62);
    expect(SYNTHETIC_AUDIO_CLOCK_DRIFT_TOLERANCE_MS).toBe(ACTOR_TURN_PLAYBACK_DRIFT_TOLERANCE_MS);
    expect(COORDINATOR_CLOCK_KIND).toBe(ACTOR_TURN_PLAYBACK_CLOCK_KIND);
  });

  it("(1) viseme cues follow audio time; gaze/posture/emotion share the same schedule", () => {
    const plan = samplePlan();
    const coordinator = coordinateActorTurnPlayback(plan, sampleExecution(), matchingArtifacts(plan), {
      nowMs: 2_400,
    });
    expect(coordinator.seam).toBe(ACTOR_TURN_PLAYBACK_COORDINATOR_SEAM);
    expect(coordinator.status).toBe("playing");
    expect(coordinator.fallbackVisible).toBe(false);
    expect(coordinator.clockKind).toBe("synthetic_audio_time");
    expect(coordinator.headsetAudioLatencyUnmeasured).toBe(true);

    const atOrigin = coordinator.tick(0);
    expect(atOrigin.visemePhoneme).toBe("sil");
    expect(atOrigin.gazeTargetKind).toBe("learner_camera");
    expect(atOrigin.posturePresetId).toBe("pose_upright_child");
    expect(atOrigin.emotion).toBe("neutral");

    const beforeAa = coordinator.tick(119);
    expect(beforeAa.visemePhoneme).toBe("sil");

    const atAa = coordinator.tick(120);
    expect(atAa.visemePhoneme).toBe("AA");
    expect(atAa.gazeTargetKind).toBe("learner_camera");

    const atEnd = coordinator.tick(AUDIO_DURATION_MS);
    expect(atEnd.emotion).toBe("anxious");
    expect(atEnd.visemePhoneme).toBe("E");
    expect(coordinator.status).toBe("completed");

    const modalities = new Set(coordinator.evidence.events.map((event) => event.modality));
    expect(modalities).toEqual(new Set(["viseme", "gaze", "posture", "emotion"]));
  });

  it("(2) a 10 ms late tick stays inside the 60 Hz drift bound and records evidence", () => {
    const coordinator = coordinateActorTurnPlayback(samplePlan(), sampleExecution(), matchingArtifacts(samplePlan()));
    coordinator.tick(0);
    const late = coordinator.tick(130);
    expect(late.visemePhoneme).toBe("AA");
    const aa = coordinator.evidence.events.find((event) => event.identity === "AA");
    expect(aa?.driftMs).toBe(10);
    expect(late.maxDriftMs).toBe(10);
    expect(late.withinDriftTolerance).toBe(true);
    expect(late.maxDriftMs).toBeLessThanOrEqual(SYNTHETIC_AUDIO_CLOCK_DRIFT_TOLERANCE_MS);
    expect(coordinator.evidence.clockKind).toBe("synthetic_audio_time");
    expect(coordinator.evidence.headsetAudioLatencyUnmeasured).toBe(true);
    expect(coordinator.evidence.driftToleranceMs).toBe(1000 / 60);
  });

  it("(3) pause freezes visemes; resume continues; interrupt clears stale face", () => {
    const slot = liveSlot();
    const coordinator = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution(),
      matchingArtifacts(samplePlan()),
      { liveSlot: slot },
    );
    coordinator.tick(120);
    coordinator.pause(125);
    expect(coordinator.status).toBe("paused");
    const paused = coordinator.tick(400);
    expect(paused.visemePhoneme).toBe("AA");
    expect(paused.audioTimeMs).toBe(125);

    coordinator.resume(125);
    const resumed = coordinator.tick(280);
    expect(resumed.visemePhoneme).toBe("E");

    coordinator.interrupt("truncated", 300);
    expect(coordinator.status).toBe("interrupted");
    expect(coordinator.tick(400).visemePhoneme).toBe("sil");
    expect(coordinator.tick(400).emotion).toBe("neutral");
    expect(slot.activeSpeech).toBeUndefined();
    expect(slot.emotionExpression.targetEmotion).toBe("neutral");
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("sil");
    expect(slot.root.userData.openClinXrActorTurnPlaybackCancelled).toBe(true);
    expect(coordinator.evidence.events.some((event) => event.cancelled)).toBe(true);
  });

  it("(4) missing audio or cues fall back visibly through frozen playback", () => {
    const slot = liveSlot();
    const missingAudio = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution(),
      matchingArtifacts(samplePlan(), { audio: null }),
      {
        liveSlot: slot,
        frozenAdapters: {
          startVoice: () => true,
          startViseme: () => true,
          startFacialAffect: () => true,
          startGazePosture: () => true,
        },
      },
    );
    expect(missingAudio.player).toMatchObject({ status: "blocked", reason: "missing_audio" });
    expect(missingAudio.fallbackVisible).toBe(true);
    expect(missingAudio.status).toBe("fallback");
    expect(missingAudio.frozenPlayback?.spokenText).toBe(SPOKEN);
    expect(slot.root.userData.openClinXrActorTurnPlaybackFallback).toBe(true);
    expect(slot.root.userData.openClinXrActorTurnPlaybackFallbackReason).toBe("missing_audio");

    const missingCues = coordinateActorTurnPlayback(
      samplePlan({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" }),
      sampleExecution({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" }),
      matchingArtifacts(samplePlan({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" }), {
        visemeCues: null,
      }),
    );
    expect(missingCues.fallbackVisible).toBe(true);
    expect(missingCues.fallbackReason).toBe("missing_viseme_cues");
  });

  it("(5) a second turn cleans the first; both sessions stay replayable", () => {
    const slot = liveSlot();
    const first = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution(),
      matchingArtifacts(samplePlan()),
      { liveSlot: slot },
    );
    first.tick(120);
    expect(first.tick(120).visemePhoneme).toBe("AA");

    const secondPlan = samplePlan({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" });
    const second = coordinateActorTurnPlayback(
      secondPlan,
      sampleExecution({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" }),
      matchingArtifacts(secondPlan),
      { liveSlot: slot },
    );
    expect(first.tick(280).visemePhoneme).toBe("sil");
    expect(slot.root.userData.openClinXrActorTurnPlaybackCancelled).toBe(true);
    const secondTick = second.tick(120);
    expect(secondTick.visemePhoneme).toBe("AA");
    expect(first.evidence.events.length).toBeGreaterThan(0);
    expect(second.evidence.events.length).toBeGreaterThan(0);
    expect(second.turnId).not.toBe(first.turnId);
  });

  it("(6) COUNTERWEIGHT: coordinator has no parallel timers; cleanupActorTurnLiveSlot is the rest path", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "actor-turn-playback-coordinator.ts"), "utf8");
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(source).toMatch(/playIdentityBoundActorTurn/);
    expect(source).toMatch(/playFrozenActorTurn/);
    const slot = liveSlot();
    cleanupActorTurnLiveSlot(slot, "neutral");
    expect(slot.activeSpeech).toBeUndefined();
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("sil");
  });

  it("(7) truncated execution cancels leftover cues at start", () => {
    const coordinator = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution({ interruption: { kind: "truncated" } }),
      matchingArtifacts(samplePlan()),
    );
    expect(coordinator.status).toBe("interrupted");
    expect(coordinator.tick(120).visemePhoneme).toBe("sil");
    expect(coordinator.evidence.events.every((event) => event.cancelled || event.appliedAtAudioMs !== null)).toBe(
      true,
    );
  });
});
