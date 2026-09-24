import { Euler, Quaternion, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { applyGeneratedHumanoidClinicalIdlePosture } from "@openclinxr/xr-pose";

/**
 * Head attention must not discard a non-identity bind orientation.
 *
 * MEASURED 2026-09-23 off the shipped GLB
 * (`apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb`):
 * head rest local (-0.538, 0.036, 0.036, 0.842) is 65.4 deg off identity and
 * neck03 rest local is 69.3 deg off identity. The posture pass wrote head (and,
 * through the head/neck alias, neck01-03) with an ABSOLUTE euler (-0.04, 0, 0),
 * replacing those orientations outright. Forward kinematics through the file:
 * clip-only head pitch 13.36 deg below horizontal vs 69.67 deg with the
 * posture overwrite; the source `Walk` clip on its own skeleton averages
 * 16.59 deg. The overwrite, not the clip, bows the head.
 *
 * known-good: the bone's own rest orientation plus the -0.04 rad attention pitch.
 */

const HEAD_REST = new Quaternion(-0.5378, 0.0356, 0.0365, 0.8415).normalize();
const NECK_REST = new Quaternion(0.565, -0.049, -0.041, 0.823).normalize();

function buildHeadRig(): { root: Object3D; neck: Object3D; head: Object3D } {
  const root = new Object3D();
  root.name = "humanoid_root";
  const neck = new Object3D();
  neck.name = "neck03";
  neck.quaternion.copy(NECK_REST);
  root.add(neck);
  const head = new Object3D();
  head.name = "head";
  head.quaternion.copy(HEAD_REST);
  neck.add(head);
  root.updateMatrixWorld(true);
  return { root, neck, head };
}

/** World forward (+Z column) pitch below horizontal, in degrees. */
function headPitchDeg(head: Object3D): number {
  head.updateWorldMatrix(true, false);
  const e = head.matrixWorld.elements;
  const y = Math.max(-1, Math.min(1, e[9] ?? Number.NaN));
  return (-Math.asin(y) * 180) / Math.PI;
}

describe("head attention preserves a non-identity bind", () => {
  it("(1) head world pitch stays within 5 deg of its rest pitch instead of snapping to the absolute euler", () => {
    const { root, head } = buildHeadRig();
    const restPitch = headPitchDeg(head);

    applyGeneratedHumanoidClinicalIdlePosture(root);

    const afterPitch = headPitchDeg(head);
    expect(
      Math.abs(afterPitch - restPitch),
      `head pitch ${afterPitch.toFixed(1)} deg vs rest ${restPitch.toFixed(1)} deg: the absolute write discarded the bind`,
    ).toBeLessThan(5);
  });

  it("(2) head local orientation equals bind composed with the -0.04 rad attention pitch within 0.5 deg", () => {
    const { root, head } = buildHeadRig();

    applyGeneratedHumanoidClinicalIdlePosture(root);

    const attention = new Quaternion().setFromEuler(new Euler(-0.04, 0, 0));
    const expected = HEAD_REST.clone().multiply(attention);
    expect(head.quaternion.angleTo(expected) * 180 / Math.PI).toBeLessThan(0.5);
  });

  it("(3) an off-identity neck keeps its rest orientation within 5 deg", () => {
    const { root, neck } = buildHeadRig();
    neck.updateWorldMatrix(true, false);
    const restY = (neck.matrixWorld.elements[9] ?? 0) as number;

    applyGeneratedHumanoidClinicalIdlePosture(root);

    neck.updateWorldMatrix(true, false);
    const afterY = (neck.matrixWorld.elements[9] ?? 0) as number;
    const restPitch = (-Math.asin(Math.max(-1, Math.min(1, restY))) * 180) / Math.PI;
    const afterPitch = (-Math.asin(Math.max(-1, Math.min(1, afterY))) * 180) / Math.PI;
    expect(
      Math.abs(afterPitch - restPitch),
      `neck pitch ${afterPitch.toFixed(1)} deg vs rest ${restPitch.toFixed(1)} deg`,
    ).toBeLessThan(5);
  });
});
