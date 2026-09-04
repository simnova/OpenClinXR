import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import { ACTOR_TURN_PLAYBACK_SEAM, playFrozenActorTurn } from "./actor-turn-playback.js";
import { expressionWeightsForEmotion } from "./actor-turn-plan-consumption.js";

/**
 * OBSERVABLE: UI-XR consumes a frozen plan for FACE/captions but does not start
 * voice, viseme, gaze/posture, and motion from that same plan identity on one
 * timeline. A mixer clip or spokenTextForTts stand-in would look like progress.
 *
 * known-good: consumeLiveActorTurn caption = plan.spokenText; anxious brow 0.62.
 */

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";
const ACTOR_ID = "patient_maya_johnson_v1";
const SPOKEN = "The inhaler is in my backpack.";

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
    gestureClipIds: ["gesture_clasp_v1"],
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

describe("the frozen actor turn drives multimodal playback", () => {
  it("(0) COUNTERWEIGHT: known-good anxious brow weight stays 0.62", () => {
    expect(expressionWeightsForEmotion("anxious").browConcern).toBe(0.62);
  });

  it("(1) voice, viseme, affect, gaze, and motion start on one timeline from the plan", () => {
    const playback = playFrozenActorTurn(samplePlan(), sampleExecution(), { nowMs: 1_000 });

    expect(playback.seam).toBe(ACTOR_TURN_PLAYBACK_SEAM);
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
    expect(playback.timelineOriginMs).toBe(1_000);
    expect(playback.faceEmotion).toBe("anxious");
    expect(playback.visemeSequence.length).toBeGreaterThan(0);
    expect(playback.phonemeSequence.length).toBeGreaterThan(0);
    expect(playback.motionClipId).toBe("gesture_clasp_v1");
    expect(playback.voiceId).toBe("mock-maya-johnson");
    expect(playback.posePresetId).toBe("pose_upright_child");
  });

  it("(2) never substitutes a different actor, plan, clip, or spoken text", () => {
    const playback = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      nowMs: 0,
      approvedMotionClipIds: ["idle_loop", "openclinxr_role_patient_asthma_breathing_effort"],
    });

    expect(playback.actorId).toBe(ACTOR_ID);
    expect(playback.planId).toBe(PLAN_ID);
    expect(playback.turnId).toBe(TURN_ID);
    expect(playback.spokenText).toBe(SPOKEN);
    expect(playback.spokenText).not.toContain("<soft>");
    expect(playback.spokenText).not.toBe(samplePlan().spokenTextForTts);
    expect(playback.motionClipId).toBeNull();
    expect(playback.droppedModalities.some((drop) => drop.modality === "motion")).toBe(true);
    expect(playback.gestureClipIds).not.toContain("idle_loop");
  });

  it("(3) dropped optional modalities keep captions and plan identity", () => {
    const playback = playFrozenActorTurn(samplePlan(), sampleExecution(), {
      nowMs: 50,
      voiceAvailable: false,
      visemeAvailable: false,
      motionAvailable: false,
    });

    expect(playback.spokenText).toBe(SPOKEN);
    expect(playback.actorId).toBe(ACTOR_ID);
    expect(playback.faceEmotion).toBe("anxious");
    expect(playback.visemeSequence).toEqual([]);
    expect(playback.motionClipId).toBeNull();
    expect(playback.droppedModalities.map((drop) => drop.modality).sort()).toEqual(
      ["motion", "viseme", "voice"].sort(),
    );
    expect(playback.lanes.map((lane) => lane.modality)).toEqual(["facial_affect", "gaze_posture"]);
  });

  it("(4) live main.ts path starts playFrozenActorTurn from the frozen plan", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(mainSource).toContain("playFrozenActorTurn");
    expect(mainSource).toContain("__openClinXrActorTurnPlayback");
    expect(mainSource).toContain("consumeLiveActorTurn");
  });
});
