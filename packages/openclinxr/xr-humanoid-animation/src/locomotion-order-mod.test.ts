import {
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
} from "@openclinxr/xr-humanoid-animation";
import { Group } from "three";
import { describe, expect, it, vi } from "vitest";

/**
 * Exercises `locomotion-order-mod.ts` (`stepLocomotionOrders` / `applyLocomotionOrderStanceLocks`
 * / the per-actor registry) entirely through the public entrypoint,
 * `updateGeneratedHumanoidAnimations`'s `locomotionOrders` parameter -- that module's own types
 * stay package-internal (not re-exported from any public subpath, keeping the reviewed public
 * surface unchanged for this feature), and `xr-humanoid-animation`'s testInternalImports ceiling
 * stays at its existing value rather than growing for a new direct import. See
 * `the-locomotion-drive-plays-a-clip.test.ts` for the same public-entrypoint pattern this reuses.
 *
 * A bare `Group`-based fake slot carries no real skeleton, mixer or clip, so
 * `resolveLocomotionClipTimeScale` -- the FIRST thing an order-driven actor needs -- returns null
 * and these tests can only exercise the refusal path. Real movement (the shared
 * `createCaseOwnedApproachForOrder` / `advanceCaseOwnedBedsideApproach` / `applyCaseOwnedStanceLock`
 * pipeline this module delegates to) is exercised by live browser capture, not a fake-skeleton
 * unit test -- same limitation the frozen-plan physician's own producer has.
 */

function stubContext(slots: GeneratedHumanoidAnimationSlot[]): HumanoidAnimationRuntimeContext {
  return {
    slots,
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

function fakeSlot(actorId: string, startX: number, startZ: number): GeneratedHumanoidAnimationSlot {
  const actorSlot = new Group();
  actorSlot.position.set(startX, 0, startZ);
  const root = new Group();
  return {
    assetId: "test",
    actorId,
    root,
    actorSlot,
    baseY: 0,
    baseX: startX,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    baseZ: startZ,
    phaseOffsetMs: 0,
    mouthCue: { visible: false, scale: { set: vi.fn() }, userData: {} },
    gazeCue: { visible: false },
    eyeFocusCue: { visible: false },
    expressionCue: { visible: false, scale: { set: vi.fn() }, position: { set: vi.fn() } },
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
  } as unknown as GeneratedHumanoidAnimationSlot;
}

const CAMERA = { position: { x: 0, y: 0, z: 5 } } as unknown as Parameters<typeof updateGeneratedHumanoidAnimations>[3];

describe("locomotionOrders (updateGeneratedHumanoidAnimations)", () => {
  it("refuses an order for an actor whose clip speed cannot be measured (no bound clip on the fake slot), without throwing", () => {
    const slot = fakeSlot("nurse", 0, 0);
    const ctx = stubContext([slot]);
    const orders = new Map([["nurse", { target: { x: 1, z: 0 } }]]);
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 0, CAMERA, null, orders)).not.toThrow();
    // The actor's own position is untouched by a refused order.
    expect(slot.actorSlot.position.x).toBe(0);
    expect(slot.actorSlot.position.z).toBe(0);
    // A second frame does not retry-crash either (the registry records the refusal internally).
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 1000, CAMERA, null, orders)).not.toThrow();
    expect(slot.actorSlot.position.x).toBe(0);
  });

  it("ignores an order for an actor with no loaded slot", () => {
    const ctx = stubContext([]);
    const orders = new Map([["nobody", { target: { x: 1, z: 0 } }]]);
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 0, CAMERA, null, orders)).not.toThrow();
  });

  it("does not move an actor with no authored order", () => {
    const slot = fakeSlot("bystander", 3, 4);
    const ctx = stubContext([slot]);
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 0, CAMERA, null, new Map())).not.toThrow();
    expect(slot.actorSlot.position.x).toBe(3);
    expect(slot.actorSlot.position.z).toBe(4);
  });

  it("a null locomotionOrders map behaves exactly like the pre-existing single-drive call (no regression)", () => {
    const slot = fakeSlot("bystander", 1, 2);
    const ctx = stubContext([slot]);
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 0, CAMERA, null, null)).not.toThrow();
    expect(slot.actorSlot.position.x).toBe(1);
  });
});
