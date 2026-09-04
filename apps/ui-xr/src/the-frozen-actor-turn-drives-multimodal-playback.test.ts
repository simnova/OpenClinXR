import { describe, expect, it, vi } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  ACTOR_TURN_PLAYBACK_SEAM,
  playFrozenActorTurn,
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
});
