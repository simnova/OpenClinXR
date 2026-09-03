import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as adaptersModule from "./adapters.js";
import { collectVoiceStream, createDefaultVoiceGateway, MockVoiceProviderAdapter } from "./index.js";

/**
 * OBSERVABLE: the voice-gateway adapter layer has no barge-in representation
 * and no plan/execution vocabulary. adapters.ts:1-270 exports only
 * collectVoiceStream, MockVoiceProviderAdapter, LocalVoiceProviderAdapter and
 * createVibeVoiceProviderAdapter; the streaming TTS render (gateway.ts:39
 * synthesize -> first ready adapter) accepts any request that merely names a
 * plan, and no code path can append an ActorTurnExecution for a learner
 * interruption. Direction 2026-09-02 DVA-8 (card cancelled; this plant
 * re-contracts it): streaming TTS/STT render MUST come from a FROZEN
 * ActorTurnPlan; a barge-in mid-render appends an ActorTurnExecution
 * (interruption.kind "truncated") and MUST NOT mutate the plan. Mutating the
 * plan, auto-approving an execution, and skipping the freeze gate are the
 * three cheap evasions this RED rejects.
 *
 * MEASURED 2026-09-03. scenario-runtime DVA-6 already freezes before render:
 * scenario-runtime.ts:379 throws "ActorTurnPlan must be frozen before speech
 * render"; executionFromFrozenPlan (actor-turn-plan.ts:209-222) derives and
 * freezes the appended execution; interruption kinds come from
 * ActorTurnExecutionSchema (shared-schemas/src/schemas.ts:163-165: "none" |
 * "truncated" | "replaced"). voice-gateway has none of this: 0 matches for
 * ActorTurn in the package, and package.json declares no shared-schemas
 * dependency, so the honest slice implements the freeze gate and the
 * execution record locally in adapters.ts.
 *
 * known-good: types.ts:138 SpeechSynthesisRequest binds every synthesis to a
 * plan by id (performancePlanId at types.ts:144); the request seam never
 * carries a mutable plan object. The counterweight (0) pins that seam so the
 * render input stays plan-referencing (ActorTurnPlan) while barge-in output
 * records an ActorTurnExecution.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED (DVA-8)
 * below. Never rewrite the diagnosis or the measured anchors. A rejection
 * still flips: the clause asserts the report, not the outcome. Never delete
 * an inverted guard.
 *
 * CONTRACTED EXPORT (the honest slice adds exactly this to adapters.ts):
 *   synthesizeActorSpeechFromFrozenPlan(options: {
 *     plan: ActorTurnPlan;            // deep-frozen in freezeActorTurnPlan order
 *     bargeInAtChunkIndex?: number;   // first chunk NOT delivered; omitted = full render
 *   }): Promise<{ audioEvents: AudioEvent[]; actorTurnExecution: ActorTurnExecution }>
 * Deterministic chunked stream, one audio chunk per whitespace token of
 * plan.spokenTextForTts. An unfrozen plan REJECTS with
 * "ActorTurnPlan must be frozen before speech render" (same gate wording as
 * scenario-runtime.ts:379) and the rejection leaves the caller's plan
 * untouched. No barge-in -> interruption.kind "none" and the full chunk
 * count. bargeInAtChunkIndex k -> only chunks 0..k-1 are delivered and
 * interruption.kind is "truncated". The plan object is never mutated: the
 * execution is a NEW frozen record derived from plan fields (planId, turnId,
 * prosody tags copied into fresh arrays), never the plan itself.
 *
 * IN-SCOPE: adapters.ts export above; freeze gate; chunked render from
 * plan.spokenTextForTts; barge-in truncation; execution append with
 * "none"/"truncated"; plan immutability + no plan-array aliasing.
 * OUT-OF-SCOPE: edits to adapters.ts (the product slice after this RED
 * lands); types.ts / gateway.ts changes; interruption kind "replaced";
 * runtime ledger append (scenario-runtime consume path); shared-schemas
 * dependency wiring for voice-gateway (implementer's call); real Grok
 * TTS/STT providers.
 * CLAIM: this RED is live today (typeof probe fails cleanly on the missing
 * export), flips green under the honest implementation above, and stays red
 * under the three evasions (mutate the plan, auto-approve an execution, skip
 * the freeze gate).
 * NOT TESTED: canonical shared-schemas schema validation of the execution
 * record (voice-gateway does not depend on shared-schemas); STT-side learner
 * transcript handling; a root-frozen-but-nested-unfrozen plan (freezeActorTurnPlan
 * always freezes nested first, so the runtime can never produce one);
 * the exact audioFormat/provenance bytes of the chunked render.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

const FULL_RENDER_CHUNK_COUNT = 6;

type TurnPlanFixture = {
  planId: string;
  planVersion: number;
  turnId: string;
  stationRunId: string;
  actorId: string;
  respondingActorId: string;
  turnIndex: number;
  spokenText: string;
  spokenTextForTts: string;
  dialogueEmotionFrom: string;
  dialogueEmotionTo: string;
  somaticEmotion: null;
  eventKind: string;
  eventKindSource: string;
  intensityBucket: string;
  ageBand: string;
  performancePlanId: string;
  facePresetId: string;
  posePresetId: string;
  gestureClipIds: string[];
  prosody: {
    wrapTags: string[];
    inlineTags: string[];
    speed: number;
    droppedTags: string[];
  };
  voiceId: string;
  languageProvenance: { fallbackUsed: boolean; providerId?: string };
  claimScope: string;
  notEvidenceFor: string[];
};

type FrozenPlanSpeechRender = (options: {
  plan: TurnPlanFixture;
  bargeInAtChunkIndex?: number;
}) => Promise<{
  audioEvents: Array<{ eventType: string; chunkIndex: number; durationMs: number }>;
  actorTurnExecution: {
    planId: string;
    turnId: string;
    interruption: { kind: "none" | "truncated" };
    renderedProsodyTags: string[];
    droppedProsodyTags: string[];
    fallback: { language: boolean; tts: boolean };
  };
}>;

function contractedRender(): FrozenPlanSpeechRender {
  // biome-ignore lint/complexity/useLiteralKeys: contract export does not exist yet; a literal key would not compile
  const candidate = (adaptersModule as unknown as Record<string, unknown>)["synthesizeActorSpeechFromFrozenPlan"];
  return candidate as FrozenPlanSpeechRender;
}

function planFixture(overrides: Partial<TurnPlanFixture> = {}): TurnPlanFixture {
  return {
    planId: "plan_turn_0001",
    planVersion: 1,
    turnId: "turn_0001",
    stationRunId: "run_dva8_001",
    actorId: "patient_robert_hayes_v1",
    respondingActorId: "patient_robert_hayes_v1",
    turnIndex: 0,
    spokenText: "When did the chest pressure start please",
    spokenTextForTts: "When did the chest pressure start",
    dialogueEmotionFrom: "anxious",
    dialogueEmotionTo: "concerned",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "adult",
    performancePlanId: "concerned-v1",
    facePresetId: "face_concerned_v1",
    posePresetId: "pose_concerned_v1",
    gestureClipIds: ["gesture_clasp_v1"],
    prosody: {
      wrapTags: [],
      inlineTags: [],
      speed: 1,
      droppedTags: ["[cry]"],
    },
    voiceId: "mock-robert-hayes",
    languageProvenance: { fallbackUsed: false },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
    ...overrides,
  };
}

/** Mirrors freezeActorTurnPlan (actor-turn-plan.ts:111-120): nested first, root last. */
function deepFreezePlan(plan: TurnPlanFixture): TurnPlanFixture {
  Object.freeze(plan.gestureClipIds);
  Object.freeze(plan.prosody.wrapTags);
  Object.freeze(plan.prosody.inlineTags);
  Object.freeze(plan.prosody.droppedTags);
  Object.freeze(plan.prosody);
  Object.freeze(plan.languageProvenance);
  Object.freeze(plan.notEvidenceFor);
  return Object.freeze(plan) as TurnPlanFixture;
}

/** Freeze nested objects only, leave the root unfrozen: defeats a shallow freeze check. */
function freezeNestedOnly(plan: TurnPlanFixture): TurnPlanFixture {
  Object.freeze(plan.gestureClipIds);
  Object.freeze(plan.prosody.wrapTags);
  Object.freeze(plan.prosody.inlineTags);
  Object.freeze(plan.prosody.droppedTags);
  Object.freeze(plan.prosody);
  Object.freeze(plan.languageProvenance);
  Object.freeze(plan.notEvidenceFor);
  return plan;
}

describe("barge-in appends an execution, never a plan mutation", () => {
  it("(0) COUNTERWEIGHT: request seam binds synthesis to a plan by id and the deterministic stream still renders", async () => {
    const types = readFileSync(join(SRC, "types.ts"), "utf8");
    const start = types.indexOf("export type SpeechSynthesisRequest");
    const end = types.indexOf("export type TranscriptEvent", start);
    const slice = types.slice(start, end === -1 ? undefined : end);
    expect(slice.length).toBeGreaterThan(40);
    expect(slice).toMatch(/performancePlanId:\s*string/);
    expect(slice).not.toMatch(/spokenTextForTts/);

    const gateway = createDefaultVoiceGateway({
      adapters: [new MockVoiceProviderAdapter()],
      routeId: "voice-offline-v1",
    });
    const audio = await collectVoiceStream(
      gateway.synthesize({
        requestId: "voice-dva8-counterweight",
        stationRunId: "run_dva8_001",
        actorId: "patient_robert_hayes_v1",
        voiceId: "mock-robert-hayes",
        text: "When did the chest pressure start?",
        performancePlanId: "concerned-v1",
        policy: {
          requestPolicyId: "voice-offline-v1",
          safetyPolicyVersion: "clinical-simulation-safety-v1",
        },
      }),
    );
    expect(audio.map((event) => event.chunkIndex)).toEqual([0]);
    expect(audio[0]?.provenance.providerId).toBe("mock-voice");
  });

  it.fails("(1) renders the whole frozen plan as a chunked stream and appends a separate frozen execution", async () => {
    const render = contractedRender();
    expect(typeof render, "adapters.ts must export synthesizeActorSpeechFromFrozenPlan").toBe("function");

    const plan = deepFreezePlan(planFixture());
    const before = JSON.parse(JSON.stringify(plan)) as TurnPlanFixture;

    const result = await render({ plan });

    expect(result.audioEvents.map((event) => event.chunkIndex)).toEqual(
      Array.from({ length: FULL_RENDER_CHUNK_COUNT }, (_, index) => index),
    );
    expect(result.audioEvents.every((event) => event.eventType === "audio_chunk")).toBe(true);
    expect(result.actorTurnExecution).toMatchObject({
      planId: plan.planId,
      turnId: plan.turnId,
      interruption: { kind: "none" },
      fallback: { language: plan.languageProvenance.fallbackUsed, tts: false },
    });
    expect(result.actorTurnExecution.renderedProsodyTags).toEqual([
      ...plan.prosody.wrapTags,
      ...plan.prosody.inlineTags,
    ]);
    expect(result.actorTurnExecution.droppedProsodyTags).toEqual([...plan.prosody.droppedTags]);
    expect(result.actorTurnExecution.renderedProsodyTags).not.toBe(plan.prosody.wrapTags);
    expect(result.actorTurnExecution.droppedProsodyTags).not.toBe(plan.prosody.droppedTags);
    expect(Object.isFrozen(result.actorTurnExecution)).toBe(true);
    expect(result.actorTurnExecution).not.toBe(plan);

    expect(plan).toEqual(before);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.prosody)).toBe(true);
  });

  it.fails("(2) refuses an unfrozen or shallow-frozen plan and leaves the caller's plan untouched", async () => {
    const render = contractedRender();
    expect(typeof render, "adapters.ts must export synthesizeActorSpeechFromFrozenPlan").toBe("function");

    const plainPlan = planFixture();
    const nestedOnlyPlan = freezeNestedOnly(planFixture());
    for (const plan of [plainPlan, nestedOnlyPlan]) {
      const before = JSON.parse(JSON.stringify(plan)) as TurnPlanFixture;
      await expect(render({ plan })).rejects.toThrow(/ActorTurnPlan must be frozen before speech render/);
      expect(plan, "rejection must not mutate the caller's plan").toEqual(before);
      expect(Object.isFrozen(plan), "rejection must not secretly freeze the caller's plan").toBe(false);
    }
  });

  it.fails("(3) a barge-in mid-stream appends a truncated execution and never mutates the plan", async () => {
    const render = contractedRender();
    expect(typeof render, "adapters.ts must export synthesizeActorSpeechFromFrozenPlan").toBe("function");

    const plan = deepFreezePlan(planFixture());
    const before = JSON.parse(JSON.stringify(plan)) as TurnPlanFixture;

    const interrupted = await render({ plan, bargeInAtChunkIndex: 2 });
    expect(interrupted.audioEvents.map((event) => event.chunkIndex)).toEqual([0, 1]);
    expect(interrupted.audioEvents.length).toBeLessThan(FULL_RENDER_CHUNK_COUNT);
    expect(interrupted.actorTurnExecution.interruption.kind).toBe("truncated");
    expect(interrupted.actorTurnExecution.planId).toBe(plan.planId);

    const cutBeforeSpeech = await render({ plan, bargeInAtChunkIndex: 0 });
    expect(cutBeforeSpeech.audioEvents).toEqual([]);
    expect(cutBeforeSpeech.actorTurnExecution.interruption.kind).toBe("truncated");

    expect(plan).toEqual(before);
    expect(Object.isFrozen(plan)).toBe(true);
  });
});
