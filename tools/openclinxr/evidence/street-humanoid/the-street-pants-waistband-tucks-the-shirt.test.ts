import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { isUpperGarmentName } from "../garment-slot.ts";
import { isPantsName, ringHighFrequency, type Ring } from "../waistband-ring.ts";

/**
 * **The street cargo-pants waistband is a bikini cut: hip skin triangles show between the
 * cream t-shirt hem and the pants rim.** Shirt looks good. Pants do not. Graded against
 * `docs/assets/mpfb-street-adult-clothed-2026-08-25.png` (hip skin, bikini-cut waistband).
 *
 * The #320 waist-meet gate is green (overlap +5.0 mm, 0 gapped buckets) and still the pixels
 * show hip skin. The gate measures per-bucket overlap of two rims; it does not bound the
 * pants rim's own Y-span. A bikini contour can overlap the shirt at every angle and still
 * leave a strip of body between the shirt's relatively flat hem and the inguinal dip.
 *
 * MEASURED 2026-09-10 on shipped `apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb`:
 *
 *   mesh                         verts   Y min     Y max     rim (this file's instrument)
 *   --------------------------   -----   --------  --------  -----------------------------
 *   cargo cover shell            8228    0.1138    1.0631    waist 313 verts, span 27.2 mm
 *   pants waistband rim (3%)     313     1.0359    1.0631    SPAN 27.2 mm   <- defect
 *   shirt (toigo t-shirt)        5400    1.0283    1.5155    hem 152 verts, span 13.4 mm
 *   shirt hem rim (3%)           152     1.0283    1.0416    SPAN 13.4 mm   <- known-good
 *
 * Operator-measured rim (same GLB, boundary-inclusive; recorded so the two instruments
 * cannot be confused):
 *
 *   pants waistband rim          1.0333 .. 1.0631   SPAN 29.8 mm
 *   shirt hem rim                1.0283 .. 1.0474   SPAN 19.1 mm
 *   waist overlap                +5.0 mm, 0 gapped buckets (#320)
 *
 * Bound: pants waistband rim span <= 24.1 mm = 19.1 mm (operator shirt hem span) + 5 mm
 * `WAIST_OVERLAP_MARGIN_M`. This file's 3% instrument already measures 27.2 mm, so the
 * RED has 3.1 mm of margin on the shared ringHighFrequency span and 5.7 mm on the
 * operator rim.
 *
 * ## MECHANISM (do not treat the gate as the defect)
 *
 * LOWER GATE `build_cover_shell(ankle_z, hem_z)` with `hem_z = shirt bounds MIN Z`
 * (`materialize_mpfb_humanoid_candidate.py` ~4310). Faces are selected by CENTROID, so
 * triangles whose centroids sit between the shirt hem VALLEYS (AABB min) and the hem
 * TEETH are excluded. `regularize_rim(..., envelope="max", which="top")` at ~10 deg
 * then preserves the inguinal bikini contour of that cut. `fit_upper_hem_to_waistband`
 * already ran; calling it again MOVES THE SHIRT (forbidden — shirt ymin is the
 * known-good column).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                         | (1) span | (2) shirt ymin | (3) ankle | result
 *   --------------------------------------------------|----------|----------------|----------|--------
 *   a) today                                          | **FAIL** |     pass       |   pass    | REFUSED
 *   b) push the shirt hem down onto the bikini rim    |   pass   |   **FAIL**     |   pass    | REFUSED
 *   c) delete / hide the pants                        |   pass   |     pass       | **FAIL**  | REFUSED
 *   d) tunic (drop a long upper over the hips)        |   pass   |   **FAIL**     |   pass    | REFUSED
 *   e) raise cover-shell band_hi to shirt hem rim MAX |   pass   |     pass       |   pass    | ALL PASS
 *      and/or widen regularize_rim window; do not     |          |                |          |
 *      re-call fit_upper_hem_to_waistband             |          |                |          |
 *
 * **(b) is the load-bearing refusal.** The shirt is the known-good column on this body
 * (ymin 1.0283, hem span 13.4 / 19.1 mm). Pushing it onto the bikini waistband greens
 * overlap and wrecks the garment the operator already accepted.
 *
 * WHICH ARE REDS AND WHICH ARE NETS: (1) is the RED and fails today. (2) and (3) pass
 * today and are counterweights. Raising the pants waist cannot be satisfied by moving
 * the shirt or by cropping the trousers off the ankle.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED. Do not rewrite
 * the measured table.
 *
 * ## FIXED
 *
 * Treatment (production materializer only): `build_cover_shell` band_hi is the shirt
 * hem rim MAX (`upper_hem_rim_max_z`), not AABB min. Street `regularize_rim` window
 * 45 deg. `fit_upper_hem_to_waistband` is NOT re-called (it would pull the hem onto
 * the raised waist). Shirt hem band is pinned to the known-good ymin 1.0283 with the
 * same 0.12 rim-fraction taper. Cover-shell replacement drops the sparse mhclo
 * texture claim so #372 does not demand a map on geometry that never exported.
 *
 * Measured on the rematerialized shipped bytes with this file's instrument:
 *
 *   mesh                         verts   Y min     Y max     rim
 *   --------------------------   -----   --------  --------  -----------------------------
 *   cargo cover shell            8435    0.1138    1.0791    waist 377 verts, span 22.0 mm
 *   pants waistband rim (3%)     377     —         —         SPAN 22.0 mm  (<= 24.1)
 *   shirt hem                    108     1.0283    —         SPAN 14.4 mm
 *
 * Columns: (1) 22.0 <= 24.1, (2) shirt ymin 1.0283 within 2 mm, (3) pants ymin 0.1138 <= 0.12.
 *
 * NOT TESTED:
 *   - **That fixing the span removes the graded hip-skin pixels.** This bounds ring
 *     geometry in the file. Parent grades a fresh glb-grade `front_lit`.
 *   - **Nurse / gown / family.** Street only.
 *   - **hm08 / fit_stage.py.** Production path is
 *     `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const STREET_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb");
const STREET_ACTOR = "mpfb-street-adult-male";

/** Operator-measured shirt ymin on the shipped street GLB (metres, Y-up). */
const SHIRT_YMIN_PIN_M = 1.0283;
/** Shirt must not move: ymin stays within 2 mm of the pin. */
const SHIRT_YMIN_TOLERANCE_M = 0.002;
/** Pants must still reach the ankle. */
const PANTS_YMIN_MAX_M = 0.12;
/**
 * 19.1 mm operator shirt-hem span + 5 mm WAIST_OVERLAP_MARGIN_M.
 * `packages/openclinxr/factory-stations/src/body_param/garment_ops.py` WAIST_OVERLAP_MARGIN_M.
 */
const PANTS_WAIST_SPAN_MAX_MM = 24.1;

type StreetRow = {
  actor: string;
  pantsName: string;
  shirtName: string;
  pantsVerts: number;
  pantsYMin: number;
  pantsYMax: number;
  shirtYMin: number;
  waist: Ring | null;
  hem: Ring | null;
};

const io = new NodeIO();

async function measureStreet(): Promise<StreetRow> {
  const doc = await io.read(STREET_GLB);
  let pantsName = "";
  let shirtName = "";
  let pantsVerts = 0;
  let pantsYMin = Infinity;
  let pantsYMax = -Infinity;
  let shirtYMin = Infinity;
  let waist: Ring | null = null;
  let hem: Ring | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const pants = isPantsName(name);
      const shirt = isUpperGarmentName(name);
      if (!pants && !shirt) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      const pts: number[][] = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        pts.push([v[0]!, v[1]!, v[2]!]);
      }
      const ys = pts.map((p) => p[1]!);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      if (pants) {
        pantsName = name;
        pantsVerts = pts.length;
        pantsYMin = lo;
        pantsYMax = hi;
        waist = ringHighFrequency(pts, "top");
      } else {
        shirtName = name;
        shirtYMin = Math.min(shirtYMin, lo);
        if (!hem) hem = ringHighFrequency(pts, "bottom");
      }
    }
  }
  return {
    actor: STREET_ACTOR,
    pantsName,
    shirtName,
    pantsVerts,
    pantsYMin,
    pantsYMax,
    shirtYMin,
    waist,
    hem,
  };
}

const row = await measureStreet();

describe("the street pants waistband tucks the shirt (bikini-cut hip skin)", () => {
  it(
    `(1) RED: cargo-pants waistband rim span is <= ${PANTS_WAIST_SPAN_MAX_MM} mm (shirt hem 19.1 mm + 5 mm overlap margin)`,
    () => {
      expect(row.pantsName, "street GLB must carry a cargo/pants material").toMatch(/pants|cargo/i);
      expect(row.waist, "pants waistband ring must be measurable").not.toBeNull();
      expect(
        row.waist!.span,
        `${row.actor} pants waist span ${row.waist!.span.toFixed(1)} mm > ${PANTS_WAIST_SPAN_MAX_MM} mm bound (shirt hem 19.1 + 5 mm WAIST_OVERLAP_MARGIN). Measured verts=${row.waist!.verts} y=${row.pantsYMin.toFixed(4)}..${row.pantsYMax.toFixed(4)}`,
      ).toBeLessThanOrEqual(PANTS_WAIST_SPAN_MAX_MM);
    },
  );

  it("(2) COUNTERWEIGHT: shirt ymin stays within 2 mm of the known-good 1.0283 m (do not push the hem)", () => {
    expect(row.shirtName, "street GLB must carry an upper garment").toMatch(/t_shirt|shirt/i);
    expect(
      Math.abs(row.shirtYMin - SHIRT_YMIN_PIN_M),
      `${row.actor} shirt ymin ${row.shirtYMin.toFixed(4)} m drifted more than ${SHIRT_YMIN_TOLERANCE_M * 1000} mm from pin ${SHIRT_YMIN_PIN_M}`,
    ).toBeLessThanOrEqual(SHIRT_YMIN_TOLERANCE_M);
  });

  it("(3) COUNTERWEIGHT: pants ymin still reaches the ankle (<= 0.12 m)", () => {
    expect(row.pantsVerts, "cover shell must still exist").toBeGreaterThan(1000);
    expect(
      row.pantsYMin,
      `${row.actor} pants ymin ${row.pantsYMin.toFixed(4)} m > ${PANTS_YMIN_MAX_M} — trousers cropped off the ankle`,
    ).toBeLessThanOrEqual(PANTS_YMIN_MAX_M);
  });
});
