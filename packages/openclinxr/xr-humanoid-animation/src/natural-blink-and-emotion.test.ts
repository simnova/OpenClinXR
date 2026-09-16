/**
 * Natural eyelid and authored-affect behavior plant, 2026-09-16.
 * Existing production entrypoints only: ordinary failures must be behavioral,
 * not missing imports, missing new modules, asset substitution or setup failure.
 * Fixture controls prove real shared closure aliases write both mesh influences.
 * Original clause bodies/names and fixture shape are immutable for the worker;
 * only measured failing it.fails markers may become ordinary it markers.
 * Numeric fixtures prove runtime composition, not visible realism or clinical affect.
 */

import { applyBlinkClosureToRoot } from "@openclinxr/xr-dialogue";
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { updateGeneratedHumanoidAnimations } from "./animation-loop.js";
import { createHumanoidEmotionExpressionState, startHumanoidEmotionTransition, updateHumanoidEmotionExpression } from "./face-rig.js";
import type { GeneratedHumanoidAnimationSlot, HumanoidAnimationRuntimeContext } from "./types.js";

function actor(actorId: string) {
  const root = new Group();
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = { "eye-left-closure": 0, "eye-right-closure": 1 };
  face.morphTargetInfluences = [0, 0];
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
    runtimePatientActorId: () => "patient", runtimeFamilyActorId: () => "family", runtimeClinicalTeamActorId: () => "nurse",
    runtimeActorRole: () => undefined, isPediatricAsthmaRuntimeScenario: () => false,
    shouldUseCleanHumanoidSourceComparatorCapture: () => false, humanoidDialogueDurationMs: () => 2000,
    applyIdlePosture: () => {}, applyRolePosture: () => {}, seatedClipPerforming: () => false,
    resolveGazeTargetWorld: (_speech, camera) => camera.position.clone(),
    normalizeLiveEmotion: () => "neutral", liveTurnForCue: () => undefined,
    bundleTurnsForScenario: () => [], runtimeTurnForTraceTag: () => undefined,
    isDeterministicCaptureClock: () => true, isMouthGazePoseReviewCaptureMode: () => false,
    selectedCaptureMode: () => "", selectedHumanoidSourceComparator: () => null,
    scenarioIdForEvidence: () => "test", comparatorScenarioId: () => "test", assetPathForSlot: () => "test.glb",
    animationPlaybackForSlot: () => undefined, morphTargetAppliedTargetCount: () => 0,
    visemeTimelineComparatorEvidencePresent: () => false, emotionTransitionCuePresent: () => false,
    currentSpeechEvidence: () => undefined, recordActingCueEvidence: () => {},
  };
}

function idleSamples(ids: string[]) {
  const actors = ids.map(actor);
  const ctx = context(actors.map(a => a.slot));
  const samples = actors.map(() => [] as number[]);
  const camera = new PerspectiveCamera();
  for (let frame = 0; frame <= 1200; frame++) {
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, frame * (1000 / 60), camera);
    actors.forEach((a, i) => { samples[i]!.push(a.face.morphTargetInfluences![0]!); });
  }
  return samples;
}

describe("natural eyelids and authored facial affect", () => {
  it("the existing closure wire actually drives both fixture eyelids and releases them", () => {
    const { slot, face } = actor("control");
    expect(applyBlinkClosureToRoot(slot.root, 1).appliedTargetCount).toBe(2);
    expect(face.morphTargetInfluences).toEqual([1, 1]);
    applyBlinkClosureToRoot(slot.root, 0);
    expect(face.morphTargetInfluences).toEqual([0, 0]);
  });

  it.fails("an idle actor closes and reopens real closure channels without active speech", () => {
    const samples = idleSamples(["patient"])[0]!;
    expect(samples.some(v => v >= 0.8)).toBe(true);
    expect(samples.some((v, i) => i > 0 && v <= 0.05 && samples[i - 1]! > 0.05)).toBe(true);
  });

  it.fails("idle actors with identical clocks have distinct nonzero closure schedules", () => {
    const samples = idleSamples(["patient", "nurse", "family"]);
    for (const sample of samples) expect(sample.some(v => v >= 0.8)).toBe(true);
    expect(samples[0]).not.toEqual(samples[1]);
    expect(samples[1]).not.toEqual(samples[2]);
    expect(samples[0]).not.toEqual(samples[2]);
  });

  it.fails("authored pain is not immediately cancelled merely because speech is absent", () => {
    const { slot } = actor("patient");
    startHumanoidEmotionTransition(slot, "pain", 0);
    updateGeneratedHumanoidAnimations(context([slot]), 1 / 60, 100, new PerspectiveCamera());
    expect(slot.emotionExpression.targetEmotion).toBe("pain");
  });

  it.fails("emotion interpolation reaches the same elapsed-time endpoint independent of frame subdivision", () => {
    const sparse = actor("sparse").slot;
    const dense = actor("dense").slot;
    startHumanoidEmotionTransition(sparse, "pain", 0);
    startHumanoidEmotionTransition(dense, "pain", 0);
    updateHumanoidEmotionExpression(sparse, 0);
    updateHumanoidEmotionExpression(sparse, 650);
    for (let t = 0; t < 650; t += 1000 / 60) updateHumanoidEmotionExpression(dense, t);
    updateHumanoidEmotionExpression(dense, 650);
    expect(sparse.emotionExpression.weights.mouthOpen).toBeCloseTo(dense.emotionExpression.weights.mouthOpen, 8);
    expect(sparse.emotionExpression.weights.browConcern).toBeCloseTo(dense.emotionExpression.weights.browConcern, 8);
    expect(sparse.emotionExpression.weights.cheekTension).toBeCloseTo(dense.emotionExpression.weights.cheekTension, 8);
  });

  it("source-comparator freeze leaves both eyelids and actor transform unchanged", () => {
    const { slot, face } = actor("frozen");
    slot.sourceComparatorFreezeEnabled = true;
    const before = slot.root.matrix.toArray();
    const ctx = context([slot]);
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 4000, new PerspectiveCamera());
    expect(face.morphTargetInfluences).toEqual([0, 0]);
    slot.root.updateMatrix();
    expect(slot.root.matrix.toArray()).toEqual(before);
  });
});
