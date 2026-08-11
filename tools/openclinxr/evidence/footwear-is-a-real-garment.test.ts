import { dirname, resolve as pathResolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #295 graded the learner-visible library figures and named "brown blob shoes with pale toes
 * protruding". It was never located. Located now:
 *
 *   rail          | shoe prims | shoe verts | foot-dominant BODY verts | ratio
 *   --------------|------------|------------|--------------------------|--------
 *   lean_female   |     2      |    **172** |          8,560           | 1 : 50
 *   heavy_male    |     2      |    **172** |          8,546           | 1 : 50
 *
 * **Eighty-six vertices per shoe over ~4,280 vertices of foot.** A shell that coarse cannot follow a
 * foot with separated toes; it is a blob, and the detailed foot pokes through it. This is not a fit
 * defect to tune — it is a resolution defect, and no coefficient fixes 86 vertices.
 *
 * THE PROCEDURAL PATH WAS A DELIBERATE FALLBACK, AND ITS OWN DOCSTRING SAYS WHY.
 * `embed_library_footwear.py:1-12`: *"MakeClothes .mhclo shoes were searched; none staged with a
 * licence-clean header on this host — procedural path is the factory finish."* That was true when
 * written. It is no longer true.
 *
 * ACQUIRED 2026-08-11 — `makehuman-shoes01`, the CC0 subset (`shoes01_cc0.zip`, 83 MB, 23 shoes, all
 * `basemesh hm08`). Measured per `.mhclo`, licence read from the file's own header and helper-vertex
 * references counted against the 13,380 body/helper split:
 *
 *   shoe                      | licence | basemesh | refs >= 13,380 | obj verts
 *   --------------------------|---------|----------|----------------|-----------
 *   **toigo_flats**           | **CC0** | hm08     |     **0**      |  28,808
 *   **toigo_mj_cloth_shoes**  | **CC0** | hm08     |     **0**      |     556
 *   culturalibre_male_boots   | CC-0    | hm08     |       0        |       -
 *   toigo_ankle_boots_*       | CC0     | hm08     |    6,252       |       -
 *   toigo_ballet_flats*       | CC0     | hm08     | 13,674-23,268  |       -
 *   toigo_stiletto_booties    | CC0     | hm08     |   67,242       |       -
 *
 * The helper-bearing ones cannot fit a stripped basemesh (#318) and are out. Three CC0 shoes with zero
 * helper references are staged in the provider cache under
 * `.openclinxr-local/provider-cache/garments/sources/makehuman-shoes01/`, matching the `pants01` /
 * `shirts01` / `hair01` convention.
 *
 * **Triangle count is NOT a selection criterion.** `toigo_flats` is 28,808 obj verts and
 * `toigo_mj_cloth_shoes` is 556; the operator's standing directive is that no generated output is gated
 * on triangle count because meshoptimizer runs later in the pipeline. Choose on clinical plausibility,
 * and say why.
 *
 * KNOWN-GOOD COLUMN: the upper and lower garment channels on these same two bodies. Both are fitted
 * `.mhclo` through `ClothesService` — 4,968-vert toigo t-shirt (#322) and 8,565-vert cargo pants — and
 * both carry a licence token read from their own header. Footwear is the last garment channel on this
 * rail still hand-generated. This slice wires the proven path to it (D1), it does not prove a new one.
 *
 * WHERE THE THRESHOLDS COME FROM:
 *
 *   >= 500 shoe verts per pair.  The current pair is 172. The lightest CC0 candidate is 556 obj verts
 *                                before fitting. Five hundred refuses the blob without preferring the
 *                                dense shoe over the light one — deliberately, per the directive above.
 *   0 helper-vertex refs.        Not a threshold: a shoe referencing helper geometry cannot fit the
 *                                stripped basemesh at all.
 *   licence token recorded.      #322 found the catalog attributing CC-BY to a procedurally generated
 *                                shell. A generated shoe has no licence; a fitted one must record its own.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                        | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — 86-vert procedural shells             |FAIL |FAIL |pass |pass | REFUSED
 *   b) subdivide the procedural blob to clear (1)    |pass |**FAIL**|pass|pass| REFUSED
 *   c) delete the shoes so nothing pokes through     |**FAIL**|FAIL|pass|pass| REFUSED
 *   d) fit a helper-bearing shoe (ballet flats etc.) |  -  |  -  |  -  |  -  | cannot bake
 *   e) fit a CC0 helper-free .mhclo via ClothesService| pass| pass| pass| pass| ALL PASS
 *
 * (b) is the tempting one and (2) refuses it: subdividing 86 vertices produces a smoother blob with a
 * higher count and no licence provenance, because a generated shell has no source to cite. (2) requires
 * the shipped footwear to record a licence token read from a `.mhclo` header, which only a real garment
 * can satisfy.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today on both rails. (3) and
 * (4) PASS today on real values — the upper and lower channels already work — and they stop the fix
 * regressing the garments #322 and #320 landed.
 *
 * NOT TESTED: nothing is rendered and no fit quality is asserted. This proves the footwear channel is a
 * fitted library garment with recorded provenance and enough resolution to follow a foot. It does NOT
 * prove the toes stop protruding — that is a coverage question, the body under the shoe is not hidden on
 * this channel (the hide mask covers upper and lower only), and #323 is the sibling slice for hiding on
 * the MPFB2 rail. Whether the chosen shoe suits a clinical station is a P3 staging judgement and mine to
 * grade.
 *
 * ## FIXED (#324)
 *
 * `embed_library_footwear.py` no longer generates procedural shells. It fits a staged CC0 MakeClothes
 * `.mhclo` shoe through the SAME `ClothesService.fit_clothes_to_human` the upper (#322) and lower (#220)
 * channels use (D1), then splits the two-feet mesh into L/R halves weighted to `mixamorig:LeftFoot` /
 * `mixamorig:RightFoot`. `body-param-cli.ts` selects the shoe per body class on clinical plausibility
 * (lean female → `toigo_flats`, heavy male → `culturalibre_male_boots`), records the licence read from
 * the shoe's OWN `.mhclo` header (`# license CC0` / `# license CC-0`), and stamps `footwearShoeId` /
 * `footwearLicenseToken` / `footwearLicenseSource` into the catalog.
 *
 * Two measured traps the fit had to clear. (a) The shipped GLB body re-imports with broken vertex
 * indexing (53,672 verts vs 13,380 — the material-split primitives merge on re-import), so the fit runs
 * against a reconstructed `base.obj` reference with the body class's phenotype macros re-applied as
 * live shape keys, then places the shoe onto the GLB body by foot landmarks. (b) `wm.obj_import` keeps
 * the MakeHuman OBJ Y-up, so the `.mhclo` offset scales land wrong on a raw reference — the reference is
 * rotated Z-up (sole at z=0) BEFORE the fit; on the first bake this inflated the flats to 24.9 cm and
 * the boots to 27.9 cm, after the fix the flats rise 5.5 cm and the boots 40.2 cm above the sole.
 *
 * Re-baked through `pnpm asset:body-param:fit -- --once` (2026-08-11). Measured on the shipped bytes:
 *
 *   rail                          | shoe                 | prims | footwear verts | licence | shoe rise
 *   ------------------------------|----------------------|-------|----------------|---------|----------
 *   body-param-adult_lean_female  | toigo_flats (CC0)    |   2   | 30,594         | CC0     | 0.055 m
 *   body-param-adult_heavy_male   | male_boots (CC-0)    |   2   | 15,628         | CC-0    | 0.402 m
 *
 * The two `it.fails` markers were flipped to `it`; all four clauses pass on the re-baked bytes, and the
 * two regression nets (`casual-top-is-a-real-garment`, `garments-meet-at-the-waist`) stay green. The
 * licence ledger gained a `makehuman-shoes01` row (CC0 per the shoes' own `.mhclo` headers). Residual
 * poke-through is expected and unasserted — the body under the shoe is not hidden on this channel
 * (`notEvidenceFor` in the stage report); #323 is the sibling slice for hiding, on the MPFB2 rail.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CANDIDATES = `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates`;
const CATALOG = `${CANDIDATES}/body-param-catalog.json`;

const FOOTWEAR_MATERIAL = /footwear|shoe|boot|flats|sandal|slipper/i;
const MIN_FOOTWEAR_VERTS = 500;

const RAILS = ["body-param-adult_lean_female-library", "body-param-adult_heavy_male-library"] as const;

type Foot = { id: string; prims: number; verts: number };

const io = new NodeIO();

async function footwearOf(id: string): Promise<Foot> {
  const doc = await io.read(`${CANDIDATES}/${id}.glb`);
  let prims = 0;
  let verts = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      if (!FOOTWEAR_MATERIAL.test(prim.getMaterial()?.getName() ?? "")) continue;
      prims += 1;
      verts += pos.getCount();
    }
  }
  return { id, prims, verts };
}

const feet = await Promise.all(RAILS.map((r) => footwearOf(r)));

type Entry = { bodyClassId?: string; [k: string]: unknown };
const entries = (JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(CATALOG, "utf8")),
) as { entries?: Entry[] }).entries ?? [];

/** An unmeasured population must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(feet.length, "rails measured").toBe(RAILS.length);
  for (const f of feet) expect(f.prims, `${f.id}: footwear primitives present`).toBeGreaterThanOrEqual(2);
  expect(entries.length, "catalog entries").toBeGreaterThanOrEqual(2);
}

describe("footwear is a fitted library garment, not an 86-vertex blob", () => {
  it(`(1) RED→GREEN: each rail's footwear carries >= ${MIN_FOOTWEAR_VERTS} vertices`, () => {
    requireMeasured();
    const thin = feet
      .filter((f) => f.verts < MIN_FOOTWEAR_VERTS)
      .map((f) => `${f.id}: ${f.verts} footwear verts across ${f.prims} primitives`);
    expect(thin, "rails whose footwear is too coarse to follow a foot").toEqual([]);
  });

  it("(2) RED→GREEN: the shipped footwear records a licence token from a .mhclo header", () => {
    requireMeasured();
    const missing: string[] = [];
    for (const e of entries) {
      const keys = Object.keys(e).filter((k) => /footwear|shoe/i.test(k) && /license/i.test(k));
      const token = keys.length ? String(e[keys[0]!] ?? "") : "";
      if (!/^CC/i.test(token)) {
        missing.push(`${e.bodyClassId}: footwear licence token = ${token || "(absent)"}`);
      }
    }
    expect(missing, "rails whose footwear has no licence provenance").toEqual([]);
  });

  it("(3) NET known-good: the upper and lower garment channels still ship fitted library garments", () => {
    requireMeasured();
    for (const e of entries) {
      expect(String(e["garmentKind"] ?? ""), `${e.bodyClassId} upper garmentKind`).toBe("library");
      expect(String(e["lowerGarmentLicenseToken"] ?? ""), `${e.bodyClassId} lower licence`).toMatch(/^CC/i);
    }
  });

  it("(4) NET: the CC0 shoes pack is staged where the fit stage can read it", () => {
    const dir = `${REPO_ROOT}/.openclinxr-local/provider-cache/garments/sources/makehuman-shoes01`;
    expect(existsSync(dir), `shoes01 staged at ${dir}`).toBe(true);
    for (const shoe of ["toigo_flats", "toigo_mj_cloth_shoes"]) {
      expect(existsSync(`${dir}/${shoe}/${shoe}.mhclo`), `${shoe}.mhclo staged`).toBe(true);
    }
  });
});
