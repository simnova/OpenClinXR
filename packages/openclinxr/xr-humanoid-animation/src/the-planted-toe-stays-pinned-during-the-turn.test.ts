import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

/**
 * DEFECT (measured on the shipped physician, `.openclinxr/evidence/foot-plant-video/
 * foot-plant-video.json` via `turn-quality-metrics.ts`): during the settling turn, the
 * labelled-planted toe sits 0.002-0.013 m off the floor yet moves 0.8-4.1 cm per frame, because the
 * walk clip's own stance phase keeps driving the leg bones through their own gait cycle in body
 * space while the slot itself does not advance — `applyClipDrivenSettlingTurn`'s Y-only lift
 * (`liftSubmergedStanceToe`, now removed) never touched XZ and could not correct this.
 *
 * FIX: `applyStanceToeXzPin` (`clip-driven-settling-turn-mod.ts`, private to this package) holds
 * each planted toe at the XZ position it had at footfall using a two-bone leg IK, blended in/out
 * over a few frames so the label flip is not a pop, and released rather than hyperextended when
 * the anchor is beyond leg reach.
 *
 * NO INTERNAL IMPORT: `clip-driven-settling-turn-mod.ts` and `locomotion-stance-labels.ts` have no
 * outside binder and are not on this package's reviewed public surface (`public-api.json`), and
 * this package's `testInternalImports` ceiling (`packages/openclinxr-verification/
 * architecture-rules/`) is already at its measured floor with no slack — the same constraint
 * `the-clip-labels-its-own-stance.test.ts` documents for the labelling predicate. This test drives
 * the one PUBLIC function that reaches the pin, `applyCaseOwnedStanceLock`
 * (`./case-owned-approach-runtime.js`), with a hand-built `approach` fixture (`as any`, same
 * pattern as that file) rather than importing the settling-turn module or the labels type.
 *
 * claimScope: the toe-XZ pin, exercised through the public settling-phase entry point.
 * notEvidenceFor: gait realism, clinical plausibility, or the yaw-pivot/footfall-bias mechanisms,
 * which this test holds inert (target heading equals the initial slot yaw throughout).
 */

function makeLegFixture(input: {
  hipY: number;
  kneeY: number;
  heelY: number;
  toeY: number;
  /**
   * A perfectly collinear hip/knee/heel chain sits at EXACTLY 100% of thigh+shin extension at
   * rest (rotating a rigid straight chain keeps it straight — only an actual joint bend shortens
   * hip-to-heel below the sum of the segment lengths), which trips a hard reach-fraction guard
   * even at the trivial "target = current position" footfall anchor. A KNEE rotation (not a
   * position offset — a position-based bend breaks the two-bone solve's own straight-continuation
   * invariant and was measured to miss a trivial identity solve by 0.15 m) gives genuine slack.
   */
  kneeRestRotationZ?: number;
}): {
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  heel: THREE.Object3D;
} {
  const actorSlot = new THREE.Group();
  actorSlot.position.set(0, 0, 0);

  const hip = new THREE.Object3D();
  hip.name = "upperleg01L";
  hip.position.set(0, input.hipY, 0);
  actorSlot.add(hip);

  const knee = new THREE.Object3D();
  knee.name = "lowerleg01L";
  knee.position.set(0, input.kneeY - input.hipY, 0);
  hip.add(knee);

  const heel = new THREE.Object3D();
  heel.name = "footL";
  heel.position.set(0, input.heelY - input.kneeY, 0);
  knee.add(heel);

  const toe = new THREE.Object3D();
  toe.name = "toe1-1L";
  toe.position.set(0, input.toeY - input.heelY, 0);
  heel.add(toe);

  // A right-foot chain the pin loop can resolve too (unused as stance in these tests, but
  // `findStanceChain` is called for "right" every frame the label reports it swing).
  const rightToe = new THREE.Object3D();
  rightToe.name = "toe1-1R";
  rightToe.position.set(0.2, input.toeY + 0.03, 0); // held clear of the floor: never stance
  actorSlot.add(rightToe);
  const rightHip = new THREE.Object3D();
  rightHip.name = "upperleg01R";
  rightHip.position.set(0.2, input.hipY, 0);
  actorSlot.add(rightHip);
  const rightKnee = new THREE.Object3D();
  rightKnee.name = "lowerleg01R";
  rightKnee.position.set(0, input.kneeY - input.hipY, 0);
  rightHip.add(rightKnee);
  const rightHeel = new THREE.Object3D();
  rightHeel.name = "footR";
  rightHeel.position.set(0, input.heelY - input.kneeY, 0);
  rightKnee.add(rightHeel);

  knee.rotation.z = input.kneeRestRotationZ ?? -1.0;
  actorSlot.updateMatrixWorld(true);
  return { actorSlot, leftToe: toe, rightToe, hip, knee, heel };
}

/** Always-left-stance labels: a single sample, so `stanceAtTime` reports it for any action time.
 * A plain literal, not the `LocomotionStanceLabels` type — see this file's own header. */
function alwaysLeftStanceLabels(): {
  clipName: string;
  cycleSeconds: number;
  forward: { x: number; z: number };
  stanceSpeedMetersPerSecond: number;
  speedToleranceMetersPerSecond: number;
  heightCutMeters: number;
  atMs: number[];
  left: boolean[];
  right: boolean[];
} {
  return {
    clipName: "test-clip",
    cycleSeconds: 1,
    forward: { x: 0, z: 1 },
    stanceSpeedMetersPerSecond: 0,
    speedToleranceMetersPerSecond: 0,
    heightCutMeters: 0,
    atMs: [0],
    left: [true],
    right: [false],
  };
}

function toeWorldXz(toe: THREE.Object3D): { x: number; z: number } {
  toe.updateWorldMatrix(true, false);
  const e = toe.matrixWorld.elements;
  return { x: e[12] ?? Number.NaN, z: e[14] ?? Number.NaN };
}

/** A minimal `ClipDrivenSettlingTurnState`-shaped literal (idle pin, no phase yet). */
function idleClipTurnState(): unknown {
  return {
    lock: {
      stanceFoot: null,
      anchorWorldXz: null,
      windowFrames: 0,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters: { left: Number.NaN, right: Number.NaN },
      doubleSupport: false,
      prevToeWorldXz: null,
      prevSlotXz: null,
      forwardLeft: 0,
      forwardRight: 0,
      labelledStance: null,
    },
    phaseFoot: null,
    phaseBudgetRadians: 0,
    phaseElapsedSeconds: 0,
    phaseAppliedRadians: 0,
    phasePivotAnchorXz: null,
    anchorPositionXz: null,
    travelUnit: null,
    pin: {
      left: { anchorXz: null, weight: 0 },
      right: { anchorXz: null, weight: 0 },
    },
    reachReleasedFrameCount: 0,
  };
}

/** A stance-label slot: a real mixer/action, so `resolveClipStanceForFrame` can read `action.time`. */
function stanceLabelSlot(): { mixer: THREE.AnimationMixer; locomotionClipName: string; responseClips: THREE.AnimationClip[] } {
  const clip = new THREE.AnimationClip("test-clip", 1, []);
  const mixer = new THREE.AnimationMixer(new THREE.Group());
  const action = mixer.clipAction(clip);
  action.play();
  action.time = 0;
  return { mixer, locomotionClipName: clip.name, responseClips: [clip] };
}

describe("the planted toe stays pinned during the settling turn", () => {
  it("a stance toe carried backward by a moving parent pose is held within 0.005 m by the IK pin", () => {
    const { actorSlot, leftToe, rightToe, hip, knee, heel } = makeLegFixture({
      hipY: 0.9,
      kneeY: 0.45,
      heelY: 0.12,
      toeY: 0.15,
    });
    // The fixture's knee rest bend moves the toe's ACTUAL resting Y away from the naive `toeY`
    // input (the bend is geometric, not a simple Y stack), so the floor is read off the toe's own
    // constructed position rather than assumed to equal `toeY`.
    const floorOriginY = leftToe.matrixWorld.elements[13]!;
    const targetHeadingRadians = actorSlot.rotation.y; // equals slot yaw throughout: pivot stays inert

    // biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
    const approach: any = {
      execution: { phase: "settling", drive: { locomotion: 1, timeScaleFactor: 1 } },
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters: 0.06,
      clipCycleSeconds: 1,
      intent: { target: { headingRadians: targetHeadingRadians } },
      stanceLabels: alwaysLeftStanceLabels(),
      stanceLabelSlot: stanceLabelSlot(),
      clipTurn: idleClipTurnState(),
    };

    let anchorXz: { x: number; z: number } | null = null;

    // 8 simulated frames: each one first applies a walk-clip-shaped joint update (the mixer
    // driving the stance hip through its own gait cycle, exactly the mechanism the defect names),
    // THEN runs the lock — the same "mixer poses, then the lock corrects" order the real frame
    // loop uses (`applyStationBedsideStanceLock`'s own header).
    for (let frame = 0; frame < 8; frame += 1) {
      hip.rotation.x += 0.05; // the clip carrying the stance leg through its own cycle
      hip.updateMatrixWorld(true);
      knee.updateMatrixWorld(true);
      heel.updateMatrixWorld(true);
      leftToe.updateMatrixWorld(true);

      applyCaseOwnedStanceLock(approach, 1 / 30);

      if (anchorXz === null) anchorXz = toeWorldXz(leftToe); // footfall anchor: the FIRST stance frame
    }

    expect(anchorXz).not.toBeNull();
    const finalXz = toeWorldXz(leftToe);
    const slideMeters = Math.hypot(finalXz.x - anchorXz!.x, finalXz.z - anchorXz!.z);
    // By frame 8 the ramp (3 frames) has long since reached weight 1; the toe should sit at the
    // anchor to within the same 0.005 m PERCEPTUAL_FLOOR_METERS the Y-only correction already uses.
    expect(slideMeters).toBeLessThanOrEqual(0.005 + 1e-6);
  });

  it("counterweight: with the leg beyond reach, the pin releases rather than hyperextending, and counts the frame", () => {
    // A short leg (thigh+shin ~ 0.08 m) so a 2 m body translation after footfall is unreachable.
    const { actorSlot, leftToe, rightToe, hip, knee } = makeLegFixture({
      hipY: 0.1,
      kneeY: 0.06,
      heelY: 0.02,
      toeY: 0,
    });
    const floorOriginY = leftToe.matrixWorld.elements[13]!;
    const targetHeadingRadians = actorSlot.rotation.y;

    // biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate.
    const approach: any = {
      execution: { phase: "settling", drive: { locomotion: 1, timeScaleFactor: 1 } },
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY,
      contactBandMeters: 0.06,
      clipCycleSeconds: 1,
      intent: { target: { headingRadians: targetHeadingRadians } },
      stanceLabels: alwaysLeftStanceLabels(),
      stanceLabelSlot: stanceLabelSlot(),
      clipTurn: idleClipTurnState(),
    };

    // Frame 1: footfall. The anchor is the toe's own current position, so it is trivially
    // reachable — no release yet.
    applyCaseOwnedStanceLock(approach, 1 / 30);
    expect(approach.clipTurn.reachReleasedFrameCount).toBe(0);

    // Something elsewhere in the pipeline translates the whole body 2 m away from the fixed
    // footfall anchor (the anchor does not follow — it is captured once, by design).
    actorSlot.position.x += 2;
    actorSlot.updateMatrixWorld(true);
    const hipQuatBefore = hip.quaternion.clone();
    const kneeQuatBefore = knee.quaternion.clone();

    applyCaseOwnedStanceLock(approach, 1 / 30);

    expect(approach.clipTurn.reachReleasedFrameCount).toBeGreaterThanOrEqual(1);
    // Released, not hyperextended: the guard fires BEFORE the IK solve, so this frame's hip/knee
    // quaternions are untouched by the pin.
    expect(hip.quaternion.equals(hipQuatBefore)).toBe(true);
    expect(knee.quaternion.equals(kneeQuatBefore)).toBe(true);
  });
});
