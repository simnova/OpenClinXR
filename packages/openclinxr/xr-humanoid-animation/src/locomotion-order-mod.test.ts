import {
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
  updateGeneratedHumanoidAnimations,
} from "@openclinxr/xr-humanoid-animation";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/** A floor slab `observeMountedApproachGeometry` recognises: an `environmentId` plus a policy
 * string containing "floor". Real `BoxGeometry` so `Box3().setFromObject` reads a real extent. */
function floorSlab(): Mesh {
  const floor = new Mesh(new BoxGeometry(20, 0.1, 20), new MeshBasicMaterial());
  floor.position.set(0, -0.05, 0);
  floor.userData = { environmentId: "test_env", openClinXrSceneNecessityPolicy: "floor" };
  return floor;
}

/** One obstacle `observeMountedApproachGeometry` picks up: a fixture slot under the environment. */
function obstacleBox(id: string, centerX: number, centerZ: number, sizeX: number, sizeZ: number): Mesh {
  const box = new Mesh(new BoxGeometry(sizeX, 1.2, sizeZ), new MeshBasicMaterial());
  box.position.set(centerX, 0.6, centerZ);
  box.userData = { fixtureSlotId: id };
  return box;
}

function sceneWithObstacles(obstacles: Mesh[]): Group {
  const root = new Group();
  root.userData = { environmentId: "test_env" };
  root.add(floorSlab());
  for (const obstacle of obstacles) root.add(obstacle);
  root.updateMatrixWorld(true);
  return root;
}

type Refusals = Record<string, string>;
type EvidenceHost = { __openClinXrLocomotionOrderEvidenceEnabled?: boolean; __openClinXrLocomotionOrderRefusals?: Refusals };

function evidenceHost(): EvidenceHost {
  return globalThis as unknown as EvidenceHost;
}

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

describe("locomotionOrders obstacle validation (2026-09-26: orders must never walk through fixtures)", () => {
  afterEach(() => {
    delete evidenceHost().__openClinXrLocomotionOrderEvidenceEnabled;
    delete evidenceHost().__openClinXrLocomotionOrderRefusals;
  });

  it("refuses with a named reason when the target is fully enclosed and no straight or routed path exists", () => {
    evidenceHost().__openClinXrLocomotionOrderEvidenceEnabled = true;
    // A closed ring of obstacles around (5, 5): north/south each span the FULL outer width and
    // east/west each span the FULL outer height, so every corner is doubly covered -- no diagonal
    // gap at a corner the way two same-length perpendicular strips would leave. The target sits in
    // a sealed room with no doorway.
    const ring = [
      obstacleBox("wall_n", 5, 6.0, 2.6, 0.6),
      obstacleBox("wall_s", 5, 4.0, 2.6, 0.6),
      obstacleBox("wall_e", 6.0, 5, 0.6, 2.6),
      obstacleBox("wall_w", 4.0, 5, 0.6, 2.6),
    ];
    const scene = sceneWithObstacles(ring);
    const slot = fakeSlot("boxed_in_actor", 0, 0);
    const ctx = stubContext([slot]);
    const orders = new Map([["boxed_in_actor", { target: { x: 5, z: 5 } }]]);
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 0, CAMERA, null, orders, scene)).not.toThrow();
    const reason = evidenceHost().__openClinXrLocomotionOrderRefusals?.["boxed_in_actor"];
    expect(reason).toBeDefined();
    expect(reason).toContain("no clear path");
    expect(reason).toContain("4 observed obstacle(s)");
    // A refused order never moves the actor.
    expect(slot.actorSlot.position.x).toBe(0);
    expect(slot.actorSlot.position.z).toBe(0);
  });

  it("does NOT report a no-path refusal when a routed detour exists around a single mid-route obstacle", () => {
    evidenceHost().__openClinXrLocomotionOrderEvidenceEnabled = true;
    // One obstacle square in the middle of the straight line from (0,0) to (3,0), with clear room
    // to route around it on either side -- a detour exists.
    const obstacle = obstacleBox("cart_mid_route", 1.5, 0, 0.6, 0.6);
    const scene = sceneWithObstacles([obstacle]);
    const slot = fakeSlot("detour_actor", 0, 0);
    const ctx = stubContext([slot]);
    const orders = new Map([["detour_actor", { target: { x: 3, z: 0 } }]]);
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 0, CAMERA, null, orders, scene)).not.toThrow();
    // The fake slot has no bound clip, so leg construction itself never runs (and never publishes
    // a refusal) -- what this test guards is that the NO-PATH reason specifically was never
    // published, because a detour around this single obstacle does exist.
    const reason = evidenceHost().__openClinXrLocomotionOrderRefusals?.["detour_actor"] ?? "";
    expect(reason).not.toContain("no clear path");
  });

  it("does NOT publish a no-path refusal for a straight route with no obstacles at all (unchanged behaviour)", () => {
    evidenceHost().__openClinXrLocomotionOrderEvidenceEnabled = true;
    const scene = sceneWithObstacles([]);
    const slot = fakeSlot("clear_route_actor", 0, 0);
    const ctx = stubContext([slot]);
    const orders = new Map([["clear_route_actor", { target: { x: 3, z: 0 } }]]);
    expect(() => updateGeneratedHumanoidAnimations(ctx, 1 / 30, 0, CAMERA, null, orders, scene)).not.toThrow();
    expect(evidenceHost().__openClinXrLocomotionOrderRefusals?.["clear_route_actor"]).toBeUndefined();
  });
});
