import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GeneratedHumanoidAnimationSlot } from "./index.js";
import { playLocomotionClip } from "./locomotion-clip-playback.js";
import {
  LOCOMOTION_LOWER_BODY_CLIP_SUFFIX,
  LOCOMOTION_UPPER_BODY_CLIP_SUFFIX,
  LOCOMOTION_UPPER_BODY_BLEND_IN_S,
  LOCOMOTION_UPPER_BODY_BLEND_OUT_S,
  readLocomotionUpperWeight,
  splitLocomotionClip,
} from "./locomotion-clip-split-mod.js";

/**
 * The walk take plays as two time-synced actions (arm-settle fix, physician).
 *
 * MEASURED (`.openclinxr/evidence/arm-settle/control.json`): one full-body action at leg weight
 * snaps the arms 27.7 deg in one frame at the walk->settling switch and 29.1 deg at walk start
 * against a 1.44 deg/frame walking median. The split keeps the lower body on today's leg logic
 * (stance lock untouched) while the upper body ramps 0->1 over 0.4 s at walk start and 1->0 over
 * 0.5 s on stop/settle. No rate limiter anywhere: the ramps change what the mixer is asked for.
 */

const LOWER_NODES = [
  "upperleg01.L",
  "lowerleg01.L",
  "foot.L",
  "toe1-1.L",
  "pelvis.L",
  "root",
  "finger1-1.L",
  "eye.L",
];
const UPPER_NODES = [
  "upperarm01.L",
  "lowerarm01.L",
  "clavicle.L",
  "shoulder01.L",
  "wrist.L",
  "spine03",
  "neck01",
  "head",
  "metacarpal1.L",
];

function probeClip(): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const node of [...LOWER_NODES, ...UPPER_NODES]) {
    tracks.push(
      new THREE.VectorKeyframeTrack(`${node}.position`, [0, 1, 2], [0, 0, 0, 0, 0.1, 0, 0, 0, 0]),
    );
  }
  return new THREE.AnimationClip("openclinxr_probe_split_walk", 2, tracks);
}

function splitSlot(clip?: THREE.AnimationClip): GeneratedHumanoidAnimationSlot {
  const take = clip ?? probeClip();
  const root = new THREE.Group();
  for (const node of [...LOWER_NODES, ...UPPER_NODES]) {
    const bone = new THREE.Object3D();
    bone.name = node;
    root.add(bone);
  }
  return {
    assetId: "split-probe",
    actorId: "split_probe_actor",
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
    mouthCue: { visible: false } as unknown as THREE.Mesh,
    gazeCue: { visible: false } as unknown as THREE.Line,
    eyeFocusCue: { visible: false } as unknown as THREE.Group,
    expressionCue: { visible: false } as unknown as THREE.Group,
    sourceComparatorFreezeEnabled: false,
    locomotionClipName: take.name,
    responseClips: [take],
    mixer: new THREE.AnimationMixer(root),
  } as unknown as GeneratedHumanoidAnimationSlot;
}

function splitActions(slot: GeneratedHumanoidAnimationSlot, clip: THREE.AnimationClip) {
  const split = splitLocomotionClip(clip);
  return {
    split,
    keeper: slot.mixer!.existingAction(clip),
    lower: slot.mixer!.existingAction(split.lower),
    upper: slot.mixer!.existingAction(split.upper),
  };
}

describe("the walk take splits into lower and upper clips", () => {
  it("partitions every track exactly once, keeping the source duration", () => {
    const clip = probeClip();
    const split = splitLocomotionClip(clip);
    expect(split.lower.name).toBe(`${clip.name}${LOCOMOTION_LOWER_BODY_CLIP_SUFFIX}`);
    expect(split.upper.name).toBe(`${clip.name}${LOCOMOTION_UPPER_BODY_CLIP_SUFFIX}`);
    expect(split.lower.duration).toBe(clip.duration);
    expect(split.upper.duration).toBe(clip.duration);
    const lowerNames = split.lower.tracks.map((track) => track.name);
    const upperNames = split.upper.tracks.map((track) => track.name);
    expect(lowerNames.length + upperNames.length).toBe(clip.tracks.length);
    expect(new Set([...lowerNames, ...upperNames]).size).toBe(clip.tracks.length);
    for (const node of LOWER_NODES) {
      expect(lowerNames.some((name) => name.startsWith(`${node}.`))).toBe(true);
      expect(upperNames.some((name) => name.startsWith(`${node}.`))).toBe(false);
    }
    for (const node of UPPER_NODES) {
      expect(upperNames.some((name) => name.startsWith(`${node}.`))).toBe(true);
      expect(lowerNames.some((name) => name.startsWith(`${node}.`))).toBe(false);
    }
  });

  it("returns the cached split for the same source clip", () => {
    const clip = probeClip();
    expect(splitLocomotionClip(clip)).toBe(splitLocomotionClip(clip));
  });

  it("starts the keeper at weight 0, the lower body at full leg weight, the upper near 0", () => {
    const clip = probeClip();
    const slot = splitSlot(clip);
    expect(playLocomotionClip(slot, 1, 1 / 60)).toBe(true);
    const { keeper, lower, upper } = splitActions(slot, clip);
    expect(keeper, "keeper action exists").not.toBeNull();
    expect(lower, "lower action exists").not.toBeNull();
    expect(upper, "upper action exists").not.toBeNull();
    expect(keeper!.isRunning()).toBe(true);
    expect(keeper!.getEffectiveWeight()).toBe(0);
    expect(lower!.getEffectiveWeight()).toBe(1);
    expect(upper!.getEffectiveWeight()).toBeCloseTo(1 / 60 / LOCOMOTION_UPPER_BODY_BLEND_IN_S, 9);
    expect(readLocomotionUpperWeight(slot.root.userData as Record<string, unknown>)).toBeCloseTo(
      1 / 60 / LOCOMOTION_UPPER_BODY_BLEND_IN_S,
      9,
    );
  });

  it("reaches full upper weight after the 0.4 s blend-in and stays time-synced", () => {
    const clip = probeClip();
    const slot = splitSlot(clip);
    for (let frame = 0; frame < 30; frame++) {
      expect(playLocomotionClip(slot, 1, 1 / 60)).toBe(true);
      slot.mixer!.update(1 / 60);
    }
    const { keeper, lower, upper } = splitActions(slot, clip);
    expect(upper!.getEffectiveWeight()).toBe(1);
    expect(lower!.getEffectiveWeight()).toBe(1);
    expect(keeper!.time).toBeCloseTo(lower!.time, 9);
    expect(upper!.time).toBeCloseTo(keeper!.time, 9);
    expect(lower!.timeScale).toBe(keeper!.timeScale);
    expect(upper!.timeScale).toBe(keeper!.timeScale);
  });

  it("fades the upper body over 0.5 s on stop and parks all three actions", () => {
    const clip = probeClip();
    const slot = splitSlot(clip);
    for (let frame = 0; frame < 30; frame++) playLocomotionClip(slot, 1, 1 / 60);
    playLocomotionClip(slot, 0, 1 / 60);
    const first = splitActions(slot, clip);
    expect(first.upper!.getEffectiveWeight()).toBeCloseTo(
      1 - 1 / 60 / LOCOMOTION_UPPER_BODY_BLEND_OUT_S,
      9,
    );
    for (let frame = 0; frame < 40; frame++) playLocomotionClip(slot, 0, 1 / 60);
    const { keeper, lower, upper } = splitActions(slot, clip);
    expect(upper!.getEffectiveWeight()).toBe(0);
    expect(lower!.getEffectiveWeight()).toBe(0);
    expect(keeper!.isRunning()).toBe(false);
    expect(lower!.isRunning()).toBe(false);
    expect(upper!.isRunning()).toBe(false);
    expect(slot.root.userData["openClinXrOwnedBoneChains"]).toEqual([]);
  });

  it("fades the upper body when settling begins (reduced leg target, still locomoting)", () => {
    const clip = probeClip();
    const slot = splitSlot(clip);
    for (let frame = 0; frame < 30; frame++) playLocomotionClip(slot, 1, 1 / 60);
    const before = splitActions(slot, clip).upper!.getEffectiveWeight();
    expect(before).toBe(1);
    playLocomotionClip(slot, 1, 1 / 60, 1, 0.4);
    const { lower, upper } = splitActions(slot, clip);
    expect(upper!.getEffectiveWeight()).toBeLessThan(1);
    expect(upper!.getEffectiveWeight()).toBeCloseTo(
      1 - 1 / 60 / LOCOMOTION_UPPER_BODY_BLEND_OUT_S,
      9,
    );
    expect(lower!.getEffectiveWeight()).toBeGreaterThan(0.4);
    expect(lower!.getEffectiveWeight()).toBeLessThan(1);
  });
});
