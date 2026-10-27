/**
 * CI cleanup — applySupinePose per-rail default regression (Anny keeps the 17 eulers, MPFB2 skips).
 *
 * Hardened: exact 17-key map pins, exact bonesTouched counts, non-vacuous root-basis assert.
 */
import { Bone, Object3D, Quaternion, Euler } from "three";
import { describe, expect, it } from "vitest";
import { applySupinePose } from "./index.js";

const EXPECTED_KEYS = [
  "pelvis", "spine", "chest", "thighL", "thighR", "shinL", "shinR", "footL", "footR",
  "upper_armL", "upper_armR", "forearmL", "forearmR", "handL", "handR", "neck", "head",
] as const;

/** Canonical on-back root basis: Euler(-PI/2, 0, PI/2, "XYZ") -> [-.5,.5,.5,.5]. */
const EXPECTED_ROOT_QUAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, Math.PI / 2, "XYZ"));

function bone(name: string): Bone {
  const b = new Bone();
  b.name = name;
  return b;
}

function annyRig(): Object3D {
  const root = new Object3D();
  root.name = "root";
  const bones = [
    "pelvis", "spine", "chest", "thighL", "thighR", "shinL", "shinR", "footL", "footR",
    "upper_armL", "upper_armR", "forearmL", "forearmR", "handL", "handR", "neck", "head",
    "root", "spine01", "spine02", "thighL01", "upperarmL01", "neck01",
  ];
  for (const n of bones) root.add(bone(n));
  return root;
}

function mpfb2Rig(): Object3D {
  const root = new Object3D();
  root.name = "root";
  for (const n of ["upperleg01.L", "upperleg02.L", "lowerleg01.L", "lowerleg02.L", "spine03", "neck01"]) {
    root.add(bone(n));
  }
  return root;
}

function expectRootBasis(q: Quaternion): void {
  expect(q.length(), "root basis must be a unit quaternion").toBeCloseTo(1, 5);
  expect(q.angleTo(EXPECTED_ROOT_QUAT), "root basis must equal canonical [-.5,.5,.5,.5]").toBeCloseTo(0, 5);
  expect([q.x, q.y, q.z, q.w].map((v) => +v.toFixed(3))).toEqual([-0.5, 0.5, 0.5, 0.5]);
}

describe("applySupinePose per-rail joint-euler default", () => {
  it("applies exactly the 17 canonical eulers by default on the Anny rail", () => {
    const rig = annyRig();
    const res = applySupinePose(rig);
    expect(res.applied).toBe(true);
    expect([...res.bonesTouched].sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(res.bonesTouched.length).toBe(17);
    expect(rig.userData["openClinXrSupinePoseBones"].length).toBe(17);
  });

  it("skips the 17 eulers by default on the MPFB2 rail", () => {
    const rig = mpfb2Rig();
    const res = applySupinePose(rig);
    expect(res.applied).toBe(false);
    expect(res.bonesTouched).toEqual([]);
    expect(rig.userData["openClinXrSupinePoseBones"]).toEqual([]);
  });

  it("explicit opt-in still applies eulers on the MPFB2 rail", () => {
    const rig = mpfb2Rig();
    const res = applySupinePose(rig, { applyJointEulers: true });
    expect(res.applied).toBe(true);
    // Resolved subset of the 17 canonical keys through the actual MPFB2 joint map
    // (pose-bone-resolver.ts MPFB2_RIG_BONE_NAMES): spine->spine03, thighL->upperleg01.L,
    // shinL->lowerleg01.L, neck->neck01. Exactly these 4 resolve on this rig.
    expect([...res.bonesTouched].sort()).toEqual(
      ["lowerleg01.L", "neck01", "spine03", "upperleg01.L"].sort(),
    );
    expect(res.bonesTouched.length).toBe(4);
    // 3 carry non-zero eulers; neck01 maps the legitimate zero euler {x:0,y:0,z:0}
    // so its quaternion stays identity — an explicit map entry, not a skip.
    const identity = new Quaternion();
    let mutated = 0;
    rig.traverse((o) => {
      if ((o as Bone).isBone && !(o.quaternion as Quaternion).equals(identity)) mutated++;
    });
    expect(mutated, "exactly the 3 non-zero-euler bones mutate").toBe(3);
    const neck = rig.getObjectByName("neck01") as Bone;
    expect(neck.quaternion.equals(identity), "zero-euler neck01 keeps the identity quaternion").toBe(true);
    expect(res.bonesTouched, "resolved set includes the zero-euler neck01").toContain("neck01");
  });

  it("explicit opt-out skips eulers on the legacy rail", () => {
    const rig = annyRig();
    const res = applySupinePose(rig, { applyJointEulers: false });
    expect(res.applied).toBe(false);
    expect(res.bonesTouched).toEqual([]);
  });

  it("root basis equals canonical [-.5,.5,.5,.5] on both rails regardless of the euler switch", () => {
    for (const rig of [annyRig(), mpfb2Rig()]) {
      applySupinePose(rig);
      expectRootBasis(rig.quaternion as Quaternion);
      expect(rig.userData["openClinXrActorPosture"]).toBe("supine");
    }
    const rigOpt = annyRig();
    applySupinePose(rigOpt, { applyJointEulers: false });
    expectRootBasis(rigOpt.quaternion as Quaternion);
  });
});
