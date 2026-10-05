/**
 * One phoneme frame owns the jaw bone. Teeth are skin on that bone.
 *
 * WHY: two writers fought. applyJawOpenToRoot uses +X and the phoneme table
 * (AA ≈ 0.151 rad). applyJawVisemeToRoot then added −0.12 × coarse visemeOpenness.
 * The animation-loop nowMs and performance.now() also picked different frames.
 * This drives updateGeneratedHumanoidAnimations: early nowMs holds AA (positive
 * jaw, stable on a second call), late nowMs holds PP (jaw at rest, lips sealed).
 *
 * claimScope: jaw rotation and lip seal follow the same phoneme clock.
 * notEvidenceFor: pixel grades, or upper-teeth head-weight lag.
 */
import { Bone, BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
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
  face.morphTargetDictionary = { "mouth-open": 0, "mouth-compression": 1 };
  face.morphTargetInfluences = [0, 0];
  root.add(face);
  const jaw = new Bone();
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
      phonemeSequence: ["AA"],
      bakedCues: [
        { phoneme: "AA", atSecond: 0, durationSeconds: 30 },
        { phoneme: "PP", atSecond: 30, durationSeconds: 30 },
      ],
      visemeSequence, startedAtMs: 0, durationMs: 60_000,
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

function jawOf(slot: GeneratedHumanoidAnimationSlot): Bone {
  const jaw = slot.root.getObjectByName("jaw");
  if (!(jaw instanceof Bone)) throw new Error("jaw bone missing from fixture");
  return jaw;
}

function influence(slot: GeneratedHumanoidAnimationSlot, name: string): number {
  let found = 0;
  slot.root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
    const index = object.morphTargetDictionary[name];
    if (typeof index === "number") found = object.morphTargetInfluences[index] ?? 0;
  });
  return found;
}

describe("jaw viseme drive", () => {
  it("early nowMs holds AA: positive jaw, and a second call does not stack", () => {
    const slot = speakingSlot("patient", ["AA"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    const first = jawOf(slot).rotation.x;
    // AA opens mildly: JAW_TEETH_GAIN = 0.5 (viseme-morph-apply.ts) halves the
    // 0.15086 JAW_OPEN_TEETH_CLEAR_RADIANS table value to ~0.0754, matching the
    // Oculus OVRLipSync 'aa' mild-production reference.
    expect(first).toBeGreaterThan(0.05);
    expect(first).toBeLessThan(0.1);
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    expect(jawOf(slot).rotation.x).toBeCloseTo(first, 5);
  });

  it("COUNTERWEIGHT: late nowMs holds PP — jaw at rest and lips sealed", () => {
    const slot = speakingSlot("patient", ["PP"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 45_000, camera);
    expect(jawOf(slot).rotation.x).toBeCloseTo(0, 5);
    expect(influence(slot, "mouth-compression")).toBeGreaterThanOrEqual(0.9);
    expect(influence(slot, "mouth-open")).toBe(0);
  });
});
