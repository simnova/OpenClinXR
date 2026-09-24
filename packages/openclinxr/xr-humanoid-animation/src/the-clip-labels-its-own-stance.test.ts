import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

/**
 * The lock crowns the foot the clip's own motion labels as stance, not the one the
 * 0.06 m height band would crown.
 *
 * `computeLocomotionStanceLabels` / `resolveLocomotionStanceLabels` / `stanceAtTime`
 * (`locomotion-stance-labels.ts`) have no outside binder and are not on this package's
 * reviewed public surface (`public-api.json`, closed by `psr-01e`), so this test does not
 * import them — directly or via a routed dynamic import — and does not reimplement the
 * labelling predicate. It drives the one public function that reaches them,
 * `applyCaseOwnedStanceLock`, with `approach.stanceLabels` set to a small, hand-built
 * `LocomotionStanceLabels` fixture whose shape is deterministic enough to state by hand
 * (2 samples, no derived math needed to know the expected labels), and reads the result
 * back off the published `approach.lock.labelledStance` / `approach.lock.stanceFoot`.
 *
 * Duty-factor / height-band-defect coverage of the labelling predicate itself now lives in
 * `tools/openclinxr/evidence/foot-plant/the-shipped-walk-labels-its-own-stance.test.ts`,
 * which reaches the same code through the production `updateStationBedsideApproach` path on
 * the shipped physician GLB and reads `userData["openClinXrLocomotionStanceLabels"]`.
 */

function labelledFixtureSlot(): { actorSlot: THREE.Group; leftToe: THREE.Object3D; rightToe: THREE.Object3D } {
  const actorSlot = new THREE.Group();
  const leftToe = new THREE.Object3D();
  leftToe.position.set(0.09, 0.03, 0.1);
  const rightToe = new THREE.Object3D();
  rightToe.position.set(-0.09, 0.01, -0.1);
  actorSlot.add(leftToe);
  actorSlot.add(rightToe);
  actorSlot.updateMatrixWorld(true);
  return { actorSlot, leftToe, rightToe };
}

describe("the clip labels its own stance", () => {
  it("the lock pins a labelled stance foot and refuses a band-inside swing foot", () => {
    // A foot at y = 0.03 (inside the 0.06 m band) travelling forward in body space is swing;
    // a foot at y = 0.01 travelling backward is stance. Two samples, hand-labelled: left is
    // swing both samples (rises, y stays 0.03), right is stance both samples (falls, y stays
    // 0.01) — the same shape `computeLocomotionStanceLabels` produces for this motion, stated
    // directly rather than computed, since this fixture only exists to prove the LOCK reads the
    // clip's label over the height band (the band alone would crown the lower left toe).
    const labels = {
      clipName: "lock-probe",
      cycleSeconds: 1,
      forward: { x: 0, z: 1 },
      stanceSpeedMetersPerSecond: 0.5,
      speedToleranceMetersPerSecond: 0.1,
      heightCutMeters: 0.02,
      atMs: [0, 500],
      left: [false, false],
      right: [true, true],
    };
    const { actorSlot, leftToe, rightToe } = labelledFixtureSlot();
    const clip = new THREE.AnimationClip("lock-probe", 1, []);
    const mixer = new THREE.AnimationMixer(new THREE.Group());
    const action = mixer.clipAction(clip);
    action.play();
    action.time = 0.25;
    const stanceLabelSlot = { mixer, locomotionClipName: clip.name, responseClips: [clip] };
    const approach = {
      execution: { phase: "walking", drive: { locomotion: 1 } },
      actorSlot,
      leftToe,
      rightToe,
      floorOriginY: 0,
      contactBandMeters: 0.06,
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
      lockArmed: true,
      stanceLabels: labels,
      stanceLabelSlot,
      turnStep: {
        plantFoot: "right",
        stepStartHeadingRadians: 0,
        restLocal: null,
        plantAnchorXz: null,
        yawPerStepRadians: 0.4,
        opened: false,
        closing: false,
      },
      restStance: null,
      closeState: { anchorXz: null, done: false, framesRun: 0, plantFoot: null },
      start: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 1 },
      intent: { target: { headingRadians: 0 } },
      // biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
    } as any;

    applyCaseOwnedStanceLock(approach);

    // The band alone would crown the lower left toe; the labels crown the planting right.
    expect(approach.lock.stanceFoot).toBe("right");
    expect(approach.lock.labelledStance).toEqual({ left: false, right: true });
  });
});
