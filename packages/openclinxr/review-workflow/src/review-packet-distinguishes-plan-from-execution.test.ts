import { describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import { buildReviewPacket } from "./index.js";

/**
 * OBSERVABLE: faculty replay flattened actor turns into one timeline summary.
 * Direction 2026-09-02: replay evaluates ActorTurnPlan + ActorTurnExecution;
 * faculty sees dropped-tag log + tag-free captions from spokenText.
 *
 * known-good: review-packet.test.ts:67 — voice.audio.generated without a plan
 * still summarizes as voice audio generated (durable ref unavailable).
 *
 * Diagnosis header IMMUTABLE. Flip assertions; append ## FIXED below.
 *
 * ## FIXED (DVA-9)
 * buildReviewPacket emits actorTurnReplays with distinct plan vs execution,
 * a dropped-tag log, and captions from tag-free spokenText.
 */

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";

function samplePlan(overrides: Partial<ActorTurnPlan> = {}): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: "run_peds",
    actorId: "patient_maya_johnson_v1",
    respondingActorId: "patient_maya_johnson_v1",
    turnIndex: 0,
    spokenText: "It feels tight when I breathe.",
    spokenTextForTts: "<soft>It feels tight when I breathe. [breath]</soft>",
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "anxious",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "child",
    performancePlanId: "perf_anxious_child_mid",
    facePresetId: "face_anxious_child",
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
    interruption: { kind: "truncated" },
    renderedProsodyTags: ["<soft>"],
    droppedProsodyTags: ["[breath]"],
    fallback: { language: false, tts: false },
    ...overrides,
  };
}

describe("review packet distinguishes plan from execution", () => {
  it("(0) COUNTERWEIGHT: voice.audio.generated without execution keeps the known-good summary", () => {
    const packet = buildReviewPacket({
      scenarioId: "ed_chest_pain_priority_v1",
      requiredTraceTags: [],
      traceEvents: [
        {
          sequence: 6,
          eventType: "voice.audio.generated",
          source: "voice-gateway",
          actorId: "patient_robert_hayes_v1",
          atSecond: 161,
          payload: {
            voiceId: "mock-robert-hayes",
            audioFormat: "audio/mock",
            visemeCue: "neutral-pain",
          },
        },
      ],
      stationRunId: "run_001",
      facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Known-good voice summary." },
    });

    expect(packet.timeline[0]?.summary).toBe(
      "patient_robert_hayes_v1 voice audio generated; durable event reference unavailable",
    );
    expect(packet.actorTurnReplays).toEqual([]);
  });

  it("(1) faculty replay keeps ActorTurnPlan distinct from ActorTurnExecution", () => {
    const plan = samplePlan();
    const execution = sampleExecution();
    const packet = buildReviewPacket({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      requiredTraceTags: ["work_of_breathing_assessment"],
      traceEvents: [
        {
          sequence: 0,
          eventType: "actor.turn.planned",
          source: "conversation-policy",
          actorId: "patient_maya_johnson_v1",
          tag: "work_of_breathing_assessment",
          atSecond: 20,
          payload: { actorTurnPlan: plan },
        },
        {
          sequence: 1,
          eventType: "actor.turn.executed",
          source: "voice-gateway",
          actorId: "patient_maya_johnson_v1",
          tag: "work_of_breathing_assessment",
          atSecond: 22,
          payload: { actorTurnExecution: execution },
        },
      ],
      stationRunId: "run_peds",
      facultyScoreDraft: { reviewerId: "faculty_peds", status: "draft", comments: "Replay plan vs execution." },
    });

    expect(packet.actorTurnReplays).toHaveLength(1);
    const replay = packet.actorTurnReplays[0];
    expect(replay?.plan).toBeDefined();
    expect(replay?.execution).toBeDefined();
    expect(replay?.plan).not.toBe(replay?.execution);
    expect(replay?.plan.spokenText).toBe("It feels tight when I breathe.");
    expect(replay?.execution?.interruption.kind).toBe("truncated");
    expect(replay?.plan.spokenText).not.toContain("truncated");
  });

  it("(2) captions come from tag-free spokenText, never spokenTextForTts", () => {
    const plan = samplePlan();
    const packet = buildReviewPacket({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      requiredTraceTags: [],
      traceEvents: [
        {
          sequence: 0,
          eventType: "actor.response.generated",
          source: "model-gateway",
          actorId: "patient_maya_johnson_v1",
          atSecond: 20,
          payload: {
            responseKind: "actor_reply",
            provenance: { providerId: "mock-model", guardrail: { status: "pass" } },
            actorTurnPlan: plan,
          },
        },
      ],
      stationRunId: "run_peds",
      facultyScoreDraft: { reviewerId: "faculty_peds", status: "draft", comments: "Tag-free captions." },
    });

    const replay = packet.actorTurnReplays[0];
    expect(replay?.caption).toBe("It feels tight when I breathe.");
    expect(replay?.caption).not.toContain("<soft>");
    expect(replay?.caption).not.toContain("[breath]");
    expect(replay?.caption).not.toBe(plan.spokenTextForTts);
    expect(packet.timeline[0]?.summary).toContain("caption It feels tight when I breathe.");
    expect(packet.timeline[0]?.summary).not.toContain("<soft>");
    expect(packet.timeline[0]?.summary).not.toContain("[breath]");
    expect(packet.timeline[0]?.summary).not.toContain(plan.spokenTextForTts);
  });

  it("(3) dropped-tag log unions plan and execution drops and stays off the caption", () => {
    const plan = samplePlan();
    const execution = sampleExecution();
    const packet = buildReviewPacket({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      requiredTraceTags: [],
      traceEvents: [
        {
          sequence: 0,
          eventType: "actor.turn.planned",
          source: "conversation-policy",
          actorId: "patient_maya_johnson_v1",
          atSecond: 20,
          payload: { actorTurnPlan: plan },
        },
        {
          sequence: 1,
          eventType: "voice.audio.generated",
          source: "voice-gateway",
          actorId: "patient_maya_johnson_v1",
          atSecond: 22,
          payload: { actorTurnExecution: execution },
        },
      ],
      stationRunId: "run_peds",
      facultyScoreDraft: { reviewerId: "faculty_peds", status: "draft", comments: "Dropped-tag log." },
    });

    const replay = packet.actorTurnReplays[0];
    expect(replay?.droppedTagLog).toEqual(["[cry]", "[breath]"]);
    expect(replay?.caption).not.toContain("[cry]");
    expect(replay?.caption).not.toContain("[breath]");
    expect(packet.timeline[0]?.summary).toContain("dropped-tag log [cry]");
    expect(packet.timeline[1]?.summary).toContain("ActorTurnExecution");
    expect(packet.timeline[1]?.summary).toContain("dropped-tag log [breath]");
    expect(packet.timeline[1]?.summary).toContain("interruption truncated");
  });

  it("(4) missing signed prosody artifact flags prosody neutralized without mutating the plan", () => {
    const plan = samplePlan();
    const execution = sampleExecution({ interruption: { kind: "none" }, droppedProsodyTags: [] });
    const packet = buildReviewPacket({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      requiredTraceTags: [],
      traceEvents: [
        {
          sequence: 0,
          eventType: "actor.turn.planned",
          source: "conversation-policy",
          actorId: "patient_maya_johnson_v1",
          atSecond: 20,
          payload: { actorTurnPlan: plan },
        },
        {
          sequence: 1,
          eventType: "actor.turn.executed",
          source: "voice-gateway",
          actorId: "patient_maya_johnson_v1",
          atSecond: 22,
          payload: {
            actorTurnExecution: execution,
            prosodyReviewArtifact: { status: "missing" },
          },
        },
      ],
      stationRunId: "run_peds",
      facultyScoreDraft: { reviewerId: "faculty_peds", status: "draft", comments: "Prosody neutralized." },
    });

    const replay = packet.actorTurnReplays[0];
    expect(replay?.prosodyNeutralized).toBe(true);
    expect(replay?.plan.prosody.wrapTags).toEqual(["<soft>"]);
    expect(packet.timeline[1]?.summary).toContain("prosody neutralized");
  });

  it("(5) a plan whose dialogueEmotionTo is pain is unrepresentable on faculty replay", () => {
    const packet = buildReviewPacket({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      requiredTraceTags: [],
      traceEvents: [
        {
          sequence: 0,
          eventType: "actor.turn.planned",
          source: "conversation-policy",
          actorId: "patient_maya_johnson_v1",
          atSecond: 20,
          payload: {
            actorTurnPlan: {
              ...samplePlan(),
              dialogueEmotionTo: "pain" as ActorTurnPlan["dialogueEmotionTo"],
            },
          },
        },
      ],
      stationRunId: "run_peds",
      facultyScoreDraft: { reviewerId: "faculty_peds", status: "draft", comments: "Reject dialogue pain." },
    });

    expect(packet.actorTurnReplays).toEqual([]);
    expect(packet.timeline[0]?.summary).not.toContain("ActorTurnPlan");
  });
});
