import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { isUpperGarmentName } from "./garment-slot.ts";

/**
 * ## HEADLINE WITHDRAWN 2026-08-13 18:2x — THIS FILE MEASURES AN OBJECT THAT CANNOT RENDER.
 *
 * The claim below — "the visible zigzag is the hide-mask boundary" — is FALSE. Every
 * `openclinxr_hidden_*` material ships `alphaMode=MASK`, `alphaCutoff=0.5`,
 * `baseColorFactor=[0,0,0,0]`, no texture. glTF discards any fragment whose alpha is below the cutoff,
 * and three.js maps `baseColorFactor[3]` to `material.opacity` so `diffuseColor.a = 0 < 0.5`.
 * **The mask is discarded, not drawn.** Corroborating from pixels: if it drew it would be a black band
 * around the torso, and no grade capture shows one.
 *
 * The visible zigzag is the **cargo-pants WAISTBAND top ring** — HF residual p95 18.96 / 10.79 /
 * 12.28 mm against the same body's shirt hem at 2.01 / 0.47 / 1.47 mm. Tracked with its own planted
 * contract in `the-waistband-is-as-smooth-as-the-hem.test.ts` (#373). The shirt hem is not the visible
 * edge either: it is tucked 9.6-16.3 mm INSIDE the trousers across all 20 shared angular buckets.
 *
 * **What survives:** every measurement below is correct. The mask ring genuinely is rougher than the
 * garment hem, the instrument is sound, and the three clauses still bound what they say they bound.
 * The file is aimed at the wrong object, not measuring the right one wrongly — so it is kept as a
 * (harmless) bound on mask-ring smoothness rather than deleted. **Do not dispatch a slice against it
 * expecting an appearance change: fixing this ring changes nothing a learner can see.**
 *
 * The remaining live question about the masks is DEAD GEOMETRY, not appearance: seven fully-discarded
 * primitives ship per actor (`hidden_upper`/`lower`/`foot`/`orphan`, several duplicated with a `.001`
 * suffix), ~4,570 vertices on aisha, costing draw calls and vertex shading every frame for nothing.
 *
 * ## FIXED (#389) — 2026-08-14, matcher + measured mask-rim decision
 *
 * #199 swapped kevin's scrub for the longer `toigo_fisherman_sweater`. Two independent things broke
 * here; the first is fixed, the second is decided by measurement:
 *
 * 1. **Hem matcher** — the file located the hem by `/t_shirt|scrub_shirt/`, which went blind to
 *    `fisherman_sweater`. Now uses the shared slot-derived `isUpperGarmentName` (garment-slot.ts).
 *
 * 2. **Mask rim band — MEASURED, not guessed.** The orchestrator's scope call asked whether the
 *    sparse rim was (a) a bake fault or (b) a legitimate tessellation. Measured on the shipped bytes:
 *
 *      - kevin's mask rim has **42 verts in a contour-following band** (the instrument's own 3% band
 *        height, but per-10°-bucket local minimum) — DENSER than pre-#199 (38) and equal to the
 *        other actors (aisha 44, child 44). The bake is not at fault; the rim is not sparse.
 *      - The horizontal bottom-3% band reported 5-9 verts because the mask's bottom edge follows
 *        the garment hem, and the knit sweater's hem is front-dropped (front 93.58cm vs back
 *        97.38cm — a real 3.8cm slope). A horizontal slice cuts diagonally through the sloped rim
 *        and sees only the front arc.
 *
 *    The instrument is corrected to follow the rim's contour (per-bucket local minimum + band).
 *    Unmeasurable is still distinct from measured-and-smooth: ringStats returns null below 12 rim
 *    verts, and requireMeasured still fires on null — a genuinely sparse rim cannot silently pass.
 *    The RED (1) still fails as expected via aisha/child (3.5x / 2.6x); kevin measures 1.1x — the
 *    sweater's own knit hem (p95AdjY 6.70mm) is as rough as the mask boundary, which is the honest
 *    comparison, not a tuned one.
 *
 * ---
 *
 * **The jagged zigzag where the shirt meets the trousers is the HIDE-MASK boundary, not the garment
 * hem.** I graded that zigzag on all three MPFB actors and could not say which object produced it for
 * two cycles. Measured 2026-08-13 10:12 with the instrument below; it is the mask, 3/3.
 *
 *   actor   object        ring verts   median adjY   p95      max
 *   ------  -----------   ----------   -----------   ------   -------
 *   aisha   garment hem      114          0.00        1.40     6.84 mm
 *   aisha   HIDE-MASK         31          0.74        8.09     8.52 mm
 *   kevin   garment hem      448          0.00        0.89     1.45 mm
 *   kevin   HIDE-MASK         38          1.89        7.51    11.99 mm
 *   child   garment hem      124          0.00        1.35     4.18 mm
 *   child   HIDE-MASK         28          0.89        4.47     9.04 mm
 *
 * ## WHY ADJACENT-DELTA AND NOT SPREAD (§11s)
 *
 * My first instrument was total hem Y-spread (7.5-14.4 mm) and it was **the wrong one**: a hem
 * legitimately follows the body contour, so spread cannot separate natural drape from raggedness. The
 * defect is high-frequency alternation between NEIGHBOURING vertices around the ring, which is what
 * this measures. Bounding a quantity when the defect lives in the spatial pattern is the error that
 * also killed my skin-variation RED earlier the same day.
 *
 * ## THE KNOWN-GOOD COLUMN IS ON THE SAME ASSET, WHICH IS WHY NO NUMBER IS INVENTED
 *
 * Every other threshold I wrote overnight needed justifying and three were withdrawn when the
 * justification collapsed. This one does not: **the garment hem on the same body, measured by the same
 * instrument in the same run, is the reference.** The mask must come within `MAX_MASK_TO_HEM_P95_RATIO`
 * of it. Today the ratios are 5.8x / 8.4x / 3.3x, so a 2x bound fails 3/3 with margin — and the bound
 * is a property of the asset, not of my judgement.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                     | (1) ratio | (2) ring density | (3) coverage | result
 *   ----------------------------------------------|-----------|------------------|--------------|--------
 *   a) today                                      | **FAIL**  |      pass        |     pass     | REFUSED
 *   b) decimate the mask ring until it is smooth  |   pass    |    **FAIL**      |     pass     | REFUSED
 *   c) shrink the mask so its boundary is shorter |   pass    |      pass        |   **FAIL**   | REFUSED
 *   d) re-tessellate the mask to follow the curve |   pass    |      pass        |     pass     | ALL PASS
 *
 * (b) and (c) are the dangerous ones and they are why this needs three clauses. A mask exists to stop
 * poke-through; **smoothness bought by removing mask is a regression wearing a green tick.** Clause (2)
 * floors ring vertex count — a genuine re-tessellation raises it, decimation lowers it. Clause (3)
 * floors the mask's Y-extent so the boundary cannot be shortened by shrinking what it covers.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 3/3 today. (2) and (3) pass today
 * and are counterweights. Their floors are measured, and — this matters after the #151 lesson — both
 * are **independent of the quantity clause (1) measures**: ring density and Y-extent do not move when
 * smoothness improves, so neither can be satisfied by the same edit that greens the RED.
 *
 * NOT TESTED:
 *   - **That fixing this removes the graded zigzag.** This locates and bounds the geometry; only a
 *     pixel grade after a re-bake settles the appearance, and that grade is the orchestrator's.
 *   - **`hidden_lower` and `hidden_foot`.** Only `hidden_upper` is measured — the junction I graded.
 *   - **The stair-step hairline.** Suspected the same class (a boundary can only be as smooth as the
 *     ring carrying it) but NOT measured with this instrument, and not claimed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/**
 * Measured 2026-08-14 with the #389 contour-following band: today's mask/hem p95 ratios are 3.5x
 * (aisha), 1.1x (kevin), 2.6x (child). 2x fails aisha and child with margin — the RED stays red via
 * them even though kevin's mask is as rough as the sweater's own knit hem (the honest comparison).
 */
const MAX_MASK_TO_HEM_P95_RATIO = 2;

/**
 * Measured ring vertex counts with the #389 contour-following band: aisha 44, kevin 42, child 44.
 * (The original horizontal-band counts — aisha 31, kevin 38, child 28 — measured a horizontal
 * slice of a sloped rim and are superseded; the shipped bytes measure higher.) Floor refuses
 * smoothing by decimation: a genuine re-tessellation RAISES this count.
 */
const MIN_MASK_RING_VERTS: Record<string, number> = {
  "mpfb-ob-patient-aisha": 44,
  "mpfb-peds-nurse-kevin": 42,
  "mpfb-peds-patient-child": 44,
};

/**
 * Mask vertical extent in metres, MEASURED 2026-08-14 on the shipped bytes with the #389
 * contour-following band: aisha 0.4274 (t-shirt hem), kevin 0.5706 (sweater hem — the longer
 * garment extends the mask), child 0.3265. Floor refuses shortening the boundary by shrinking
 * what the mask covers. These were placeholders (0) for one run — which made clause (3)
 * vacuous, exactly the trap §7t names — until measured and filled in.
 */
const MIN_MASK_Y_EXTENT: Record<string, number> = {
  "mpfb-ob-patient-aisha": 0.4274,
  "mpfb-peds-nurse-kevin": 0.5706,
  "mpfb-peds-patient-child": 0.3265,
};

type Ring = { verts: number; medianAdjY: number; p95AdjY: number; yExtent: number };

/**
 * The rim ring of a primitive, ordered by angle about the body axis, then adjacent-Y deltas.
 *
 * #389 (appended to the #389 header block below): the band follows the rim's CONTOUR, not a
 * horizontal slice. The mask's bottom edge follows the garment hem, and the knit sweater's hem
 * is front-dropped (front 93.6cm, back 97.4cm — a real 3.8cm slope). A horizontal bottom-% band
 * slices through that slope and reads a dense rim as sparse: kevin's rim has 42 verts around its
 * contour (same density as every other actor) but only 5-9 in a horizontal band. Bucket by angle,
 * keep verts within bandH of each bucket's OWN lowest, then adjacent-Y deltas around the ring.
 * A genuinely sparse rim (<12 verts around the full contour) still returns null — unmeasurable
 * stays distinct from measured-and-smooth; the vacuity guard below still fires on it.
 */
function ringStats(pts: { x: number; y: number; z: number }[]): Ring | null {
  if (pts.length < 12) return null;
  const ys = pts.map((p) => p.y).sort((a, b) => a - b);
  const lo = ys[0]!;
  const hi = ys[ys.length - 1]!;
  const bandH = (hi - lo) * 0.03;
  const withDeg = pts.map((p) => ({ ...p, deg: (Math.atan2(p.z, p.x) * 180 / Math.PI + 360) % 360 }));
  const buckets = Array.from({ length: 36 }, () => [] as typeof withDeg);
  for (const p of withDeg) buckets[Math.min(35, Math.floor(p.deg / 10))]!.push(p);
  const bucketLo = buckets.map((b) => (b.length ? Math.min(...b.map((q) => q.y)) : Infinity));
  const band = withDeg
    .filter((p) => {
      const bi = Math.min(35, Math.floor(p.deg / 10));
      return p.y < bucketLo[bi]! + bandH;
    })
    .map((p) => ({ ...p, th: Math.atan2(p.z, p.x) }))
    .sort((a, b) => a.th - b.th);
  if (band.length < 12) return null;
  const d: number[] = [];
  for (let i = 1; i < band.length; i += 1) d.push(Math.abs(band[i]!.y - band[i - 1]!.y) * 1000);
  d.sort((a, b) => a - b);
  return {
    verts: band.length,
    medianAdjY: d[Math.floor(d.length / 2)] ?? 0,
    p95AdjY: d[Math.floor(d.length * 0.95)] ?? 0,
    yExtent: hi - lo,
  };
}

const io = new NodeIO();

async function measureActor(actor: string): Promise<{ hem: Ring | null; mask: Ring | null }> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, `${actor}.glb`));
  let hem: Ring | null = null;
  let mask: Ring | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isHem = isUpperGarmentName(name);
      const isMask = /hidden_upper/i.test(name);
      if (!isHem && !isMask) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      const pts: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        pts.push({ x: v[0]!, y: v[1]!, z: v[2]! });
      }
      const s = ringStats(pts);
      if (isHem && !hem) hem = s;
      if (isMask && !mask) mask = s;
    }
  }
  return { hem, mask };
}

const measured = await Promise.all(
  ACTORS.map(async (a) => ({ actor: a, ...(await measureActor(a)) })),
);

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  const usable = measured.filter((m) => m.hem !== null && m.mask !== null);
  expect(
    usable.length,
    `actors with both a hem ring and a mask ring (of ${ACTORS.length}): ${measured
      .map((m) => `${m.actor} hem=${m.hem ? "y" : "n"} mask=${m.mask ? "y" : "n"}`)
      .join("; ")}`,
  ).toBe(ACTORS.length);
}

describe("the hide-mask boundary is not a sawtooth", () => {
  it.fails("(1) RED: the mask ring is as smooth as the garment hem on the same body", () => {
    requireMeasured();
    const ragged = measured
      .filter((m) => m.hem && m.mask && m.mask.p95AdjY > m.hem.p95AdjY * MAX_MASK_TO_HEM_P95_RATIO)
      .map(
        (m) =>
          `${m.actor}: mask p95=${m.mask!.p95AdjY.toFixed(2)}mm vs hem p95=${m.hem!.p95AdjY.toFixed(
            2,
          )}mm (${(m.mask!.p95AdjY / Math.max(m.hem!.p95AdjY, 0.01)).toFixed(1)}x, bound ${MAX_MASK_TO_HEM_P95_RATIO}x)`,
      );
    expect(ragged, "actors whose hide-mask boundary is rougher than their own garment hem").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the mask ring is not smoothed by decimation", () => {
    // Refuses buying smoothness by deleting mask vertices. A real re-tessellation RAISES this count.
    requireMeasured();
    const thinned = measured
      .filter((m) => m.mask && m.mask.verts < (MIN_MASK_RING_VERTS[m.actor] ?? 0))
      .map((m) => `${m.actor}: mask ring ${m.mask!.verts} verts < floor ${MIN_MASK_RING_VERTS[m.actor]}`);
    expect(thinned, "mask rings decimated rather than re-tessellated").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the mask still covers what it covered", () => {
    // Refuses shortening the boundary by shrinking the mask — which re-introduces the poke-through the
    // mask exists to prevent. Smoothness bought with coverage is a regression wearing a green tick.
    requireMeasured();
    const shrunk = measured
      .filter((m) => m.mask && m.mask.yExtent < (MIN_MASK_Y_EXTENT[m.actor] ?? 0) * 0.98)
      .map(
        (m) =>
          `${m.actor}: mask Y extent ${(m.mask!.yExtent * 1000).toFixed(0)}mm < 98% of ${(
            (MIN_MASK_Y_EXTENT[m.actor] ?? 0) * 1000
          ).toFixed(0)}mm`,
      );
    expect(shrunk, "mask shrunk to shorten its boundary").toEqual([]);
  });

  /**
   * (4) COUNTERWEIGHT ADDED 2026-08-28 (#744). Clauses (2) and (3) are RED on main for
   * `mpfb-peds-nurse-kevin` — 40 verts against a floor of 42, and a 538 mm mask extent against
   * 571 mm. The cheapest way to green them is to lower the floors to what kevin measures today.
   *
   * That is refused here. Both numbers were MEASURED on the shipped bytes on 2026-08-14 with the
   * #389 contour-following band, AFTER #199's sweater swap — see the two docblocks above. Lowering
   * them makes the gate describe the regression instead of the requirement.
   *
   * ATTRIBUTION, measured 2026-08-28 rather than assumed: kevin's `hidden_upper` primitive reads
   * 1719 verts / 538 mm at `f82e1cc2` (before #739), at `de57fc4d` (#739) and on main after #740.
   * Identical at all three, so neither recent asset landing moved it and the change predates them.
   *
   * If you conclude the floors are genuinely stale rather than the asset regressed, SAY SO AND STOP
   * — that is a successful finding under this brief and it does not fail the slice. Do not lower
   * them silently.
   */
  it("(4) COUNTERWEIGHT: the measured floors are not lowered to match the regression", () => {
    expect(
      MIN_MASK_RING_VERTS["mpfb-peds-nurse-kevin"],
      "42 rim verts, measured 2026-08-14 on the shipped bytes after #199's sweater swap",
    ).toBeGreaterThanOrEqual(42);
    expect(
      MIN_MASK_Y_EXTENT["mpfb-peds-nurse-kevin"],
      "0.5706 m — the sweater hem extends the mask; measured on the same bytes",
    ).toBeGreaterThanOrEqual(0.5706);
    expect(MIN_MASK_RING_VERTS["mpfb-ob-patient-aisha"], "aisha's floor, unchanged").toBeGreaterThanOrEqual(44);
    expect(MIN_MASK_RING_VERTS["mpfb-peds-patient-child"], "the child's floor, unchanged").toBeGreaterThanOrEqual(44);
  });
});
