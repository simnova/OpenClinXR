import { describe, expect, it } from "vitest";
import {
  updateGeneratedHumanoidAnimations,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
} from "./index.js";

// OBSERVABLE: animation-loop.ts:156 writes
//   slot.root.position.x = emotionalSway + dialogueWeightShift
// while :155 is
//   slot.root.position.y = slot.baseY + breathing * 0.018
// and the scale lines likewise COMPOSE from captured bases. position.x is the only
// component that ASSIGNS. slot.baseX is captured at
// xr-asset-loading/src/humanoid-animation.ts:119 and never read.
//
// MEASURED 2026-09-09. Latent for standing and seated because the loader zeroes the
// humanoid child at xr-asset-loading/src/generated-loaders.ts:112, so baseX is 0 today.
// It blocks any future child-local X offset, which is exactly what the authored
// plantOffsetMeters chain needs.
//
// known-good: the SUPINE branch already composes correctly. animation-loop.ts:148-153
// restores x, y, z and all three scales from the captured bases through
// holdSupinePlantFrame. The non-supine branch at :154-161 assigns. Supine is the
// known-good column for this file.
//
// SPLIT FROM the-framing-guard-keeps-seated-and-supine-anchors.test.ts in xr-scene:
// that package does not depend on @openclinxr/xr-humanoid-animation, so the clause
// could not live there. The other four clauses stayed in xr-scene.
//
// Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED below.
//
// CONTRACTED: animation-loop.ts:156 becomes
//   slot.root.position.x = slot.baseX + emotionalSway + dialogueWeightShift;
// matching :155's slot.baseY + form.
describe("The frame loop composes position.x from its base", () => {
  it.fails("(5) The frame loop composes position.x from slot.baseX", () => {
    // animation-loop.ts:156 assigns position.x = emotionalSway + dialogueWeightShift
    // It should compose from slot.baseX like position.y composes from slot.baseY at :155
    // baseX is captured at humanoid-animation.ts:119 and currently unused
    const mockCtx = {
      slots: [] as GeneratedHumanoidAnimationSlot[],
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

    const slot: GeneratedHumanoidAnimationSlot = {
      assetId: "test-asset",
      actorId: "patient-1",
      root: {
        position: { x: 0.5, y: 1.0, z: -0.2 }, // baseX = 0.5 (NONZERO)
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        userData: {
          openClinXrActorPosture: "standing",
        },
        updateMatrixWorld: vi.fn(),
      } as unknown as THREE.Group,
      actorSlot: { position: { x: 0, y: 0, z: 0 } } as unknown as THREE.Group,
      baseX: 0.5, // NONZERO baseX - the case loader's zeroing at generated-loaders.ts:112 hides today
      baseY: 1.0,
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
      emotionExpression: { weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 }, targetEmotion: "neutral", currentEmotion: "neutral", transitionStartedAtMs: 0 },
    };

    mockCtx.slots = [slot];

    // Run one frame update
    updateGeneratedHumanoidAnimations(mockCtx, 1/60, Date.now(), { position: { x: 0, y: 0, z: 5 } } as unknown as THREE.PerspectiveCamera);

    // position.x should be composed from slot.baseX (0.5) + emotionalSway + dialogueWeightShift
    // NOT just emotionalSway + dialogueWeightShift (which would lose the 0.5 anchor)
    const expectedX = slot.baseX + Math.sin((Date.now() / 1000) * 0.43) * 0.012; // emotionalSway only (not speaking)
    expect(slot.root.position.x).toBeCloseTo(expectedX, 3);
  });
});

// THREE namespace for test type assertions
declare const THREE: {
  Group: new () => { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number }; userData: Record<string, unknown>; updateMatrixWorld: (force: boolean) => void };
  Mesh: new () => { visible: boolean; scale: { set: (x: number, y: number, z: number) => void }; userData: Record<string, unknown> };
  Line: new () => { visible: boolean };
  PerspectiveCamera: new () => { position: { x: number; y: number; z: number } };
};
