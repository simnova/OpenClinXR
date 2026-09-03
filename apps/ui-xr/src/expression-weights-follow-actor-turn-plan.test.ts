import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  LIVE_ACTOR_TURN_CONSUMPTION_SEAM,
  consumeLiveActorTurn,
  emotionForDialogueText,
  expressionWeightsForEmotion,
  liveActorTurnFromPayload,
  liveCaptionFromPlan,
  registerLiveActorTurn,
  resetLiveActorTurnRegistry,
  resolveLiveActorTurnForTrace,
} from "./actor-turn-plan-consumption.js";

/**
 * OBSERVABLE: live UI-XR FACE inferred emotion from actor-line keywords
 * (emotionForDialogueText) and profile text, so dismissive vs empathetic
 * learner events could not change FACE unless the actor line contained
 * matching words.
 *
 * known-good: apps/ui-xr/src/main.ts:8870 expressionWeightsForEmotion anxious
 * browConcern 0.62 / concerned 0.72.
 *
 * Diagnosis header IMMUTABLE. Flip assertions; append ## FIXED below.
 *
 * ## FIXED (DVA-7)
 * consumeLiveActorTurn drives FACE from plan.dialogueEmotionTo. Captions are
 * plan.spokenText. Barge-in is execution.interruption.kind. emotionForDialogueText
 * remains exported for fixtures only; main.ts live path no longer calls it.
 */

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";
const KEYWORD_FREE_LINE = "The inhaler is in my backpack.";
const PAINFUL_LINE = "It feels tight when I breathe.";

function samplePlan(overrides: Partial<ActorTurnPlan> = {}): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: "run_peds",
    actorId: "patient_maya_johnson_v1",
    respondingActorId: "patient_maya_johnson_v1",
    turnIndex: 0,
    spokenText: KEYWORD_FREE_LINE,
    spokenTextForTts: `<soft>${KEYWORD_FREE_LINE} [breath]</soft>`,
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

describe("expression weights follow actor turn plan", () => {
  it("(0) COUNTERWEIGHT: known-good anxious brow weight stays 0.62", () => {
    expect(expressionWeightsForEmotion("anxious").browConcern).toBe(0.62);
    expect(expressionWeightsForEmotion("concerned").browConcern).toBe(0.72);
    expect(expressionWeightsForEmotion("neutral").browConcern).toBe(0.08);
  });

  it("(1) dismissive vs empathetic plans change FACE without keyword matches in the actor line", () => {
    const dismissive = consumeLiveActorTurn(
      samplePlan({ eventKind: "learner_dismissive", dialogueEmotionTo: "anxious" }),
      sampleExecution(),
    );
    const empathetic = consumeLiveActorTurn(
      samplePlan({ eventKind: "learner_empathetic", dialogueEmotionTo: "reassured" }),
      sampleExecution(),
    );

    expect(dismissive.plan.spokenText).toBe(KEYWORD_FREE_LINE);
    expect(empathetic.plan.spokenText).toBe(KEYWORD_FREE_LINE);
    expect(emotionForDialogueText(KEYWORD_FREE_LINE)).toBe("neutral");
    expect(dismissive.faceEmotion).toBe("anxious");
    expect(empathetic.faceEmotion).toBe("reassured");
    expect(dismissive.faceWeights.browConcern).toBeGreaterThan(empathetic.faceWeights.browConcern);
    expect(dismissive.faceSource).toBe("plan.dialogueEmotionTo");
    expect(dismissive.seam).toBe(LIVE_ACTOR_TURN_CONSUMPTION_SEAM);
  });

  it("(2) spokenText keywords cannot override plan.dialogueEmotionTo", () => {
    const live = consumeLiveActorTurn(
      samplePlan({
        spokenText: PAINFUL_LINE,
        spokenTextForTts: `<soft>${PAINFUL_LINE} [breath]</soft>`,
        dialogueEmotionTo: "reassured",
      }),
      sampleExecution(),
    );

    expect(emotionForDialogueText(PAINFUL_LINE)).toBe("pain");
    expect(live.faceEmotion).toBe("reassured");
    expect(live.faceWeights).toEqual(expressionWeightsForEmotion("reassured"));
    expect(live.faceWeights.browConcern).not.toBe(expressionWeightsForEmotion("pain").browConcern);
  });

  it("(3) captions come from plan.spokenText, never spokenTextForTts", () => {
    const plan = samplePlan({ spokenText: PAINFUL_LINE });
    const live = consumeLiveActorTurn(plan, sampleExecution());

    expect(live.caption).toBe(PAINFUL_LINE);
    expect(live.caption).toBe(liveCaptionFromPlan(plan));
    expect(live.captionSource).toBe("plan.spokenText");
    expect(live.caption).not.toBe(plan.spokenTextForTts);
    expect(live.caption).not.toContain("<soft>");
    expect(live.caption).not.toContain("[breath]");
  });

  it("(4) barge-in is execution.interruption.kind and does not mutate the plan", () => {
    const plan = samplePlan();
    const spokenBefore = plan.spokenText;
    const live = consumeLiveActorTurn(plan, sampleExecution({ interruption: { kind: "truncated" } }));

    expect(live.bargeInKind).toBe("truncated");
    expect(live.bargeInSource).toBe("execution.interruption.kind");
    expect(live.plan.spokenText).toBe(spokenBefore);
    expect(live.plan.spokenText).not.toContain("truncated");
    expect(plan.spokenText).toBe(spokenBefore);
    expect(live.plan).not.toBe(live.execution);
  });

  it("(5) dropped-tag log unions plan and execution drops and stays off the caption", () => {
    const live = consumeLiveActorTurn(samplePlan(), sampleExecution());

    expect(live.droppedTagLog).toEqual(["[cry]", "[breath]"]);
    expect(live.caption).not.toContain("[cry]");
    expect(live.caption).not.toContain("[breath]");
  });

  it("(6) mismatched execution join is not applied", () => {
    const live = consumeLiveActorTurn(
      samplePlan(),
      sampleExecution({ planId: "plan_other", turnId: "turn_other", interruption: { kind: "replaced" } }),
    );

    expect(live.executionApplied).toBe(false);
    expect(live.bargeInKind).toBe("none");
    expect(live.schemaGaps.some((gap) => gap.reason === "execution_join_mismatch")).toBe(true);
  });

  it("(7) DVA-6 execution schema gaps are reported instead of invented viseme/audio heuristics", () => {
    const live = consumeLiveActorTurn(samplePlan(), sampleExecution());
    const fields = live.schemaGaps.map((gap) => gap.field);

    expect(fields).toEqual(expect.arrayContaining([
      "audioStartedAtMs",
      "ttsProviderId",
      "audioUri",
      "visemeTimeline",
    ]));
    expect(live.visualGaps.map((gap) => gap.surface)).toEqual([
      "lip_sync",
      "audible_tts",
      "face_preset_mesh",
    ]);
    expect(live.execution && "visemeTimeline" in live.execution).toBe(false);
    expect(live.execution && "audioUri" in live.execution).toBe(false);
  });

  it("(8) payload keeps actorTurnPlan and actorTurnExecution as distinct records", () => {
    const plan = samplePlan();
    const execution = sampleExecution({ interruption: { kind: "replaced" } });
    const parsed = liveActorTurnFromPayload({
      actorTurnPlan: plan,
      actorTurnExecution: execution,
    });

    expect(parsed?.plan).toBe(plan);
    expect(parsed?.execution).toBe(execution);
    expect(parsed?.plan).not.toBe(parsed?.execution);
  });

  it("(9) registry join is planId+turnId and can be resolved by trace tag", () => {
    resetLiveActorTurnRegistry();
    const consumed = registerLiveActorTurn(samplePlan(), sampleExecution(), "work_of_breathing_assessment");
    const resolved = resolveLiveActorTurnForTrace("work_of_breathing_assessment");

    expect(consumed.joinKey).toBe(`${PLAN_ID}::${TURN_ID}`);
    expect(resolved?.faceEmotion).toBe("anxious");
    expect(resolveLiveActorTurnForTrace("unknown_tag")).toBeUndefined();
    resetLiveActorTurnRegistry();
  });

  it("(10) live main.ts path no longer calls emotionForDialogueText", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(mainSource).toContain("consumeLiveActorTurn");
    expect(mainSource).toContain("plan.dialogueEmotionTo");
    expect(mainSource).not.toMatch(/emotionForDialogueText\s*\(/u);
    expect(mainSource).not.toContain("dialogue_text_heuristic");
  });
});
