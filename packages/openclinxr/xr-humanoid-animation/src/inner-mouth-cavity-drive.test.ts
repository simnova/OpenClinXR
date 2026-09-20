/**
 * Unlit cavity card appears on open visemes through the public speech path.
 *
 * Lip-sync review: viseme_aa=1 + mouth-open=1 left parent lips sealed (f6c7d15d8);
 * jaw drive opens the aa crop; the hole is unlit. Card is MeshBasicMaterial, hidden
 * on rest/PP.
 *
 * claimScope: card visible on open visemes, hidden on rest, via updateGeneratedHumanoidAnimations.
 * notEvidenceFor: anatomical palate; pixel grade of a new capture (parent grades).
 */
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  createHumanoidEmotionExpressionState,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
} from "./index.js";

function speakingSlot(visemeSequence: string[]): GeneratedHumanoidAnimationSlot {
  const root = new Group();
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = {};
  face.morphTargetInfluences = [];
  root.add(face);
  const jaw = new Object3D();
  jaw.name = "jaw";
  root.add(jaw);
  const head = new Object3D();
  head.name = "head";
  root.add(head);
  const actorSlot = new Group();
  actorSlot.add(root);
  return {
    actorId: "patient",
    assetId: "patient-asset",
    root,
    actorSlot,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
    mouthCue: new Mesh(),
    gazeCue: new Line(),
    eyeFocusCue: new Group(),
    expressionCue: new Group(),
    emotionExpression: createHumanoidEmotionExpressionState({ deterministicClock: true }),
    sourceComparatorFreezeEnabled: false,
    activeSpeech: {
      actorId: "patient",
      assetId: "patient-asset",
      gazeTargetKind: "learner_camera",
      gazeTargetActorId: null,
      text: "ah",
      emotion: "neutral",
      emotionContext: { emotion: "neutral", source: "plan_missing", baselineMood: [], cueIds: [] },
      phonemeSequence: ["AA"],
      visemeSequence,
      startedAtMs: 0,
      durationMs: 60_000,
    },
  };
}

function context(slots: GeneratedHumanoidAnimationSlot[]): HumanoidAnimationRuntimeContext {
  return {
    slots,
    slotsByActorId: new Map(slots.map((s) => [s.actorId, s])),
    actorSlotsByActorId: new Map(slots.map((s) => [s.actorId, s.actorSlot])),
    virtualDeviceSlotsByActorId: new Map(),
    activeVirtualDeviceSpeechByActorId: new Map(),
    runtimePatientActorId: () => "patient",
    runtimeFamilyActorId: () => "family",
    runtimeClinicalTeamActorId: () => "nurse",
    runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    shouldUseCleanHumanoidSourceComparatorCapture: () => false,
    humanoidDialogueDurationMs: () => 60_000,
    applyIdlePosture: () => {},
    applyRolePosture: () => {},
    seatedClipPerforming: () => false,
    resolveGazeTargetWorld: (_speech, camera) => camera.position.clone(),
    normalizeLiveEmotion: () => "neutral",
    liveTurnForCue: () => undefined,
    bundleTurnsForScenario: () => [],
    runtimeTurnForTraceTag: () => undefined,
    isDeterministicCaptureClock: () => true,
    isMouthGazePoseReviewCaptureMode: () => false,
    selectedCaptureMode: () => "",
    selectedHumanoidSourceComparator: () => null,
    scenarioIdForEvidence: () => "test",
    comparatorScenarioId: () => "test",
    assetPathForSlot: () => "test.glb",
    animationPlaybackForSlot: () => undefined,
    morphTargetAppliedTargetCount: () => 0,
    visemeTimelineComparatorEvidencePresent: () => false,
    emotionTransitionCuePresent: () => false,
    currentSpeechEvidence: () => undefined,
    recordActingCueEvidence: () => {},
  };
}

describe("inner mouth cavity drive", () => {
  it("an open viseme shows an unlit cavity card through the speech path", () => {
    const slot = speakingSlot(["open"]);
    updateGeneratedHumanoidAnimations(context([slot]), 1 / 60, 1000, new PerspectiveCamera());
    const card = slot.root.getObjectByName("openclinxr_inner_mouth_cavity");
    expect(card, "cavity card").toBeTruthy();
    expect(card?.visible).toBe(true);
  });

  it("COUNTERWEIGHT: a rest viseme hides the cavity card", () => {
    const slot = speakingSlot(["open"]);
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1000, camera);
    expect(slot.root.getObjectByName("openclinxr_inner_mouth_cavity")?.visible).toBe(true);
    if (slot.activeSpeech) {
      slot.activeSpeech.visemeSequence = ["rest"];
      slot.activeSpeech.phonemeSequence = ["sil"];
      slot.activeSpeech.bakedCues = [{ phoneme: "sil", atSecond: 0, durationSeconds: 60 }];
    }
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 2000, camera);
    expect(slot.root.getObjectByName("openclinxr_inner_mouth_cavity")?.visible).toBe(false);
  });

  it("LIVE-SHAPED: visemeSequence sil plus baked AA still shows the cavity card", () => {
    const slot = speakingSlot(["sil"]);
    if (slot.activeSpeech) {
      slot.activeSpeech.phonemeSequence = ["sil"];
      slot.activeSpeech.bakedCues = [{ phoneme: "AA", atSecond: 0, durationSeconds: 60 }];
    }
    updateGeneratedHumanoidAnimations(context([slot]), 1 / 60, 1000, new PerspectiveCamera());
    expect(slot.root.getObjectByName("openclinxr_inner_mouth_cavity")?.visible).toBe(true);
  });

  it("COUNTERWEIGHT: visemeSequence sil plus baked PP hides the cavity card", () => {
    const slot = speakingSlot(["sil"]);
    if (slot.activeSpeech) {
      slot.activeSpeech.phonemeSequence = ["sil"];
      slot.activeSpeech.bakedCues = [{ phoneme: "PP", atSecond: 0, durationSeconds: 60 }];
    }
    updateGeneratedHumanoidAnimations(context([slot]), 1 / 60, 1000, new PerspectiveCamera());
    expect(slot.root.getObjectByName("openclinxr_inner_mouth_cavity")?.visible).toBe(false);
  });
});
