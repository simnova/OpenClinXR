/**
 * REGRESSION GATES for the rest blink and the multi-target expression drive.
 *
 * Both drive the PACKAGE ENTRYPOINT only. A control that calls a helper directly proves the
 * helper works and nothing about the shipped path; these exercise `updateGeneratedHumanoidAnimations`
 * and `applyHumanoidMorphTargetCue`, which are what the runtime actually calls.
 *
 * DIAGNOSES, both measured 2026-09-16 on a 1,321-frame capture of mpfb-gown-adult-patient.glb:
 *  - updateHumanoidSpeechCue returned before the face rig whenever slot.activeSpeech was
 *    undefined, so across 883 silent frames (~8.7 s) blink intensity was 0 on every one, where a
 *    3.4 s mean interval predicts two or three blinks. After the fix: blinks at 8,016 ms and
 *    10,274 ms, vertex-measured lid closure 0.9993.
 *  - the 1:1 morph resolver sent openclinxr_brow_concern to "eyebrows-left-inner-up" ALONE and
 *    openclinxr_cheek_tension to null, so an authored emotion moved half a face or none of it.
 *
 * claimScope: that these channels are driven through the public API. notEvidenceFor blink realism,
 * anatomical correctness, or whether the resulting face reads as the intended emotion.
 */
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  applyHumanoidMorphTargetCue,
  createHumanoidEmotionExpressionState,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
} from "./index.js";

/** The FACS names a shipped MPFB body carries (measured, not invented). */
const MPFB_TARGETS = [
  "eye-left-closure", "eye-right-closure", "eye-left-slit", "eye-right-slit",
  "eyebrows-left-inner-up", "eyebrows-right-inner-up", "eyebrows-left-down", "eyebrows-right-down",
  "mouth-open", "nose-compression-uncompress",
];

function actor(actorId: string, targetNames: string[]) {
  const root = new Group();
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = Object.fromEntries(targetNames.map((n, i) => [n, i]));
  face.morphTargetInfluences = targetNames.map(() => 0);
  root.add(face);
  const actorSlot = new Group();
  actorSlot.add(root);
  const slot: GeneratedHumanoidAnimationSlot = {
    actorId, assetId: `${actorId}-asset`, root, actorSlot,
    baseX: 0, baseY: 0, baseZ: 0, baseScaleX: 1, baseScaleY: 1, baseScaleZ: 1,
    baseRotationY: 0, phaseOffsetMs: 0, mouthCue: new Mesh(), gazeCue: new Line(),
    eyeFocusCue: new Group(), expressionCue: new Group(),
    emotionExpression: createHumanoidEmotionExpressionState({ deterministicClock: true }),
    sourceComparatorFreezeEnabled: false,
  };
  return { slot, face };
}

function context(slots: GeneratedHumanoidAnimationSlot[]): HumanoidAnimationRuntimeContext {
  return {
    slots, slotsByActorId: new Map(slots.map(s => [s.actorId, s])),
    actorSlotsByActorId: new Map(slots.map(s => [s.actorId, s.actorSlot])),
    virtualDeviceSlotsByActorId: new Map(), activeVirtualDeviceSpeechByActorId: new Map(),
    runtimePatientActorId: () => "patient", runtimeFamilyActorId: () => "family",
    runtimeClinicalTeamActorId: () => "nurse", runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    shouldUseCleanHumanoidSourceComparatorCapture: () => false, humanoidDialogueDurationMs: () => 2000,
    applyIdlePosture: () => {}, applyRolePosture: () => {}, seatedClipPerforming: () => false,
    resolveGazeTargetWorld: (_speech, camera) => camera.position.clone(),
    normalizeLiveEmotion: () => "neutral", liveTurnForCue: () => undefined,
    bundleTurnsForScenario: () => [], runtimeTurnForTraceTag: () => undefined,
    isDeterministicCaptureClock: () => true, isMouthGazePoseReviewCaptureMode: () => false,
    selectedCaptureMode: () => "", selectedHumanoidSourceComparator: () => null,
    scenarioIdForEvidence: () => "test", comparatorScenarioId: () => "test",
    assetPathForSlot: () => "test.glb", animationPlaybackForSlot: () => undefined,
    morphTargetAppliedTargetCount: () => 0, visemeTimelineComparatorEvidencePresent: () => false,
    emotionTransitionCuePresent: () => false, currentSpeechEvidence: () => undefined,
    recordActingCueEvidence: () => {},
  };
}

/** Run the PUBLIC animation loop with no active speech and sample the lid-closure channel. */
function idleClosureSeries(durationMs: number) {
  const { slot, face } = actor("patient", MPFB_TARGETS);
  const ctx = context([slot]);
  const camera = new PerspectiveCamera();
  const samples: number[] = [];
  const stepMs = 1000 / 60;
  for (let t = 0; t <= durationMs; t += stepMs) {
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, t, camera);
    samples.push(face.morphTargetInfluences![0]!);
  }
  return samples;
}

function onsets(samples: number[]) {
  const out: number[] = [];
  let rising = false;
  samples.forEach((v, i) => {
    if (v > 0.9 && !rising) { out.push(i); rising = true; }
    if (v < 0.1) rising = false;
  });
  return out;
}

describe("a silent humanoid still blinks", () => {
  it("drives the lid-closure channel to a full blink with no active speech", () => {
    const samples = idleClosureSeries(30000);
    // pre-fix this channel was 0 on every one of 883 measured silent frames
    expect(Math.max(...samples)).toBeGreaterThan(0.9);
    expect(onsets(samples).length).toBeGreaterThanOrEqual(4);
  });

  it("blinks on an IRREGULAR schedule, not a metronome", () => {
    const frames = onsets(idleClosureSeries(90000));
    const intervals = frames.slice(1).map((f, i) => f - frames[i]!);
    expect(intervals.length).toBeGreaterThanOrEqual(8);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length);
    // the pre-fix clock was `elapsedMs % 4300`: sd exactly 0
    expect(sd).toBeGreaterThan(3);
    expect(new Set(intervals).size).toBeGreaterThan(intervals.length * 0.5);
  });

  it("COUNTERWEIGHT: the schedule is DETERMINISTIC — two runs agree exactly", () => {
    // rejects Math.random(), which would satisfy every assertion above
    expect(onsets(idleClosureSeries(30000))).toEqual(onsets(idleClosureSeries(30000)));
  });

  it("COUNTERWEIGHT: the lids return fully open between blinks", () => {
    // rejects "hold the lids shut", which would also make the peak exceed 0.9
    expect(idleClosureSeries(30000).some(v => v < 0.001)).toBe(true);
  });
});

describe("an authored emotion drives every FACS unit it implies", () => {
  /** Drive the PUBLIC morph cue and report which target names were written nonzero. */
  function driven(weights: { mouthOpen: number; browConcern: number; cheekTension: number }) {
    const { slot, face } = actor("patient", MPFB_TARGETS);
    applyHumanoidMorphTargetCue(slot, 0, "rest", weights, () => ({ activeTargetName: null }));
    const dict = face.morphTargetDictionary!;
    return Object.keys(dict).filter(n => (face.morphTargetInfluences![dict[n]!] ?? 0) > 0.001);
  }

  it("brow concern moves BOTH brows, never one side alone", () => {
    const names = driven({ mouthOpen: 0, browConcern: 0.8, cheekTension: 0 });
    expect(names).toContain("eyebrows-left-inner-up");
    expect(names).toContain("eyebrows-right-inner-up");
    // pre-fix exactly one brow target was written
    expect(names.filter(n => n.startsWith("eyebrows-")).length).toBeGreaterThan(1);
    expect(names.filter(n => n.includes("-left-")).length)
      .toBe(names.filter(n => n.includes("-right-")).length);
  });

  it("cheek tension drives real shipped targets instead of nothing", () => {
    // pre-fix openclinxr_cheek_tension resolved to null: this channel wrote nowhere
    const names = driven({ mouthOpen: 0, browConcern: 0, cheekTension: 0.8 });
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(MPFB_TARGETS).toContain(n);
  });

  it("COUNTERWEIGHT: zero weights write nothing — the drive is not unconditional", () => {
    expect(driven({ mouthOpen: 0, browConcern: 0, cheekTension: 0 })).toEqual([]);
  });

  it("COUNTERWEIGHT: a body carrying the canonical names gets exactly one target each", () => {
    // the Anny rail must not fan out
    const { slot, face } = actor("anny", ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"]);
    applyHumanoidMorphTargetCue(slot, 0, "rest", { mouthOpen: 0, browConcern: 0.8, cheekTension: 0 },
      () => ({ activeTargetName: null }));
    const dict = face.morphTargetDictionary!;
    const names = Object.keys(dict).filter(n => (face.morphTargetInfluences![dict[n]!] ?? 0) > 0.001);
    expect(names).toEqual(["openclinxr_brow_concern"]);
  });
});
