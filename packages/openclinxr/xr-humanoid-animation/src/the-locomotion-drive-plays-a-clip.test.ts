import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  updateGeneratedHumanoidAnimations,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
} from "./index.js";

/**
 * The locomotion drive slid the root and animated nothing.
 *
 * `animation-loop.ts` wrote `slot.root.position.z = slot.baseZ + locomotion * 0.6` whenever the
 * drive asked for locomotion. That is the ~100% foot slide the approach executor's own metric
 * reports on itself: no leg is animated, so every planted foot travels the whole distance.
 *
 * Since 2026-09-09 an actor may carry a retargeted locomotion take
 * (`openclinxr_retarget_cmu_02_01_walk`, grafted into the shipped physician). When it does, the
 * drive plays that clip and the clip CLAIMS the leg chain through `openClinXrOwnedBoneChains`, the
 * existing seam that stops the posture pass rewriting those bones every frame.
 *
 * An actor with no locomotion clip must keep the old behaviour exactly. That is clause (3), and
 * without it this change would silently freeze every peds actor the drive moves today.
 */

  function stubContext() {
  return {
    slots: [] as GeneratedHumanoidAnimationSlot[],
    activeVirtualDeviceSpeechByActorId: [],
    runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    runtimePatientActorId: () => "patient-1",
    runtimeFamilyActorId: () => "family-1",
    runtimeClinicalTeamActorId: () => "clinical-1",
    applyIdlePosture: vi.fn(),
    applyRolePosture: vi.fn(),
    seatedClipPerforming: () => false,
    recordActingCueEvidence: vi.fn(),
    scenarioIdForEvidence: () => "generic",
    bundleTurnsForScenario: () => [],
    runtimeTurnForTraceTag: () => undefined,
    liveTurnForCue: () => undefined,
    normalizeLiveEmotion: (e: string) => e,
    currentSpeechEvidence: () => undefined,
    assetPathForSlot: () => "/test.glb",
    isMouthGazePoseReviewCaptureMode: () => false,
    selectedHumanoidSourceComparator: () => "generic",
    writeComparatorEvidenceRecord: vi.fn(),
    shouldUseCleanHumanoidSourceComparatorCapture: () => false,
    dialogueText: () => ({ line: "", initial: "" }),
    visemeUtterance: () => "",
    triggerDialogue: vi.fn(),
    schedulePedsPlaybackIfReady: vi.fn(),
    recordBootPhase: vi.fn(),
    animationSlots: () => [],
    pushAnimationSlot: vi.fn(),
    setAnimationSlotByActor: vi.fn(),
    setActorSlotByActor: vi.fn(),
    clinicalTouchScenario: () => undefined,
    registerTouchRegions: vi.fn(),
    createEmotionState: () => ({ weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 }, targetEmotion: "neutral", currentEmotion: "neutral", transitionStartedAtMs: 0 }),
    translationBoneNames: () => [],
    seatedClipPlayable: () => false,
    seatedChairHeight: () => 0.45,
    plantSeatedPelvis: () => ({ deltaY: 0, pelvisBefore: { x: 0, y: 0, z: 0 } }),
    findStretcherInScene: () => null,
    stretcherDeckTopWorldY: () => 0.8,
    applyAndPlantSupineDeck: vi.fn(),
    applyPosture: vi.fn(),
  } as unknown as HumanoidAnimationRuntimeContext;
}

const WALK = new THREE.AnimationClip("openclinxr_retarget_cmu_02_01_walk", 2.87, []);

function standingSlot(overrides: Partial<GeneratedHumanoidAnimationSlot> = {}): GeneratedHumanoidAnimationSlot {
  const root = new THREE.Group();
  root.position.set(0, 1, -0.2);
  root.userData["openClinXrActorPosture"] = "standing";
  return {
    assetId: "mpfb-clinical-physician-adult",
    actorId: "senior_resident_ward_v1",
    root,
    actorSlot: new THREE.Group(),
    baseX: 0,
    baseY: 1,
    baseZ: -0.2,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
    mouthCue: { visible: false, scale: { set: vi.fn() }, userData: {} } as unknown as THREE.Mesh,
    gazeCue: { visible: false } as unknown as THREE.Line,
    eyeFocusCue: { visible: false } as unknown as THREE.Group,
    expressionCue: { visible: false, scale: { set: vi.fn() }, position: { set: vi.fn() } } as unknown as THREE.Group,
    sourceComparatorFreezeEnabled: false,
    responseClips: [],
    emotionExpression: {
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetEmotion: "neutral",
      currentEmotion: "neutral",
      transitionStartedAtMs: 0,
      transitionDurationMs: 0,
    },
    ...overrides,
  };
}

function runFrame(slot: GeneratedHumanoidAnimationSlot, locomotion: number | null): void {
  const ctx = stubContext();
  (ctx as unknown as { slots: GeneratedHumanoidAnimationSlot[] }).slots = [slot];
  updateGeneratedHumanoidAnimations(
    ctx,
    1 / 60,
    1_000,
    { position: { x: 0, y: 0, z: 5 } } as unknown as THREE.PerspectiveCamera,
    locomotion === null ? null : { locomotion },
  );
}

describe("the locomotion drive plays a retargeted clip instead of sliding the root", () => {
  it("(1) an actor WITH a locomotion clip plays it and claims the leg chain", () => {
    const slot = standingSlot({
      locomotionClipName: WALK.name,
      responseClips: [WALK],
      mixer: new THREE.AnimationMixer(new THREE.Group()),
    });
    runFrame(slot, 1);
    const playback = slot.root.userData["openClinXrLocomotionClipPlayback"] as {
      clipName: string;
      playing: boolean;
    };
    expect(playback.clipName).toBe(WALK.name);
    expect(playback.playing).toBe(true);
    expect(slot.mixer?.existingAction(WALK)?.isRunning()).toBe(true);
    // The chains must be claimed, or applyIdlePosture rewrites the legs and the walk is invisible.
    expect(slot.root.userData["openClinXrOwnedBoneChains"]).toContain("foot");
    // And the root must NOT have been slid: that is the behaviour this replaces.
    expect(slot.root.position.z).toBeCloseTo(slot.baseZ, 6);
  });

  it("(2) a zero drive STOPS the clip and releases the chain, so the actor is not left mid-stride", () => {
    const slot = standingSlot({
      locomotionClipName: WALK.name,
      responseClips: [WALK],
      mixer: new THREE.AnimationMixer(new THREE.Group()),
    });
    runFrame(slot, 1);
    runFrame(slot, 0);
    const playback = slot.root.userData["openClinXrLocomotionClipPlayback"] as { playing: boolean };
    expect(playback.playing).toBe(false);
    expect(slot.mixer?.existingAction(WALK)?.isRunning()).toBe(false);
    expect(slot.root.userData["openClinXrOwnedBoneChains"]).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: an actor with NO locomotion clip still slides, exactly as before", () => {
    // Every peds actor the drive moves today has no such clip. If this clause failed, the change
    // would have frozen them while clauses (1) and (2) stayed green.
    const slot = standingSlot();
    runFrame(slot, 1);
    expect(slot.root.position.z).toBeCloseTo(slot.baseZ + 0.6, 6);
    expect(slot.root.userData["openClinXrLocomotionClipPlayback"]).toBeUndefined();
  });

  it("(4) a named clip that is not among the actor's clips falls back to sliding rather than freezing", () => {
    const slot = standingSlot({
      locomotionClipName: "openclinxr_retarget_absent",
      responseClips: [WALK],
      mixer: new THREE.AnimationMixer(new THREE.Group()),
    });
    runFrame(slot, 1);
    expect(slot.root.position.z).toBeCloseTo(slot.baseZ + 0.6, 6);
  });
});
