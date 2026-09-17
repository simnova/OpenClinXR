import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  updateGeneratedHumanoidAnimations,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
} from "./index.js";

/**
 * DIAGNOSIS (immutable). `animation-loop.ts`'s standing/idle branch wrote:
 *
 *   slot.root.position.x = slot.baseX + emotionalSway + dialogueWeightShift;
 *
 * where `emotionalSway = sin(t * 0.43) * 0.012` and, while speaking,
 * `dialogueWeightShift = sin(t * 3.1) * 0.008`. `slot.root` is the humanoid's own group, and its
 * local origin sits at the character's OWN FEET — the same invariant the Y-axis fix beside this one
 * documents ("expands the body about the group origin at the feet, so the chest rises and the toes
 * stay"). A direct ASSIGNMENT to `position.x` is a rigid horizontal translation of that whole group,
 * feet included, and nothing downstream corrects it: `applySettledPostureCorrection`
 * (stance-lock-mod.ts) only lifts a submerged toe's Y by rotating the hip/knee; it never reads or
 * restores toe X/Z. The toe bone's own LOCAL transform never changes and the CASE-OWNED APPROACH's
 * outer `actorSlot` (one level further out, planted by the approach executor) never moves either —
 * the drift enters exactly one level in, on `slot.root`, which is also
 * `case-owned-approach-runtime-mod.ts`'s `humanoidRoot`.
 *
 * Measured here on the shipped physician's own rest-frame toe offset relative to `slot.root`
 * (0.096, 0.016, 0.035 — SC-05's decoded value, `runtime-approach-measurement.ts` docstring) over 30
 * simulated seconds of a standing, non-speaking actor: worst single-frame world XZ step exceeded the
 * 0.005 m perceptual floor (`measurement-rubric.ts:65`) and the toe's peak displacement from its rest
 * position reached the same order of magnitude as the reported "the patient's foot still moves
 * against the surface supporting it — 0.01604 m at peak and 0.00954 m once settled" defect
 * (docs/progress.html, entries 99-101; cause recorded there as undetermined).
 *
 * claimScope: `slot.root` position/rotation composition for a standing, non-speaking actor over a
 * deterministic simulated clock, and the resulting toe world XZ displacement.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance, speaking actors, seated or
 * supine postures, or any browser-observed capture.
 *
 * ## FIXED
 * The sway now composes into `rotation.z` (a lean about the root's own near-floor origin) instead of
 * `position.x` (a rigid translation). Diagnosis header kept; do not rewrite the numbers above.
 */

const PERCEPTUAL_FLOOR_METERS = 0.005; // measurement-rubric.ts:65, duplicated across the tools/packages boundary.

function buildStandingSlotContext(): { ctx: HumanoidAnimationRuntimeContext; slot: GeneratedHumanoidAnimationSlot; toe: THREE.Object3D } {
  const mockCtx = {
    slots: [] as GeneratedHumanoidAnimationSlot[],
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

  const root = new THREE.Group();
  root.position.set(0, 0, 0); // baseX = 0: the loader zeroes the humanoid child (generated-loaders.ts:112)
  root.userData.openClinXrActorPosture = "standing";

  // SC-05's decoded rest-frame toe offset relative to slot.root (runtime-approach-measurement.ts).
  const toe = new THREE.Object3D();
  toe.name = "toe1-1.L";
  toe.position.set(0.096, 0.016, 0.035);
  root.add(toe);
  root.updateMatrixWorld(true);

  const slot: GeneratedHumanoidAnimationSlot = {
    assetId: "test-asset",
    actorId: "patient-1",
    root,
    actorSlot: new THREE.Group(),
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
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
  };
  mockCtx.slots = [slot];
  return { ctx: mockCtx, slot, toe };
}

describe("a standing actor does not slide during idle sway", () => {
  it("(1) the toe's world XZ stays within the perceptual floor of its rest position over 30 s idle", () => {
    const { ctx, slot, toe } = buildStandingSlotContext();
    const camera = { position: { x: 0, y: 1.6, z: 3 } } as unknown as THREE.PerspectiveCamera;

    // Update from ROOT down. `toe.updateMatrixWorld(true)` alone recomposes against whatever the
    // PARENT's matrixWorld already holds — three.js does not walk upward to refresh it — so it
    // silently reads a stale root transform and hides exactly the drift this test exists to catch.
    slot.root.updateMatrixWorld(true);
    const rest = new THREE.Vector3().setFromMatrixPosition(toe.matrixWorld);

    const deltaSeconds = 1 / 30;
    const durationSeconds = 30;
    const frameCount = Math.round(durationSeconds / deltaSeconds);
    let worstStepMeters = 0;
    let worstDisplacementMeters = 0;
    let previous = rest.clone();
    for (let frame = 0; frame < frameCount; frame += 1) {
      const nowMs = frame * deltaSeconds * 1000;
      updateGeneratedHumanoidAnimations(ctx, deltaSeconds, nowMs, camera);
      slot.root.updateMatrixWorld(true);
      const world = new THREE.Vector3().setFromMatrixPosition(toe.matrixWorld);
      const step = Math.hypot(world.x - previous.x, world.z - previous.z);
      if (step > worstStepMeters) worstStepMeters = step;
      const displacement = Math.hypot(world.x - rest.x, world.z - rest.z);
      if (displacement > worstDisplacementMeters) worstDisplacementMeters = displacement;
      previous = world;
    }

    expect(worstStepMeters, "worst single-frame XZ step").toBeLessThanOrEqual(PERCEPTUAL_FLOOR_METERS);
    expect(worstDisplacementMeters, "worst XZ displacement from rest").toBeLessThanOrEqual(PERCEPTUAL_FLOOR_METERS);
  });

  it("(2) COUNTERWEIGHT: the root itself still visibly sways (the idle-life cue is not simply deleted)", () => {
    const { ctx, slot } = buildStandingSlotContext();
    const camera = { position: { x: 0, y: 1.6, z: 3 } } as unknown as THREE.PerspectiveCamera;
    const rotations: number[] = [];
    for (let frame = 0; frame < 900; frame += 1) {
      updateGeneratedHumanoidAnimations(ctx, 1 / 30, frame * (1000 / 30), camera);
      rotations.push(slot.root.rotation.z);
    }
    const spread = Math.max(...rotations) - Math.min(...rotations);
    expect(spread, "rotation.z spread over 30 s").toBeGreaterThan(0.005);
  });
});
