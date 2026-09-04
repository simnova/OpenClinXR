import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  ACTOR_TURN_PLAYER_SEAM,
  digestActorTurnPlan,
  playIdentityBoundActorTurn,
  type ActorTurnExecutionArtifacts,
  type ActorTurnPlayerAdapter,
  type ActorTurnPlayerAdapterContext,
  type ActorTurnPlayerAdapters,
  type IdentityBoundRef,
} from "./actor-turn-player.js";
import { mouthCuesToPhonemeCues } from "./viseme-baked-cues.js";

/**
 * Frozen ActorTurnPlan + execution artifacts play as one identity-bound
 * timeline. Audio, Rhubarb viseme cues, gaze, and emotion share actorId,
 * turnId, and plan digest. Mismatch or missing artifacts block; never fall
 * back to per-letter visemesForText.
 *
 * known-good: viseme-baked-cues Rhubarb A → AA; captions = plan.spokenText.
 */

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";
const ACTOR_ID = "patient_maya_johnson_v1";
const SPOKEN = "The inhaler is in my backpack.";
const AUDIO_URI = "fixture://actor-turn/plan_maya_wob_001.wav";
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
    audio: {
      ...id,
      audioUri: AUDIO_URI,
      durationMs: 1_200,
    },
    visemeCues: {
      ...id,
      baker: "rhubarb",
      mouthCues: [...RHUBARB_CUES],
    },
    gaze: {
      ...id,
      gazeTargetKind: "learner_camera",
      gazeTargetActorId: null,
    },
    emotion: {
      ...id,
      from: plan.dialogueEmotionFrom,
      to: plan.dialogueEmotionTo,
    },
    ...overrides,
  };
}

function spyAdapters(overrides: Partial<ActorTurnPlayerAdapters> = {}): ActorTurnPlayerAdapters & {
  calls: ActorTurnPlayerAdapterContext[];
} {
  const calls: ActorTurnPlayerAdapterContext[] = [];
  const record: ActorTurnPlayerAdapter = (ctx) => {
    calls.push(ctx);
    return true;
  };
  return {
    startAudio: vi.fn(record),
    startViseme: vi.fn(record),
    startGaze: vi.fn(record),
    startEmotion: vi.fn(record),
    calls,
    ...overrides,
  };
}

describe("the actor turn player binds audio viseme gaze and emotion", () => {
  it("(0) COUNTERWEIGHT: Rhubarb A still maps to AA; digest is stable for a frozen plan", () => {
    const mapped = mouthCuesToPhonemeCues({ mouthCues: [{ start: 0, end: 0.2, value: "A" }] });
    expect(mapped[0]?.phoneme).toBe("AA");
    const plan = samplePlan();
    expect(digestActorTurnPlan(plan)).toBe(digestActorTurnPlan(samplePlan()));
    expect(digestActorTurnPlan(plan)).toHaveLength(16);
  });

  it("(1) matching artifacts start audio, rhubarb visemes, gaze, and emotion on one timeline", () => {
    const plan = samplePlan();
    const adapters = spyAdapters();
    const playback = playIdentityBoundActorTurn(plan, matchingArtifacts(plan), {
      nowMs: 2_400,
      adapters,
    });

    expect(playback.status).toBe("playing");
    if (playback.status !== "playing") {
      return;
    }
    expect(playback.seam).toBe(ACTOR_TURN_PLAYER_SEAM);
    expect(playback.actorId).toBe(ACTOR_ID);
    expect(playback.turnId).toBe(TURN_ID);
    expect(playback.planDigest).toBe(digestActorTurnPlan(plan));
    expect(playback.spokenText).toBe(SPOKEN);
    expect(playback.timelineOriginMs).toBe(2_400);
    expect(playback.audio.startedAtMs).toBe(2_400);
    expect(playback.audio.audioUri).toBe(AUDIO_URI);
    expect(playback.viseme.startedAtMs).toBe(2_400);
    expect(playback.viseme.baker).toBe("rhubarb");
    expect(playback.viseme.cues.map((cue) => cue.phoneme)).toEqual(["sil", "AA", "E"]);
    expect(playback.gaze.startedAtMs).toBe(2_400);
    expect(playback.gaze.gazeTargetKind).toBe("learner_camera");
    expect(playback.emotion.startedAtMs).toBe(2_400);
    expect(playback.emotion.from).toBe("neutral");
    expect(playback.emotion.to).toBe("anxious");
    expect(playback.fallbackToPerLetterVisemes).toBe(false);
    expect(playback.claimScope).toBe("simulated_actor_behavior");
    expect(playback.notEvidenceFor).toEqual(
      expect.arrayContaining(["quest_readiness", "live_speech_provider", "clinical_affect_inference"]),
    );
  });

  it("(2) missing audio blocks and does not invent per-letter visemes", () => {
    const plan = samplePlan();
    const playback = playIdentityBoundActorTurn(plan, matchingArtifacts(plan, { audio: null }));
    expect(playback).toMatchObject({
      status: "blocked",
      reason: "missing_audio",
      fallbackToPerLetterVisemes: false,
    });
    expect(playback).not.toHaveProperty("viseme");
  });

  it("(3) missing rhubarb viseme cues block instead of visemesForText", () => {
    const plan = samplePlan();
    const playback = playIdentityBoundActorTurn(plan, matchingArtifacts(plan, { visemeCues: null }));
    expect(playback).toMatchObject({
      status: "blocked",
      reason: "missing_viseme_cues",
      fallbackToPerLetterVisemes: false,
    });
  });

  it("(4) empty rhubarb mouth cues block", () => {
    const plan = samplePlan();
    const id = identityFor(plan);
    const playback = playIdentityBoundActorTurn(
      plan,
      matchingArtifacts(plan, {
        visemeCues: { ...id, baker: "rhubarb", mouthCues: [] },
      }),
    );
    expect(playback).toMatchObject({
      status: "blocked",
      reason: "empty_viseme_cues",
      fallbackToPerLetterVisemes: false,
    });
  });

  it("(5) mismatched actorId / turnId / planDigest each block", () => {
    const plan = samplePlan();
    const id = identityFor(plan);
    const adapters = spyAdapters();
    const actorMismatch = playIdentityBoundActorTurn(
      plan,
      matchingArtifacts(plan, {
        visemeCues: { ...id, actorId: "parent_jordan_v1", baker: "rhubarb", mouthCues: [...RHUBARB_CUES] },
      }),
      { adapters },
    );
    expect(actorMismatch).toMatchObject({
      status: "blocked",
      reason: "identity_mismatch",
      mismatchedField: "actorId",
      mismatchedArtifact: "visemeCues",
      fallbackToPerLetterVisemes: false,
    });

    const turnMismatch = playIdentityBoundActorTurn(
      plan,
      matchingArtifacts(plan, {
        gaze: { ...id, turnId: "turn_other", gazeTargetKind: "learner_camera", gazeTargetActorId: null },
      }),
    );
    expect(turnMismatch).toMatchObject({
      status: "blocked",
      reason: "identity_mismatch",
      mismatchedField: "turnId",
      mismatchedArtifact: "gaze",
    });

    const digestMismatch = playIdentityBoundActorTurn(
      plan,
      matchingArtifacts(plan, {
        emotion: { ...id, planDigest: "deadbeefdeadbeef", from: "neutral", to: "anxious" },
      }),
    );
    expect(digestMismatch).toMatchObject({
      status: "blocked",
      reason: "identity_mismatch",
      mismatchedField: "planDigest",
      mismatchedArtifact: "emotion",
    });
    expect(adapters.startAudio).not.toHaveBeenCalled();
    expect(adapters.startViseme).not.toHaveBeenCalled();
    expect(adapters.startGaze).not.toHaveBeenCalled();
    expect(adapters.startEmotion).not.toHaveBeenCalled();
  });

  it("(6) COUNTERWEIGHT: player source never imports dialogue-visemes / visemesForText", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "actor-turn-player.ts"), "utf8");
    expect(source).not.toMatch(/from ["'].*dialogue-visemes/);
    expect(source).not.toMatch(/from ["'].*actor-turn-playback/);
    expect(source).toMatch(/baker: "rhubarb"/);
  });

  it("(7) spies: each adapter is called once with the same identity, origin, and Rhubarb cues", () => {
    const plan = samplePlan();
    const adapters = spyAdapters();
    const digest = digestActorTurnPlan(plan);
    const playback = playIdentityBoundActorTurn(plan, matchingArtifacts(plan), {
      nowMs: 2_400,
      adapters,
    });

    expect(playback.status).toBe("playing");
    expect(adapters.startAudio).toHaveBeenCalledTimes(1);
    expect(adapters.startViseme).toHaveBeenCalledTimes(1);
    expect(adapters.startGaze).toHaveBeenCalledTimes(1);
    expect(adapters.startEmotion).toHaveBeenCalledTimes(1);
    expect(adapters.calls).toHaveLength(4);
    for (const ctx of adapters.calls) {
      expect(ctx.actorId).toBe(ACTOR_ID);
      expect(ctx.turnId).toBe(TURN_ID);
      expect(ctx.planDigest).toBe(digest);
      expect(ctx.timelineOriginMs).toBe(2_400);
      expect(ctx.visemeCues.baker).toBe("rhubarb");
      expect(ctx.visemeCues.mouthCues).toEqual([...RHUBARB_CUES]);
      expect(ctx.visemePhonemeCues.map((cue) => cue.phoneme)).toEqual(["sil", "AA", "E"]);
    }
  });

  it("(8) missing adapter blocks with no callbacks and no per-letter fallback", () => {
    const plan = samplePlan();
    const adapters = spyAdapters({ startViseme: undefined });
    const playback = playIdentityBoundActorTurn(plan, matchingArtifacts(plan), { adapters });
    expect(playback).toMatchObject({
      status: "blocked",
      reason: "adapter_missing",
      mismatchedArtifact: "visemeCues",
      fallbackToPerLetterVisemes: false,
    });
    expect(adapters.startAudio).not.toHaveBeenCalled();
    expect(adapters.startGaze).not.toHaveBeenCalled();
    expect(adapters.startEmotion).not.toHaveBeenCalled();
  });

  it("(9) adapter returning false blocks after all four are invoked", () => {
    const plan = samplePlan();
    const adapters = spyAdapters();
    adapters.startGaze = vi.fn((ctx: ActorTurnPlayerAdapterContext) => {
      adapters.calls.push(ctx);
      return false;
    });
    const playback = playIdentityBoundActorTurn(plan, matchingArtifacts(plan), { adapters });
    expect(playback).toMatchObject({
      status: "blocked",
      reason: "adapter_failed",
      mismatchedArtifact: "gaze",
      fallbackToPerLetterVisemes: false,
    });
    expect(adapters.startAudio).toHaveBeenCalledTimes(1);
    expect(adapters.startViseme).toHaveBeenCalledTimes(1);
    expect(adapters.startGaze).toHaveBeenCalledTimes(1);
    expect(adapters.startEmotion).toHaveBeenCalledTimes(1);
  });

  it("(10) adapter throw blocks after all four are invoked", () => {
    const plan = samplePlan();
    const adapters = spyAdapters();
    adapters.startEmotion = vi.fn((ctx: ActorTurnPlayerAdapterContext) => {
      adapters.calls.push(ctx);
      throw new Error("emotion adapter boom");
    });
    const playback = playIdentityBoundActorTurn(plan, matchingArtifacts(plan), { adapters });
    expect(playback).toMatchObject({
      status: "blocked",
      reason: "adapter_threw",
      mismatchedArtifact: "emotion",
      fallbackToPerLetterVisemes: false,
    });
    expect(adapters.startAudio).toHaveBeenCalledTimes(1);
    expect(adapters.startViseme).toHaveBeenCalledTimes(1);
    expect(adapters.startGaze).toHaveBeenCalledTimes(1);
    expect(adapters.startEmotion).toHaveBeenCalledTimes(1);
  });
});
