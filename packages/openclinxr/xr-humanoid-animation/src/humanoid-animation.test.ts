import { describe, expect, it } from "vitest";
import { Bone, Group, PerspectiveCamera, Quaternion, Vector3 } from "three";
import {
  applyHumanoidFaceRigControls,
  clampDialogueFacingYaw,
  computeAffectRampIntensity,
  computeHumanoidEyeMotionMetrics,
  createHumanoidEmotionExpressionState,
  lerpHumanoidAnimation,
  normalizeHumanoidAnimationAngle,
  roundHumanoidExpressionWeights,
  startHumanoidEmotionTransition,
  visemeOpenness,
} from "./face-rig.js";
import { humanoidDialogueDurationMs, isGeneratedRuntimeDrive } from "./index.js";
import { pediatricAsthmaActingOverlayForSlot } from "./animation-loop.js";

function emptyCtx() {
  return {
    slots: [],
    slotsByActorId: new Map(),
    actorSlotsByActorId: new Map(),
    virtualDeviceSlotsByActorId: new Map(),
    activeVirtualDeviceSpeechByActorId: new Map(),
    runtimePatientActorId: () => "patient",
    runtimeFamilyActorId: () => "family",
    runtimeClinicalTeamActorId: () => "team",
    runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    shouldUseCleanHumanoidSourceComparatorCapture: () => false,
    humanoidDialogueDurationMs: () => 0,
    applyIdlePosture: () => {},
    applyRolePosture: () => {},
    seatedClipPerforming: () => false,
    resolveGazeTargetWorld: () => { throw new Error("unused"); },
    normalizeLiveEmotion: (_emotion: string) => "neutral" as const,
    liveTurnForCue: () => undefined,
    bundleTurnsForScenario: () => [],
    runtimeTurnForTraceTag: () => undefined,
    isDeterministicCaptureClock: () => true,
    isMouthGazePoseReviewCaptureMode: () => false,
    selectedCaptureMode: () => "",
    selectedHumanoidSourceComparator: () => null,
    scenarioIdForEvidence: () => "peds_asthma_parent_anxiety_v1",
    comparatorScenarioId: () => "peds_asthma_parent_anxiety_v1",
    assetPathForSlot: () => "",
    animationPlaybackForSlot: () => undefined,
    morphTargetAppliedTargetCount: () => 0,
    visemeTimelineComparatorEvidencePresent: () => false,
    emotionTransitionCuePresent: () => false,
    currentSpeechEvidence: () => undefined,
    recordActingCueEvidence: () => {},
  };
}

/** MPFB eye bones point along local +Y, the gaze axis. */
function eyeForward(bone: Bone): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion())).normalize();
}

function eyeSignedAngle(from: Vector3, to: Vector3, axis: Vector3): number {
  const a = from.clone().addScaledVector(axis, -from.dot(axis)).normalize();
  const b = to.clone().addScaledVector(axis, -to.dot(axis)).normalize();
  return Math.atan2(axis.dot(a.clone().cross(b)), a.dot(b));
}

describe("xr-humanoid-animation math helpers", () => {
  it("lerps with clamped alpha", () => {
    expect(lerpHumanoidAnimation(0, 10, 0.5)).toBe(5);
    expect(lerpHumanoidAnimation(0, 10, 2)).toBe(10);
  });

  it("normalizes angles and clamps facing yaw", () => {
    expect(normalizeHumanoidAnimationAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 5);
    expect(clampDialogueFacingYaw(2)).toBe(0.42);
    expect(clampDialogueFacingYaw(-2)).toBe(-0.42);
  });

  it("maps visemes to openness with a rest fallback", () => {
    expect(visemeOpenness("open")).toBe(0.78);
    expect(visemeOpenness("unknown-viseme")).toBe(0.35);
  });

  it("ramps affect intensity along onset/transition/decay", () => {
    const timeline = { intensity: 1, onsetMs: 100, transitionMs: 100, decayMs: 100 };
    expect(computeAffectRampIntensity(50, 1000, timeline)).toBe(0);
    expect(computeAffectRampIntensity(150, 1000, timeline)).toBeCloseTo(0.5, 5);
    expect(computeAffectRampIntensity(500, 1000, timeline)).toBe(1);
    expect(computeAffectRampIntensity(50, 1000, null)).toBe(0);
  });

  it("computes deterministic eye motion for a speech start", () => {
    const speech = {
      actorId: "a",
      assetId: "asset",
      gazeTargetKind: "learner_camera" as const,
      gazeTargetActorId: null,
      text: "hello",
      emotion: "neutral" as const,
      emotionContext: { emotion: "neutral" as const, source: "plan_missing" as const, baselineMood: [], cueIds: [] },
      phonemeSequence: ["HH"],
      visemeSequence: ["open"],
      startedAtMs: 1000,
      durationMs: 2000,
    };
    const metrics = computeHumanoidEyeMotionMetrics(speech, 1000);
    expect(metrics.blinkIntensity).toBe(0);
    expect(Number.isFinite(metrics.microSaccadeYaw)).toBe(true);
  });

  it("creates a neutral emotion state and transitions target", () => {
    const state = createHumanoidEmotionExpressionState({ deterministicClock: true });
    expect(state.transitionStartedAtMs).toBe(0);
    expect(state.targetEmotion).toBe("neutral");
    const slot = { emotionExpression: state } as Parameters<typeof startHumanoidEmotionTransition>[0];
    startHumanoidEmotionTransition(slot, "anxious", 10);
    expect(slot.emotionExpression.targetEmotion).toBe("anxious");
    expect(slot.emotionExpression.transitionDurationMs).toBe(650);
    expect(roundHumanoidExpressionWeights(slot.emotionExpression.weights).mouthOpen).toBeGreaterThanOrEqual(0);
  });

  it("sizes dialogue duration with a review-capture floor", () => {
    expect(humanoidDialogueDurationMs(10, false)).toBe(900);
    expect(humanoidDialogueDurationMs(100, true)).toBe(45_000);
  });

  it("guards drive shape and returns a non-peds overlay outside the peds scenario", () => {
    expect(isGeneratedRuntimeDrive({})).toBe(true);
    expect(isGeneratedRuntimeDrive(null)).toBe(false);
    const overlay = pediatricAsthmaActingOverlayForSlot(
      emptyCtx(),
      { actorId: "patient" } as Parameters<typeof pediatricAsthmaActingOverlayForSlot>[1],
      0,
      false,
    );
    expect(overlay.cueIds).toEqual([]);
  });

  it("drives MPFB eye bones absolutely across 200 schedule frames", () => {
    const root = new Group();
    const head = new Bone(); head.name = "head";
    // MPFB eye parents are rotated ~168 deg about X (world quaternion of eyeL's parent on
    // mpfb-ob-patient-aisha); an unrotated parent hid a flipped yaw sign.
    head.quaternion.set(0.978, 0.032, -0.155, 0.133).normalize();
    const left = new Bone(); left.name = "eyeL"; left.rotation.set(-1.4, 0, 0.41);
    const right = new Bone(); right.name = "eyeR"; right.rotation.set(0, 0, -0.37);
    head.add(left, right); root.add(head); root.updateMatrixWorld(true);
    const restQuaternion = left.quaternion.clone();
    const restForward = eyeForward(left);
    const headRight = new Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new Quaternion())).normalize();
    const slot = {
      actorId: "patient", assetId: "mpfb-test", root, actorSlot: new Group(),
      emotionExpression: createHumanoidEmotionExpressionState({ deterministicClock: true }),
    } as unknown as Parameters<typeof applyHumanoidFaceRigControls>[0];
    const speech = {
      actorId: "patient", assetId: "mpfb-test", gazeTargetKind: "learner_camera",
      gazeTargetActorId: null, text: "test", emotion: "neutral",
      emotionContext: { emotion: "neutral", source: "plan_missing", baselineMood: [], cueIds: [] },
      phonemeSequence: [], visemeSequence: [], startedAtMs: 0, durationMs: 10_000,
    } as Parameters<typeof applyHumanoidFaceRigControls>[3];
    const drive = (yaw: number, pitch: number): void => applyHumanoidFaceRigControls(
      slot, 0, "rest", speech, new PerspectiveCamera(),
      { blinkIntensity: 0, microSaccadeYaw: yaw, microSaccadePitch: pitch },
      { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      () => new Vector3(0, 1.57, -0.71), () => {},
    );
    for (let frame = 0; frame < 200; frame++) {
      const elapsedMs = frame * (1000 / 60);
      const eye = computeHumanoidEyeMotionMetrics(speech, elapsedMs, "talking", elapsedMs);
      drive(eye.microSaccadeYaw, eye.microSaccadePitch);
      const current = eyeForward(left);
      const yaw = eyeSignedAngle(restForward, current, new Vector3(0, 1, 0));
      const yawedRest = restForward.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw);
      // 2 decimals: head right is not exactly perpendicular to world up on the tilted head, so
      // yaw and pitch couple by ~2% of a ~0.02 rad drive. A flipped sign misses by 2x the drive.
      expect(yaw).toBeCloseTo(eye.microSaccadeYaw, 2);
      expect(eyeSignedAngle(yawedRest, current, headRight))
        .toBeCloseTo(eye.microSaccadePitch, 2);
    }
    drive(0, 0);
    expect(left.quaternion.angleTo(restQuaternion)).toBeLessThan(1e-6);
  });

  it("keeps the legacy gaze-control path", () => {
    const root = new Group();
    const left = new Group(); left.name = "openclinxr_left_eye_gaze_control";
    const right = new Group(); right.name = "openclinxr_right_eye_gaze_control";
    root.add(left, right);
    const slot = { root } as Parameters<typeof applyHumanoidFaceRigControls>[0];
    const speech = { emotion: "neutral" } as Parameters<typeof applyHumanoidFaceRigControls>[3];
    applyHumanoidFaceRigControls(
      slot, 0, "rest", speech, new PerspectiveCamera(),
      { blinkIntensity: 0, microSaccadeYaw: 0.12, microSaccadePitch: -0.04 },
      { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      () => new Vector3(0, 1.57, -0.71), () => {},
    );
    expect([left.rotation.y, left.rotation.x]).toEqual([0.12, -0.04]);
    expect(right.rotation.y).toBeCloseTo(0.108, 6);
    expect(right.rotation.x).toBeCloseTo(-0.0368, 6);
  });
});
