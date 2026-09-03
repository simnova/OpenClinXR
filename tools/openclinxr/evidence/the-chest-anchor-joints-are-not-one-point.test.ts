import { existsSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the shipped MPFB rig's two chest anchor joints are the SAME POINT on the midline, so
 * a goal aimed at `rightChestSurface` aims at the sternum. Every contract that measured distance to
 * `breastR` has been measuring the spine centreline and could not see it, because the assertion and
 * the implementation agreed on the same bad anchor.
 *
 * MEASURED 2026-09-03 at 1bab31eb, read straight from
 * apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb (148 nodes, one skin, 137
 * joints) with @gltf-transform/core. Local translations, metres:
 *
 *   breast.L      ( 0.00000, 0.16119,  0.00000)   IDENTICAL to breast.R
 *   breast.R      ( 0.00000, 0.16119,  0.00000)
 *   clavicle.L    ( 0.02434, 0.08085,  0.02208)   the pair mirrors: +/- 0.02434 on x
 *   clavicle.R    (-0.02434, 0.08085,  0.02208)
 *   wrist.L       ( 0.00000, 0.12051,  0.00000)   mirrors via its parent chain
 *   wrist.R       (-0.00000, 0.12051,  0.00000)
 *
 * Both breast joints carry x = 0 exactly and the same y, so they resolve to one world position. The
 * runtime confirms it: in runtime-goal-eval.json every frame records breastL, breastR and spine01 at
 * the identical world point (0.00000, 1.34395, 0.01283), while the clavicle pair sits 4.87 cm apart
 * and the wrist pair 46.49 cm apart in the same frame.
 *
 * THIS IS AN ASSET DEFECT, NOT A RUNTIME ONE, and that was worth establishing before carding it. The
 * harness resolves the role through a literal bone-name lookup that THROWS when the joint is missing
 * ("actor lacks breast.R chest anchor", harness.html), so there is no silent fallback to a spine
 * bone. The joints exist and are co-located in the bytes.
 *
 * WHAT IT COST. Two fixes landed against this anchor and both did exactly what they promised: the
 * goal now tracks its named landmark (5524da80) and the elbow stays inside human flexion
 * (1bab31eb). A correct solve to a correctly-tracked wrong landmark still puts the hand on the
 * sternum. The re-captured still shows a hand at the throat rather than on the right chest.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite
 * the measured tables.
 *
 * claimScope: whether the shipped rig's two chest anchor joints are laterally separated, mirrored
 *   about the midline, and separated by more than the clavicle pair in the same file.
 * notEvidenceFor: what any still SHOWS — no pixel is graded here. Whether 16.1 cm above the parent
 *   is the right height for a chest anchor. Any other rig; only mpfb-clinical-nurse-adult is read.
 *   Whether `rightChestSurface` is the right region for a pulse-taking gesture. The compiler rail.
 *   Quest frame budget.
 */

const ROOT = join(import.meta.dirname, "../../..");
const ACTOR = join(ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");

/**
 * Upper bound on chest-anchor separation, from anatomy rather than from this asset: adult
 * nipple-to-nipple distance tops out around 22 cm, so 25 cm admits any real human and refuses a
 * "fix" that simply flings the joints outward to clear the floor below.
 */
const MAX_CHEST_SEPARATION_M = 0.25;

type Joint = { name: string; t: readonly number[] };

async function joints(): Promise<Joint[]> {
  const doc = await new NodeIO().read(ACTOR);
  return doc
    .getRoot()
    .listNodes()
    .map((n) => ({ name: n.getName(), t: [...n.getTranslation()] as readonly number[] }));
}

const byName = (all: Joint[], name: string): Joint | undefined => all.find((j) => j.name === name);

describe("the chest anchor joints are not one point", () => {
  it("(0) VACUITY GUARD: the actor exists and carries both chest joints and both clavicles", async () => {
    expect(existsSync(ACTOR), `${ACTOR} is missing — there is no rig to measure`).toBe(true);
    const all = await joints();
    for (const n of ["breast.L", "breast.R", "clavicle.L", "clavicle.R"]) {
      expect(byName(all, n), `joint ${n} is absent; the assertions below would be about nothing`).toBeDefined();
    }
  });

  it.fails("(1) RED: the two chest anchors are laterally separated, and by more than the clavicles", async () => {
    const all = await joints();
    const bl = byName(all, "breast.L")!;
    const br = byName(all, "breast.R")!;
    const cl = byName(all, "clavicle.L")!;
    const cr = byName(all, "clavicle.R")!;

    const chestSpan = Math.abs(bl.t[0]! - br.t[0]!);
    const clavicleSpan = Math.abs(cl.t[0]! - cr.t[0]!);

    // THE FLOOR IS ANATOMICAL AND SOURCED FROM THIS SAME FILE. Clavicle joint roots sit medially,
    // near the sternum; the breasts are lateral to them. So a rig whose chest anchors are closer
    // together than its clavicle roots is wrong by construction, whatever the absolute numbers are.
    expect(
      chestSpan,
      `chest anchors span ${(chestSpan * 100).toFixed(3)} cm, the clavicle pair spans ${(clavicleSpan * 100).toFixed(3)} cm`,
    ).toBeGreaterThan(clavicleSpan);

    // COUNTERWEIGHT 1 — the cheapest way to clear the floor is to fling the joints apart. Bounded
    // above from anatomy, not from this asset, so widening cannot buy a pass.
    expect(chestSpan, `chest anchors span ${(chestSpan * 100).toFixed(1)} cm, wider than any human chest`)
      .toBeLessThanOrEqual(MAX_CHEST_SEPARATION_M);

    // COUNTERWEIGHT 2 — the second cheapest is to move ONE side. The pair must mirror about the
    // midline, which is the convention the clavicles in this same file already follow.
    expect(Math.sign(bl.t[0]!), "breast.L is not on the +x side of the midline").toBe(1);
    expect(Math.sign(br.t[0]!), "breast.R is not on the -x side of the midline").toBe(-1);
    expect(
      Math.abs(Math.abs(bl.t[0]!) - Math.abs(br.t[0]!)),
      "the chest anchors are not mirrored: their distances from the midline differ",
    ).toBeLessThanOrEqual(0.001);
  });

  it.fails("(2) RED: the chest anchors are not co-located with a spine joint", async () => {
    const all = await joints();
    const br = byName(all, "breast.R")!;
    const spine01 = byName(all, "spine01");
    // spine01 shares breast.R's exact local translation today (0, 0.16119, 0). A chest SURFACE
    // anchor that coincides with a spine joint is inside the torso, not on its surface.
    if (spine01) {
      const same =
        Math.abs(br.t[0]! - spine01.t[0]!) < 1e-9
        && Math.abs(br.t[1]! - spine01.t[1]!) < 1e-9
        && Math.abs(br.t[2]! - spine01.t[2]!) < 1e-9;
      expect(same, "breast.R has the identical local translation as spine01").toBe(false);
    }
  });
});
