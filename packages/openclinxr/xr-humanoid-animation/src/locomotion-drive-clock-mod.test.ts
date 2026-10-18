import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  updateGeneratedHumanoidAnimations,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
} from "./index.js";

/**
 * Entry-anchored idle-life phase for driven slots (walk-start slice), exercised
 * entirely through the public entrypoint `updateGeneratedHumanoidAnimations` --
 * `locomotion-drive-clock-mod.ts` stays package-internal (not re-exported from
 * any public subpath, keeping the reviewed public surface unchanged for this
 * feature), and `xr-humanoid-animation`'s testInternalImports ceiling stays at
 * its existing value rather than growing for a new direct import. Same
 * public-entrypoint pattern as `locomotion-order-mod.test.ts` (which reuses
 * `the-locomotion-drive-plays-a-clip.test.ts`).
 *
 * A driven slot's idle-life phase (breathing, sway, lean) runs on drive age
 * from the first driven frame plus a stable actorId-hash stagger -- never on
 * wall/sim `nowMs` (whose anchor is load timing) and never on creation-order
 * `phaseOffsetMs` (whose order is GLB-completion timing). Undriven slots and
 * the deterministic capture clock keep the legacy `nowMs` path exactly. The
 * phase `t` is observed through the frame loop's own composition for a
 * standing, non-speaking, non-peds actor:
 *   rotation.z = sin(t*0.72)*0.012 + sin(t*0.43)*0.012
 *   scale.y    = baseScaleY + sin(t*1.15)*0.012
 * (animation-loop.ts, non-supine branch; dialogueWeightShift is 0 while
 * silent and the peds overlay is 0 outside a peds scenario.)
 */

const ACTOR = "senior_resident_ward_v1";
const PHASE_OFFSET_MS = 960;
const DRIVE = { locomotion: 1 };

function legacyRotationZ(nowMs: number, phaseOffsetMs: number): number {
  const t = (nowMs + phaseOffsetMs) / 1000;
  return Math.sin(t * 0.72) * 0.012 + Math.sin(t * 0.43) * 0.012;
}

function makeCtx(slots: GeneratedHumanoidAnimationSlot[], deterministic: boolean): HumanoidAnimationRuntimeContext {
  return {
    slots,
    activeVirtualDeviceSpeechByActorId: [],
    runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    runtimePatientActorId: () => "patient-1",
    runtimeFamilyActorId: () => "family-1",
    runtimeClinicalTeamActorId: () => "clinical-1",
    applyIdlePosture: () => {},
    applyRolePosture: () => {},
    seatedClipPerforming: () => false,
    recordActingCueEvidence: () => {},
    scenarioIdForEvidence: () => "generic",
    bundleTurnsForScenario: () => [],
    runtimeTurnForTraceTag: () => undefined,
    liveTurnForCue: () => undefined,
    normalizeLiveEmotion: (e: string) => e,
    currentSpeechEvidence: () => undefined,
    assetPathForSlot: () => "/test.glb",
    isMouthGazePoseReviewCaptureMode: () => false,
    selectedHumanoidSourceComparator: () => "generic",
    writeComparatorEvidenceRecord: () => {},
    shouldUseCleanHumanoidSourceComparatorCapture: () => false,
    dialogueText: () => ({ line: "", initial: "" }),
    visemeUtterance: () => "",
    isDeterministicCaptureClock: () => deterministic,
    triggerDialogue: () => {},
    schedulePedsPlaybackIfReady: () => {},
    recordBootPhase: () => {},
    animationSlots: () => [],
    pushAnimationSlot: () => {},
    setAnimationSlotByActor: () => {},
    setActorSlotByActor: () => {},
    clinicalTouchScenario: () => undefined,
    registerTouchRegions: () => {},
    createEmotionState: () => ({
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetEmotion: "neutral",
      currentEmotion: "neutral",
      transitionStartedAtMs: 0,
    }),
    translationBoneNames: () => [],
    seatedClipPlayable: () => false,
    seatedChairHeight: () => 0.45,
    plantSeatedPelvis: () => ({ deltaY: 0, pelvisBefore: { x: 0, y: 0, z: 0 } }),
    findStretcherInScene: () => null,
    stretcherDeckTopWorldY: () => 0.8,
    applyAndPlantSupineDeck: () => {},
    applyPosture: () => {},
  } as unknown as HumanoidAnimationRuntimeContext;
}

function makeSlot(actorId: string, phaseOffsetMs: number): GeneratedHumanoidAnimationSlot {
  const root = new THREE.Group();
  root.userData["openClinXrActorPosture"] = "standing";
  return {
    assetId: "test-asset",
    actorId,
    root,
    actorSlot: new THREE.Group(),
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs,
    mouthCue: { visible: false, scale: { set: () => {} }, userData: {} } as unknown as THREE.Mesh,
    gazeCue: { visible: false } as unknown as THREE.Line,
    eyeFocusCue: { visible: false } as unknown as THREE.Group,
    expressionCue: { visible: false, scale: { set: () => {} }, position: { set: () => {} } } as unknown as THREE.Group,
    sourceComparatorFreezeEnabled: false,
    responseClips: [],
    emotionExpression: {
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetEmotion: "neutral",
      currentEmotion: "neutral",
      transitionStartedAtMs: 0,
      targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      transitionDurationMs: 0,
    },
  } as unknown as GeneratedHumanoidAnimationSlot;
}

const CAMERA = { position: { x: 0, y: 1.6, z: 3 } } as unknown as THREE.PerspectiveCamera;

describe("locomotion drive clock (updateGeneratedHumanoidAnimations)", () => {
  it("phases a driven slot on drive age, never on wall nowMs", () => {
    // Two independent first-driven frames for the same actor: the wall anchor
    // differs by ~1.7e12 ms (load timing) and the creation-order stagger is
    // identical, yet the composed sway must be identical -- the wall never
    // enters and the stagger is the stable actor hash, not phaseOffsetMs.
    const slotA = makeSlot(ACTOR, PHASE_OFFSET_MS);
    const ctxA = makeCtx([slotA], false);
    updateGeneratedHumanoidAnimations(ctxA, 1 / 60, 1_700_000_000_000, CAMERA, DRIVE);
    const slotB = makeSlot(ACTOR, PHASE_OFFSET_MS);
    const ctxB = makeCtx([slotB], false);
    updateGeneratedHumanoidAnimations(ctxB, 1 / 60, 2000, CAMERA, DRIVE);
    expect(slotB.root.rotation.z).toBeCloseTo(slotA.root.rotation.z, 12);
    expect(slotB.root.scale.y).toBeCloseTo(slotA.root.scale.y, 12);
    // Sanity: the legacy wall path WOULD have differed here, so the equality
    // above is the drive-age clock doing work, not a constant pose.
    expect(legacyRotationZ(1_700_000_000_000, PHASE_OFFSET_MS)).not.toBeCloseTo(
      legacyRotationZ(2000, PHASE_OFFSET_MS),
      3,
    );
  });

  it("advances the driven phase each frame and resets the age when the drive lapses", () => {
    const slot = makeSlot(ACTOR, PHASE_OFFSET_MS);
    const ctx = makeCtx([slot], false);
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1_700_000_000_000, CAMERA, DRIVE);
    const first = slot.root.rotation.z;
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 1_700_000_000_000, CAMERA, DRIVE);
    const second = slot.root.rotation.z;
    // One driven 1/60 s substep of age: the pose must move (the clock runs).
    expect(Math.abs(second - first)).toBeGreaterThan(1e-6);
    // Lapse: undriven falls back to the legacy nowMs path exactly.
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 5000, CAMERA, null);
    expect(slot.root.rotation.z).toBeCloseTo(legacyRotationZ(5000, PHASE_OFFSET_MS), 10);
    // Restart: the age restarts from the first driven frame, matching a fresh
    // slot's first driven pose exactly (no leaked age across the lapse).
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 5000, CAMERA, DRIVE);
    const restarted = slot.root.rotation.z;
    const fresh = makeSlot(ACTOR, PHASE_OFFSET_MS);
    updateGeneratedHumanoidAnimations(makeCtx([fresh], false), 1 / 60, 9000, CAMERA, DRIVE);
    expect(restarted).toBeCloseTo(fresh.root.rotation.z, 12);
    expect(restarted).not.toBeCloseTo(legacyRotationZ(5000, PHASE_OFFSET_MS), 3);
  });

  it("keeps the legacy nowMs path under the deterministic capture clock even when driven", () => {
    const slot = makeSlot(ACTOR, PHASE_OFFSET_MS);
    const ctx = makeCtx([slot], true);
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 2000, CAMERA, DRIVE);
    expect(slot.root.rotation.z).toBeCloseTo(legacyRotationZ(2000, PHASE_OFFSET_MS), 10);
    // A second driven frame at the same wall instant does not advance: the
    // deterministic clock holds the legacy path, so the pose is at rest.
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 2000, CAMERA, DRIVE);
    expect(slot.root.rotation.z).toBeCloseTo(legacyRotationZ(2000, PHASE_OFFSET_MS), 10);
  });

  it("ignores a drive addressed to another actor", () => {
    const slot = makeSlot(ACTOR, PHASE_OFFSET_MS);
    const ctx = makeCtx([slot], false);
    updateGeneratedHumanoidAnimations(ctx, 1 / 60, 2000, CAMERA, { actorId: "someone_else", locomotion: 1 });
    expect(slot.root.rotation.z).toBeCloseTo(legacyRotationZ(2000, PHASE_OFFSET_MS), 10);
  });
});
