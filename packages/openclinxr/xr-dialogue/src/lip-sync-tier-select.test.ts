import { describe, expect, it } from "vitest";
import type { ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  digestActorTurnPlan,
  playIdentityBoundActorTurn,
  type ActorTurnExecutionArtifacts,
} from "./index.js";

/**
 * Two-tier lip sync seam (MADR 0062, card tsk_edba82577ad9cc4a).
 * A turn carrying a baked track must play that track's cue times verbatim.
 * RED: the player only accepts baker "rhubarb" (actor-turn-player.ts), so a
 * baked MFA track is blocked with missing_viseme_cues. The follow-up card
 * builds baked-track playback; the ceiling stays as-is, so this test uses
 * the published entrypoint only (no coordinator, clock, or slot internals).
 */

const PLAN_ID = "plan_two_tier_baked_001";
const TURN_ID = "turn_two_tier_baked_001";
const ACTOR_ID = "patient_maya_johnson_v1";
const SPOKEN = "The inhaler is in my backpack.";
const AUDIO_URI = "bundle://encounter/turn_two_tier_baked_001.wav";
const AUDIO_DURATION_MS = 1_200;

/** Baked MFA-aligned cue times the exam must reproduce verbatim. */
const BAKED_AT_SECONDS = [0.12, 0.28, 0.45] as const;
const BAKED_PHONEMES = ["PP", "aa", "SS"] as const;

const ADAPTERS = {
  startAudio: () => true,
  startViseme: () => true,
  startGaze: () => true,
  startEmotion: () => true,
};

function samplePlan(): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: "run_peds",
    actorId: ACTOR_ID,
    respondingActorId: ACTOR_ID,
    turnIndex: 0,
    spokenText: SPOKEN,
    spokenTextForTts: SPOKEN,
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "neutral",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "child",
    performancePlanId: "perf_neutral_child_mid",
    facePresetId: "face.neutral",
    posePresetId: "pose_upright_child",
    gestureClipIds: [],
    prosody: { wrapTags: [], inlineTags: [], speed: 1, droppedTags: [] },
    voiceId: "mock-maya-johnson",
    languageProvenance: { fallbackUsed: false, providerId: "mock-model" },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
  };
}

describe("two-tier lip sync baked seam", () => {
  it.fails("a turn carrying a baked track plays that track's cue times verbatim", () => {
    const plan = samplePlan();
    const id = { actorId: plan.actorId, turnId: plan.turnId, planDigest: digestActorTurnPlan(plan) };
    const artifacts = {
      audio: { ...id, audioUri: AUDIO_URI, durationMs: AUDIO_DURATION_MS },
      visemeCues: {
        ...id,
        baker: "mfa-baked",
        contentHash: "sha256:two-tier-baked-fixture",
        mouthCues: [
          { start: 0.12, end: 0.28, value: "P" },
          { start: 0.28, end: 0.45, value: "AA" },
          { start: 0.45, end: 0.6, value: "S" },
        ],
      },
      gaze: { ...id, gazeTargetKind: "learner_camera", gazeTargetActorId: null },
      emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
    } as unknown as ActorTurnExecutionArtifacts;
    const result = playIdentityBoundActorTurn(plan, artifacts, { adapters: ADAPTERS });
    expect(result.status).toBe("playing");
    if (result.status === "playing") {
      expect(result.viseme.cues.map((cue) => cue.atSecond)).toEqual([...BAKED_AT_SECONDS]);
      expect(result.viseme.cues.map((cue) => cue.phoneme)).toEqual([...BAKED_PHONEMES]);
    }
  });
});
