import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **Kevin's trouser leg and his boot occupy the same space, and the sawtooth at his ankle is the two
 * meshes fighting — not a ragged rim.** #374 regularized the cover shell's lower rim and the
 * measurement went 10.35 -> 2.39 mm, but his cuffs still grade as shredded teeth while aisha's, fixed
 * by the identical treatment, came out visibly clean. The difference is measured below.
 *
 * Measured 2026-08-14 on the shipped bytes. Vertical overlap between the trouser cuff and the
 * footwear, then a per-angular-bucket comparison of which mesh is radially outside the other:
 *
 *   actor   footwear                     overlap    buckets   pants-out   shoe-out   verdict
 *   ------  ---------------------------  --------   -------   ---------   --------   --------
 *   kevin   culturalibre_male_boots      +279.2mm    31/36        5          25      INTERPENETRATING
 *   aisha   toigo_flats                   -28.0mm      -          -           -      no overlap
 *   child   toigo_mj_cloth_shoes          -39.5mm      -          -           -      no overlap
 *
 * Kevin's radial delta swings **-29.2 mm to +14.0 mm**: the trouser leg is inside the boot shaft in
 * most directions and pokes through it in others. That alternation, seen from the front, is a row of
 * teal teeth against brown leather.
 *
 * ## FIXED (#378) — 2026-08-14, measured on the re-baked bytes
 *
 * The treatment is a tuck: `tuck_trousers_into_boots` in
 * materialize_mpfb_humanoid_candidate.py pulls every trouser vertex in the overlap
 * band radially inward to just inside the boot's OUTER surface along the ray from
 * the leg axis (the band's own horizontal centroid — the all-trouser centroid is
 * pulled medial by the pelvis/waist mass) through the vertex. The surface is the
 * outermost triangle hit within 0.15 m — the near shaft wall; the tube's far wall
 * and the other foot exceed the reach bound. The boot was already outside the
 * trouser in 25/31 buckets, so the pull is local (5 buckets, 2-27 mm) and the
 * visible trouser leg above the boot's rim is untouched — its rays miss, no boot
 * wall at that height — so the #373 waistband and #374 ankle-rim treatments and
 * the leg silhouette keep their shipped geometry. Runs after the shoe fit and
 * before the render-truth re-hide; no-ops when the trouser hem is above the
 * footwear top (aisha, the child). STAGING CHOICE: tucked-in, not trouser-over-
 * boot — the boot already contained the leg in most buckets, and trouser-over
 * would require inflating the leg to the shaft's ~90 mm radius (a balloon).
 *
 *   actor   footwear                     overlap    buckets   pants-out   shoe-out   verdict
 *   ------  ---------------------------  --------   -------   ---------   --------   --------
 *   kevin   culturalibre_male_boots      +279.2mm    28/36        0          28      CONSISTENT
 *
 * Post-fix radial delta: min -33 mm, p10 -29 mm, median -20.4 mm — every shared
 * bucket has the boot outside the trouser by well past the 2 mm tolerance (the
 * closest bucket is -3 mm). Clause (2) cuff reach unchanged (-279.2 mm) and clause
 * (3) footwear tris unchanged (30,768), so neither counterweight moved.
 *
 * ## THE KNOWN-GOOD IS THE SAME PIPELINE DOING IT RIGHT IN AN OVERLAP BAND (SS9h)
 *
 * "2 of 3 actors are fine" is a weak reference, because those two have no overlap at all and never
 * exercise the case. The real known-good is the **shirt/trouser junction**, measured for #373: in the
 * 13.4 mm band where the child's shirt hem and trouser waist overlap, **all 20 shared angular buckets
 * have the pants outside the shirt by 9.6-16.3 mm, and none within 2 mm.** Same fit machinery, same
 * actor, a genuine overlap, and a consistent layer order. So a clean tuck is something this pipeline
 * demonstrably produces — kevin's ankle is a defect, not a limit of the medium.
 *
 * The rule this encodes: **where two garments overlap vertically, one must be consistently outside the
 * other.** Trouser-over-boot and trouser-tucked-into-boot are both fine. Alternating is not.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) consistent | (2) no bare gap | (3) footwear intact | result
 *   -------------------------------------------------|----------------|-----------------|---------------------|--------
 *   a) today                                         |   **FAIL**     |      pass       |        pass         | REFUSED
 *   b) shorten the trousers above the boot top       |     pass       |    **FAIL**     |        pass         | REFUSED
 *   c) inflate the boot until it swallows the leg    |     pass       |      pass       |     **FAIL**        | REFUSED
 *   d) tuck the cuff consistently inside the shaft   |     pass       |      pass       |        pass         | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Deleting the overlap makes clause (1)
 * vacuous — no shared buckets, nothing to be inconsistent about — and leaves bare shin between the
 * trouser hem and the boot top. That is SS6p exactly: a contract that removes something must say what
 * takes over its job. Clause (2) requires the trouser cuff to reach at least as low as the footwear's
 * top, so the leg is never exposed.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 1/3 — aisha and the child pass
 * untouched and are not defects. (2) and (3) pass today and are counterweights. Both are independent
 * of what (1) measures: making the layer order consistent moves neither the cuff's reach nor the
 * footwear's geometry.
 *
 * NOT TESTED:
 *   - **That fixing this removes the graded teeth.** This bounds mesh occupancy in the file; only a
 *     pixel grade after a re-bake settles appearance, and that grade is the orchestrator's.
 *   - **Other garment pairs.** Only trouser-vs-footwear is measured. Sleeve-vs-glove, collar-vs-shirt
 *     and shirt-vs-trouser are excluded here (the last is #373's known-good, not an assertion).
 *   - **Which way kevin should resolve.** Tucked-in and worn-over both satisfy clause (1); which is
 *     clinically right for a nurse in boots is a staging question, not an implementer decision (SS8y).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/** A bucket counts as "outside" only beyond this, so surface noise is not read as a layer flip. */
const RADIAL_TOLERANCE_MM = 2;
/** Below this many shared buckets the comparison is not meaningful and the actor is skipped. */
const MIN_SHARED_BUCKETS = 6;
const ANGULAR_BUCKETS = 36;

type Pair = {
  actor: string;
  overlapMm: number;
  sharedBuckets: number;
  pantsOutside: number;
  shoeOutside: number;
  /** Lowest trouser point minus highest footwear point, in mm. Negative = trousers reach below. */
  cuffReachMm: number;
  shoeTris: number;
};

const io = new NodeIO();

async function measure(actor: string): Promise<Pair | null> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, `${actor}.glb`));
  let pants: number[][] = [];
  let shoe: number[][] = [];
  let shoeTris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isPants = /cargo_pants/i.test(name);
      const isShoe = /footwear/i.test(name);
      if (!isPants && !isShoe) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      const pts: number[][] = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        pts.push([...v]);
      }
      if (isPants) pants = pts;
      else {
        shoe = pts;
        const idx = prim.getIndices();
        shoeTris = idx ? idx.getCount() / 3 : 0;
      }
    }
  }
  // Left side only: the two legs are mirror images and one loop is unambiguous.
  const pl = pants.filter((q) => q[0]! < 0);
  const sl = shoe.filter((q) => q[0]! < 0);
  if (pl.length < 12 || sl.length < 12) return null;

  const cuffLow = Math.min(...pl.map((q) => q[1]!));
  const shoeHigh = Math.max(...sl.map((q) => q[1]!));
  const overlapMm = (shoeHigh - cuffLow) * 1000;

  let sharedBuckets = 0;
  let pantsOutside = 0;
  let shoeOutside = 0;
  if (overlapMm > 0) {
    const cx = pl.reduce((s, q) => s + q[0]!, 0) / pl.length;
    const cz = pl.reduce((s, q) => s + q[2]!, 0) / pl.length;
    const bin = (q: number[]): number =>
      Math.floor(((Math.atan2(q[2]! - cz, q[0]! - cx) + Math.PI) / (2 * Math.PI)) * ANGULAR_BUCKETS) %
      ANGULAR_BUCKETS;
    const rad = (q: number[]): number => Math.hypot(q[0]! - cx, q[2]! - cz);
    const pb: number[][] = Array.from({ length: ANGULAR_BUCKETS }, () => []);
    const sb: number[][] = Array.from({ length: ANGULAR_BUCKETS }, () => []);
    for (const q of pl) if (q[1]! >= cuffLow && q[1]! <= shoeHigh) pb[bin(q)]!.push(rad(q));
    for (const q of sl) if (q[1]! >= cuffLow && q[1]! <= shoeHigh) sb[bin(q)]!.push(rad(q));
    for (let i = 0; i < ANGULAR_BUCKETS; i += 1) {
      if (!pb[i]!.length || !sb[i]!.length) continue;
      sharedBuckets += 1;
      const delta = (Math.max(...pb[i]!) - Math.max(...sb[i]!)) * 1000;
      if (delta > RADIAL_TOLERANCE_MM) pantsOutside += 1;
      else if (delta < -RADIAL_TOLERANCE_MM) shoeOutside += 1;
    }
  }
  return {
    actor,
    overlapMm,
    sharedBuckets,
    pantsOutside,
    shoeOutside,
    cuffReachMm: (cuffLow - shoeHigh) * 1000,
    shoeTris,
  };
}

/** MEASURED 2026-08-14 on the shipped bytes. */
const BASELINE: Record<string, { cuffReachMm: number; shoeTris: number }> = {
  "mpfb-ob-patient-aisha": { cuffReachMm: 28.0, shoeTris: 57600 },
  "mpfb-peds-nurse-kevin": { cuffReachMm: -279.2, shoeTris: 30768 },
  "mpfb-peds-patient-child": { cuffReachMm: 39.5, shoeTris: 1004 },
};

const rows = (await Promise.all(ACTORS.map(measure))).filter((r): r is Pair => r !== null);

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(rows.length, `actors with both a trouser leg and footwear (of ${ACTORS.length})`).toBe(
    ACTORS.length,
  );
}

describe("overlapping garments do not interpenetrate", () => {
  it("(1) RED: where a trouser leg and footwear overlap, one is consistently outside", () => {
    requireMeasured();
    const mixed = rows
      .filter(
        (r) =>
          r.sharedBuckets >= MIN_SHARED_BUCKETS && r.pantsOutside > 0 && r.shoeOutside > 0,
      )
      .map(
        (r) =>
          `${r.actor}: ${r.overlapMm.toFixed(1)}mm overlap, ${r.sharedBuckets} shared buckets — pants outside in ${r.pantsOutside}, footwear outside in ${r.shoeOutside}. The layer order flips around the leg.`,
      );
    expect(mixed, "garment pairs that interpenetrate rather than layering").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: no bare leg between the trouser hem and the footwear", () => {
    // Refuses (b): deleting the overlap makes clause (1) VACUOUS — no shared buckets, nothing to be
    // inconsistent about — and exposes shin. SS6p: removing something requires stating what replaces it.
    // Each actor's own reach is floored, so nobody's trousers can retreat up the leg.
    requireMeasured();
    const exposed = rows
      .filter((r) => r.cuffReachMm > (BASELINE[r.actor]?.cuffReachMm ?? 0) + 5)
      .map(
        (r) =>
          `${r.actor}: trouser hem now ends ${r.cuffReachMm.toFixed(1)}mm above the footwear top (was ${BASELINE[r.actor]?.cuffReachMm}mm) — bare leg`,
      );
    expect(exposed, "trousers shortened away from the footwear, exposing the leg").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the footwear is not inflated to swallow the leg", () => {
    // Refuses (c): scaling the boot up until nothing pokes through would satisfy clause (1) by making
    // the footwear absurd. Its geometry is pinned.
    requireMeasured();
    const inflated = rows
      .filter((r) => r.shoeTris !== (BASELINE[r.actor]?.shoeTris ?? -1))
      .map(
        (r) => `${r.actor}: footwear tris ${r.shoeTris} (was ${BASELINE[r.actor]?.shoeTris}) — the shoe was remeshed`,
      );
    expect(inflated, "footwear geometry changed instead of the layer order").toEqual([]);
  });
});
