import { describe, expect, it } from "vitest";

/**
 * Planted test for the 2026-10-09 root-motion bind fix
 * (`motion_bind_from_positions_stage.py`, `apply_pose`).
 *
 * THE DEFECT, measured on Blender 5.1.1: PoseBone.location is expressed in the
 * bone's own rest frame, so the achieved armature-space offset is
 * R_rest @ location. The stage assigned an armature-space delta directly, which
 * leaked forward travel into the vertical axis by sin(tilt) * travel, where
 * tilt is the hips rest rotation's deviation from the 180-degree flip:
 * nurse 0.27 deg (no visible drop), physician 8.79 deg (0.42 m drop on 2.51 m
 * travel), child 16.43 deg (0.67 m drop on 2.15 m travel). Full numbers in
 * `.openclinxr/evidence/rootmotion-bind/pre-fix.json` (scratch, gitignored).
 *
 * This test pins the conversion contract with the measured child rest matrix:
 * the naive assignment leaks ~0.61 m into Z on a 2.15 m travel delta (the
 * bug), and the inverse-rest conversion restores the delta exactly (the fix).
 * It tests the math, not the Blender stage itself, which has no Python runner.
 */

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
type Vec3 = [number, number, number];

/** Measured child hips rest rotation, pre-fix.json matrixLocalRows (3x3). */
const CHILD_REST: Mat3 = [
  [1.0, 0.0, 7.474423000530805e-7],
  [2.1136351335826475e-07, -0.959183931350708, -0.2827831208705902],
  [7.169327886913379e-07, 0.2827831208705902, -0.9591865539550781],
];

function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Exact 3x3 inverse (what Blender's Matrix.inverted() computes). */
function inverse(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = 1 / det;
  return [
    [A * s, (c * h - b * i) * s, (b * f - c * e) * s],
    [B * s, (a * i - c * g) * s, (c * d - a * f) * s],
    [C * s, (b * g - a * h) * s, (a * e - b * d) * s],
  ];
}

describe("root bone location frame conversion", () => {
  // Child stop clip: 2.15 m of root travel along armature -Y (sign from the
  // cagematch root-displacement direction; magnitude is what leaks).
  const travel: Vec3 = [0, -2.15, 0];

  it("naive armature-space assignment leaks travel into Z (the bug)", () => {
    const achieved = mulVec(CHILD_REST, travel);
    // Predicted leak 0.61 m vs measured child root drop 0.67 m (remainder is
    // the source's own first-to-last hips change plus walking bob).
    expect(Math.abs(achieved[2])).toBeGreaterThan(0.55);
    expect(Math.abs(achieved[2])).toBeLessThan(0.7);
  });

  it("inverse-rest conversion restores the delta (the fix)", () => {
    const location = mulVec(inverse(CHILD_REST), travel);
    const achieved = mulVec(CHILD_REST, location);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(achieved[i] - travel[i])).toBeLessThan(1e-9);
    }
  });

  it("near-flip rigs leak almost nothing (why the nurse passed)", () => {
    const nurseTiltRad = ((180 - 179.7309) * Math.PI) / 180;
    expect(Math.abs(Math.sin(nurseTiltRad)) * 3.04).toBeLessThan(0.02);
  });
});
