import { boneIsOwned, type OwnedChain } from "@openclinxr/xr-pose";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
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
  // A rig with real bone NAMES, because the chain claim now resolves categories against the bones
  // this actor actually carries rather than storing the categories themselves.
  for (const bone of ["upperleg01.L", "lowerleg01.L", "foot.L", "toe1-1.L", "upperarm01.L"]) {
    const node = new THREE.Object3D();
    node.name = bone;
    root.add(node);
  }
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
    // THE CLAIM MUST BE READABLE BY ITS OWN READER. It used to be a `string[]` of chain categories
    // while `clinical-idle-posture.ts:263-265` filters for `{ownerId, boneNames}` objects, so the
    // owned set was always empty and the skip never fired — a correct-and-inert seam. Asserting
    // through `boneIsOwned` rather than on the stored shape is what makes that class fail here.
    const claimed = slot.root.userData["openClinXrOwnedBoneChains"] as OwnedChain[];
    expect(Array.isArray(claimed)).toBe(true);
    expect(boneIsOwned(claimed, "foot.L")).toBe(true);
    expect(boneIsOwned(claimed, "toe1-1.L")).toBe(true);
    // And the unowned neighbour keeps moving: an arm bone is NOT captured by the leg claim.
    expect(boneIsOwned(claimed, "upperarm01.L")).toBe(false);
    // And the root must NOT have been slid: that is the behaviour this replaces.
    expect(slot.root.position.z).toBeCloseTo(slot.baseZ, 6);
  });

  it("(2) a zero drive STOPS the clip and releases the chain, so the actor is not left mid-stride", () => {
    // A bone the clip actually drives, so "settled on the rest frame" is a POSE assertion rather
    // than a flag assertion. y goes 0.4 -> 0.9 over the clip; the rest frame is 0.4.
    const REST_Y = 0.4;
    const restBone = new THREE.Object3D();
    restBone.name = "foot.L";
    const mixerRoot = new THREE.Group();
    mixerRoot.add(restBone);
    const settleClip = new THREE.AnimationClip("openclinxr_retarget_settle_probe", 1, [
      new THREE.VectorKeyframeTrack("foot.L.position", [0, 1], [0, REST_Y, 0, 0, 0.9, 0]),
    ]);
    const slot = standingSlot({
      locomotionClipName: settleClip.name,
      responseClips: [settleClip],
      mixer: new THREE.AnimationMixer(mixerRoot),
    });
    runFrame(slot, 1);
    slot.mixer?.update(0.5);
    expect(restBone.position.y).toBeGreaterThan(REST_Y + 0.1);
    runFrame(slot, 0);
    const playback = slot.root.userData["openClinXrLocomotionClipPlayback"] as {
      playing: boolean;
      settledOn?: string;
    };
    expect(playback.playing).toBe(false);
    expect(slot.mixer?.existingAction(settleClip)?.isRunning()).toBe(false);
    expect(slot.root.userData["openClinXrOwnedBoneChains"]).toEqual([]);
    // AND THE POSE IS THE CLIP'S REST FRAME, not wherever the stride stopped. `action.stop()` alone
    // deactivates the action and leaves the bones holding the last mid-stride values: measured on
    // the shipped take, the physician stood on one leg with `toe1-1.L` 0.252 m above the floor for
    // the whole stopped observation and `signed-floor-contact` recorded zero frames on that foot.
    expect(playback.settledOn).toBe("clip_rest_frame");
    expect(restBone.position.y).toBeCloseTo(REST_Y, 6);
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
