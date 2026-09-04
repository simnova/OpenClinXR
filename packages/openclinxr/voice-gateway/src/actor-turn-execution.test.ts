import { describe, expect, it, vi } from "vitest";
import {
  ACTOR_TURN_EXECUTION_SEAM,
  ACTOR_TURN_TIMELINE_ORIGIN_MS,
  FROZEN_PLAN_RENDER_GATE_MESSAGE,
  executeFrozenActorTurn,
  type ActorTurnExecutionAdapters,
  type FrozenActorTurnPlanForExecution,
} from "./actor-turn-execution.js";

/**
 * Frozen ActorTurnPlan drives voice/prosody/viseme/affect/gaze/motion on one
 * timeline. Optional modalities drop with reasons; spokenText stays usable.
 * Bounded execution stays DVA-6 (no visemeTimeline/audioUri on the record).
 *
 * known-good: adapters.ts synthesizeActorSpeechFromFrozenPlan freeze gate +
 * scenario-runtime executionFromFrozenPlan planId/turnId join.
 */

const SPOKEN = "The inhaler is in my backpack.";

function planFixture(overrides: Partial<FrozenActorTurnPlanForExecution> = {}): FrozenActorTurnPlanForExecution {
  return {
    planId: "plan_maya_wob_001",
    turnId: "turn_maya_wob_001",
    actorId: "patient_maya_johnson_v1",
    spokenText: SPOKEN,
    spokenTextForTts: `<soft>${SPOKEN} [breath]</soft>`,
    voiceId: "mock-maya-johnson",
    dialogueEmotionTo: "anxious",
    facePresetId: "face.anxious",
    posePresetId: "pose_upright_child",
    performancePlanId: "perf_anxious_child_mid",
    gestureClipIds: ["gesture_clasp_v1"],
    prosody: {
      wrapTags: ["<soft>"],
      inlineTags: ["[breath]"],
      speed: 0.95,
      droppedTags: ["[cry]"],
    },
    languageProvenance: { fallbackUsed: false, providerId: "mock-model" },
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
    ...overrides,
  };
}

function runtimeAdapters(overrides: Partial<ActorTurnExecutionAdapters> = {}): ActorTurnExecutionAdapters {
  return {
    startProsody: vi.fn(() => true),
    startViseme: vi.fn(() => true),
    startFacialAffect: vi.fn(() => true),
    startGazePosture: vi.fn(() => true),
    startMotion: vi.fn(() => true),
    ...overrides,
  };
}

function deepFreezePlan(plan: FrozenActorTurnPlanForExecution): FrozenActorTurnPlanForExecution {
  Object.freeze(plan.gestureClipIds);
  Object.freeze(plan.prosody.wrapTags);
  Object.freeze(plan.prosody.inlineTags);
  Object.freeze(plan.prosody.droppedTags);
  Object.freeze(plan.prosody);
  Object.freeze(plan.languageProvenance);
  Object.freeze(plan.notEvidenceFor);
  return Object.freeze(plan);
}

describe("executeFrozenActorTurn", () => {
  it("(0) COUNTERWEIGHT: known-good freeze gate wording stays exact", async () => {
    const unfrozen = planFixture();
    await expect(executeFrozenActorTurn(unfrozen)).rejects.toThrow(FROZEN_PLAN_RENDER_GATE_MESSAGE);
    expect(unfrozen.spokenText).toBe(SPOKEN);
  });

  it("(1) all started lanes share plan identity and timeline origin 0", async () => {
    const plan = deepFreezePlan(planFixture());
    const adapters = runtimeAdapters();
    const envelope = await executeFrozenActorTurn(plan, { adapters });

    expect(envelope.seam).toBe(ACTOR_TURN_EXECUTION_SEAM);
    expect(adapters.startViseme).toHaveBeenCalledTimes(1);
    expect(adapters.startMotion).toHaveBeenCalledTimes(1);
    expect(adapters.startFacialAffect).toHaveBeenCalledWith(expect.objectContaining({
      planId: plan.planId,
      turnId: plan.turnId,
      actorId: plan.actorId,
      timelineOriginMs: 0,
    }));
    expect(envelope.timelineOriginMs).toBe(ACTOR_TURN_TIMELINE_ORIGIN_MS);
    expect(envelope.identity).toMatchObject({
      planId: plan.planId,
      turnId: plan.turnId,
      actorId: plan.actorId,
      spokenText: plan.spokenText,
      voiceId: plan.voiceId,
    });
    expect(envelope.actorTurnExecution.planId).toBe(plan.planId);
    expect(envelope.actorTurnExecution.turnId).toBe(plan.turnId);
    expect(envelope.lanes.map((lane) => lane.modality)).toEqual([
      "voice",
      "prosody",
      "viseme",
      "facial_affect",
      "gaze_posture",
      "motion",
    ]);
    for (const lane of envelope.lanes) {
      expect(lane.startedAtMs).toBe(0);
    }
    expect(envelope.lanes.find((lane) => lane.modality === "voice")?.identity).toBe(plan.voiceId);
    expect(envelope.lanes.find((lane) => lane.modality === "motion")?.identity).toBe("gesture_clasp_v1");
    expect(envelope.lanes.find((lane) => lane.modality === "facial_affect")?.identity).toBe(plan.facePresetId);
    expect(envelope.lanes.find((lane) => lane.modality === "gaze_posture")?.identity).toBe(plan.posePresetId);
  });

  it("(2) never substitutes a different actor, plan, clip, or spoken text", async () => {
    const plan = deepFreezePlan(planFixture());
    const envelope = await executeFrozenActorTurn(plan);

    expect(envelope.identity.actorId).toBe("patient_maya_johnson_v1");
    expect(envelope.identity.planId).toBe("plan_maya_wob_001");
    expect(envelope.identity.spokenText).toBe(SPOKEN);
    expect(envelope.identity.spokenText).not.toContain("<soft>");
    expect(envelope.identity.gestureClipIds).toEqual(["gesture_clasp_v1"]);
    expect(envelope.identity.gestureClipIds).not.toContain("idle_loop");
    expect(envelope.identity.voiceId).not.toBe("mock-robert-hayes");
  });

  it("(3) dropped optional modalities keep spokenText usable", async () => {
    const plan = deepFreezePlan(planFixture({ gestureClipIds: [] }));
    const envelope = await executeFrozenActorTurn(plan, {
      available: { voice: false, motion: false },
    });

    expect(envelope.identity.spokenText).toBe(SPOKEN);
    expect(envelope.actorTurnExecution.fallback.tts).toBe(true);
    expect(envelope.audioEvents).toEqual([]);
    expect(envelope.droppedModalities.find((drop) => drop.modality === "voice")?.reason).toBe(
      "voice_provider_unavailable",
    );
    expect(envelope.droppedModalities.find((drop) => drop.modality === "motion")?.reason).toBe(
      "motion_unavailable",
    );
    expect(envelope.droppedModalities.find((drop) => drop.modality === "viseme")?.reason).toBe(
      "adapter_missing",
    );
    expect(envelope.lanes.map((lane) => lane.modality)).not.toContain("voice");
    expect(envelope.lanes.map((lane) => lane.modality)).not.toContain("motion");
  });

  it("(4) bounded execution does not invent visemeTimeline or audioUri", async () => {
    const plan = deepFreezePlan(planFixture());
    const envelope = await executeFrozenActorTurn(plan, { adapters: runtimeAdapters() });
    const execution = envelope.actorTurnExecution;

    expect(execution).toEqual({
      planId: plan.planId,
      turnId: plan.turnId,
      interruption: { kind: "none" },
      renderedProsodyTags: ["<soft>", "[breath]"],
      droppedProsodyTags: ["[cry]"],
      fallback: { language: false, tts: false },
    });
    expect("visemeTimeline" in execution).toBe(false);
    expect("audioUri" in execution).toBe(false);
    expect("audioStartedAtMs" in execution).toBe(false);
    expect(Object.isFrozen(execution)).toBe(true);
  });

  it("(5) does not mutate the frozen plan", async () => {
    const plan = deepFreezePlan(planFixture());
    const spokenBefore = plan.spokenText;
    const clipsBefore = [...plan.gestureClipIds];
    const envelope = await executeFrozenActorTurn(plan, {
      bargeInAtChunkIndex: 1,
      adapters: runtimeAdapters(),
    });

    expect(plan.spokenText).toBe(spokenBefore);
    expect([...plan.gestureClipIds]).toEqual(clipsBefore);
    expect(envelope.actorTurnExecution.interruption.kind).toBe("truncated");
    expect(envelope.identity.spokenText).toBe(spokenBefore);
    expect(envelope.actorTurnExecution).not.toBe(plan);
  });
});
