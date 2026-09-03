import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the runtime-goal arm reaches its target with a wrist residual of 0.00 m while the
 * elbow is folded to a 16.8 deg interior angle — past maximum human flexion, with the forearm driven
 * back through the upper arm and into the torso. The solver reports success on an impossible pose.
 *
 * MEASURED 2026-09-03 from runtime-goal-eval.json at 5524da80, all 12 oscillation frames, computed
 * from recorded WORLD POSITIONS only (no quaternions — see the frame trap below):
 *
 *   elbow interior angle, upperarm01R-lowerarm01R-wristR    16.8 deg at EVERY frame
 *   shoulder angle, shoulder01R-upperarm01R-lowerarm01R    110.3 deg at every frame
 *   upper arm length                                        26.29 cm, constant
 *   forearm length                                          23.47 cm, constant
 *   wristR -> targetWorld residual                           0.00 cm at every frame
 *
 * A human elbow's interior angle runs from ~180 deg (full extension) to ~30-35 deg at maximum
 * flexion. 16.8 deg puts the hand BEHIND the elbow. The constant bone lengths confirm the solve is
 * rotation-only, so this is not a scaling artefact: the joint is simply rotated past its range.
 *
 * WHY THE EXISTING PROOFS ARE ALL GREEN ON THIS POSE. The bake-off recorded the same 0.00 m residual
 * on the frame whose native still shows the right arm missing entirely, with a torn hole through the
 * right shoulder and collar (graded 2026-09-03; baked_tracks on the same behaviour keeps both arms
 * intact). Residual measures distance to goal. The body-region contract measures goal-to-region and
 * the declared chain. None of the three can tell a reaching arm from a collapsed one.
 *
 * THE CAUSE IS A SHIPPED API THAT IS NOT WIRED, not a missing mechanism. three.js CCDIKSolver reads
 * per-link `rotationMin`, `rotationMax` and `limitation` (node_modules/three/examples/jsm/animation/
 * CCDIKSolver.js:146-148, applied at :200-227). The harness builds its links as
 *
 *     links: linkIndices.map((index) => ({ index })),   // harness.html, iteration: 200
 *
 * so not one of the four links declares any constraint. The compiler's own rail DOES constrain —
 * SHOULDER_BEND_LIMIT_RAD 2.0 and ELBOW_BEND_LIMIT_RAD 2.7 applied by clampBend in
 * packages/openclinxr/motion-compiler/src/ik/solve-chain.ts:64,65,280,282 — so the two rails differ
 * and only the harness rail is unconstrained.
 *
 * THE FRAME TRAP, and it has already misled one author here. The entrypoint's "IK joint limits cannot
 * be checked by any caller" section records a 504-target sweep reporting max shoulderLocal 176.5 deg
 * against a 114.6 deg limit, which reads as a clamp that never binds and is a DIFFERENT ANGLE:
 * shoulderLocal lives in the parent frame, the clamp constrains world directions, and the two differ
 * by parentQ. Every assertion below is computed from three world POSITIONS, so no frame conversion
 * exists to get wrong.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite the
 * measured tables.
 *
 * claimScope: whether the solved right elbow's interior angle stays inside human flexion range across
 *   the recorded oscillation, while the wrist still reaches its goal and bone lengths stay fixed.
 * notEvidenceFor: what any still SHOWS — no pixel is graded here. Whether rotationMin/rotationMax are
 *   the right fix on this rig (they are Euler clamps and are documented to misbehave on bones with
 *   offset rest rotations or ranges crossing +-pi; `limitation` is a hinge axis and may suit an elbow
 *   better). The compiler rail's limits, whose binding behaviour remains unmeasurable from
 *   SolvedArmPose. The left arm. Shoulder ROM, which is a clinical question this does not settle.
 *   Quest frame budget.
 */

/**
 * ## FIXED (#0)
 *
 * harness.html now wires per-link constraints on its CCDIKSolver links. Measured on this MPFB rig
 * BEFORE choosing the mechanism: lowerarm01.R (the elbow link, links[0], chainRoles[0]) rest local
 * Euler is (36.4, 5.9, 2.5) deg — a genuine offset rest rotation, so the documented Euler-clamp
 * caveat (mrdoob/three.js issue 29682) was measured, not assumed. The unconstrained fold was a
 * 142.9 deg rotation about local axis (0.745, 0.004, 0.667) taking the local Euler to (139.2, 65.4,
 * 48.9) deg; flexion to the 155 deg ceiling (interior 25 deg, matching the compiler rail's 2.7 rad
 * at solve-chain.ts:65) maps to ~(115.4, 49.7, 51.2) deg. A component-wise box therefore separates
 * the fold from the ceiling pose.
 *
 * | candidate (lowerarm01R constraint) | worst interior deg | max wrist residual m |
 * |---|---|---|
 * | none (shipped 5524da80) | 16.8 | 0.000 |
 * | `limitation` hinge axis (0.745, 0, 0.667) | 9.25 | 0.000 |
 * | `rotationMax` box (117, 52, 58) deg — SHIPPED | 31.75 | 0.000 |
 *
 * `limitation` alone does not bind: it is a range-free hinge and the fold IS flexion overshoot, so
 * it survives. The shipped `rotationMax` box on links[0] (radians 2.042/0.908/1.012, applied per
 * CCD iteration at CCDIKSolver.js:219-229) keeps every oscillation frame inside human flexion —
 * 31.75 deg interior, i.e. ~148 deg flexion, inside the normal 145-150 deg maximum — while the
 * wrist still reaches its goal at 0.000 m residual and both bone lengths stay constant (spread
 * ~1e-16 m). Recorded by re-running runtime-goal-eval.mts at 9ea15acd; the descriptor and the
 * goal-pointing logic are untouched.
 */

const ROOT = join(import.meta.dirname, "../../..");
const EVAL = join(ROOT, "tools/openclinxr/evidence/motion-backend-bakeoff/runtime-goal-eval.json");
const HARNESS = join(ROOT, "tools/openclinxr/evidence/motion-backend-bakeoff/harness.html");

/**
 * The generous outer bound of published elbow flexion, expressed as the interior angle at the joint.
 *
 * Normal maximum flexion is 145-150 deg, leaving an interior angle of 30-35 deg. 25 deg here
 * corresponds to 155 deg of flexion, beyond the normal range, so a pose that fails this clause is
 * outside human ROM by any reading. It is an EXTERNAL anatomical floor, not a value fitted to the
 * observation: measured is 16.8 deg, so the margin is 8.2 deg.
 */
const MIN_ELBOW_INTERIOR_DEG = 25;

/** From the body-region contract: an effector more than 0.03 m from its target is not in contact. */
const CONTACT_TOLERANCE_M = 0.03;

type Vec = { x: number; y: number; z: number };
type Frame = { bones: Record<string, Vec>; targetWorld: Vec; solverBlend: number };

const evalReport = (): { oscillation: Frame[] } => JSON.parse(readFileSync(EVAL, "utf8"));
const frames = (): Frame[] => evalReport().oscillation;

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec): number => Math.hypot(a.x, a.y, a.z);
const dist = (a: Vec, b: Vec): number => len(sub(a, b));

/** Interior angle at `b`, in degrees, from three world positions. No frame conversion involved. */
function interiorAngleDeg(a: Vec, b: Vec, c: Vec): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const denom = len(u) * len(v);
  if (denom === 0) return Number.NaN;
  const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / denom;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);

describe("the solved elbow stays inside human flexion", () => {
  it("(0) VACUITY GUARD: the eval and harness exist, and the arm bones are all recorded", () => {
    expect(existsSync(EVAL), `${EVAL} is missing — there is no solve to measure`).toBe(true);
    expect(existsSync(HARNESS), `${HARNESS} is missing`).toBe(true);
    const f = frames();
    expect(f.length, "fewer than 12 oscillation frames recorded").toBeGreaterThanOrEqual(12);
    for (const bone of ["shoulder01R", "upperarm01R", "lowerarm01R", "wristR"]) {
      expect(f[0]?.bones[bone], `bone ${bone} is not recorded; the angle cannot be computed`).toBeDefined();
    }
  });

  it("(1) FIXED: the right elbow is not folded past maximum human flexion", () => {
    const angles = frames().map((f) =>
      interiorAngleDeg(f.bones["upperarm01R"]!, f.bones["lowerarm01R"]!, f.bones["wristR"]!),
    );
    const worst = Math.min(...angles);
    expect(worst, `worst elbow interior angle is ${worst.toFixed(1)} deg, past maximum human flexion`)
      .toBeGreaterThanOrEqual(MIN_ELBOW_INTERIOR_DEG);

    // COUNTERWEIGHT 1 — the cheapest way to straighten the elbow is to stop reaching the goal. The
    // wrist must still arrive at its target, so a fix that abandons the contact does not pass.
    const residuals = frames().map((f) => dist(f.bones["wristR"]!, f.targetWorld));
    expect(Math.max(...residuals), "the wrist no longer reaches its goal; the reach was traded for the angle")
      .toBeLessThanOrEqual(CONTACT_TOLERANCE_M);

    // COUNTERWEIGHT 2 — the second cheapest is to lengthen the arm. Rotation-only IK cannot change
    // bone lengths, so any spread here means the rig was scaled rather than the joint constrained.
    const upper = frames().map((f) => dist(f.bones["upperarm01R"]!, f.bones["lowerarm01R"]!));
    const fore = frames().map((f) => dist(f.bones["lowerarm01R"]!, f.bones["wristR"]!));
    expect(spread(upper), "upper arm length varies across frames; the arm was scaled").toBeLessThanOrEqual(0.001);
    expect(spread(fore), "forearm length varies across frames; the arm was scaled").toBeLessThanOrEqual(0.001);
  });

  it("(2) FIXED: every IK link declares a rotation constraint, and the elbow's is not a full turn", () => {
    const html = readFileSync(HARNESS, "utf8");
    // The harness constructs links inline. A constrained solver must name at least one of the three
    // constraint fields three.js CCDIKSolver reads; today the links are bare `{ index }`.
    const declaresConstraint = /rotationMin|rotationMax|limitation/.test(html);
    expect(declaresConstraint, "no IK link declares rotationMin, rotationMax or limitation").toBe(true);

    // COUNTERWEIGHT — a constraint wide enough never to bind is the same as no constraint. Whatever
    // is declared must be narrower than a full turn on at least one axis. 6.28 rad is a full turn;
    // the compiler rail's own elbow bound is 2.7 rad (solve-chain.ts:65), so anything at or beyond
    // 2*pi is looser than both rails and cannot be a limit.
    const numbers = [...html.matchAll(/rotation(?:Min|Max)[^)\n]*?(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    if (numbers.length > 0) {
      const widest = Math.max(...numbers.map(Math.abs));
      expect(widest, `declared limit ${widest} rad is a full turn or wider, so it never binds`)
        .toBeLessThan(2 * Math.PI);
    }
  });
});
