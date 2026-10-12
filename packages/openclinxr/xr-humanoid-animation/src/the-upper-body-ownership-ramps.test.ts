import type { OwnedChain } from "@openclinxr/xr-pose";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  LOCOMOTION_UPPER_BODY_BLEND_IN_S,
  LOCOMOTION_UPPER_BODY_BLEND_OUT_S,
  playLocomotionClip,
} from "./locomotion-clip-playback-mod.js";
import type { GeneratedHumanoidAnimationSlot } from "./types.js";

/**
 * The upper-body ownership weight is a continuous sim-delta ramp (arm-settle).
 *
 * 0→1 over LOCOMOTION_UPPER_BODY_BLEND_IN_S from walk start, 1→0 over
 * LOCOMOTION_UPPER_BODY_BLEND_OUT_S from the moment walking ends. The settling path (drive 0)
 * keeps the upper-body chain CLAIMED while its weight is above 0 — the posture pass blends on
 * it instead of snapping to idle — and only clears the claim once the fade completes. The leg
 * chain stays at weight 1 throughout: this ramp never touches stance amplitude.
 */
const WALK = new THREE.AnimationClip("openclinxr_retarget_walk_source", 2.87, []);

function walkingSlot(): GeneratedHumanoidAnimationSlot {
  const root = new THREE.Group();
  root.position.set(0, 1, -0.2);
  root.userData["openClinXrActorPosture"] = "standing";
  for (const bone of ["upperleg01.L", "lowerleg01.L", "foot.L", "upperarm01.L", "lowerarm01.L"]) {
    const node = new THREE.Object3D();
    node.name = bone;
    root.add(node);
  }
  return {
    assetId: "mpfb-clinical-physician-adult",
    actorId: "senior_resident_ward_v1",
    root,
    actorSlot: new THREE.Group(),
    baseX: 0,
    baseY: 1,
    baseZ: -0.2,
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
    responseClips: [WALK],
    locomotionClipName: WALK.name,
    mixer: new THREE.AnimationMixer(new THREE.Group()),
  } as unknown as GeneratedHumanoidAnimationSlot;
}

function upperWeight(slot: GeneratedHumanoidAnimationSlot): number | undefined {
  const chains = slot.root.userData["openClinXrOwnedBoneChains"] as OwnedChain[] | undefined;
  for (const chain of chains ?? []) {
    if (chain.boneNames.includes("upperarm01.L")) return chain.weight ?? 1;
  }
  return undefined;
}

function legWeight(slot: GeneratedHumanoidAnimationSlot): number | undefined {
  const chains = slot.root.userData["openClinXrOwnedBoneChains"] as OwnedChain[] | undefined;
  for (const chain of chains ?? []) {
    if (chain.boneNames.includes("upperleg01.L")) return chain.weight ?? 1;
  }
  return undefined;
}

const STEP = 1 / 30;

describe("the upper-body ownership weight ramps", () => {
  it("blends 0→1 over the blend-in window from walk start with legs pinned at 1", () => {
    expect(LOCOMOTION_UPPER_BODY_BLEND_IN_S).toBeCloseTo(0.4, 9);
    const slot = walkingSlot();
    const seen: number[] = [];
    const framesIn = Math.round(LOCOMOTION_UPPER_BODY_BLEND_IN_S / STEP);
    for (let i = 0; i < framesIn; i += 1) {
      expect(playLocomotionClip(slot, 1, STEP)).toBe(true);
      seen.push(upperWeight(slot) ?? Number.NaN);
      expect(legWeight(slot)).toBe(1);
    }
    for (let i = 0; i < seen.length; i += 1) {
      expect(seen[i]).toBeCloseTo(Math.min(1, ((i + 1) * STEP) / LOCOMOTION_UPPER_BODY_BLEND_IN_S), 9);
    }
    expect(seen[seen.length - 1]).toBe(1);
    expect(upperWeight(slot)).toBe(1);
  });

  it("holds the upper-body chain through walking→settling and fades 1→0 over the blend-out", () => {
    expect(LOCOMOTION_UPPER_BODY_BLEND_OUT_S).toBeCloseTo(0.5, 9);
    const slot = walkingSlot();
    for (let i = 0; i < 15; i += 1) playLocomotionClip(slot, 1, STEP);
    expect(upperWeight(slot)).toBe(1);
    // Walking ends (settling drive 0): the chain stays claimed while its weight is above 0.
    const seen: number[] = [];
    const framesOut = Math.round(LOCOMOTION_UPPER_BODY_BLEND_OUT_S / STEP);
    for (let i = 0; i < framesOut; i += 1) {
      expect(playLocomotionClip(slot, 0, STEP)).toBe(true);
      const w = upperWeight(slot);
      expect(w).toBeDefined();
      seen.push(w ?? Number.NaN);
      expect(legWeight(slot)).toBe(1);
    }
    for (let i = 0; i < seen.length; i += 1) {
      expect(seen[i]).toBeCloseTo(Math.max(0, 1 - ((i + 1) * STEP) / LOCOMOTION_UPPER_BODY_BLEND_OUT_S), 9);
    }
    // Fade complete: the claim clears and the action parks (float residue may need one
    // extra frame past the window end).
    let cleared = slot.root.userData["openClinXrOwnedBoneChains"];
    let extra = 0;
    while (Array.isArray(cleared) && cleared.length > 0 && extra < 3) {
      expect(playLocomotionClip(slot, 0, STEP)).toBe(true);
      cleared = slot.root.userData["openClinXrOwnedBoneChains"];
      extra += 1;
    }
    expect(cleared).toEqual([]);
    expect(slot.mixer?.existingAction(WALK)?.isRunning()).toBe(false);
  });
});
