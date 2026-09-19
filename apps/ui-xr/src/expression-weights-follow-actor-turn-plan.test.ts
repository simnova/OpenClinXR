import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  attachBakedCuesToSpeech,
  LIVE_ACTOR_TURN_CONSUMPTION_SEAM,
  consumeLiveActorTurn,
  emotionForDialogueText,
  expressionWeightsForEmotion,
  liveActorTurnFromPayload,
  liveCaptionFromPlan,
  registerLiveActorTurn,
  resetLiveActorTurnRegistry,
  resolveLiveActorTurnForTrace,
} from "@openclinxr/xr-dialogue";

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

  /**
   * Station actor-response drops actorTurnPlan: main.ts:2388-2406 reads only
   * actorResponseTextFromApiResult (runtime-state.ts:1822-1828) then
   * resolveLiveActorTurnForTrace(tag). requestActorResponse appears once.
   * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
   */
  it("(11) station actor-response body registers the live plan", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const stationStart = mainSource.indexOf("requestActorResponse");
    const stationBlock = mainSource.slice(stationStart, stationStart + 3000);
    expect(stationBlock).toContain("registerLiveActorTurn");
    const recorded = { actorTurnPlan: samplePlan({ dialogueEmotionTo: "anxious" }) };
    const parsed = liveActorTurnFromPayload(recorded as Record<string, unknown>);
    expect(parsed?.plan.dialogueEmotionTo).toBe("anxious");
    expect(consumeLiveActorTurn(parsed!.plan, parsed!.execution).faceEmotion).toBe("anxious");
  });

  it("(12) station block consumes synthesize return into the live registry", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const stationStart = mainSource.indexOf("requestActorResponse");
    const stationBlock = mainSource.slice(stationStart, stationStart + 5000);
    expect(stationBlock).toContain("synthesizeActorSpeech");
    expect(stationBlock).toContain("actorTurnExecution");
    expect(stationBlock).toContain("registerLiveActorTurn");
    const plan = samplePlan({ dialogueEmotionTo: "anxious" });
    const recordedVoice = { actorTurnExecution: sampleExecution({ interruption: { kind: "truncated" } }) };
    const joined = liveActorTurnFromPayload({
      actorTurnPlan: plan,
      actorTurnExecution: (recordedVoice as Record<string, unknown>)["actorTurnExecution"],
    });
    const live = consumeLiveActorTurn(joined!.plan, joined!.execution);
    expect(live.executionApplied).toBe(true);
    expect(live.bargeInKind).toBe("truncated");
    expect(live.droppedTagLog).toEqual(["[cry]", "[breath]"]);
  });

  // ## FIXED (R2 tsk_c948fb0a7b60c922)
  // Station block now registerLiveActorTurn(plan, execution, tag) from
  // liveActorTurnFromPayload(actorResponse). Caption still falls back to
  // actorResponseTextFromApiResult.

  /**
   * Station voice drives mouth from synthesize audioEvents: main.ts block after
   * synthesizeActorSpeech reads voiceRecord audioEvents (same voiceResult that
   * joins actorTurnExecution) into slot.activeSpeech; execution gains no
   * visemeTimeline/audioUri. Mock "neutral-pain" is not a real cue.
   * Diagnosis (7)(11)(12) headers IMMUTABLE. Added as it (green in same change).
   */
  it("(13) station block drives slot.activeSpeech from synthesize audioEvents, ignoring mock cue", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const synthStart = mainSource.indexOf("synthesizeActorSpeech");
    const stationBlock = mainSource.slice(synthStart, synthStart + 1500);
    expect(stationBlock).toContain("audioEvents");
    expect(stationBlock).toContain("activeSpeech");
    expect(stationBlock).not.toContain("visemeTimeline");
    expect(stationBlock).not.toContain("audioUri");
    const slot = { activeSpeech: { text: "line" }, root: { userData: {}, traverse() {} } };
    expect(attachBakedCuesToSpeech(slot, "line", "peds_asthma_parent_anxiety_v1", [{ visemeCue: "AA", durationMs: 200 }])).toBe(true);
    expect((slot.activeSpeech as Record<string, unknown>)["bakedCues"]).toEqual([
      { phoneme: "AA", atSecond: 0, durationSeconds: 0.2 },
    ]);
    const mockSlot = { activeSpeech: { text: "line" }, root: { userData: {}, traverse() {} } };
    expect(attachBakedCuesToSpeech(mockSlot, "line", "peds_asthma_parent_anxiety_v1", [{ visemeCue: "neutral-pain", durationMs: 1100 }])).toBe(true);
    expect((mockSlot.activeSpeech as Record<string, unknown>)["bakedCues"]).toEqual([
      { phoneme: "AA", atSecond: 0, durationSeconds: 1.1 },
    ]);
    for (const cue of (mockSlot.activeSpeech as Record<string, unknown>)["bakedCues"] as Array<Record<string, unknown>>) {
      expect(cue["phoneme"]).not.toBe("neutral-pain");
    }
    const exec = sampleExecution() as Record<string, unknown>;
    expect("visemeTimeline" in exec).toBe(false);
    expect("audioUri" in exec).toBe(false);
  });

  /**
   * S3 offline recache: generated spokenText with no served hash still moves mouth
   * via S1 amplitude (live first packet); the recache artifact attaches only when
   * mediaPositionSeconds is present (replay/Q4). Execution gains no viseme/audio.
   * Diagnosis (7)(11)(12) headers IMMUTABLE. Added as it (green in same change).
   */
  it("(14) generated line moves mouth live via S1 amplitude; recache attaches only for audio-owned replay", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const synthStart = mainSource.indexOf("synthesizeActorSpeech");
    const stationBlock = mainSource.slice(synthStart, synthStart + 1500);
    expect(stationBlock).toContain("recachedMouthCues");
    expect(stationBlock).not.toContain("visemeTimeline");
    expect(stationBlock).not.toContain("audioUri");
    const generated = "A generated reply no bake ever hashed.";
    const liveSlot = { activeSpeech: { text: generated }, root: { userData: {}, traverse() {} } };
    expect(attachBakedCuesToSpeech(liveSlot, generated, "peds_asthma_parent_anxiety_v1", [{ visemeCue: "AA", durationMs: 200 }])).toBe(true);
    const recache = [{ phoneme: "AA", atSecond: 0, durationSeconds: 0.2 }];
    const liveRecacheSlot = { activeSpeech: { text: generated }, root: { userData: {}, traverse() {} } };
    expect(attachBakedCuesToSpeech(liveRecacheSlot, generated, "peds_asthma_parent_anxiety_v1", undefined, recache)).toBe(false);
    expect("bakedCues" in (liveRecacheSlot.activeSpeech as Record<string, unknown>)).toBe(false);
    const replaySlot = { activeSpeech: { text: generated }, root: { userData: {}, traverse() {} }, mediaPositionSeconds: () => 1.5 };
    expect(attachBakedCuesToSpeech(replaySlot, generated, "peds_asthma_parent_anxiety_v1", undefined, recache)).toBe(true);
    expect((replaySlot.activeSpeech as Record<string, unknown>)["bakedCues"]).toEqual(recache);
    expect((replaySlot.root.userData as Record<string, unknown>)["openClinXrRecachedVisemeTimeline"]).toMatchObject({ cueCount: 1 });
    const exec = sampleExecution() as Record<string, unknown>;
    expect("visemeTimeline" in exec).toBe(false);
    expect("audioUri" in exec).toBe(false);
  });

  /**
   * S5 mock duration envelope: synthesize audioEvents with mock "neutral-pain"
   * but a finite durationMs attach a mouth-open envelope from duration;
   * "neutral-pain" never becomes a phoneme. Execution gains no
   * visemeTimeline/audioUri (DVA-6 stays gap-reported).
   * Diagnosis (7)(11)(12)(13)(14) headers IMMUTABLE.
   */
  it("(15) mock visemeCue with durationMs attaches an AA mouth-open envelope", () => {
    const slot = { activeSpeech: { text: "line" }, root: { userData: {}, traverse() {} } };
    expect(attachBakedCuesToSpeech(slot, "line", "peds_asthma_parent_anxiety_v1", [{ visemeCue: "neutral-pain", durationMs: 1100 }])).toBe(true);
    expect((slot.activeSpeech as Record<string, unknown>)["bakedCues"]).toEqual([
      { phoneme: "AA", atSecond: 0, durationSeconds: 1.1 },
    ]);
    for (const cue of (slot.activeSpeech as Record<string, unknown>)["bakedCues"] as Array<Record<string, unknown>>) {
      expect(cue["phoneme"]).not.toBe("neutral-pain");
    }
    const exec = sampleExecution() as Record<string, unknown>;
    expect("visemeTimeline" in exec).toBe(false);
    expect("audioUri" in exec).toBe(false);
  });

  // ## FIXED (S5 tsk_e7a367796ea110c1)
  // mouthCuesFromSynthesizeAudioEvents emits one AA envelope (durationMs/1000)
  // for mock/empty visemeCue with finite duration; real tokens still win.
  // Clause (13) mock half flipped to attach=true + AA; phoneme never
  // "neutral-pain"; execution gains no visemeTimeline/audioUri.
});
