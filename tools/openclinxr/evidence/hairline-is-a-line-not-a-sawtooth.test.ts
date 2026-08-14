import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every MPFB actor has a jagged black sawtooth across the forehead. It survives seven #341 rounds,
 * it is on 3 of 3 actors, and it is on the most-looked-at part of a clinical figure.
 *
 * It is NOT the seam-fringe class #341 round 7 fixed. That was discarded alpha-0 hide polygons
 * showing background where no garment covered them (`f1880fe1`). The scalp is not hidden and not a
 * garment: it is a rendering primitive of the body mesh carrying its own material, and the hairline
 * is the boundary between that primitive and the skin primitive.
 *
 * MEASURED 2026-08-12 on the landed GLBs, and the FIRST metric I tried was the wrong one — recorded
 * because the next person will reach for it too:
 *
 *   forehead seam Y      aisha            kevin            child
 *   -----------------    -------------    -------------    -------------
 *   mean                 0.9319 H         0.9397 H         0.9289 H
 *   sd                   30.9 mm          39.3 mm          28.0 mm
 *   span                 147.6 mm         156.4 mm         113.0 mm
 *
 * Span and sd CANNOT distinguish a ragged hairline from a smoothly curved one — a hairline that
 * sweeps up at the temples legitimately spans centimetres. Bounding the spread would have been the
 * §11s error a third time this week: bounding a QUANTITY when the defect lives in the SHAPE.
 *
 * The signature of a sawtooth is ALTERNATION. Sorting the central-forehead seam vertices by X and
 * counting sign changes in successive dY:
 *
 *   central forehead     aisha            kevin            child
 *   -----------------    -------------    -------------    -------------
 *   seam vertices        57               37               59
 *   direction flips      37 / 55 steps    21 / 35 steps    31 / 57 steps
 *   FLIP RATE            67%              60%              54%
 *   median |dY| step     27.3 mm          6.9 mm           14.9 mm
 *
 * A smooth arc flips direction 0–10% of steps (once or twice, at its extrema). 54–67% is a boundary
 * alternating up and down almost every polygon — the per-polygon material assignment following
 * triangle edges, which is what the pixels show.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                    | (1) not ragged | (2) hairline stays put | (3) scalp survives | result
 *   ---------------------------------------------|----------------|------------------------|--------------------|--------
 *   a) today — per-polygon assignment            |   **FAIL**     |         pass           |       pass         | REFUSED
 *   b) raise every seam vertex to the max         |     pass       |       **FAIL**         |       pass         | REFUSED
 *   c) shrink the scalp above the visible brow    |     pass       |       **FAIL**         |       pass         | REFUSED
 *   d) drop the scalp region entirely             |     pass       |       **FAIL**         |     **FAIL**       | REFUSED
 *   e) a boundary that follows a smooth curve     |     pass       |         pass           |       pass         | ALL PASS
 *
 * (b) and (c) are the two to worry about: both flatten the flip rate to ~0 and both do it by MOVING
 * the hairline, which #341 round 5 derived from the body's own surface ("the highest face-front
 * vertex still at or ahead of the forehead plane") after establishing that the shipped anatomy has
 * no hairline reference at all. That derivation is the known-good column and must survive; a fix
 * that smooths the line by relocating it has thrown away the only anatomy we have.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on all three today. (2) and (3)
 * PASS today and are regression nets, not evidence of a defect.
 *
 * NOT TESTED, and this is the scope statement:
 *   - No pixel is graded here. This asserts the SEAM GEOMETRY only. A hairline can be numerically
 *     smooth and still read wrong — wrong shape, wrong height for the face, wrong for a child.
 *   - Nothing is claimed about the OTHER open defects on these figures: mitten shards on the hands,
 *     the ragged waistband and trouser hems, or the child wearing its shirt on adult bands (#332).
 *     They are not shown to share this cause.
 *   - The flip-rate threshold bounds ALTERNATION, not amplitude. A finer zigzag with the same flip
 *     rate still fails, which is intended; a smooth curve with large amplitude passes, which is also
 *     intended, because that is a hairline shape question and not this contract's.
 *
 * ## SUPERSEDED 2026-08-13 — THE SUBJECT OF THIS CONTRACT NO LONGER EXISTS
 *
 * Everything above is a true record of a defect that was real when measured. It is retained because
 * the flip-rate METHOD it introduced is still in use (#355 applied it to the garment-boundary
 * frontier), and because the numbers are the only calibration anyone has for "what a per-polygon
 * sawtooth measures".
 *
 * **But #341 rounds 11-16 retired the scalp primitive.** The hairline moved into the baked skin
 * texture, so `scalpPrims = 0` on all three shipped actors and there is no scalp/skin seam left to
 * walk. Measured 2026-08-13: 0 scalp primitives, 0 hair meshes, 0 hair triangles; hair exists only as
 * dark pixels in the 615-648 KB skin texture (#296).
 *
 * **THE STATE THIS LEFT WAS WORSE THAN A RED.** `measure()` returned null for every actor, `rows` was
 * empty, and the vacuity guard threw — so clauses (2) and (3) failed on main (for an unknown number of
 * cycles), while clause (1), being `it.fails`, **"passed" by throwing**. An `it.fails` test is
 * satisfied when the body fails for ANY reason, including measuring nothing at all. A RED that is
 * green because its subject was deleted is the most misleading artifact this repo can hold: it reads
 * as a defect still being watched.
 *
 * It also made every `done_when` that referenced this file unpassable. That cost a real slice — #355's
 * contract gated on it and was refused at integrate, and the work had to be cherry-picked.
 *
 * ## WHAT REPLACES IT (§6p: a contract that removes something must say what takes over)
 *
 * The clauses below now gate the design that actually shipped: the scalp is retired and the hairline
 * is baked into the skin texture. That is a NET over the current mechanism, not a weakening — the old
 * clauses could not fail meaningfully, and these can.
 *
 * What is NOT covered, and is the honest gap: **nothing here measures whether the painted hairline
 * looks right.** It does not. Graded on #354's 1024 px eye crops, the mask is a hard, pixel-stair-
 * stepped boundary that clips aisha's brow and runs onto Kevin's cheek. Quantifying that needs a
 * texture-space measurement (the render-space attempts failed twice — in a lit render "dark" is also
 * pupils, lashes and shadow), and it belongs to #296.
 *
 * ## SUPERSEDED (#359) — the texture route is removed; the region is the mechanism again
 *
 * #358's head-framed comparison settled the direction: the texture-mask hairline (this contract's
 * subject) was graded as damage — roughly half the scalp bare skin, a hard pixel-stair-stepped
 * vertical edge, an isolated black rectangle — while the per-polygon scalp material region read
 * unambiguously as hair. #359 therefore removes the texture route and ships the region: the body
 * mesh again carries an `openclinxr_mesh_native_scalp_hair_surface` primitive (the Anny known-good
 * mechanism, bounds-derived by `apply_mesh_native_scalp_hair_material_region`). The clauses below
 * now gate THAT mechanism, mirroring how #341 rewrote this file when the subject changed the other
 * way: (1) is the region's presence (the texture route's replacement), (2) is unchanged (the baked
 * skin texture must not vanish), and (3) becomes a mesh-level tripwire — the region is a primitive
 * WITHIN the body mesh; a separate hair MESH is still the hand-authored-geometry failure.
 *
 * ## FIXED (#387) — the placeholder is retired where a real fitted replacement exists
 *
 * The bounds-derived scalp paint is a self-declared PLACEHOLDER — its own docstring
 * (`automate_blender.py:4245`) says it exists "before a real groom/hair-card source stage
 * exists" — and #381 landed the real thing: 4,976 tris of fitted MakeClothes library hair
 * on aisha (`mpfb-ob-patient-aisha`). The paint underneath was never retired: she shipped
 * both, and the 2.8%-luminance placeholder under fitted hair was the hard 4096-grade
 * boundary #387 closes. The materializer now skips painting it where real fitted hair
 * exists (shared `body_param_stage.scalp_placeholder_retired_for`), so:
 *
 * - OLD clause (1) "every MPFB actor carries the scalp region" is re-premised: the region
 *   is required on figures with NO fitted hair (nurse, child) and must be ABSENT on the
 *   figure that has it (aisha). The measurement (scalpPrims per shipped body) is unchanged.
 * - OLD clause (3) "no separate hair MESH" counted aisha's #381 fitted
 *   `makeclothes_library_hair_*` mesh as a separate mesh — a PRE-EXISTING failure on main
 *   (the mesh landed in #381 before this contract was re-based). The fitted library hair
 *   is the D1-fitted replacement, the OPPOSITE of the hand-authored sphere #222 refuses,
 *   so it is now excluded by mesh-name prefix — the same convention as the #222 contract's
 *   FITTED_LIBRARY_HAIR_MESH. Any OTHER separate hair mesh still trips the wire.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The baked skin texture must stay present; below this it is not a real bake. */
const MIN_SKIN_TEXTURE_KB = 200;

type Row = { file: string; scalpPrims: number; separateHairMeshes: number; skinTextureKb: number };

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const meshes = doc.getRoot().listMeshes();
  let scalpPrims = 0;
  let separateHairMeshes = 0;
  let skinTextureKb = 0;
  let bodyMesh: (typeof meshes)[number] | undefined;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const name = `${mesh.getName()}/${prim.getMaterial()?.getName() ?? ""}`;
      // The region is a primitive WITHIN the body mesh (#359). A separate hair MESH is the
      // hand-authored-geometry failure (the old UV sphere); count meshes, not primitives.
      if (/scalp/i.test(name)) {
        scalpPrims++;
        bodyMesh = bodyMesh ?? mesh;
      }
      if (/skin/i.test(name)) {
        const img = prim.getMaterial()?.getBaseColorTexture()?.getImage();
        if (img) skinTextureKb = Math.max(skinTextureKb, img.length / 1024);
      }
    }
  }
  for (const mesh of meshes) {
    if (mesh === bodyMesh) continue;
    // #330/#381 — the FITTED library hair mesh (`makeclothes_library_hair_*`) is a
    // D1-fitted .mhclo replacement, the OPPOSITE of the hand-authored UV sphere #222
    // refuses; it is excluded by mesh-name prefix, the same convention as the #222
    // contract's FITTED_LIBRARY_HAIR_MESH. #387: aisha's placeholder is retired BECAUSE
    // this mesh replaced it, so counting it here would contradict the premise.
    if (/^makeclothes_library_hair/i.test(mesh.getName() ?? "")) continue;
    if (mesh.listPrimitives().some((p) => /hair/i.test(p.getMaterial()?.getName() ?? ""))) {
      separateHairMeshes++;
    }
  }
  return { file: rel.split("/").pop()!, scalpPrims, separateHairMeshes, skinTextureKb };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t) — the trap this file just fell into. */
function requireRows(): void {
  expect(rows.length, `MPFB bodies scanned (of ${files.length})`).toBeGreaterThanOrEqual(3);
}

/** #387 — the shipped base id of the figure whose placeholder scalp paint is retired
 * (real fitted hair on disk). See body_param_stage.scalp_placeholder_retired_for. */
const RETIRED_FIGURE = "mpfb-ob-patient-aisha.glb";

describe("the scalp region is the hair mechanism on the body mesh (texture route removed, #359)", () => {
  it("(1) RED: the scalp region is present on every actor without fitted hair and absent on aisha", () => {
    // #359 reinstated the per-polygon scalp region (the #341 texture route is removed).
    // #387: the region is a self-declared PLACEHOLDER (automate_blender.py:4245) — it is
    // required where no real fitted hair exists (the nurse and the child) and must be
    // ABSENT where #381's fitted replacement is on disk (aisha). Old assertion changed:
    // "every MPFB actor carries the scalp region" — that encoded the placeholder as a
    // required feature; the retirement makes aisha the documented exception.
    requireRows();
    const missing = rows
      .filter((r) => r.file !== RETIRED_FIGURE)
      .filter((r) => r.scalpPrims === 0)
      .map((r) => `${r.file}: scalpPrims=${r.scalpPrims}`);
    expect(missing, "bodies without the scalp region (aisha exempt: placeholder retired)").toEqual([]);
    const stale = rows
      .filter((r) => r.file === RETIRED_FIGURE && r.scalpPrims > 0)
      .map((r) => `${r.file}: scalpPrims=${r.scalpPrims} — placeholder not retired`);
    expect(stale, "figures with real fitted hair still carrying the placeholder").toEqual([]);
  });

  it("(2) the baked skin texture is present and non-trivial", () => {
    // The skin bake (enhanced_skin -> baseColorTexture) is the body's skin surface; if it
    // vanishes the actors lose their skin shading entirely.
    requireRows();
    const missing = rows
      .filter((r) => r.skinTextureKb < MIN_SKIN_TEXTURE_KB)
      .map((r) => `${r.file}: skinTexture=${r.skinTextureKb.toFixed(0)}KB`);
    expect(missing, `bodies whose skin texture is under ${MIN_SKIN_TEXTURE_KB} KB`).toEqual([]);
  });

  it("(3) no separate hair MESH has appeared outside the body mesh", () => {
    // The region is a primitive WITHIN the body mesh. A separate hair mesh is the
    // hand-authored-geometry failure (#222's UV sphere); tripwire at mesh level.
    requireRows();
    const geo = rows.filter((r) => r.separateHairMeshes > 0).map((r) => `${r.file}: separateHairMeshes=${r.separateHairMeshes}`);
    expect(geo, "bodies carrying a separate hair mesh").toEqual([]);
  });
});
