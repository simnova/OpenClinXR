import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  ACTOR_TURN_PLAYBACK_SEAM,
  playFrozenActorTurn,
  playFrozenActorTurnOnSlot,
  resetActorTurnPlaybackStarts,
  type ActorTurnLiveSlot,
  type ActorTurnPlaybackAdapters,
  type ActorTurnPlaybackStartContext,
} from "./actor-turn-playback.js";
import { expressionWeightsForEmotion } from "./actor-turn-plan-consumption.js";

/**
 * Frozen ActorTurnPlan must start voice/viseme/affect/gaze/motion through
 * runtime adapters on one timeline. Mixer advances only the plan's named clip.
 *
 * known-good: consumeLiveActorTurn caption = plan.spokenText; anxious brow 0.62.
 */

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";
const ACTOR_ID = "patient_maya_johnson_v1";
const SPOKEN = "The inhaler is in my backpack.";
const PLAN_CLIP = "gesture_clasp_v1";
const OTHER_CLIP = "idle_loop";

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
    gestureClipIds: [PLAN_CLIP],
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

function spyAdapters(overrides: Partial<ActorTurnPlaybackAdapters> = {}): ActorTurnPlaybackAdapters & {
  calls: ActorTurnPlaybackStartContext[];
} {
  const calls: ActorTurnPlaybackStartContext[] = [];
  const record = (ctx: ActorTurnPlaybackStartContext): boolean => {
    calls.push(ctx);
    return true;
  };
  return {
    startVoice: vi.fn(record),
    startViseme: vi.fn(record),
    startFacialAffect: vi.fn(record),
    startGazePosture: vi.fn(record),
    startMotion: vi.fn((ctx) => {
      calls.push(ctx);
      return true;
    }),
    calls,
    ...overrides,
  };
}

describe("the frozen actor turn drives multimodal playback", () => {
  beforeEach(() => {
    resetActorTurnPlaybackStarts();
  });

  it("(0) COUNTERWEIGHT: known-good anxious brow weight stays 0.62", () => {
    expect(expressionWeightsForEmotion("anxious").browConcern).toBe(0.62);
  });

  it("(1) spies prove every adapter starts the same plan identity on one timeline", () => {
    const adapters = spyAdapters();
    const playback = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      nowMs: 1_000,
      adapters,
      approvedMotionClipIds: [PLAN_CLIP, OTHER_CLIP],
    });

    expect(playback.seam).toBe(ACTOR_TURN_PLAYBACK_SEAM);
    expect(adapters.startVoice).toHaveBeenCalledTimes(1);
    expect(adapters.startViseme).toHaveBeenCalledTimes(1);
    expect(adapters.startFacialAffect).toHaveBeenCalledTimes(1);
    expect(adapters.startGazePosture).toHaveBeenCalledTimes(1);
    expect(adapters.startMotion).toHaveBeenCalledTimes(1);
    for (const ctx of adapters.calls) {
      expect(ctx.planId).toBe(PLAN_ID);
      expect(ctx.turnId).toBe(TURN_ID);
      expect(ctx.actorId).toBe(ACTOR_ID);
      expect(ctx.spokenText).toBe(SPOKEN);
      expect(ctx.timelineOriginMs).toBe(1_000);
    }
    expect(playback.lanes.map((lane) => lane.modality)).toEqual([
      "voice",
      "viseme",
      "facial_affect",
      "gaze_posture",
      "motion",
    ]);
    for (const lane of playback.lanes) {
      expect(lane.startedAtMs).toBe(1_000);
    }
  });

  it("(2) mixer counterweight: plan clip advances, a different available clip does not", () => {
    const mixer = {
      available: [PLAN_CLIP, OTHER_CLIP],
      played: [] as string[],
      play(clipId: string): boolean {
        if (!this.available.includes(clipId)) return false;
        this.played.push(clipId);
        return true;
      },
    };
    const adapters = spyAdapters({
      startMotion: vi.fn((ctx) => mixer.play(ctx.clipId)),
    });
    const playback = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      nowMs: 0,
      adapters,
      approvedMotionClipIds: mixer.available,
    });

    expect(playback.motionClipId).toBe(PLAN_CLIP);
    expect(mixer.played).toEqual([PLAN_CLIP]);
    expect(mixer.played).not.toContain(OTHER_CLIP);
    expect(playback.spokenText).toBe(SPOKEN);
    expect(playback.spokenText).not.toContain("<soft>");
  });

  it("(3) missing adapters and unavailable named clips drop; captions stay usable", () => {
    const startMotion = vi.fn(() => true);
    const playback = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      nowMs: 50,
      approvedMotionClipIds: [OTHER_CLIP],
      adapters: { startMotion },
    });

    expect(playback.spokenText).toBe(SPOKEN);
    expect(playback.actorId).toBe(ACTOR_ID);
    expect(playback.faceEmotion).toBe("anxious");
    expect(startMotion).not.toHaveBeenCalled();
    expect(playback.motionClipId).toBeNull();
    expect(playback.lanes).toEqual([]);
    expect(playback.droppedModalities.map((drop) => drop.reason)).toEqual([
      "adapter_missing",
      "adapter_missing",
      "adapter_missing",
      "adapter_missing",
      "no_approved_gesture_clip",
    ]);
  });

  it("(4) a failed optional adapter does not substitute another clip or spoken text", () => {
    const startMotion = vi.fn((_ctx: { clipId: string }) => false);
    const playback = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      adapters: spyAdapters({
        startVoice: vi.fn(() => false),
        startMotion,
      }),
      approvedMotionClipIds: [PLAN_CLIP, OTHER_CLIP],
    });

    expect(playback.spokenText).toBe(SPOKEN);
    expect(playback.lanes.map((lane) => lane.modality)).not.toContain("voice");
    expect(playback.droppedModalities.some((drop) => drop.modality === "voice" && drop.reason === "adapter_failed")).toBe(true);
    expect(startMotion).toHaveBeenCalledWith(expect.objectContaining({ clipId: PLAN_CLIP, actorId: ACTOR_ID }));
    expect(playback.motionClipId).toBeNull();
    expect(playback.gestureClipIds).not.toContain(OTHER_CLIP);
  });

  it("(5) production on-slot adapter mutates live slot and plays only the plan clip", () => {
    const slot: ActorTurnLiveSlot = {
      emotionExpression: { targetEmotion: "neutral" },
      root: { userData: {} },
    };
    const playClip = vi.fn((actorId: string, clipId: string) => actorId === ACTOR_ID && clipId === PLAN_CLIP);
    const startFaceTransition = vi.fn((_actorId: string, emotion: string) => {
      slot.emotionExpression.targetEmotion = emotion;
    });
    const speak = vi.fn((ctx: ActorTurnPlaybackStartContext) => {
      slot.activeSpeech = {
        actorId: ctx.actorId,
        text: ctx.spokenText,
        visemeSequence: ctx.visemeSequence,
      };
      return true;
    });
    const playback = playFrozenActorTurnOnSlot(samplePlan(), sampleExecution(), {
      nowMs: 10,
      clipNames: [PLAN_CLIP, OTHER_CLIP],
      getSlot: (id) => (id === ACTOR_ID ? slot : undefined),
      speak,
      playClip,
      startFaceTransition,
    });

    expect(speak).toHaveBeenCalledTimes(1);
    expect(slot.activeSpeech?.text).toBe(SPOKEN);
    expect(slot.root.userData.openClinXrActorTurnVoiceId).toBe("mock-maya-johnson");
    expect(slot.root.userData.openClinXrActorTurnPerformancePlanId).toBe("perf_anxious_child_mid");
    expect(slot.root.userData.openClinXrActorTurnPosePresetId).toBe("pose_upright_child");
    expect(slot.emotionExpression.targetEmotion).toBe("anxious");
    expect(playClip).toHaveBeenCalledTimes(1);
    expect(playClip).toHaveBeenCalledWith(ACTOR_ID, PLAN_CLIP);
    expect(playClip).not.toHaveBeenCalledWith(ACTOR_ID, OTHER_CLIP);
    expect(playback.lanes.map((lane) => lane.modality)).toEqual([
      "voice",
      "viseme",
      "facial_affect",
      "gaze_posture",
      "motion",
    ]);
  });

  it("(6) absent slot / failed speech and unavailable plan clip are counterweights", () => {
    const playClip = vi.fn(() => true);
    const absent = playFrozenActorTurnOnSlot(samplePlan(), sampleExecution(), {
      nowMs: 0,
      clipNames: [PLAN_CLIP, OTHER_CLIP],
      getSlot: () => undefined,
      speak: vi.fn(() => false),
      playClip,
      startFaceTransition: vi.fn(),
    });
    expect(absent.spokenText).toBe(SPOKEN);
    expect(absent.lanes.map((lane) => lane.modality)).not.toContain("voice");
    expect(absent.droppedModalities.some((drop) => drop.modality === "voice" && drop.reason === "adapter_failed")).toBe(true);

    resetActorTurnPlaybackStarts();
    playClip.mockClear();
    const live: ActorTurnLiveSlot = {
      activeSpeech: { actorId: ACTOR_ID, text: SPOKEN, visemeSequence: ["AA"] },
      emotionExpression: { targetEmotion: "anxious" },
      root: { userData: {} },
    };
    const unavailable = playFrozenActorTurnOnSlot(samplePlan(), sampleExecution(), {
      nowMs: 0,
      clipNames: [OTHER_CLIP],
      getSlot: () => live,
      speak: vi.fn(() => true),
      playClip,
      startFaceTransition: vi.fn(),
    });
    expect(playClip).not.toHaveBeenCalled();
    expect(unavailable.motionClipId).toBeNull();
    expect(unavailable.droppedModalities.some((drop) => drop.modality === "motion" && drop.reason === "no_approved_gesture_clip")).toBe(true);
  });

  it("(7) one plan/turn starts each modality once across duplicate playback calls", () => {
    const adapters = spyAdapters();
    const first = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      adapters,
      approvedMotionClipIds: [PLAN_CLIP],
    });
    const second = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      adapters,
      approvedMotionClipIds: [PLAN_CLIP],
    });
    expect(second).toBe(first);
    expect(adapters.startVoice).toHaveBeenCalledTimes(1);
    expect(adapters.startMotion).toHaveBeenCalledTimes(1);
  });

  it("(8) COUNTERWEIGHT: same planId/turnId in two station runs both start; duplicate in one run does not", () => {
    const firstAdapters = spyAdapters();
    const first = playFrozenActorTurn(samplePlan({ stationRunId: "run_peds_a" }), sampleExecution(), {
      adapters: firstAdapters,
      approvedMotionClipIds: [PLAN_CLIP],
    });
    const firstDuplicate = playFrozenActorTurn(samplePlan({ stationRunId: "run_peds_a" }), sampleExecution(), {
      adapters: firstAdapters,
      approvedMotionClipIds: [PLAN_CLIP],
    });
    expect(firstDuplicate).toBe(first);
    expect(firstAdapters.startVoice).toHaveBeenCalledTimes(1);

    const secondAdapters = spyAdapters();
    const second = playFrozenActorTurn(samplePlan({ stationRunId: "run_peds_b" }), sampleExecution(), {
      adapters: secondAdapters,
      approvedMotionClipIds: [PLAN_CLIP],
    });
    expect(second).not.toBe(first);
    expect(secondAdapters.startVoice).toHaveBeenCalledTimes(1);
    expect(firstAdapters.startVoice).toHaveBeenCalledTimes(1);
  });
});
