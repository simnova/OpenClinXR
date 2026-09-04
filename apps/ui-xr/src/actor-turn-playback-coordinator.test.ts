import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan, DialogueEmotion } from "@openclinxr/shared-schemas";
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
  type CoordinatorAudioClockSource,
  type CoordinatorModalityAdapters,
} from "./actor-turn-playback-coordinator.js";
import { expressionWeightsForEmotion } from "./actor-turn-plan-consumption.js";
import {
  digestActorTurnPlan,
  playIdentityBoundActorTurn,
  type ActorTurnExecutionArtifacts,
  type GazeTargetKind,
  type IdentityBoundRef,
} from "./actor-turn-player.js";

/**
 * Audio source currentTime is the one clock for viseme, gaze, posture, and affect.
 * known-good: identity-bound player blocks missing audio; anxious brow 0.62.
 * Headset audio latency is unmeasured; the test clock is synthetic_audio_time.
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

/** Synthetic HTMLMediaElement.currentTime stand-in. Not headset-measured. */
function syntheticAudioClock(initialSeconds = 0): CoordinatorAudioClockSource & {
  setCurrentTimeSeconds: (seconds: number) => void;
  paused: boolean;
} {
  let currentTimeSeconds = initialSeconds;
  let paused = false;
  return {
    clockKind: COORDINATOR_CLOCK_KIND,
    headsetAudioLatencyUnmeasured: true,
    currentTimeSeconds: () => currentTimeSeconds,
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
    },
    setCurrentTimeSeconds(seconds: number): void {
      if (!paused) {
        currentTimeSeconds = seconds;
      }
    },
    get paused(): boolean {
      return paused;
    },
  };
}

function recordingAdapters(): CoordinatorModalityAdapters & {
  visemes: string[];
  gazes: Array<GazeTargetKind | null>;
  postures: string[];
  emotions: DialogueEmotion[];
} {
  const visemes: string[] = [];
  const gazes: Array<GazeTargetKind | null> = [];
  const postures: string[] = [];
  const emotions: DialogueEmotion[] = [];
  return {
    visemes,
    gazes,
    postures,
    emotions,
    applyViseme: (phoneme) => {
      visemes.push(phoneme);
    },
    applyGaze: (gaze) => {
      gazes.push(gaze);
    },
    applyPosture: (pose) => {
      postures.push(pose);
    },
    applyEmotion: (emotion) => {
      emotions.push(emotion);
    },
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

  it("(1) viseme cues follow audio currentTime; gaze/posture/emotion apply to adapters and slot", () => {
    const plan = samplePlan();
    const clock = syntheticAudioClock(0);
    const slot = liveSlot();
    const adapters = recordingAdapters();
    const coordinator = coordinateActorTurnPlayback(plan, sampleExecution(), matchingArtifacts(plan), {
      nowMs: 2_400,
      audioClock: clock,
      liveSlot: slot,
      modalityAdapters: adapters,
    });
    expect(coordinator.seam).toBe(ACTOR_TURN_PLAYBACK_COORDINATOR_SEAM);
    expect(coordinator.status).toBe("playing");
    expect(coordinator.fallbackVisible).toBe(false);
    expect(coordinator.clockKind).toBe("synthetic_audio_time");
    expect(coordinator.headsetAudioLatencyUnmeasured).toBe(true);

    const atOrigin = coordinator.tick();
    expect(atOrigin.visemePhoneme).toBe("sil");
    expect(atOrigin.gazeTargetKind).toBe("learner_camera");
    expect(atOrigin.posturePresetId).toBe("pose_upright_child");
    expect(atOrigin.emotion).toBe("neutral");
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("sil");
    expect(slot.root.userData.openClinXrActorTurnGazeTargetKind).toBe("learner_camera");
    expect(slot.root.userData.openClinXrActorTurnPosePresetId).toBe("pose_upright_child");
    expect(slot.emotionExpression.targetEmotion).toBe("neutral");
    expect(adapters.visemes.at(-1)).toBe("sil");
    expect(adapters.gazes.at(-1)).toBe("learner_camera");
    expect(adapters.postures.at(-1)).toBe("pose_upright_child");
    expect(adapters.emotions.at(-1)).toBe("neutral");

    clock.setCurrentTimeSeconds(0.119);
    expect(coordinator.tick().visemePhoneme).toBe("sil");

    clock.setCurrentTimeSeconds(0.12);
    const atAa = coordinator.tick();
    expect(atAa.visemePhoneme).toBe("AA");
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("AA");
    expect(adapters.visemes.at(-1)).toBe("AA");

    clock.setCurrentTimeSeconds(AUDIO_DURATION_MS / 1000);
    const atEnd = coordinator.tick();
    expect(atEnd.emotion).toBe("anxious");
    expect(atEnd.visemePhoneme).toBe("E");
    expect(slot.emotionExpression.targetEmotion).toBe("anxious");
    expect(adapters.emotions.at(-1)).toBe("anxious");
    expect(coordinator.status).toBe("completed");
  });

  it("(2) a 10 ms late audio currentTime stays inside the 60 Hz drift bound", () => {
    const clock = syntheticAudioClock(0);
    const coordinator = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution(),
      matchingArtifacts(samplePlan()),
      { audioClock: clock, modalityAdapters: recordingAdapters() },
    );
    coordinator.tick();
    clock.setCurrentTimeSeconds(0.13);
    const late = coordinator.tick();
    expect(late.visemePhoneme).toBe("AA");
    const aa = coordinator.evidence.events.find((event) => event.identity === "AA");
    expect(aa?.driftMs).toBe(10);
    expect(late.maxDriftMs).toBe(10);
    expect(late.withinDriftTolerance).toBe(true);
    expect(late.clockKind).toBe("synthetic_audio_time");
    expect(late.headsetAudioLatencyUnmeasured).toBe(true);
    expect(coordinator.evidence.driftToleranceMs).toBe(1000 / 60);
  });

  it("(3) pause/resume/interrupt drive adapters and clear stale face on the live slot", () => {
    const clock = syntheticAudioClock(0);
    const slot = liveSlot();
    const adapters = recordingAdapters();
    const coordinator = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution(),
      matchingArtifacts(samplePlan()),
      { audioClock: clock, liveSlot: slot, modalityAdapters: adapters },
    );
    clock.setCurrentTimeSeconds(0.12);
    coordinator.tick();
    coordinator.pause();
    expect(coordinator.status).toBe("paused");
    expect(clock.paused).toBe(true);
    clock.setCurrentTimeSeconds(0.4);
    const paused = coordinator.tick();
    expect(paused.visemePhoneme).toBe("AA");
    expect(paused.audioTimeMs).toBe(120);
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("AA");

    coordinator.resume();
    expect(clock.paused).toBe(false);
    clock.setCurrentTimeSeconds(0.28);
    const resumed = coordinator.tick();
    expect(resumed.visemePhoneme).toBe("E");
    expect(adapters.visemes.at(-1)).toBe("E");
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("E");

    coordinator.interrupt("truncated");
    expect(coordinator.status).toBe("interrupted");
    expect(adapters.visemes.at(-1)).toBe("sil");
    expect(adapters.emotions.at(-1)).toBe("neutral");
    expect(coordinator.tick().visemePhoneme).toBe("sil");
    expect(coordinator.tick().emotion).toBe("neutral");
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
        audioClock: syntheticAudioClock(0),
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
      { audioClock: syntheticAudioClock(0) },
    );
    expect(missingCues.fallbackVisible).toBe(true);
    expect(missingCues.fallbackReason).toBe("missing_viseme_cues");
  });

  it("(5) a second turn and a same actor/turn restart both clean the previous coordinator", () => {
    const clock = syntheticAudioClock(0);
    const slot = liveSlot();
    const firstAdapters = recordingAdapters();
    const first = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution(),
      matchingArtifacts(samplePlan()),
      { audioClock: clock, liveSlot: slot, modalityAdapters: firstAdapters },
    );
    clock.setCurrentTimeSeconds(0.12);
    expect(first.tick().visemePhoneme).toBe("AA");
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("AA");

    const secondPlan = samplePlan({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" });
    const secondClock = syntheticAudioClock(0);
    const second = coordinateActorTurnPlayback(
      secondPlan,
      sampleExecution({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" }),
      matchingArtifacts(secondPlan),
      { audioClock: secondClock, liveSlot: slot, modalityAdapters: recordingAdapters() },
    );
    expect(first.tick().visemePhoneme).toBe("sil");
    expect(firstAdapters.visemes.at(-1)).toBe("sil");
    expect(slot.root.userData.openClinXrActorTurnPlaybackCancelled).toBe(true);

    secondClock.setCurrentTimeSeconds(0.12);
    expect(second.tick().visemePhoneme).toBe("AA");

    const restartClock = syntheticAudioClock(0);
    const restartAdapters = recordingAdapters();
    const restart = coordinateActorTurnPlayback(
      secondPlan,
      sampleExecution({ turnId: "turn_maya_wob_002", planId: "plan_maya_wob_002" }),
      matchingArtifacts(secondPlan),
      { audioClock: restartClock, liveSlot: slot, modalityAdapters: restartAdapters },
    );
    expect(second.tick().visemePhoneme).toBe("sil");
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("sil");
    restartClock.setCurrentTimeSeconds(0);
    expect(restart.tick().visemePhoneme).toBe("sil");
    expect(restart.turnId).toBe(second.turnId);
  });

  it("(6) COUNTERWEIGHT: tick has no asserted-time argument; no parallel timers", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "actor-turn-playback-coordinator.ts"), "utf8");
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(source).toMatch(/tick\(\): CoordinatorTickSnapshot/);
    expect(source).not.toMatch(/tick\(audioTimeMs/);
    expect(source).toMatch(/currentTimeSeconds\(\)/);
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
      { audioClock: syntheticAudioClock(0), modalityAdapters: recordingAdapters() },
    );
    expect(coordinator.status).toBe("interrupted");
    expect(coordinator.tick().visemePhoneme).toBe("sil");
    expect(coordinator.evidence.events.every((event) => event.cancelled || event.appliedAtAudioMs !== null)).toBe(
      true,
    );
  });

  it("(8) wall-clock / caller time does not drive modalities; audio currentTime does", () => {
    const clock = syntheticAudioClock(0.12);
    const adapters = recordingAdapters();
    const slot = liveSlot();
    const coordinator = coordinateActorTurnPlayback(
      samplePlan(),
      sampleExecution(),
      matchingArtifacts(samplePlan()),
      { audioClock: clock, liveSlot: slot, modalityAdapters: adapters },
    );
    const wallClockMs = 50_000;
    const snap = coordinator.tick();
    expect(snap.audioTimeMs).toBe(120);
    expect(snap.audioTimeMs).not.toBe(wallClockMs);
    expect(snap.visemePhoneme).toBe("AA");
    expect(snap.emotion).toBe("neutral");
    expect(adapters.visemes.at(-1)).toBe("AA");
    expect(adapters.emotions.at(-1)).toBe("neutral");
    expect(slot.root.userData.openClinXrActorTurnVisemePhoneme).toBe("AA");
    expect(slot.emotionExpression.targetEmotion).toBe("neutral");
    expect(snap.clockKind).toBe("synthetic_audio_time");
    expect(snap.headsetAudioLatencyUnmeasured).toBe(true);
  });
});
