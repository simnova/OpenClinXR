import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import {
  blendStopClipPlayback,
  startStopClipPlayback,
  STOP_PLAYING_FLAG,
  updateStopPlayback,
} from "./stop-clip-playback-mod.js";
import { STOP_CROSSFADE_SECONDS } from "./stop-clip-wiring-mod.js";

/**
 * The stop action is distance-driven: it starts at the entry clip time with timeScale 0, so
 * the mixer's own integration never advances it, and every stopping frame sets its time
 * explicitly from the executor's R^-1(remaining) while the weights morph across the entry
 * crossfade. The headless assay never creates a stop action (it poses markers), so this path
 * — the one the browser consumer actually plays — is covered here, not there.
 */

const DURATION = 5.5;
const T0 = 1.25;

function distanceSlot(): {
  approach: CaseOwnedBedsideApproach;
  mixer: THREE.AnimationMixer;
  walkClip: THREE.AnimationClip;
  stopClip: THREE.AnimationClip;
} {
  const actorSlot = new THREE.Group();
  const root = new THREE.Group();
  actorSlot.add(root);
  const toeL = new THREE.Object3D();
  toeL.name = "toe1-1L";
  const toeR = new THREE.Object3D();
  toeR.name = "toe1-1R";
  const rootBone = new THREE.Object3D();
  rootBone.name = "root";
  root.add(toeL);
  root.add(toeR);
  root.add(rootBone);
  const walkClip = new THREE.AnimationClip("openclinxr_probe_walk", 1.667, [
    new THREE.VectorKeyframeTrack("toe1-1L.position", [0, 1.667], [0, 0, 0, 0.5, 0, 0]),
    new THREE.VectorKeyframeTrack("toe1-1R.position", [0, 1.667], [0.5, 0, 0, 0, 0, 0]),
  ]);
  const stopClip = new THREE.AnimationClip("openclinxr_retarget_kimodo_stop_probe", DURATION, [
    new THREE.VectorKeyframeTrack("toe1-1L.position", [0, DURATION], [0, 0, 0, 0.1, 0, 0]),
    new THREE.VectorKeyframeTrack("toe1-1R.position", [0, DURATION], [0.1, 0, 0, 0.1, 0, 0]),
    new THREE.VectorKeyframeTrack("root.position", [0, DURATION], [0, 0, 0, 0, 0, 2.5]),
  ]);
  const mixer = new THREE.AnimationMixer(root);
  const walkAction = mixer.clipAction(walkClip);
  walkAction.play();
  const noRootClip = stopClip.clone();
  const approach = {
    stanceLabelSlot: {
      root,
      actorSlot,
      mixer,
      locomotionClipName: walkClip.name,
      responseClips: [walkClip, stopClip],
    },
    stopWiring: {
      clipName: stopClip.name,
      tEarliestS: T0,
      durationSeconds: DURATION,
      noRootClip,
    },
    execution: {
      phase: "stopping",
      stopElapsedSeconds: 0,
      stopClipTimeS: T0,
    },
    lock: null,
    lockArmed: false,
    stopFired: null,
    stopSettleBlendT: null,
  } as unknown as CaseOwnedBedsideApproach;
  return { approach, mixer, walkClip, stopClip };
}

describe("the distance-driven stop action", () => {
  it("starts at the entry time and holds it against mixer integration", () => {
    const { approach, mixer } = distanceSlot();
    startStopClipPlayback(approach, T0);
    const wiring = approach.stopWiring;
    if (!wiring) throw new Error("no wiring");
    const action = mixer.existingAction(wiring.noRootClip);
    if (!action) throw new Error("no stop action");
    expect(action.time).toBe(T0);
    expect(action.timeScale).toBe(0);
    expect((approach.stanceLabelSlot?.root.userData as Record<string, unknown>)[STOP_PLAYING_FLAG]).toBe(true);
    mixer.update(1 / 60);
    // Zero-weight actions never activate (three.js skips them), so running-ness is asserted
    // after the blend raises the weight below; here the contract is enabled, unpaused, held.
    expect(action.enabled).toBe(true);
    expect(action.paused).toBe(false);
    expect(action.time).toBe(T0);
  });

  it("sets the clip time explicitly and morphs the weights across the crossfade", () => {
    const { approach, mixer } = distanceSlot();
    startStopClipPlayback(approach, T0);
    const wiring = approach.stopWiring;
    if (!wiring || !approach.stanceLabelSlot) throw new Error("no wiring");
    const stopAction = mixer.existingAction(wiring.noRootClip);
    const walkClip = approach.stanceLabelSlot.responseClips?.[0];
    const walkAction = walkClip ? mixer.existingAction(walkClip as THREE.AnimationClip) : null;
    if (!stopAction || !walkAction) throw new Error("no actions");
    approach.execution.stopClipTimeS = T0 + 0.1;
    blendStopClipPlayback(approach, STOP_CROSSFADE_SECONDS / 2);
    expect(stopAction.time).toBeCloseTo(T0 + 0.1, 9);
    expect(stopAction.getEffectiveWeight()).toBeCloseTo(0.5, 9);
    expect(walkAction.getEffectiveWeight()).toBeCloseTo(0.5, 9);
    mixer.update(1 / 60);
    // The mixer never integrates the stop time itself: it stays exactly where the drive put it.
    expect(stopAction.time).toBeCloseTo(T0 + 0.1, 9);
  });

  it("records the firing on the stopping entry frame", () => {
    const { approach, mixer } = distanceSlot();
    approach.execution.phase = "stopping";
    updateStopPlayback(approach, "walking", 1 / 60, {
      trigger: {
        clipName: "openclinxr_retarget_kimodo_stop_probe",
        durationSeconds: DURATION,
        rootTrackXz: [],
        routeYawRadians: 0,
        distCurve: [],
        tEarliestS: T0,
        rMaxM: 2,
        rDecelM: 0.2,
        decelOnsetS: 2,
        holdOnsetS: 4,
      },
    });
    expect(approach.stopFired).toEqual({ t0S: T0, rMaxM: 2 });
    const wiring = approach.stopWiring;
    if (!wiring) throw new Error("no wiring");
    const entry = mixer.existingAction(wiring.noRootClip);
    expect(entry?.enabled).toBe(true);
    expect(entry?.paused).toBe(false);
    expect(entry?.time).toBe(T0);
  });
});
