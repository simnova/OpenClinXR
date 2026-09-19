/**
 * Lip-seal drive: a ["PP"] visemeSequence pins mouth-compression to >= 0.9.
 *
 * WHY: CEO grade after jaw -0.12 — viseme_PP lips unsealed with upper teeth in the
 * gap, viseme_sil shows a white teeth line. The named viseme_PP (visemes02 pack)
 * does not seal, so closed visemes dual-drive FACS mouth-compression (AU24) to 1.
 * Drives the PUBLIC speech loop (`updateGeneratedHumanoidAnimations`) with a mesh
 * carrying mouth-compression in its dictionary.
 * Counterweight: an open viseme through the same path leaves mouth-compression at 0.
 *
 * claimScope: mouth-compression influence follows closed visemes through the runtime path.
 * notEvidenceFor: pixel grades of a new capture, or lip-seal anatomy.
 */
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  createHumanoidEmotionExpressionState,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
} from "./index.js";

function sealingSlot(actorId: string, visemeSequence: string[], dict: Record<string, number> = { "mouth-compression": 0 }, phonemeSequence: string[] = ["AA"]): { slot: GeneratedHumanoidAnimationSlot; face: Mesh } {
  const root = new Group();
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = dict;
  face.morphTargetInfluences = Object.values(dict);
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
      text: "pah", emotion: "neutral",
      emotionContext: { emotion: "neutral", source: "plan_missing", baselineMood: [], cueIds: [] },
      phonemeSequence, visemeSequence, startedAtMs: 0, durationMs: 60_000,
    },
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

describe("lip-seal drive", () => {
  it("a PP viseme pins mouth-compression through the speech path", () => {
    const { slot, face } = sealingSlot("patient", ["PP"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    expect(face.morphTargetInfluences?.[0] ?? 0).toBeGreaterThanOrEqual(0.9);
  });

  it("a PP viseme zeroes a competing viseme_PP while sealing", () => {
    const dict = { "mouth-compression": 0, viseme_PP: 1 };
    const { slot, face } = sealingSlot("patient", ["PP"], dict, ["PP"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    const influences = face.morphTargetInfluences ?? [];
    expect(influences[face.morphTargetDictionary!["viseme_PP"]!] ?? 1).toBe(0);
    expect(influences[face.morphTargetDictionary!["mouth-compression"]!] ?? 0).toBeGreaterThanOrEqual(0.9);
  });

  it("a PP viseme zeroes mouth-open while sealing", () => {
    const dict = { "mouth-open": 0, "mouth-compression": 1, viseme_PP: 2 };
    const { slot, face } = sealingSlot("patient", ["PP"], dict, ["PP"]);
    face.morphTargetInfluences![0] = 0.233;
    face.morphTargetInfluences![1] = 0;
    face.morphTargetInfluences![2] = 1;
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    const influences = face.morphTargetInfluences ?? [];
    expect(influences[face.morphTargetDictionary!["mouth-open"]!] ?? 1).toBe(0);
    expect(influences[face.morphTargetDictionary!["mouth-compression"]!] ?? 0).toBeGreaterThanOrEqual(0.9);
  });

  it("a PP then aa sequence clears the leftover mouth-compression on the open frame", () => {
    const dict = { "mouth-compression": 0, viseme_PP: 1, viseme_AA: 0 };
    const { slot, face } = sealingSlot("patient", ["PP"], dict, ["PP"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    expect(face.morphTargetInfluences?.[face.morphTargetDictionary!["mouth-compression"]!] ?? 0).toBeGreaterThanOrEqual(0.9);
    if (slot.activeSpeech) {
      slot.activeSpeech.visemeSequence = ["aa"];
      slot.activeSpeech.phonemeSequence = ["AA"];
    }
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 2000, camera);
    const influences = face.morphTargetInfluences ?? [];
    expect(influences[face.morphTargetDictionary!["mouth-compression"]!] ?? 1).toBe(0);
  });

  it("COUNTERWEIGHT: an open viseme leaves mouth-compression at rest", () => {
    const { slot, face } = sealingSlot("patient", ["open"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    expect(face.morphTargetInfluences?.[0] ?? 0).toBeCloseTo(0, 5);
  });
});
