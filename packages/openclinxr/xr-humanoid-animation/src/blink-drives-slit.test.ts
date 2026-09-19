/**
 * Lid closure ALSO drives the lid-tightener (eye-*-slit, FACS AU7).
 *
 * WHY: CEO grade of docs/assets/speech-emotion-blink-closed-2026-09-17.png — vertex lid
 * closure 0.9993 still left a blue iris sliver under a crumpled lid, so closure alone does
 * not seal the eye. This drives the PUBLIC loop (`updateGeneratedHumanoidAnimations`), the
 * path the runtime actually calls, on a silent actor with both closure and slit targets.
 *
 * claimScope: that closure and slit are both driven to full through the public API.
 * notEvidenceFor: blink realism, anatomical correctness, or pixels of a new capture.
 */
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  createHumanoidEmotionExpressionState,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
} from "./index.js";

const TARGETS = ["eye-left-closure", "eye-right-closure", "eye-left-slit", "eye-right-slit"];

function actor(actorId: string) {
  const root = new Group();
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = Object.fromEntries(TARGETS.map((n, i) => [n, i]));
  face.morphTargetInfluences = TARGETS.map(() => 0);
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

describe("blink drives slit with lid closure", () => {
  it("at full blink BOTH slit influences exceed 0.9 alongside closure", () => {
    const { slot, face } = actor("patient");
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    const dict = face.morphTargetDictionary!;
    let maxLeftSlit = 0;
    let maxRightSlit = 0;
    let maxClosure = 0;
    const stepMs = 1000 / 60;
    for (let t = 0; t <= 30000; t += stepMs) {
      updateGeneratedHumanoidAnimations(ctx, 1 / 60, t, camera);
      const inf = face.morphTargetInfluences!;
      maxClosure = Math.max(maxClosure, inf[dict["eye-left-closure"]!]!, inf[dict["eye-right-closure"]!]!);
      maxLeftSlit = Math.max(maxLeftSlit, inf[dict["eye-left-slit"]!]!);
      maxRightSlit = Math.max(maxRightSlit, inf[dict["eye-right-slit"]!]!);
    }
    // closure must reach full blink, else the slit assertion is vacuous
    expect(maxClosure).toBeGreaterThan(0.9);
    expect(maxLeftSlit).toBeGreaterThan(0.9);
    expect(maxRightSlit).toBeGreaterThan(0.9);
  });

  it("COUNTERWEIGHT: with lids open the blink adds nothing above the emotion baseline", () => {
    // Neutral cheek_tension drives AU7 slit at 0.08 * 0.85 = 0.068 through the emotion path;
    // the blink must add nothing on top of that when intensity is 0.
    const { slot, face } = actor("patient");
    const ctx = context([slot]);
    const camera = new PerspectiveCamera();
    const dict = face.morphTargetDictionary!;
    const stepMs = 1000 / 60;
    let sawOpen = false;
    for (let t = 0; t <= 30000; t += stepMs) {
      updateGeneratedHumanoidAnimations(ctx, 1 / 60, t, camera);
      const inf = face.morphTargetInfluences!;
      if ((inf[dict["eye-left-closure"]!] ?? 1) < 0.001 && (inf[dict["eye-right-closure"]!] ?? 1) < 0.001) {
        sawOpen = true;
        expect(inf[dict["eye-left-slit"]!]!).toBeLessThanOrEqual(0.1);
        expect(inf[dict["eye-right-slit"]!]!).toBeLessThanOrEqual(0.1);
        break;
      }
    }
    expect(sawOpen).toBe(true);
  });
});
