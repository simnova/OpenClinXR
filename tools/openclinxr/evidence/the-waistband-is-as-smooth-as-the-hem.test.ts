import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **The visible sawtooth at the shirt/trouser junction is the CARGO-PANTS WAISTBAND ring.** Graded in
 * pixels on every MPFB capture and located 2026-08-13 after two wrong attributions of mine — see the
 * withdrawal note below. Measured on the shipped bytes with the instrument in this file:
 *
 *   actor   ring                      verts   HF median   HF p95    ring span
 *   ------  ------------------------  -----   ---------   -------   ---------
 *   aisha   PANTS waistband (top)      132      3.50 mm   18.96 mm   26.2 mm
 *   aisha   shirt hem (bottom)         114      0.26 mm    2.01 mm   12.7 mm   <- known-good
 *   kevin   PANTS waistband (top)       59      1.80 mm   10.79 mm   27.0 mm
 *   kevin   shirt hem (bottom)         448      0.27 mm    0.47 mm    7.5 mm   <- known-good
 *   child   PANTS waistband (top)      144      2.46 mm   12.28 mm   18.3 mm
 *   child   shirt hem (bottom)         124      0.19 mm    1.47 mm   10.0 mm   <- known-good
 *
 * Ratios today: 9.4x / 23.0x / 8.4x. The bound is 4x, so this fails 3/3 with 2.1-5.8x of margin.
 *
 * ## WHY HIGH-FREQUENCY RESIDUAL AND NOT SPREAD OR AN EXTREME (SS11s)
 *
 * A waistband legitimately follows the body contour, so total Y-spread cannot separate natural drape
 * from raggedness -- and `min`/`max` are satisfied by a saw whose teeth all clear the line. The defect
 * is alternation between NEIGHBOURING vertices around the ring. So: order the ring by angle about the
 * body axis, subtract a 7-neighbour circular moving average (which removes the contour), and measure
 * what is left. That is the raggedness and nothing else.
 *
 * An earlier pass of mine ordered ring vertices by X. That is an INVALID traversal of a curve that
 * wraps the body -- adjacent in X can be opposite hips -- and it produced numbers 4-6x larger. Angular
 * ordering is not a detail here; it is the difference between measuring the defect and measuring the
 * parameterisation.
 *
 * ## THE KNOWN-GOOD COLUMN IS ON THE SAME BODY, SO NO NUMBER IS INVENTED (SS9h)
 *
 * The shirt hem is a garment boundary ring on the same actor, from the same MakeClothes library,
 * fitted by the same pipeline, measured in the same run by the same function. It lands at 0.47-2.01 mm.
 * That is proof this pipeline CAN produce a smooth ring on this body -- so the waistband's 10.79-18.96
 * mm is a defect and not a property of the medium. The 4x multiplier is my choice and I state it as
 * one: it grants four times the slack of the best ring the pipeline actually produces, and still fails
 * every actor today.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) ratio | (2) verts | (3) geometry | (4) hem | result
 *   -------------------------------------------------|-----------|-----------|--------------|---------|--------
 *   a) today                                         | **FAIL**  |   pass    |     pass     |  pass   | REFUSED
 *   b) ROUGHEN THE HEM to inflate the denominator    |   pass    |   pass    |     pass     | **FAIL**| REFUSED
 *   c) decimate the waistband ring until it is smooth|   pass    | **FAIL**  |     pass     |  pass   | REFUSED
 *   d) remesh / flatten the waistband                |   pass    |   pass    |   **FAIL**   |  pass   | REFUSED
 *   e) re-fit or re-tessellate so the ring follows   |   pass    |   pass    |     pass     |  pass   | ALL PASS
 *
 * **(b) is the load-bearing one and it is why clause (4) exists.** Clause (1) is a RATIO, and every
 * ratio can be satisfied from its denominator. Degrading the shirt hem from 1.47 mm to 4 mm would green
 * clause (1) on the child while making the product visibly worse in a second place. Clause (4) pins the
 * hem ABSOLUTELY, against its own measured value, so the denominator cannot move.
 *
 * (c) is the SS6t class: smoothness bought by deleting the vertices that carry the boundary. Clause (2)
 * floors the ring population -- a genuine re-tessellation raises it, decimation lowers it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 3/3. (2), (3) and (4) pass today
 * and are counterweights. Each is independent of the quantity (1) measures -- smoothing the waistband
 * moves neither the ring population, nor the triangle count, nor the hem -- so none can be satisfied by
 * the same edit that greens the RED.
 *
 * ## WITHDRAWN, and recorded because both wrong answers are plausible and someone will re-reach them
 *
 *   - **"It is the hide-mask boundary" (#364) is FALSE.** Every `openclinxr_hidden_*` material ships
 *     `alphaMode=MASK`, `alphaCutoff=0.5`, `baseColorFactor=[0,0,0,0]`. glTF discards any fragment below
 *     the cutoff and three.js maps `baseColorFactor[3]` to `opacity`, so `diffuseColor.a = 0 < 0.5`:
 *     the mask renders NOTHING. If it drew, it would be a black band, and no capture shows one.
 *   - **"It is the shirt hem" is FALSE.** In the 13.4 mm band where the child's hem and waist overlap,
 *     all 20 shared angular buckets have the pants OUTSIDE the shirt by 9.6-16.3 mm, and none within
 *     2 mm. The hem is tucked in and hidden; the pants rim is the visible edge against it.
 *
 * NOT TESTED:
 *   - **That fixing this removes the graded sawtooth.** This bounds ring geometry in the file. Only a
 *     pixel grade after a re-bake settles appearance, and that grade is the orchestrator's.
 *   - **The other rings.** Only the pants TOP and the shirt BOTTOM are measured. Trouser cuffs, sleeve
 *     cuffs, collars and the footwear rings are excluded, not asserted on.
 *   - **The hairline**, which is the same visual family (a boundary only as smooth as the ring carrying
 *     it) but is a MATERIAL REGION on the body mesh rather than a garment rim, and is not measured here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/** The waistband may be at most this many times rougher than the same body's own shirt hem. */
const MAX_WAISTBAND_TO_HEM_HF_RATIO = 4;
/** The hem is the denominator of clause (1); this pins it absolutely so it cannot be inflated. */
const HEM_DEGRADATION_ALLOWANCE = 1.5;

type Ring = { verts: number; hfMedian: number; hfP95: number; span: number };

/**
 * Order a boundary ring by angle about the body axis, subtract a 7-neighbour CIRCULAR moving average
 * to remove the legitimate contour, and return the high-frequency residual in millimetres.
 */
function ringHighFrequency(pts: number[][], which: "top" | "bottom"): Ring | null {
  if (pts.length < 12) return null;
  const ys = pts.map((p) => p[1]!);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const height = hi - lo;
  const cx = pts.reduce((s, p) => s + p[0]!, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[2]!, 0) / pts.length;
  const band = pts
    .filter((p) => (which === "top" ? p[1]! > hi - height * 0.03 : p[1]! < lo + height * 0.03))
    .map((p) => ({ y: p[1]!, th: Math.atan2(p[2]! - cz, p[0]! - cx) }))
    .sort((a, b) => a.th - b.th);
  if (band.length < 12) return null;

  const residual: number[] = [];
  for (let i = 0; i < band.length; i += 1) {
    let sum = 0;
    for (let k = -3; k <= 3; k += 1) sum += band[(i + k + band.length) % band.length]!.y;
    residual.push(Math.abs(band[i]!.y - sum / 7) * 1000);
  }
  const sorted = [...residual].sort((a, b) => a - b);
  const bandYs = band.map((b) => b.y);
  return {
    verts: band.length,
    hfMedian: sorted[Math.floor(sorted.length / 2)] ?? 0,
    hfP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    span: (Math.max(...bandYs) - Math.min(...bandYs)) * 1000,
  };
}

/**
 * MEASURED 2026-08-13 on the shipped bytes. Floors refuse (b) hem degradation, (c) ring decimation and
 * (d) remesh. An actor absent from this table fails the enumeration guard rather than passing silently.
 */
const BASELINE: Record<
  string,
  { waistVerts: number; waistSpan: number; pantsTris: number; hemHfP95: number }
> = {
  "mpfb-ob-patient-aisha": { waistVerts: 132, waistSpan: 26.2, pantsTris: 2782, hemHfP95: 2.01 },
  "mpfb-peds-nurse-kevin": { waistVerts: 59, waistSpan: 27.0, pantsTris: 2628, hemHfP95: 0.47 },
  "mpfb-peds-patient-child": { waistVerts: 144, waistSpan: 18.3, pantsTris: 2636, hemHfP95: 1.47 },
};

type Row = { actor: string; waist: Ring | null; hem: Ring | null; pantsTris: number };

const io = new NodeIO();

async function measure(actor: string): Promise<Row> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, `${actor}.glb`));
  let waist: Ring | null = null;
  let hem: Ring | null = null;
  let pantsTris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isPants = /cargo_pants/i.test(name);
      const isShirt = /t_shirt|scrub_shirt/i.test(name);
      if (!isPants && !isShirt) continue;
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      if (!pos) continue;
      const v = [0, 0, 0];
      const pts: number[][] = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        pts.push([...v]);
      }
      if (isPants) {
        waist = ringHighFrequency(pts, "top");
        pantsTris = idx ? idx.getCount() / 3 : 0;
      } else if (!hem) {
        hem = ringHighFrequency(pts, "bottom");
      }
    }
  }
  return { actor, waist, hem, pantsTris };
}

const rows = await Promise.all(ACTORS.map(measure));

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  const usable = rows.filter((r) => r.waist !== null && r.hem !== null);
  expect(
    usable.length,
    `actors with both a waistband ring and a hem ring: ${rows
      .map((r) => `${r.actor} waist=${r.waist ? "y" : "n"} hem=${r.hem ? "y" : "n"}`)
      .join("; ")}`,
  ).toBe(ACTORS.length);
}

describe("the cargo-pants waistband is as smooth as the hem on the same body", () => {
  it.fails(
    `(1) RED: waistband high-frequency residual is within ${MAX_WAISTBAND_TO_HEM_HF_RATIO}x the same body's shirt hem`,
    () => {
      requireMeasured();
      const ragged = rows
        .filter((r) => r.waist && r.hem && r.waist.hfP95 > r.hem.hfP95 * MAX_WAISTBAND_TO_HEM_HF_RATIO)
        .map(
          (r) =>
            `${r.actor}: waistband HF p95 ${r.waist!.hfP95.toFixed(2)}mm vs hem ${r.hem!.hfP95.toFixed(
              2,
            )}mm = ${(r.waist!.hfP95 / Math.max(r.hem!.hfP95, 0.01)).toFixed(1)}x (bound ${MAX_WAISTBAND_TO_HEM_HF_RATIO}x)`,
        );
      expect(ragged, "waistbands rougher than the same body's own garment hem").toEqual([]);
    },
  );

  it("(2) COUNTERWEIGHT: the waistband ring is not smoothed by decimation", () => {
    // Refuses buying smoothness by deleting the vertices that carry the boundary (SS6t).
    // A genuine re-tessellation RAISES this count; decimation lowers it.
    requireMeasured();
    const thinned = rows
      .filter((r) => r.waist && r.waist.verts < (BASELINE[r.actor]?.waistVerts ?? 0))
      .map((r) => `${r.actor}: waistband ring ${r.waist!.verts} verts < floor ${BASELINE[r.actor]?.waistVerts}`);
    expect(thinned, "waistband rings decimated rather than re-tessellated").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the trousers are not remeshed and the waistband is not flattened", () => {
    // Refuses changing the geometry instead of its smoothness — a remesh, or collapsing the ring's
    // contour so there is nothing left to be ragged.
    requireMeasured();
    const changed = rows
      .filter((r) => {
        const b = BASELINE[r.actor];
        return !b || r.pantsTris !== b.pantsTris || (r.waist?.span ?? 0) < b.waistSpan * 0.8;
      })
      .map((r) => {
        const b = BASELINE[r.actor];
        return b
          ? `${r.actor}: pants tris ${r.pantsTris} (was ${b.pantsTris}), waist span ${(r.waist?.span ?? 0).toFixed(1)}mm (was ${b.waistSpan}mm)`
          : `${r.actor}: not in the measured baseline`;
      });
    expect(changed, "trouser geometry changed rather than its ring smoothness").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the shirt hem — clause (1)'s denominator — is not degraded", () => {
    // THE LOAD-BEARING ONE. Clause (1) is a ratio and every ratio can be satisfied from below.
    // Roughening the hem would green it while making the product visibly worse in a second place,
    // so the hem is pinned ABSOLUTELY against its own measured value, not relatively.
    requireMeasured();
    const degraded = rows
      .filter((r) => r.hem && r.hem.hfP95 > (BASELINE[r.actor]?.hemHfP95 ?? 0) * HEM_DEGRADATION_ALLOWANCE)
      .map(
        (r) =>
          `${r.actor}: hem HF p95 ${r.hem!.hfP95.toFixed(2)}mm exceeds ${HEM_DEGRADATION_ALLOWANCE}x measured ${BASELINE[r.actor]?.hemHfP95}mm — the ratio was satisfied from its denominator`,
      );
    expect(degraded, "shirt hem roughened to inflate clause (1)'s denominator").toEqual([]);
  });
});
