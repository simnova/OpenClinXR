import { applyGeneratedHumanoidClinicalIdlePosture, type OwnedChain } from "@openclinxr/xr-pose";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

/**
 * The posture pass applies an owned bone ONCE per call (arm-settle).
 *
 * CAUSE. `applyGeneratedHumanoidClinicalIdlePosture` traverses the scene graph AND every
 * skinned mesh's skeleton (`clinical-idle-posture.ts`). A skinned figure shares its skeleton
 * across its meshes, so the skeleton loop re-presented the same bone objects once per mesh.
 * Absolute writes are idempotent, but the ownership slerp is not: N applications compound the
 * mixer residual to w^N (measured w^19 on the physician), crushing the continuous 0→1
 * ownership ramp into a one-frame step at both walk start and walk end. The pass now guards
 * by bone OBJECT identity: shared objects apply once, distinct same-named objects each apply.
 */
function buildSharedSkeletonHumanoid(meshCount: number): { root: THREE.Object3D; upperArmL: THREE.Object3D } {
  const root = new THREE.Object3D();
  root.name = "humanoid_root";
  root.userData["openClinXrActorPosture"] = "standing";
  const upperArmL = new THREE.Object3D();
  upperArmL.name = "upper_armL";
  root.add(upperArmL);
  for (let i = 0; i < meshCount; i += 1) {
    const mesh = new THREE.Object3D() as THREE.Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: THREE.Object3D[] };
    };
    mesh.name = `garment_mesh_${i}`;
    mesh.isSkinnedMesh = true;
    mesh.skeleton = { bones: [upperArmL] };
    root.add(mesh);
  }
  return { root, upperArmL };
}

function quatAngleDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

describe("the posture pass applies an owned bone once per call", () => {
  it("a shared-skeleton bone with w=0.5 lands halfway between mixer and idle, not compounded", () => {
    const { root, upperArmL } = buildSharedSkeletonHumanoid(3);
    const mixerEuler = new THREE.Euler(0.6, 0.1, -0.4);
    upperArmL.rotation.copy(mixerEuler);
    upperArmL.updateMatrixWorld(true);
    const mixerQuat = upperArmL.quaternion.clone();

    // Idle target: the same bone with no claim takes the absolute write.
    applyGeneratedHumanoidClinicalIdlePosture(root);
    const idleQuat = upperArmL.quaternion.clone();
    const fullSwingDeg = quatAngleDeg(mixerQuat, idleQuat);
    expect(fullSwingDeg).toBeGreaterThan(5);

    // Owned at w=0.5, skeleton shared across 3 meshes: one application blends halfway.
    upperArmL.quaternion.copy(mixerQuat);
    upperArmL.rotation.setFromQuaternion(mixerQuat);
    const owned: OwnedChain[] = [
      { ownerId: "openclinxr.locomotion-clip-playback", boneNames: ["upper_armL"], weight: 0.5 },
    ];
    root.userData["openClinXrOwnedBoneChains"] = owned;
    applyGeneratedHumanoidClinicalIdlePosture(root);
    const blendedDeg = quatAngleDeg(upperArmL.quaternion, mixerQuat);
    // Single slerp(t=0.5): half the swing. Compounded (4 applications): 94% of the swing.
    expect(blendedDeg).toBeGreaterThan(fullSwingDeg * 0.4);
    expect(blendedDeg).toBeLessThan(fullSwingDeg * 0.6);
  });

  it("distinct same-named objects each still get their own write", () => {
    const root = new THREE.Object3D();
    root.name = "humanoid_root";
    root.userData["openClinXrActorPosture"] = "standing";
    const first = new THREE.Object3D();
    first.name = "upper_armL";
    first.rotation.set(0.6, 0, 0);
    root.add(first);
    const second = new THREE.Object3D();
    second.name = "upper_armL";
    second.rotation.set(-0.6, 0, 0);
    root.add(second);
    const owned: OwnedChain[] = [
      { ownerId: "openclinxr.locomotion-clip-playback", boneNames: ["upper_armL"], weight: 0.5 },
    ];
    root.userData["openClinXrOwnedBoneChains"] = owned;
    applyGeneratedHumanoidClinicalIdlePosture(root);
    // Identity guard, not name guard: the two objects blended from different mixer poses and
    // did not converge.
    expect(quatAngleDeg(first.quaternion, second.quaternion)).toBeGreaterThan(5);
  });
});
