import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

/**
 * After a completed stop with no meaningful residual yaw, the walk clip's continued
 * steps are spurious: pinning them drags the slot 0.15-0.22 m and slides toes through
 * all of settling/arrived while arrival never converges (stop-takes slide
 * decomposition, all rigs). Exercised through the public lock entry with a fabricated
 * settling approach so the test pins the wiring, not just the turn in isolation.
 */

function settlingApproach(stopClipTimeS: number | null): {
  approach: Record<string, unknown>;
  actorSlot: THREE.Group;
} {
  const actorSlot = new THREE.Group();
  actorSlot.position.set(2, 0, 3);
  const root = new THREE.Group();
  actorSlot.add(root);
  const toeL = new THREE.Object3D();
  toeL.name = "toe1-1L";
  toeL.position.set(-0.2, 0.05, 0.1);
  const toeR = new THREE.Object3D();
  toeR.name = "toe1-1R";
  toeR.position.set(0.2, 0.05, -0.1);
  root.add(toeL);
  root.add(toeR);
  const walkClip = new THREE.AnimationClip("openclinxr_probe_walk", 1.667, [
    new THREE.VectorKeyframeTrack("toe1-1L.position", [0, 1.667], [0, 0, 0, 0.5, 0, 0]),
    new THREE.VectorKeyframeTrack("toe1-1R.position", [0, 1.667], [0.5, 0, 0, 0, 0, 0]),
  ]);
  const mixer = new THREE.AnimationMixer(root);
  const walkAction = mixer.clipAction(walkClip);
  walkAction.play();
  walkAction.time = 0.4;
  actorSlot.updateMatrixWorld(true);
  const idlePin = () => ({ anchorXz: null, weight: 0 });
  return {
    actorSlot,
    approach: {
      execution: { phase: "settling", drive: { locomotion: 1 }, stopClipTimeS },
      intent: { target: { headingRadians: actorSlot.rotation.y } },
      actorSlot,
      leftToe: toeL,
      rightToe: toeR,
      floorOriginY: 0,
      contactBandMeters: 0.06,
      clipCycleSeconds: 1.0,
      stanceLabelSlot: {
        root,
        actorSlot,
        mixer,
        locomotionClipName: walkClip.name,
        responseClips: [walkClip],
      },
      stanceLabels: null,
      lock: null,
      stopFired: null,
      stopSettleBlendT: null,
      clipTurn: {
        lock: null,
        phaseFoot: null,
        phaseBudgetRadians: 0,
        phaseElapsedSeconds: 0,
        phaseAppliedRadians: 0,
        phasePivotAnchorXz: null,
        anchorPositionXz: null,
        travelUnit: null,
        pin: { left: idlePin(), right: idlePin() },
        reachReleasedFrameCount: 0,
        pendingFootfallBiasXz: null,
        pendingFootfallBiasFramesLeft: 0,
        reachReleasedThisFrame: { left: null, right: null },
        pinDebugThisFrame: { left: { anchorXz: null, weight: 0 }, right: { anchorXz: null, weight: 0 } },
      },
    },
  };
}

function runSettling(stopClipTimeS: number | null): { slotX: number; slotZ: number; leftWeight: number; rightWeight: number } {
  const { approach, actorSlot } = settlingApproach(stopClipTimeS);
  for (let frame = 0; frame < 20; frame += 1) {
    applyCaseOwnedStanceLock(approach as never, 1 / 60);
  }
  const pin = (approach as unknown as { clipTurn: { pin: { left: { weight: number }; right: { weight: number } } } }).clipTurn.pin;
  return { slotX: actorSlot.position.x, slotZ: actorSlot.position.z, leftWeight: pin.left.weight, rightWeight: pin.right.weight };
}

describe("the settling lock stands down after a stop", () => {
  it("leaves slot and pin untouched when post-stop with no residual yaw", () => {
    const after = runSettling(2.5);
    expect(after.slotX).toBe(2);
    expect(after.slotZ).toBe(3);
    expect(after.leftWeight).toBe(0);
    expect(after.rightWeight).toBe(0);
  });

  it("still pins on the walk-only path", () => {
    const after = runSettling(null);
    expect(after.leftWeight + after.rightWeight).toBeGreaterThan(0);
  });
});
