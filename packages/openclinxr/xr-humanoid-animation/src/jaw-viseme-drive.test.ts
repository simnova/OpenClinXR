/**
 * Jaw bone follows viseme openness so skin-weighted teeth move with the lips.
 *
 * WHY: CEO grade of native 200x180 mouth crops — viseme_sil shows a white teeth line
 * between closed lips, viseme_PP is unsealed with upper teeth in the gap, viseme_aa
 * leaves a static upper-teeth row. Measured: fitted teeth carry no morphs (~50% verts
 * on `jaw`, ~50% on `head`), viseme morphs live only on the body, jaw never rotates.
 * Drives the PUBLIC speech loop (`updateGeneratedHumanoidAnimations`, the path the
 * runtime actually calls) with a speaking slot and a `jaw` bone on the root: an open
 * viseme rotates the jaw off rest, and returning to silence restores rest (0).
 * Counterweight: a rest viseme through the same path restores rest (openness 0).
 *
 * claimScope: the jaw bone tracks viseme openness through the runtime speech path.
 * notEvidenceFor: pixel grades of a new capture, or anatomical jaw correctness.
 */
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  createHumanoidEmotionExpressionState,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
} from "./index.js";

function speakingSlot(actorId: string, visemeSequence: string[]): GeneratedHumanoidAnimationSlot {
  const root = new Group();
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = {};
  face.morphTargetInfluences = [];
  root.add(face);
  const jaw = new Object3D();
  jaw.name = "jaw";
  root.add(jaw);
  const actorSlot = new Group();
  actorSlot.add(root);
  const slot: GeneratedHumanoidAnimationSlot = {
    actorId, assetId: `${actorId}-asset`, root, actorSlot,
    baseX: 0, baseY: 0, baseZ: 0, baseScaleX: 1, baseScaleY: 1, baseScaleZ: 1,
    baseRotationY: 0, phaseOffsetMs: 0, mouthCue: new Mesh(), gazeCue: new Line(),
    eyeFocusCue: new Group(), expressionCue: new Group(),
    emotionExpression: createHumanoidEmotionExpressionState({ deterministicClock: true }),
    sourceComparatorFreezeEnabled: false,
    activeSpeech: {
      actorId, assetId: `${actorId}-asset`, gazeTargetKind: "learner_camera", gazeTargetActorId: null,
      text: "ah", emotion: "neutral",
      emotionContext: { emotion: "neutral", source: "plan_missing", baselineMood: [], cueIds: [] },
      phonemeSequence: ["AA"], visemeSequence, startedAtMs: 0, durationMs: 60_000,
    },
  };
  return slot;
}

function context(slots: GeneratedHumanoidAnimationSlot[]): HumanoidAnimationRuntimeContext {
  return {
    slots, slotsByActorId: new Map(slots.map(s => [s.actorId, s])),
    actorSlotsByActorId: new Map(slots.map(s => [s.actorId, s.actorSlot])),
    virtualDeviceSlotsByActorId: new Map(), activeVirtualDeviceSpeechByActorId: new Map(),
    runtimePatientActorId: () => "patient", runtimeFamilyActorId: () => "family",
    runtimeClinicalTeamActorId: () => "nurse", runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    shouldUseCleanHumanoidSourceComparatorCapture: () => false, humanoidDialogueDurationMs: () => 60_000,
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

function jawOf(slot: GeneratedHumanoidAnimationSlot): Object3D {
  const jaw = slot.root.getObjectByName("jaw");
  if (!jaw) throw new Error("jaw bone missing from fixture");
  return jaw;
}

describe("jaw viseme drive", () => {
  it("an open viseme rotates the jaw off rest through the speech path", () => {
    const slot = speakingSlot("patient", ["open"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    expect(jawOf(slot).rotation.x).toBeLessThan(-0.02);
  });

  it("COUNTERWEIGHT: a rest viseme restores the jaw to rest", () => {
    const slot = speakingSlot("patient", ["open"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    expect(jawOf(slot).rotation.x).toBeLessThan(-0.02);
    if (slot.activeSpeech) slot.activeSpeech.visemeSequence = ["rest"];
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 2000, camera);
    expect(jawOf(slot).rotation.x).toBeCloseTo(0, 5);
  });
});
