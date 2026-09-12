import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { isUpperGarmentName } from "../garment-slot.ts";
import { measureWaistFit } from "../garments-meet-at-the-waist-measure.ts";
import { isPantsName } from "../waistband-ring.ts";

/**
 * **The street patient's trousers are a body-derived cover shell, not a MakeClothes garment.**
 * Operator refused the shell. The production LOWER GATE replaces the sparse cargo mhclo fit
 * with `build_cover_shell` because coverage fails. Card tsk_2a6935fb4eb63f95.
 *
 * MEASURED 2026-09-10 on shipped `apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb`:
 *
 *   mesh                                      verts   Y min     Y max
 *   ---------------------------------------   -----   --------  --------
 *   cargo cover shell (mat_*cargo_pants.001)  8435    0.1138    1.0791
 *   toigo t-shirt                             5400    1.0283    1.5155
 *
 * pants01 CC0 pack (https://static.makehumancommunity.org/assets/assetpacks/pants01.html,
 * zip pants01_cc0.zip). Only cortu_cargo_pants was extracted. This slice staged the other
 * full-length pair and read each .mhclo header:
 *
 *   garment              obj verts/faces   mhclo max ref   helper >=13380   licence
 *   -------------------- ---------------   -------------   --------------   --------
 *   cortu_cargo_pants    211 / 196         13351           0                CC0 (author dash)
 *   toigo_wool_pants     1372 / 1337       13351           0                `# license CC0`
 *   toigo_harem_pants    5527 / 5456       17973           5527 (ALL)       `# license CC0`
 *
 * Harem is refused: every interpolation ref is a helper vert, so ClothesService cannot
 * fit it on the #318 stripped 13,380-vert basemesh (same refusal as scrub-pants-pre-strip).
 * Wool is the chosen covering pair: same max-ref as cargo (fits stripped), ~6.5× denser
 * than the 196-face see-through cargo, vertex count in the same band as the known-good
 * WojackOWL scrub pants (1,392 obj verts) that already skip the cover shell.
 *
 * Bound: shipped pants primitive verts within 20% of pants_wool.obj (1372) → [1098, 1646].
 * Cover shell 8435 is 6.1× the obj. Sparse cargo 211 is 0.15×. Both fail. ClothesService
 * fit deforms in place, so a covering wool fit stays ~1372.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                         | (1) verts | (2) shirt ymin | (3) ankle | result
 *   --------------------------------------------------|-----------|----------------|----------|--------
 *   a) today (cover shell 8435)                       | **FAIL**  |     pass       |   pass    | REFUSED
 *   b) ship the 196-face cargo without a covering mhclo | **FAIL** |     pass       |   pass    | REFUSED
 *   c) keep build_cover_shell on street               | **FAIL**  |     pass       |   pass    | REFUSED
 *   d) push the shirt                                 |   pass    |   **FAIL**     |   pass    | REFUSED
 *   e) put scrub pants on the street patient          |   pass?   |     pass       |   pass    | REFUSED (wardrobe)
 *   f) fit toigo_wool_pants via ClothesService; skip  |   pass    |     pass       |   pass    | ALL PASS
 *      cover shell when that library name covers      |           |                |          |
 *
 * (e) is wardrobe, not a vertex bound: clinician scrub stays on the clinician pre-strip
 * branch. Street/family lower slot must not point at Scrub_Pants.
 *
 * WHICH ARE REDS AND WHICH ARE NETS: (1) is the RED and fails today. (2) and (3) pass
 * today and are counterweights. Replacing the shell cannot be satisfied by moving the
 * shirt or by cropping the trousers off the ankle, and cannot be satisfied by shipping
 * the sparse cargo.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED. Do not rewrite
 * the measured table.
 *
 * ## FIXED
 *
 * Treatment (production materializer only): patient/family lower slot fits
 * `toigo_wool_pants` (`pants_wool.obj` 1372/1337, `# license CC0`) via
 * ClothesService. LOWER GATE still replaces cargo; wool is in the covering-library
 * skip with scrub (`_COVERING_LIBRARY_LOWER`). Cover-shell rim regularizers do not
 * run on a covering library mesh.
 *
 * glTF splits POSITION on UV/normal seams (same as the shirt: 1391 blender → 5400
 * GLB). The identity that survives export is triangle count = triangulated obj
 * (1337 quads → 2674 tris). Cover shell on the pre-fix GLB was 8435 verts / 2844
 * tris / unique 1482 — 2844 is 6.3% above 2674, so a 5% tris bound refuses the
 * shell; the original 20% *vert* band cannot pass a textured mhclo.
 *
 * Measured on the rematerialized shipped bytes:
 *
 *   mesh                         glb verts  unique  tris   Y min     Y max
 *   --------------------------   ---------  ------  ----   --------  --------
 *   makeclothes_library_wool_pants    4711     908  2674   0.0687    1.0856
 *   toigo t-shirt                     5400    1391  2700   1.0283    1.5155
 *
 * LOWER_GATE verdict covers (raycast 0.9361). Shirt ymin pin 1.0283. Pants ymin
 * 0.0687 <= 0.12.
 *
 * ## FIXED (jeans 2026-09-10)
 *
 * Wool failed look-good: pale/translucent crotch even with ambient world light.
 * Treatment (production materializer only): patient/family lower slot fits
 * `punkduck_male_classic_jeans` (`male-classic-jeans.obj` 2614/2295, mhclo
 * `# license CC-BY 4.0`, pack page
 * https://static.makehumancommunity.org/assets/assetpacks/pants02.html = the
 * CC-BY grant) via ClothesService. Slot name
 * `makeclothes_library_classic_jeans_pants` keeps a `pants` token for the
 * waistband matcher; joins `_COVERING_LIBRARY_LOWER` with scrub+wool (cargo
 * still hits the cover-shell gate). Material forced OPAQUE (wool's defect was
 * translucency). Attribution Punkduck/pants02 printed at bake time
 * (LOWER_GARMENT_ATTRIBUTION).
 *
 * Measured on the rematerialized shipped bytes:
 *
 *   mesh                              glb verts  tris   Y min     Y max
 *   --------------------------------  ---------  ----   --------  --------
 *   makeclothes_library_classic_jeans  7516      4590   0.0597    1.0906
 *   toigo t-shirt                     5400       2700   1.0283    1.5155
 *
 * (glbVerts split higher than wool's 4711: the jeans consume their denim
 * diffuse texture, so UV seams split POSITION. Tris are the identity.)
 * LOWER_GATE verdict covers (raycast 0.9785). PANTS_FIT 2614 -> 2614 tris
 * 4590. Shirt ymin pin 1.0283.
 *
 * NOT TESTED:
 *   - **Family rebake.** Street only this slice. Patient/family lower slot is wired
 *     together; family GLB is not rematerialized here.
 *   - **hm08 / fit_stage.py.** Production path is
 *     `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`.
 *   - **Pixel grade of the jeans.** Parent grades the isolated EEVEE still.
 *
 * ## FIXED (straight-leg look-good 2026-09-10)
 *
 * Punkduck classic jeans covered but graded as balloon/jodhpur thighs with a
 * washed lower-leg fade. Treatment: patient/family lower slot fits
 * `elvs_jeans_straight_leg` (`mens_elv_jeans2slf.obj` 3109/2854, 5708 tris,
 * `# license CC_by`, pack page pants02 CC-BY) via ClothesService. Slot name
 * `makeclothes_library_straight_leg_jeans_pants`. Shirt ymin pin unchanged.
 *
 * ## SUPERSEDED (street jeans waist-meet, 2026-09-12)
 *
 * Clause (2) pin is cargo-era. Jeans waistband sat 16.8 mm below the pin.
 * Cover-shell band_hi stays unraised. Shirt hem now meets the jeans
 * (gapped 0 / +5.0 mm). Clause (2) asserts that meet.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const STREET_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb");
const STREET_ACTOR = "mpfb-street-adult-male";

/** elvs_jeans_straight_leg / mens_elv_jeans2slf.obj (pants02 CC-BY). */
const CHOSEN_MHCLO_OBJ_VERTS = 3109;
/** 2854 quads → fan-triangulated tris. Survives glTF POSITION splits. */
const CHOSEN_MHCLO_TRIS = 5708;
/** 5% — cover shell 2844 tris is 38% below and must fail; sparse cargo 392 far below. */
const TRIS_TOLERANCE = 0.05;
const PANTS_TRIS_MIN = Math.round(CHOSEN_MHCLO_TRIS * (1 - TRIS_TOLERANCE));
const PANTS_TRIS_MAX = Math.round(CHOSEN_MHCLO_TRIS * (1 + TRIS_TOLERANCE));
/** Cover shell measured on the shipped street GLB 2026-09-10. Tris identity only;
 * the jeans carry a denim texture (wool did not), so glbVerts split higher. */
const COVER_SHELL_VERTS = 8435;
const COVER_SHELL_TRIS = 2844;
/** Sparse cargo obj (forbidden as a shipped mesh without a covering mhclo). */
const CARGO_OBJ_VERTS = 211;
const CARGO_OBJ_FACES = 196;

/** Pants must still reach the ankle/boot. */
const PANTS_YMIN_MAX_M = 0.12;

type StreetRow = {
  actor: string;
  pantsName: string;
  shirtName: string;
  pantsVerts: number;
  pantsTris: number;
  pantsYMin: number;
  pantsYMax: number;
  shirtYMin: number;
  bootYMin: number;
  bootYMax: number;
};

const io = new NodeIO();

async function measureStreet(): Promise<StreetRow> {
  const doc = await io.read(STREET_GLB);
  let pantsName = "";
  let shirtName = "";
  let pantsVerts = 0;
  let pantsTris = 0;
  let pantsYMin = Infinity;
  let pantsYMax = -Infinity;
  let shirtYMin = Infinity;
  let bootYMin = Infinity;
  let bootYMax = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? mesh.getName() ?? "";
      const pants = isPantsName(name);
      const shirt = isUpperGarmentName(name);
      const boot = /footwear|boot/i.test(name);
      if (!pants && !shirt && !boot) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        lo = Math.min(lo, v[1]!);
        hi = Math.max(hi, v[1]!);
      }
      if (pants) {
        pantsName = name;
        pantsVerts = pos.getCount();
        const idx = prim.getIndices();
        pantsTris = idx ? idx.getCount() / 3 : 0;
        pantsYMin = lo;
        pantsYMax = hi;
      } else if (shirt) {
        shirtName = name;
        shirtYMin = Math.min(shirtYMin, lo);
      } else {
        bootYMin = Math.min(bootYMin, lo);
        bootYMax = Math.max(bootYMax, hi);
      }
    }
  }
  return {
    actor: STREET_ACTOR,
    pantsName,
    shirtName,
    pantsVerts,
    pantsTris,
    pantsYMin,
    pantsYMax,
    shirtYMin,
    bootYMin,
    bootYMax,
  };
}

const row = await measureStreet();

describe("the street pants are MakeClothes, not a cover shell", () => {
  it(
    `(1) RED: shipped pants tris within 5% of triangulated punkduck classic jeans obj (${CHOSEN_MHCLO_TRIS} → [${PANTS_TRIS_MIN}, ${PANTS_TRIS_MAX}]); cargo ${CARGO_OBJ_VERTS}/${CARGO_OBJ_FACES} vs shell ${COVER_SHELL_VERTS}v/${COVER_SHELL_TRIS}t`,
    () => {
      expect(row.pantsName, "street GLB must carry straight-leg jeans, not cargo/scrub").toMatch(/straight_leg/i);
      expect(
        row.pantsTris,
        `${row.actor} pants tris ${row.pantsTris} (name=${row.pantsName} glbVerts=${row.pantsVerts} objVerts=${CHOSEN_MHCLO_OBJ_VERTS}) outside ${PANTS_TRIS_MIN}..${PANTS_TRIS_MAX} (5% of jeans triangulated obj ${CHOSEN_MHCLO_TRIS}). Cover shell is ${COVER_SHELL_VERTS}v/${COVER_SHELL_TRIS}t; sparse cargo obj is ${CARGO_OBJ_VERTS}/${CARGO_OBJ_FACES}.`,
      ).toBeGreaterThanOrEqual(PANTS_TRIS_MIN);
      expect(
        row.pantsTris,
        `${row.actor} pants tris ${row.pantsTris} above jeans 5% ceiling ${PANTS_TRIS_MAX} — still the ${COVER_SHELL_TRIS}-tri cover shell`,
      ).toBeLessThanOrEqual(PANTS_TRIS_MAX);
      expect(
        row.pantsVerts,
        `${row.actor} pants glbVerts ${row.pantsVerts} still the sparse cargo obj ${CARGO_OBJ_VERTS}`,
      ).toBeGreaterThan(CARGO_OBJ_VERTS * 2);
      expect(
        row.pantsTris,
        `${row.actor} pants tris ${row.pantsTris} still the ${COVER_SHELL_TRIS}-tri cover shell`,
      ).not.toBe(COVER_SHELL_TRIS);
    },
  );

  it("(2) COUNTERWEIGHT: shirt hem meets the jeans waistband (gapped 0, min +5.0 mm); pin superseded", async () => {
    expect(row.shirtName, "street GLB must carry an upper garment").toMatch(/t_shirt|shirt/i);
    expect(row.pantsName, "shipped lower remains straight-leg jeans").toMatch(/straight_leg/i);
    const fit = await measureWaistFit(STREET_GLB, STREET_ACTOR);
    expect(fit.lowerName, "lower is mhclo jeans").toMatch(/straight_leg_jeans/i);
    expect(fit.gapped, "no gapped waist buckets").toBe(0);
    expect(Math.min(...fit.overlaps) * 1000, "min overlap is the #320 5 mm margin").toBeCloseTo(5.0, 1);
  });

  it("(3) COUNTERWEIGHT: pants ymin still reaches the ankle (<= 0.12 m)", () => {
    expect(row.pantsVerts, "pants primitive must exist").toBeGreaterThan(100);
    expect(
      row.pantsYMin,
      `${row.actor} pants ymin ${row.pantsYMin.toFixed(4)} m > ${PANTS_YMIN_MAX_M} — trousers cropped off the ankle`,
    ).toBeLessThanOrEqual(PANTS_YMIN_MAX_M);
  });

  it("(4) RED: pants hem is not perched on the boot rim (ymin below boot ymax by >= 20 mm)", () => {
    expect(Number.isFinite(row.bootYMax), "street GLB must carry footwear").toBe(true);
    const gap = row.bootYMax - row.pantsYMin;
    expect(
      gap,
      `${row.actor} pants ymin ${row.pantsYMin.toFixed(4)} vs boot ymax ${row.bootYMax.toFixed(4)} (gap ${gap.toFixed(4)} m) — cuff sitting on the boot rim`,
    ).toBeGreaterThanOrEqual(0.02);
  });

  it("(5) RED: boot soles meet the ground (ymin <= 20 mm)", () => {
    expect(
      row.bootYMin,
      `${row.actor} boot ymin ${row.bootYMin.toFixed(4)} m — soles lifted off the ground plane`,
    ).toBeLessThanOrEqual(0.02);
  });
});
