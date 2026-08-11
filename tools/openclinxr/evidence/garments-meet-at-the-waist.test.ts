import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The learner-visible adult female shows a ragged band of bare skin at the waist, between the top and
 * the trousers. #295 graded it and could not locate it; four of my own instruments then failed to,
 * because they were all asking the wrong question. This one asks the right one.
 *
 * WHY THE EXISTING COVERAGE GATE IS GREEN AND THE PIXELS ARE NOT.
 * `garment-covers-its-region.test.ts` is **5/5 on current main**. It measures POKE-THROUGH — body faces
 * protruding through a garment — and the hide mask's coverage of them. A **gap between two garments** is
 * not poke-through: no face pokes through anything, there is simply no cloth there. Different defect
 * class, structurally invisible to that instrument. This is the §6t lesson again — five gates measured
 * proximity and extremes while the defect lived in continuity.
 *
 * MEASURED 2026-08-11 on the shipped GLBs, per angular bucket around the vertical axis (36 buckets;
 * upper garment's lowest hem vertex vs lower garment's highest waistband vertex; positive = overlap):
 *
 *   rail                          | upper garment    | min overlap | median | gapped buckets
 *   ------------------------------|------------------|-------------|--------|----------------
 *   body-param-adult_lean_female  | civilian_shirt   | **-32.8 mm**| -1.6 mm| **14 / 22**
 *   body-param-adult_heavy_male   | scrub_shirt      | **+0.1 mm** | +5.7 mm| **0 / 16**
 *
 * **Same lower garment on both** (`cargo_pants`), different upper. The scrub shirt meets the waistband
 * at every measured angle; the civilian shirt misses it at 64% of them, opening to 3.3 cm of bare skin.
 * So this is a per-garment fit outcome, not a property of the body or the pipeline — which is what
 * makes a known-good column possible at all.
 *
 * THE KNOWN-GOOD COLUMN IS REAL BUT MARGINAL, AND SAYING SO IS THE POINT (§9s).
 * `heavy_male` clears by **0.1 mm** at its tightest bucket. That is a genuine pass on real geometry —
 * zero gapped buckets out of sixteen — and it is one re-bake away from failing. **This contract buys
 * "no visible gap", not "a well-tailored waist."** A robust target would be several millimetres of
 * positive overlap at every angle, and NEITHER rail achieves that today. Do not read a green here as
 * the waist being solved.
 *
 * WHERE THE THRESHOLDS COME FROM:
 *
 *   overlap >= 0 at every bucket.  Not tuned — zero is the definition of "the garments meet". The bad
 *                                  column is 32.8 mm the wrong side of it; the good column is 0.1 mm
 *                                  the right side.
 *   overlap <= 100 mm.             Refuses "extend the hem to the knees", which satisfies the floor by
 *                                  turning a shirt into a tunic. A hand's width is the loosest defensible
 *                                  reading of "a shirt overlaps a waistband"; the good column sits at
 *                                  5.7 mm median, so this bound is nowhere near it and is close to
 *                                  vacuous today. It exists for the fix, not for the present — stated
 *                                  rather than left to read as a strong green (§7t).
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                        | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                         |FAIL |pass |pass |pass | REFUSED
 *   b) delete the upper garment                      |pass |pass |**FAIL**|pass| REFUSED
 *   c) delete the lower garment                      |pass |pass |**FAIL**|pass| REFUSED
 *   d) extend the shirt hem to the knees             |pass |pass |pass |**FAIL**| REFUSED
 *   e) raise the trouser waistband to the armpits    |pass |pass |pass |**FAIL**| REFUSED
 *   f) fit the hem so it meets the waistband         |pass |pass |pass |pass | ALL PASS
 *
 * (b) and (c) are the degenerate escapes — with one garment gone there are no buckets to compare and
 * the overlap set is empty, so (3) requires both garments to still be present with a comparable rim.
 * (d) and (e) reach the floor by making the overlap absurd, which (4) bounds.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today on the female. (2) is the
 * known-good column and passes today on the male, marginally, as disclosed. (3) and (4) pass today and
 * constrain the fix.
 *
 * NOT TESTED: nothing is rendered. This measures two silhouette edges against each other at 36 angles;
 * it does not prove the hem LOOKS tidy, that the raggedness is gone (both edges have ~30 mm span, which
 * this contract does not bound), or that skin is invisible — a garment can meet a waistband and still
 * show skin through a fold. Only the two library rails are measured; the Anny rail's garments are
 * painted regions, not shells, and have no hem to compare. The footwear poke-through from the same #295
 * grade is untouched.
 *
 * ## FIXED (#320)
 *
 * `body_param_stage.py` now pushes the upper garment's hem down to the lower garment's waistband rim,
 * per angular bucket, AFTER the coverage gate — so `lower_garment` is the geometry that SHIPS (a sparse
 * library fit is replaced by the body-derived cover shell inside that gate; measuring before it reads a
 * mesh that never reaches the export). The terminus is DERIVED from the lower garment's own waistband rim
 * (D1): for every bucket the upper hem's lowest rim vertex is pushed to at least the lower waistband's
 * highest rim vertex minus a 5 mm margin, with a taper that is zero at the top of the rim band so the
 * band stays welded to the garment. The stage angle convention mirrors the contract exactly (the Y-up
 * export maps stage (x,y,z) to glTF (x,z,-y), so `atan2(-stage_y, stage_x)` is the contract's
 * `atan2(glb_z, glb_x)`). A garment that already meets is a no-op; the known-good scrub column improved
 * from +0.1 mm to +5.0 mm of overlap (the issue names "several millimetres" as the robust target).
 *
 * Re-baked through `pnpm asset:body-param:fit -- --once` (2026-08-11), measured on the shipped GLBs:
 *
 *   rail                          | upper garment    | min overlap | median | gapped buckets
 *   ------------------------------|------------------|-------------|--------|----------------
 *   body-param-adult_lean_female  | civilian_shirt   |  **+5.0 mm**|+5.0 mm | **0 / 22**
 *   body-param-adult_heavy_male   | scrub_shirt      |  **+5.0 mm**|+5.7 mm | **0 / 16**
 *
 * The `it.fails` marker on (1) was flipped to `it`; all four clauses pass on the re-baked bytes. The
 * same marginality disclosure from the header still applies: a green here means "no visible gap", not
 * "a well-tailored waist" — the ragged ~30 mm span of both edges is deliberately not bounded.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CANDIDATES = `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates`;

const UPPER = /shirt|top|scrub|gown|tshirt/i;
const LOWER = /pants|trouser|short/i;
const BUCKETS = 36;
/** Fraction of a garment's own Y range treated as its rim band. */
const RIM_FRACTION = 0.12;
/** Zero is the definition of "the garments meet". Not tuned. */
const MIN_OVERLAP_M = 0;
/** Refuses turning a shirt into a tunic to clear the floor. Loose by design; see header. */
const MAX_OVERLAP_M = 0.1;

type WaistFit = { id: string; overlaps: number[]; gapped: number };

const io = new NodeIO();

/**
 * Per-angle overlap between the upper garment's hem and the lower garment's waistband.
 * Positive means the waistband sits ABOVE the hem — they overlap. Negative is a gap.
 */
async function measureWaist(id: string): Promise<WaistFit> {
  const doc = await io.read(`${CANDIDATES}/${id}.glb`);
  let hem: number[] | null = null;
  let waist: number[] | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      if (!/makeclothes/i.test(name)) continue;
      const isUpper = UPPER.test(name);
      const isLower = LOWER.test(name);
      if (!isUpper && !isLower) continue;

      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const el: [number, number, number] = [0, 0, 0];
      const verts: [number, number, number][] = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        const [x, y, z] = pos.getElement(i, el);
        verts.push([x!, y!, z!]);
      }
      const ys = verts.map((v) => v[1]);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      const ref = isUpper ? lo : hi;

      const edge = new Array<number>(BUCKETS).fill(isUpper ? Infinity : -Infinity);
      for (const [x, y, z] of verts) {
        if (Math.abs(y - ref) > (hi - lo) * RIM_FRACTION) continue;
        const angle = Math.atan2(z, x);
        const b = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
        edge[b] = isUpper ? Math.min(edge[b]!, y) : Math.max(edge[b]!, y);
      }
      if (isUpper) hem = edge;
      else waist = edge;
    }
  }

  const overlaps: number[] = [];
  if (hem && waist) {
    for (let b = 0; b < BUCKETS; b += 1) {
      if (Number.isFinite(hem[b]!) && Number.isFinite(waist[b]!)) overlaps.push(waist[b]! - hem[b]!);
    }
  }
  return { id, overlaps, gapped: overlaps.filter((o) => o < MIN_OVERLAP_M).length };
}

const female = await measureWaist("body-param-adult_lean_female-library");
const male = await measureWaist("body-param-adult_heavy_male-library");

/** An unmeasured rail must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(fit: WaistFit): void {
  expect(fit.overlaps.length, `${fit.id}: comparable hem/waistband buckets found`).toBeGreaterThanOrEqual(12);
}

const mm = (m: number): string => `${(m * 1000).toFixed(1)}mm`;

describe("the upper and lower garments meet at the waist", () => {
  it("(1) RED→GREEN: no angular bucket has a gap between hem and waistband", () => {
    requireMeasured(female);
    const worst = Math.min(...female.overlaps);
    expect(
      female.gapped,
      `${female.id}: gapped buckets of ${female.overlaps.length}, worst ${mm(worst)}`,
    ).toBe(0);
  });

  it("(2) NET known-good: the heavy-male rail meets at every angle (marginally — see header)", () => {
    requireMeasured(male);
    const worst = Math.min(...male.overlaps);
    expect(male.gapped, `${male.id}: gapped buckets of ${male.overlaps.length}, worst ${mm(worst)}`).toBe(0);
  });

  it("(3) COUNTERWEIGHT: both garments are still present with a comparable rim — deleting one is refused", () => {
    for (const fit of [female, male]) {
      expect(fit.overlaps.length, `${fit.id}: comparable buckets`).toBeGreaterThanOrEqual(12);
    }
  });

  it(`(4) COUNTERWEIGHT: overlap stays under ${MAX_OVERLAP_M * 1000}mm — a tunic is refused`, () => {
    for (const fit of [female, male]) {
      requireMeasured(fit);
      const biggest = Math.max(...fit.overlaps);
      expect(biggest, `${fit.id}: largest overlap ${mm(biggest)}`).toBeLessThanOrEqual(MAX_OVERLAP_M);
    }
  });
});
