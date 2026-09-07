import { describe, expect, it } from "vitest";
import {
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
import { humanoidDialogueDurationMs, isGeneratedRuntimeDrive } from "./gaze-evidence.js";
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
});
