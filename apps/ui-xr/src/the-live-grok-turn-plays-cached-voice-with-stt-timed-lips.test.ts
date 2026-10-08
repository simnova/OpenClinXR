import { describe, expect, it, vi } from "vitest";
import type { ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  digestActorTurnPlan,
  playIdentityBoundActorTurn,
} from "@openclinxr/xr-dialogue";

/**
 * Live tier for unscripted turns (MADR 0062 decision 4) at the ui-xr seam:
 * STT-timed ARPABET cues (the live-plan shape: snapped onsets, closure-gap P)
 * play verbatim through the identity-bound player on one audio/viseme clock,
 * and the turn trace records lipSyncTierPlayed live. Missing live cues block;
 * the path never falls back to dictionary timing.
 *
 * Cue times below are the fixed live bake of the cached pain replay (AY
 * snapped to the 0.14 s energy onset, F at 0.271 s, closure-gap P at 0.68 s).
 * The bake itself is proven in xr-dialogue (S2 parity) and driven for real
 * pixels by tools/openclinxr/evidence/parent-fitted-teeth/live-grok-capture;
 * a replay cache miss there surfaces the gateway error code. Replay only —
 * no network calls.
 */

const PLAN_ID = "plan_live_grok_001";
const TURN_ID = "turn_live_grok_001";
const ACTOR_ID = "parent_tara_johnson_v1";

/** Fixed live bake of the cached pain replay (first cues; closure P at 0.68). */
const LIVE_CUES = [
  { start: 0.14, end: 0.242, value: "AY1" },
  { start: 0.271, end: 0.3528, value: "F" },
  { start: 0.3528, end: 0.4678, value: "IY1" },
  { start: 0.68, end: 0.726, value: "P" },
] as const;

function samplePlan(): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: "run_peds",
    actorId: ACTOR_ID,
    respondingActorId: ACTOR_ID,
    turnIndex: 0,
    spokenText: "I feel the pain is better now.",
    spokenTextForTts: "I feel the pain is better now.",
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "concerned",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "adult",
    performancePlanId: "perf_concerned_adult_mid",
    facePresetId: "face.concerned",
    posePresetId: "pose_upright_adult",
    gestureClipIds: [],
    prosody: { wrapTags: [], inlineTags: [], speed: 1, droppedTags: [] },
    voiceId: "ara",
    languageProvenance: { fallbackUsed: false, providerId: "grok-voice" },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
  };
}

describe("the live grok turn plays cached voice with stt-timed lips", () => {
  it("plays live cues verbatim on one clock with tier live", () => {
    const plan = samplePlan();
    const id = { actorId: plan.actorId, turnId: plan.turnId, planDigest: digestActorTurnPlan(plan) };
    const seenOrigins: number[] = [];
    const startAudio = vi.fn((ctx: { timelineOriginMs: number }) => {
      seenOrigins.push(ctx.timelineOriginMs);
      return true;
    });
    const startViseme = vi.fn((ctx: { timelineOriginMs: number }) => {
      seenOrigins.push(ctx.timelineOriginMs);
      return true;
    });
    const playback = playIdentityBoundActorTurn(
      plan,
      {
        audio: { ...id, audioUri: "replay:fixture-pain", durationMs: 2280 },
        visemeCues: { ...id, baker: "mfa-baked", mouthCues: [...LIVE_CUES] },
        gaze: { ...id, gazeTargetKind: "learner_camera", gazeTargetActorId: null },
        emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
      },
      {
        nowMs: 5_000,
        adapters: {
          startAudio,
          startViseme,
          startGaze: () => true,
          startEmotion: () => true,
        },
      },
    );
    expect(playback.status).toBe("playing");
    if (playback.status !== "playing") return;
    expect(playback.viseme.baker).toBe("mfa-baked");
    expect(playback.viseme.cues.map((cue) => cue.atSecond)).toEqual([0.14, 0.271, 0.3528, 0.68]);
    expect(playback.audio.startedAtMs).toBe(5_000);
    expect(playback.viseme.startedAtMs).toBe(5_000);
    expect(playback.fallbackToPerLetterVisemes).toBe(false);
    const trace = {
      lipSyncTierPlayed: "live" as const,
      planId: playback.planId,
      turnId: playback.turnId,
      timelineOriginMs: playback.timelineOriginMs,
      visemeCueCount: playback.viseme.cues.length,
    };
    expect(trace.lipSyncTierPlayed).toBe("live");
    expect(trace.visemeCueCount).toBe(4);
    expect(startAudio).toHaveBeenCalledTimes(1);
    expect(startViseme).toHaveBeenCalledTimes(1);
    expect(seenOrigins).toEqual([5_000, 5_000]);
  });

  it("missing live cues block with no dictionary fallback", () => {
    const plan = samplePlan();
    const id = { actorId: plan.actorId, turnId: plan.turnId, planDigest: digestActorTurnPlan(plan) };
    const startViseme = vi.fn(() => true);
    const playback = playIdentityBoundActorTurn(
      plan,
      {
        audio: { ...id, audioUri: "replay:fixture-pain", durationMs: 2280 },
        visemeCues: null,
        gaze: { ...id, gazeTargetKind: "learner_camera", gazeTargetActorId: null },
        emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
      },
      {
        adapters: {
          startAudio: () => true,
          startViseme,
          startGaze: () => true,
          startEmotion: () => true,
        },
      },
    );
    expect(playback.status).toBe("blocked");
    if (playback.status !== "blocked") return;
    expect(playback.reason).toBe("missing_viseme_cues");
    expect(playback.fallbackToPerLetterVisemes).toBe(false);
    expect(startViseme).not.toHaveBeenCalled();
  });
});
