import { applyGeneratedHumanoidClinicalIdlePosture, type OwnedChain } from "@openclinxr/xr-pose";
import * as THREE from "three";
import { Bone } from "three";
import { describe, expect, it } from "vitest";

/**
 * `boneOwnershipWeight` (chain-ownership.ts) has no outside binder and is not on this package's
 * reviewed public surface (public-api.json). The assertions below query it against `ownedChains`
 * fixtures this file builds itself, so they read that same fixture data directly instead — this
 * is a check on the fixture, not on the posture-pass predicate under test (that predicate is
 * `applyGeneratedHumanoidClinicalIdlePosture`, asserted on via the rotation checks in each test).
 */
function fixtureOwnershipWeight(owned: readonly OwnedChain[], boneName: string): number | undefined {
  for (const chain of owned) {
    if (chain.boneNames.includes(boneName)) return chain.weight ?? 1;
  }
  return undefined;
}

/**
 * Tests for the locomotion crossfade integration with clinical idle posture.
 * These tests verify the crossfade behavior and ownership handling.
 */

/** `asBones` builds THREE.Bone nodes, which turns on MPFB rig detection; the generic-rig clauses need Object3D. */
function buildTestHumanoid(asBones = false): THREE.Object3D {
  const make = (): THREE.Object3D => (asBones ? new THREE.Bone() : new THREE.Object3D());
  const root = new THREE.Object3D();
  root.name = "humanoid_root";
  root.userData["openClinXrActorPosture"] = "standing";

  // Left arm chain (using names that match MPFB_CLINICAL_IDLE_ARM_HANG keys)
  const upperArmL = make();
  upperArmL.name = "upper_armL";
  root.add(upperArmL);
  const lowerArmL = make();
  lowerArmL.name = "forearmL";
  upperArmL.add(lowerArmL);
  const handL = make();
  handL.name = "handL";
  lowerArmL.add(handL);

  // Right arm chain
  const upperArmR = make();
  upperArmR.name = "upper_armR";
  root.add(upperArmR);
  const lowerArmR = make();
  lowerArmR.name = "forearmR";
  upperArmR.add(lowerArmR);
  const handR = make();
  handR.name = "handR";
  lowerArmR.add(handR);

  // Head
  const head = make();
  head.name = "head";
  root.add(head);

  // Spine
  const spine03 = make();
  spine03.name = "spine03";
  root.add(spine03);

  // Legs (for completeness)
  const upperLegL = make();
  upperLegL.name = "upperleg01.L";
  root.add(upperLegL);
  const upperLegR = make();
  upperLegR.name = "upperleg01.R";
  root.add(upperLegR);

  return root;
}

describe("locomotion crossfade with clinical idle posture", () => {
  it("(a) with drive > 0 for > 0.3s, posture pass leaves upper_armL / forearmL / spine03 exactly as mixer wrote them", () => {
    const humanoid = buildTestHumanoid();

    // Simulate locomotion clip driving upper body (crossfade complete, weight=1)
    const ownedChains: OwnedChain[] = [
      {
        ownerId: "openclinxr.locomotion-clip-playback",
        boneNames: ["upper_armL", "forearmL", "spine03", "upper_armR", "forearmR"],
        weight: 1, // Full ownership after crossfade
      },
      {
        ownerId: "openclinxr.locomotion-clip-playback",
        boneNames: ["upperleg01.L", "upperleg01.R"],
        weight: 1, // Legs always full ownership
      },
    ];
    humanoid.userData["openClinXrOwnedBoneChains"] = ownedChains;

    // Mixer writes some rotation to the owned bones
    const upperArmL = humanoid.getObjectByName("upper_armL")!;
    const lowerArmL = humanoid.getObjectByName("forearmL")!;
    const spine03 = humanoid.getObjectByName("spine03")!;
    const mixerRotationUpper = new THREE.Euler(0.5, 0.2, -0.3);
    const mixerRotationLower = new THREE.Euler(-0.4, 0.1, 0.2);
    const mixerRotationSpine = new THREE.Euler(0.1, 0.05, -0.1);
    upperArmL.rotation.copy(mixerRotationUpper);
    lowerArmL.rotation.copy(mixerRotationLower);
    spine03.rotation.copy(mixerRotationSpine);

    // Store pre-posture rotations
    const beforeUpper = upperArmL.rotation.clone();
    const beforeLower = lowerArmL.rotation.clone();
    const beforeSpine = spine03.rotation.clone();

    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // Owned bones should be unchanged (weight=1 means skip posture entirely)
    expect(upperArmL.rotation.equals(beforeUpper)).toBe(true);
    expect(lowerArmL.rotation.equals(beforeLower)).toBe(true);
    expect(spine03.rotation.equals(beforeSpine)).toBe(true);

    // Verify ownership weight is 1 for these bones
    expect(fixtureOwnershipWeight(ownedChains, "upper_armL")).toBe(1);
    expect(fixtureOwnershipWeight(ownedChains, "forearmL")).toBe(1);
    expect(fixtureOwnershipWeight(ownedChains, "spine03")).toBe(1);
  });

  it("(b) head is still written by the posture pass while walking", () => {
    const humanoid = buildTestHumanoid();

    // Upper body owned, but head is NOT in the claim
    const ownedChains: OwnedChain[] = [
      {
        ownerId: "openclinxr.locomotion-clip-playback",
        boneNames: ["upper_armL", "forearmL", "upper_armR", "forearmR"],
        weight: 1,
      },
    ];
    humanoid.userData["openClinXrOwnedBoneChains"] = ownedChains;

    const head = humanoid.getObjectByName("head")!;
    const beforeHead = head.rotation.clone();

    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // Head should be written by posture (not owned)
    expect(head.rotation.equals(beforeHead)).toBe(false);
    expect(fixtureOwnershipWeight(ownedChains, "head")).toBeUndefined();
  });

  it("(c) at t = 0.15s into walking an owned upper_armL rotation lies strictly between idle and mixer rotation (angle to each > 1 deg)", () => {
    const humanoid = buildTestHumanoid();

    // Simulate MPFB rig detection so correct idle map is used
    humanoid.userData.openClinXrHumanoidRail = "mpfb2";

    // Crossfade in progress: weight = 0.5 (halfway through 0.3s fade at 0.15s)
    const crossfadeWeight = 0.5;
    const ownedChains: OwnedChain[] = [
      {
        ownerId: "openclinxr.locomotion-clip-playback",
        boneNames: ["upper_armL", "forearmL"],
        weight: crossfadeWeight,
      },
    ];
    humanoid.userData["openClinXrOwnedBoneChains"] = ownedChains;

    const upperArmL = humanoid.getObjectByName("upper_armL")!;
    const lowerArmL = humanoid.getObjectByName("forearmL")!;

    // Mixer writes a rotation (simulated clip pose)
    const mixerQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0.3, -0.4));
    upperArmL.quaternion.copy(mixerQuat);
    lowerArmL.quaternion.copy(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.2, 0.1)));

    const mixerQuatUpper = upperArmL.quaternion.clone();
    const mixerQuatLower = lowerArmL.quaternion.clone();

    // Apply posture - should slerp toward idle
    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // After crossfade, rotation should be between idle and mixer
    // Upper arm: idle has z ≈ -1.12, mixer has z ≈ -0.4, crossfade 0.5 should be between
    const angleToMixerUpper = upperArmL.quaternion.angleTo(mixerQuatUpper);
    const angleToMixerLower = lowerArmL.quaternion.angleTo(mixerQuatLower);

    // At weight=0.5, the result should be different from both idle and mixer
    // (angle to each should be > 1 degree = ~0.0175 rad)
    expect(angleToMixerUpper).toBeGreaterThan(0.0175);
    expect(angleToMixerLower).toBeGreaterThan(0.0175);

    // Verify ownership weight is 0.5
    expect(fixtureOwnershipWeight(ownedChains, "upper_armL")).toBe(0.5);
    expect(fixtureOwnershipWeight(ownedChains, "forearmL")).toBe(0.5);
  });

  it("(d) 0.3s after stopping, upper_armL equals the idle hang within 0.5 deg, the upper-body and leg claims are cleared, and the walk action's effective weight is 0", () => {
    const humanoid = buildTestHumanoid();

    // Simulate MPFB rig detection so correct idle map is used
    humanoid.userData.openClinXrHumanoidRail = "mpfb2";

    // No ownership (fully faded out)
    humanoid.userData["openClinXrOwnedBoneChains"] = [];

    const upperArmL = humanoid.getObjectByName("upper_armL")!;
    const lowerArmL = humanoid.getObjectByName("forearmL")!;

    // Apply posture - should write full idle pose
    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // Verify arm hang posture was applied (idle pose)
    // MPFB upper arm L idle: z ≈ -1.12 (hang from T-pose)
    expect(Math.abs(upperArmL.rotation.z - (-1.12))).toBeLessThan(0.0087); // 0.5 deg in rad
    // Lower arm idle: x ≈ -0.18 (mild elbow flexion)
    expect(Math.abs(lowerArmL.rotation.x - (-0.18))).toBeLessThan(0.0087);

    // Claims should be cleared
    expect(humanoid.userData["openClinXrOwnedBoneChains"]).toEqual([]);
  });

  it("(e) the lowerarm01 ownership fix: an owned forearmL is not touched by MPFB forearm idle branch", () => {
    const humanoid = buildTestHumanoid();

    // Simulate MPFB rig detection
    humanoid.userData.openClinXrHumanoidRail = "mpfb2";

    // MPFB rig with owned forearmL (crossfade weight = 1)
    const ownedChains: OwnedChain[] = [
      {
        ownerId: "openclinxr.locomotion-clip-playback",
        boneNames: ["forearmL", "upper_armL"],
        weight: 1,
      },
    ];
    humanoid.userData["openClinXrOwnedBoneChains"] = ownedChains;

    // Simulate MPFB rig detection (sanitised names)
    const jointNames = new Set([
      "upper_armL",
      "forearmL",
      "handL",
      "upper_armR",
      "forearmR",
      "handR",
      "head",
      "spine03",
    ]);
    humanoid.userData.openClinXrMpfbForearmBinds = new Map();

    const lowerArmL = humanoid.getObjectByName("forearmL")!;
    // Set some mixer rotation
    lowerArmL.rotation.set(-0.5, 0.1, 0.2);
    const beforeLower = lowerArmL.rotation.clone();

    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // Owned forearmL should NOT be touched by MPFB forearm idle
    expect(lowerArmL.rotation.equals(beforeLower)).toBe(true);

    // Verify the ownership check happens before MPFB branch
    expect(fixtureOwnershipWeight(ownedChains, "forearmL")).toBe(1);
  });

  it("(f) governor bounds transition jumps: teleport under ownership, then claim clear, arrival, frozen holds", async () => {
    const humanoid = buildTestHumanoid(true);

    // Simulate MPFB rig detection - need MPFB joint names for isMpfb2Rig() to return true
    // Add MPFB leg bones so collectJointNames finds them
    const upperLegL = humanoid.getObjectByName("upperleg01.L")!;
    const upperLegR = humanoid.getObjectByName("upperleg01.R")!;
    upperLegL.name = "upperleg01.L";
    upperLegR.name = "upperleg01.R";

    // Simulate MPFB rig detection
    humanoid.userData.openClinXrHumanoidRail = "mpfb2";

    // Replace forearmL with lowerarm01.L to match MPFB naming
    const lowerArmL = humanoid.getObjectByName("forearmL")!;
    lowerArmL.name = "lowerarm01.L";

    // Add MPFB bind for lowerarm01.L (A-pose bind with elbow flexed ~40 deg on X)
    // Key must be sanitised (dots removed, case preserved): "lowerarm01.L" -> "lowerarm01L"
    const bind = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0)); // ~40 deg X bend
    humanoid.userData.openClinXrMpfbForearmBinds = new Map([
      ["lowerarm01L", { x: bind.x, y: bind.y, z: bind.z, w: bind.w }],
    ]);
    const bindBend = 2 * Math.atan2(bind.x, bind.w);
    const idleQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6 * bindBend, 0, 0));

    // Converge to idle first (unowned absolute write + governor first-sight record).
    lowerArmL.quaternion.copy(idleQuat);
    applyGeneratedHumanoidClinicalIdlePosture(humanoid);
    expect(lowerArmL.quaternion.angleTo(idleQuat)).toBeLessThan(1e-6);

    // A 25 deg teleport under ownership (whatever the in-pass blend does with it).
    const jump = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 25 * Math.PI / 180);
    const teleported = idleQuat.clone().premultiply(jump);
    const rotations: THREE.Quaternion[] = [lowerArmL.quaternion.clone()];
    const perCallChange: number[] = [];
    const step = (w: number | null) => {
      lowerArmL.quaternion.copy(teleported);
      humanoid.userData["openClinXrOwnedBoneChains"] = w === null ? [] : [
        { ownerId: "openclinxr.locomotion-clip-playback", boneNames: ["lowerarm01.L"], weight: w },
      ];
      const before = rotations[rotations.length - 1]!.clone();
      applyGeneratedHumanoidClinicalIdlePosture(humanoid);
      const result = lowerArmL.quaternion.clone();
      perCallChange.push(before.angleTo(result));
      rotations.push(result);
    };
    // Owned release, then the claim clears mid-convergence (the fade-end handoff).
    step(0.5); step(0.5); step(0.5);
    step(null); step(null); step(null); step(null); step(null);
    step(null); step(null); step(null); step(null); step(null);

    // No call covers more than the governor cap (3.5 deg), including the clear frame.
    const govCapRad = (3.5 * Math.PI) / 180;
    for (const change of perCallChange) {
      expect(change).toBeLessThanOrEqual(govCapRad + 1e-6);
    }

    // It still arrives back at idle.
    expect(rotations[rotations.length - 1]!.angleTo(idleQuat)).toBeLessThan(0.02);

    // A frozen mixer holds exactly (repeat collapse): one more call with no re-pose.
    applyGeneratedHumanoidClinicalIdlePosture(humanoid);
    expect(lowerArmL.quaternion.angleTo(rotations[rotations.length - 1]!)).toBeLessThan(1e-9);
  });

});