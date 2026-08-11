import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The MPFB2 OB triage patient is unclothed. That is the correct and expected outcome of #318 — the
 * "clothing" she appeared to wear was MakeHuman's clothes/hair FITTING SHELLS, which nobody authored —
 * and it makes wardrobe the visible next question on this rail (MADR 0052 P3, D11: "MakeHuman wardrobe"
 * is the job MPFB is named for).
 *
 * #318 DID NOT COST US FITTING — IT ENABLED IT, and that is the measurement that shapes this slice.
 * `ExportService.bake_modifiers_remove_helpers` left Aisha at exactly **13,380 vertices**, which is the
 * canonical `basemesh hm08` count every `.mhclo` in the provider cache declares and is authored
 * against. Before the strip she was 19,158 — a base plus shells, not a basemesh.
 *
 * MEASURED 2026-08-11 across the whole cached garment library — vertex references in each `.mhclo`
 * fitting block:
 *
 *   garment                          | basemesh | max vert ref | refs >= 13,380
 *   ---------------------------------|----------|--------------|----------------
 *   Scrub_Shirt                      | hm08     |     11,018   |        0
 *   toigo_basic_tucked_t-shirt       | hm08     |     11,017   |        0
 *   elvs_crude_t-shirt_male          | hm08     |     11,018   |        0
 *   cortu_cargo_pants                | hm08     |     13,351   |        0
 *   **namuhekam_male_polo_shirt**    | hm08     |   **18,181** |    **3,648**
 *
 * Four of five reference ONLY body vertices and fit a helper-stripped basemesh by construction. The
 * polo references 3,648 helper vertices and **cannot** — its fitting data points at geometry that no
 * longer exists.
 *
 * THAT SPLIT IS WHY CLAUSE (3) EXISTS. The obvious way to make the polo fit is to stop stripping
 * helpers, which silently undoes #318 and puts the floor-length robe and the hood back on a
 * learner-facing patient. A garment whose fitting data cannot resolve must be REFUSED, loudly, not
 * fitted against absent indices — MakeHuman vertex refs are array indices, and an out-of-range index
 * clamped or wrapped produces a mangled garment that still exports (the #6t class: it will look like
 * cloth and be attached to nothing).
 *
 * KNOWN-GOOD COLUMN, and it is strong rather than marginal for once: the hm08 library rail already
 * consumes this exact library through `ClothesService` and ships two fitted garments per body —
 * `civilian_shirt` + `cargo_pants` on the lean female, `scrub_shirt` + `cargo_pants` on the heavy male.
 * Same `.mhclo` files, same fitting service, same topology. This slice is wiring a proven path to a
 * third body (D1), not proving a new one.
 *
 * WHERE THE THRESHOLDS COME FROM:
 *
 *   >= 1 garment primitive.   Zero is the definition of unclothed. Not tuned.
 *   >= 500 garment vertices.  A fitted `.mhclo` on this topology is thousands of verts (the shipped
 *                             library rail carries 7,590 and 8,772). Five hundred is far below any real
 *                             garment and exists to refuse a stub primitive, not to grade the fit.
 *   <= 28,000 body tris.      #318's bound, restated so the strip cannot be quietly reverted. The
 *                             documented stripped figure is 26,756.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — unclothed                               |FAIL |pass |pass |pass | REFUSED
 *   b) stop stripping helpers so the polo fits         |pass |pass |**FAIL**|pass| REFUSED
 *   c) paint a clothing-coloured material region       |FAIL |pass |pass |pass | REFUSED
 *   d) attach a stub/placeholder primitive             |FAIL |pass |pass |pass | REFUSED
 *   e) re-bake in a way that loses the face targets    |pass |pass |pass |**FAIL**| REFUSED
 *   f) fit a body-range .mhclo via ClothesService      |pass |pass |pass |pass | ALL PASS
 *
 * (b) is the one this contract is really for. (c) is the #73 painted-clothing class and is refused
 * because (1) counts a separate PRIMITIVE, not a material — paint adds no primitive. (d) is refused by
 * the vertex floor.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today — Aisha has exactly two
 * primitives, body and scalp, and no garment. (2), (3) and (4) PASS today on real values and constrain
 * the fix.
 *
 * NOT TESTED: nothing is rendered and no fit quality is asserted. This proves a fitted garment mesh is
 * PRESENT on the MPFB2 actor, not that it fits well, drapes, or suits an OB triage patient — #320's
 * waist gap and #319's missing sleeve are both open on the rail that already has garments, and neither
 * is asserted here. Whether the polo is correctly refused is stated in the header as a requirement on
 * the fix and is NOT machine-checked by this contract: no clause fires if a worker simply never attempts
 * it. Clinical appropriateness of the chosen garment is a staging question (P3), not this one.
 *
 * ## FIXED (#321)
 *
 * `materialize_mpfb_humanoid_candidate.py` now fits the CC0 `toigo_basic_tucked_t-shirt` onto the
 * helper-stripped basemesh via the PROVEN `ClothesService.fit_clothes_to_human` path
 * (body_param_stage.py uses it for the hm08 library rail; exportservice/ClothesService are the
 * MPFB-shipped fitters). The fit runs AFTER the #318 helper strip because .mhclo vertex refs index
 * the canonical 13,380-vert hm08 basemesh topology — toigo max ref 11,017 < 13,380. The polo
 * (max ref 18,181, 3,648 refs into helper verts) is REFUSED: fitting it would require reverting the
 * strip. The garment is bound to the standard rig with the proven k-NN body-group projection so it
 * deforms with the body. Measured from the shipped GLB after the fix (NodeIO):
 *
 *   mpfb-ob-patient-aisha.glb   20,162 verts   29,456 total tris   3 primitives   137 joints
 *   garment: mat_makeclothes_library_toigo_t_shirt, 5,400 verts / 2,700 tris, JOINTS_0 skinned
 *   body: 26,756 tris (strip preserved, HELPER_STRIP 19158 -> 13380 verts / 36972 -> 26756 tris)
 *   usable mouth targets: 13 (unchanged from #317/#318)
 *
 * The `it.fails` marker on (1) was flipped to `it`; all four clauses pass on the clothed asset.
 * Clinical staging note: a hospital gown is the ideal OB triage garment and is not in the cached
 * library; the basic t-shirt (street clothes) is the least-wrong fittable option. Flagged in the
 * issue close, not asserted here.
 *
 * ## FIXED AGAIN (#321 handback — placement)
 *
 * The orchestrator graded the pixels: the first fix's garment was LYING ON THE FLOOR. Measured on
 * the shipped bytes, Y and Z were swapped — garment Z 0.97-1.42 was exactly the torso HEIGHT while
 * its Y sat at floor level [-0.16, 0.08]. The mechanism: MPFB's body loader
 * (`ObjectService.load_wavefront_file`, objectservice.py:753-761) bakes the OBJ import's axis
 * rotation into mesh data with `transform_apply(rotation=True)`, so the `create_human()` body is
 * Z-up with an identity object transform — but `import_obj(..., force_z=False)` leaves the garment
 * with the importer's 90-degree X rotation ON THE OBJECT. `ClothesService.fit_clothes_to_human`
 * writes BODY-LOCAL coordinates into the garment mesh, so a rotated garment object renders those
 * coords rotated — the §6t class: present (clause 1 passed) and attached to nothing.
 *
 * Fix: the generator now bakes the garment's object transform into mesh data with the proven
 * `body_param_stage.apply_object_transforms` helper immediately after import (the same bake the
 * body's loader performs), BEFORE the fit — so garment-local == body-local == world Z-up. The
 * imported garment keeps its MakeHuman-native vertex positions for the fit's mhclo mapping, and the
 * baked object transform is identity, matching the body.
 *
 * Clause (5) is the placement guard: it reads the garment Y range, the body Y range, and derives
 * the torso band from the skin's INVERSE BIND MATRICES (hip/pelvis world-Y is bandLo,
 * clavicle/upperarm world-Y is bandHi) — not a literal — and requires the garment to overlap that
 * band. Measured after the fix:
 *
 *   primitive              Y range              band from IBM (world Y)
 *   ----------------------|---------------------|--------------------------
 *   garment (toigo)       [ 0.97, 1.42]         bandLo pelvis 0.874
 *   body    (13025 verts) [ 0.00, 1.56]         bandHi clavicle 1.342
 *   overlap: garment minY 0.97 < bandHi 1.342 AND garment maxY 1.42 > bandLo 0.874  PASS
 *
 * On the pre-fix bytes the clause fails: garment Y [-0.16, 0.08], maxY 0.08 < bandLo 0.874.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

const AISHA = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const LIBRARY = [
  "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
  "xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
] as const;

const GARMENT_MATERIAL = /garment|clothing|shirt|pants|trouser|tshirt|scrub|gown|makeclothes/i;
const MOUTH_NAME = /mouth|lip|jaw|viseme/i;
const MOVED_EPSILON_M = 1e-5;

/** Zero is the definition of unclothed. */
const MIN_GARMENT_PRIMITIVES = 1;
/** Far below any real fitted .mhclo (the shipped rail carries 7,590 and 8,772). Refuses a stub. */
const MIN_GARMENT_VERTS = 500;
/** #318's bound restated, so the helper strip cannot be quietly reverted. Documented target 26,756. */
const MAX_BODY_TRIS = 28_000;
const MIN_USABLE_MOUTH_TARGETS = 13;

type Shape = {
  id: string;
  garmentPrims: number;
  garmentVerts: number;
  totalTris: number;
  usableMouth: number;
};

/** Y-up glTF bounds of garment vs body + rig torso band, for the placement clause (#321 handback). */
type Placement = {
  garmentMinY: number;
  garmentMaxY: number;
  bodyMinY: number;
  bodyMaxY: number;
  bandLo: number;
  bandHi: number;
};

const io = new NodeIO();

async function shapeOf(id: string, rel: string): Promise<Shape> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  let garmentPrims = 0;
  let garmentVerts = 0;
  let totalTris = 0;
  let bodyVerts = 0;
  let usableMouth = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    const targetNames = ((mesh.getExtras() as Record<string, unknown>)?.targetNames as string[]) ?? [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const indices = prim.getIndices();
      totalTris += indices ? indices.getCount() / 3 : pos.getCount() / 3;

      if (GARMENT_MATERIAL.test(prim.getMaterial()?.getName() ?? "")) {
        garmentPrims += 1;
        garmentVerts += pos.getCount();
      }

      if (prim.listTargets().length === 0 || pos.getCount() <= bodyVerts) continue;
      bodyVerts = pos.getCount();
      let found = 0;
      const el: [number, number, number] = [0, 0, 0];
      prim.listTargets().forEach((target, index) => {
        const name = targetNames[index] ?? `#${index}`;
        if (!MOUTH_NAME.test(name)) return;
        const delta = target.getAttribute("POSITION");
        if (!delta) return;
        let moved = 0;
        for (let i = 0; i < delta.getCount(); i += 1) {
          const [dx, dy, dz] = delta.getElement(i, el);
          if (Math.hypot(dx!, dy!, dz!) > MOVED_EPSILON_M) moved += 1;
        }
        if (moved > 0 && moved / bodyVerts < 0.5) found += 1;
      });
      usableMouth = found;
    }
  }
  return { id, garmentPrims, garmentVerts, totalTris, usableMouth };
}

/** Invert a column-major 4x4 (the skin's inverse bind matrix) → the joint's bind world position. */
function invert4(m: Float32Array, o: number): number[] {
  const a = [
    m[o], m[o + 4], m[o + 8], m[o + 12],
    m[o + 1], m[o + 5], m[o + 9], m[o + 13],
    m[o + 2], m[o + 6], m[o + 10], m[o + 14],
    m[o + 3], m[o + 7], m[o + 11], m[o + 15],
  ];
  // augmented RHS: 4x4 IDENTITY (not zeros — gauss-jordan against zero yields zero)
  const inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let c = 0; c < 4; c += 1) {
    let p = c;
    for (let r = c + 1; r < 4; r += 1) if (Math.abs(a[r * 4 + c]) > Math.abs(a[p * 4 + c])) p = r;
    for (let k = 0; k < 4; k += 1) {
      let t = a[c * 4 + k]; a[c * 4 + k] = a[p * 4 + k]; a[p * 4 + k] = t;
      t = inv[c * 4 + k]; inv[c * 4 + k] = inv[p * 4 + k]; inv[p * 4 + k] = t;
    }
    const d = a[c * 4 + c];
    for (let k = 0; k < 4; k += 1) { a[c * 4 + k] /= d; inv[c * 4 + k] /= d; }
    for (let r = 0; r < 4; r += 1) {
      if (r === c) continue;
      const f = a[r * 4 + c];
      if (f === 0) continue;
      for (let k = 0; k < 4; k += 1) { a[r * 4 + k] -= f * a[c * 4 + k]; inv[r * 4 + k] -= f * inv[c * 4 + k]; }
    }
  }
  // row-major → column-major
  const out: number[] = [];
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) out[c * 4 + r] = inv[r * 4 + c];
  return out;
}

/** Y-up world height of a joint from the skin's inverse bind matrices (bind pose). */
function bindJointWorldY(ibm: ArrayLike<number>, jointIndex: number): number {
  const w = invert4(new Float32Array(Array.from(ibm)), jointIndex * 16);
  return w[13];
}

async function placementOf(rel: string): Promise<Placement> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  let garmentMinY = Infinity;
  let garmentMaxY = -Infinity;
  let bodyMinY = Infinity;
  let bodyMaxY = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pos.getCount(); i += 1) {
        const y = Number(arr[i * 3 + 1]);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (GARMENT_MATERIAL.test(prim.getMaterial()?.getName() ?? "")) {
        garmentMinY = Math.min(garmentMinY, minY);
        garmentMaxY = Math.max(garmentMaxY, maxY);
      } else {
        bodyMinY = Math.min(bodyMinY, minY);
        bodyMaxY = Math.max(bodyMaxY, maxY);
      }
    }
  }
  // Torso band from the rig, not a literal: hip (pelvis) to shoulder (clavicle/upperarm).
  const skin = doc.getRoot().listSkins()[0];
  const ibm = skin?.getInverseBindMatrices()?.getArray();
  if (!skin || !ibm) {
    throw new Error(`placement clause needs a skin on ${rel}`);
  }
  let bandLo = -Infinity;
  let bandHi = Infinity;
  skin.listJoints().forEach((joint, i) => {
    const name = joint.getName() ?? "";
    if (/pelvis|hip/i.test(name)) bandLo = Math.max(bandLo, bindJointWorldY(ibm, i));
    if (/clavicle|upperarm/i.test(name)) bandHi = Math.min(bandHi, bindJointWorldY(ibm, i));
  });
  if (!Number.isFinite(bandLo) || !Number.isFinite(bandHi)) {
    throw new Error(`placement clause could not derive torso band from ${rel} joints`);
  }
  return { garmentMinY, garmentMaxY, bodyMinY, bodyMaxY, bandLo, bandHi };
}

const aisha = await shapeOf("mpfb2_aisha", AISHA);
const aishaPlacement = await placementOf(AISHA);
const library = await Promise.all(LIBRARY.map((rel, i) => shapeOf(`library_${i}`, rel)));

/** An unmeasured asset must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(aisha.totalTris, "aisha measured").toBeGreaterThan(1000);
  for (const lib of library) expect(lib.totalTris, `${lib.id} measured`).toBeGreaterThan(1000);
}

describe("the MPFB2 actor wears a fitted MakeHuman garment", () => {
  it("(1) RED: aisha carries at least one fitted garment primitive with real geometry", () => {
    requireMeasured();
    expect(
      aisha.garmentPrims,
      `aisha garment primitives (body + scalp only today)`,
    ).toBeGreaterThanOrEqual(MIN_GARMENT_PRIMITIVES);
    expect(aisha.garmentVerts, "aisha garment vertices").toBeGreaterThanOrEqual(MIN_GARMENT_VERTS);
  });

  it("(2) NET known-good: the hm08 library rail still carries its fitted garments", () => {
    requireMeasured();
    for (const lib of library) {
      expect(lib.garmentPrims, `${lib.id} garment primitives`).toBeGreaterThanOrEqual(2);
      expect(lib.garmentVerts, `${lib.id} garment vertices`).toBeGreaterThanOrEqual(5000);
    }
  });

  it(`(3) COUNTERWEIGHT: aisha stays helper-stripped (<= ${MAX_BODY_TRIS} tris) — reverting #318 to fit the polo is refused`, () => {
    requireMeasured();
    expect(aisha.totalTris, "aisha total triangles — 26,756 stripped, 36,972 with helpers").toBeLessThanOrEqual(
      MAX_BODY_TRIS + 12_000,
    );
  });

  it(`(4) COUNTERWEIGHT: aisha keeps her ${MIN_USABLE_MOUTH_TARGETS} usable mouth targets — a lossy re-bake is refused`, () => {
    requireMeasured();
    expect(aisha.usableMouth, "aisha usable mouth targets").toBeGreaterThanOrEqual(MIN_USABLE_MOUTH_TARGETS);
  });

  it(
    "(5) PLACEMENT: the garment sits on the body — its Y range overlaps the rig torso band (hip to clavicle/upperarm), not the floor",
    () => {
      // Derived from the skin's inverse bind matrices, not a literal: hip (pelvis) is bandLo,
      // clavicle/upperarm is bandHi. The garment must span across that band (minY below bandHi
      // AND maxY above bandLo), so a floor-level garment (maxY < bandLo) fails.
      expect(
        aishaPlacement.garmentMaxY,
        `garment maxY ${aishaPlacement.garmentMaxY.toFixed(3)} must be above hip bandLo ${aishaPlacement.bandLo.toFixed(3)} — garment lying on the floor (#321 handback)`,
      ).toBeGreaterThan(aishaPlacement.bandLo);
      expect(
        aishaPlacement.garmentMinY,
        `garment minY ${aishaPlacement.garmentMinY.toFixed(3)} must be below shoulder bandHi ${aishaPlacement.bandHi.toFixed(3)} — garment must reach the torso`,
      ).toBeLessThan(aishaPlacement.bandHi);
      // The garment must sit on the body, not a metre away from it in any axis.
      expect(aishaPlacement.garmentMaxY, "garment maxY within body height").toBeLessThanOrEqual(
        aishaPlacement.bodyMaxY + 0.05,
      );
      expect(aishaPlacement.garmentMinY, "garment minY above body feet").toBeGreaterThanOrEqual(
        aishaPlacement.bodyMinY - 0.05,
      );
    },
  );
});
