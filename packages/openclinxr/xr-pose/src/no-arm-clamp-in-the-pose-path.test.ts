import { applyHumanoidJointRotationsByAlias } from "@openclinxr/xr-pose";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

/**
 * No arm clamp anywhere in the pose path (arm-settle bar e).
 *
 * The arm-settle fix changes the ownership blend the posture pass receives (single application
 * of a continuous weight ramp) — never a limiter on how far a bone may move per frame. A
 * per-frame rate limiter would slow real gestures and leave the cut in place, so the pose path
 * must apply a commanded pose immediately. This test commands an upper-arm target 60 deg from
 * its current orientation through the role-pose writer outside locomotion and asserts it lands
 * on the same call.
 */
describe("the pose path applies a far arm target on the same frame", () => {
  it("reaches a 60-deg-away upper-arm target with one writer call (no clamp)", () => {
    const humanoid = new THREE.Group();
    const upperArmL = new THREE.Object3D();
    upperArmL.name = "upper_armL";
    upperArmL.rotation.set(0, 0, 0);
    upperArmL.updateMatrixWorld(true);
    humanoid.add(upperArmL);
    const target = new Map([["upper_armL", { x: -Math.PI / 3, y: 0, z: 0, absolute: true }]]);
    applyHumanoidJointRotationsByAlias(humanoid, target, "arm_settle_no_clamp_probe");
    expect(upperArmL.rotation.x).toBeCloseTo(-Math.PI / 3, 9);
    expect(upperArmL.rotation.y).toBeCloseTo(0, 9);
    expect(upperArmL.rotation.z).toBeCloseTo(0, 9);
    expect(upperArmL.userData["openClinXrRoleSpecificPose"]).toBe("arm_settle_no_clamp_probe");
  });
});
