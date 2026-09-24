import { CLINICIAN_WALK_SPEED_MPS } from "@openclinxr/asset-registry/approach-executor";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { playLocomotionClip } from "./locomotion-clip-playback.js";
import type { GeneratedHumanoidAnimationSlot } from "./index.js";

/** The shape `resolveLocomotionClipTimeScale` caches on the root, read back here rather than
 * calling the (unexported) measurement function a second time. */
type CachedLocomotionClipSpeed = {
  clipName: string;
  groundSpeedMetersPerSecond: number;
  cycleSeconds: number;
  timeScale: number;
};

/**
 * The walk action plays at a DERIVED rate, not at 1.
 *
 * The executor prescribes the route at `CLINICIAN_WALK_SPEED_MPS` while the stance
 * lock derives the actual advance from the planted foot, so the ground speed is the
 * clip's own stance speed. A clip slower than the plan stretches the walk; the rate
 * clip slower than the plan stretches the walk; the rate that reunites them is
 * `CLINICIAN_WALK_SPEED_MPS / measuredClipSpeed`, measured off the bound clip itself.
 * A fixture toe planted at y = 0.01 for the first 1 s half-cycle, travelling 0.55 m,
 * measures 0.55 m/s, so the action must play at exactly 2.0.
 */
const CYCLE_SECONDS = 2;
const STANCE_TRAVEL_METERS = 1.1;
const EXPECTED_GROUND_SPEED_MPS = STANCE_TRAVEL_METERS / CYCLE_SECONDS;
const EXPECTED_TIME_SCALE = CLINICIAN_WALK_SPEED_MPS / EXPECTED_GROUND_SPEED_MPS;

function timescaleSlot(): GeneratedHumanoidAnimationSlot {
  const actorSlot = new THREE.Group();
  const root = new THREE.Group();
  actorSlot.add(root);
  const toeL = new THREE.Object3D();
  toeL.name = "toe1-1.L";
  const toeR = new THREE.Object3D();
  toeR.name = "toe1-1.R";
  root.add(toeL);
  root.add(toeR);
  // Walk-shaped and PERIODIC: the left toe stands (y = 0.01) for the first half,
  // travelling 1.1 m, then swings back high for the second half and lands exactly
  // where it started, so the loop wrap (t = 2 s reads as t = 0) extends no window.
  // A monotonic out-and-back-less track would read first == last across the wrap and
  // measure zero. The steep lift clears the 0.06 m contact band within one sample.
  const clip = new THREE.AnimationClip("openclinxr_timescale_probe_walk", CYCLE_SECONDS, [
    new THREE.VectorKeyframeTrack("toe1-1.L.position", [0, 1, 1.02, 1.5, 2], [
      0, 0.01, STANCE_TRAVEL_METERS / 4,
      0, 0.01, -STANCE_TRAVEL_METERS / 4,
      0, 0.29, -0.27,
      0, 0.29, 0,
      0, 0.01, STANCE_TRAVEL_METERS / 4,
    ]),
    new THREE.VectorKeyframeTrack("toe1-1.R.position", [0, 1, 2], [
      0, 0.3, -STANCE_TRAVEL_METERS / 4,
      0, 0.3, 0,
      0, 0.3, STANCE_TRAVEL_METERS / 4,
    ]),
  ]);
  return {
    assetId: "timescale-probe",
    actorId: "timescale_probe_actor",
    root,
    actorSlot,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
    mouthCue: { visible: false } as unknown as THREE.Mesh,
    gazeCue: { visible: false } as unknown as THREE.Line,
    eyeFocusCue: { visible: false } as unknown as THREE.Group,
    expressionCue: { visible: false } as unknown as THREE.Group,
    sourceComparatorFreezeEnabled: false,
    locomotionClipName: clip.name,
    responseClips: [clip],
    mixer: new THREE.AnimationMixer(root),
  } as unknown as GeneratedHumanoidAnimationSlot;
}

describe("the walk action timescale matches the executor", () => {
  it("measures the clip's own stance speed and plays at plan speed over clip speed", () => {
    const slot = timescaleSlot();
    expect(playLocomotionClip(slot, 1, 1 / 60), "the walk action started").toBe(true);
    const measurement = slot.root.userData["openClinXrLocomotionClipSpeed"] as
      | CachedLocomotionClipSpeed
      | undefined;
    expect(measurement, "the probe clip has a measurable stance window").not.toBeUndefined();
    expect(measurement!.clipName).toBe("openclinxr_timescale_probe_walk");
    expect(measurement!.groundSpeedMetersPerSecond).toBeCloseTo(EXPECTED_GROUND_SPEED_MPS, 2);
    expect(measurement!.timeScale).toBeCloseTo(EXPECTED_TIME_SCALE, 2);
    expect(Math.abs(measurement!.timeScale - EXPECTED_TIME_SCALE) / EXPECTED_TIME_SCALE).toBeLessThan(0.01);
  });

  it("the playing walk action carries that timescale", () => {
    const slot = timescaleSlot();
    expect(playLocomotionClip(slot, 1, 1 / 60)).toBe(true);
    const clip = slot.responseClips!.find(
      (candidate) => candidate.name === slot.locomotionClipName,
    )!;
    const action = slot.mixer!.existingAction(clip);
    expect(action, "the walk action is playing").not.toBeNull();
    expect(action!.timeScale).toBeCloseTo(EXPECTED_TIME_SCALE, 2);
    expect(Math.abs(action!.timeScale - EXPECTED_TIME_SCALE) / EXPECTED_TIME_SCALE).toBeLessThan(0.01);
    const stored = slot.root.userData["openClinXrLocomotionClipSpeed"] as
      | CachedLocomotionClipSpeed
      | undefined;
    expect(stored?.timeScale).toBeCloseTo(EXPECTED_TIME_SCALE, 2);
  });
});
