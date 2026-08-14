import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **The placeholder-scalp retirement is keyed per actor, so every NEW MPFB bake re-introduces it.**
 *
 * #403 landed two MPFB adults on 2026-08-14. Both ship
 * `openclinxr_mesh_native_scalp_hair_surface` at `baseColorFactor` **rgb(9,7,6)** — a near-black shell
 * over the crown. The four MPFB assets that already shipped carry **no such mesh at all**: the
 * retirement went through for them under #387 / #399 / `a997ae27`.
 *
 *   asset                       | placeholder scalp        | fitted hair
 *   ----------------------------|--------------------------|----------------------------
 *   **mpfb-clinical-nurse-adult**  | **2792 t @ rgb(9,7,6)**  | toigo_blunt_bob 2858 t
 *   **mpfb-family-partner-adult**  | **2724 t @ rgb(9,7,6)**  | toigo_curled_under_bob 2852 t
 *   mpfb-peds-nurse-kevin          | NONE                     | mhair02 3460 t
 *   mpfb-peds-patient-child        | NONE                     | ..._with_bangs 4976 t
 *   mpfb-ob-patient-aisha          | NONE                     | ..._with_bangs 4976 t
 *   mpfb-peds-parent-aisha         | NONE                     | ..._with_bangs 4976 t
 *
 * **This is the defect class the factory is supposed to eliminate (D9).** A retirement applied to a
 * list of known actors is not a pipeline step; it is four manual exceptions. The direction's next
 * moves — the two ED patients, then `adult_male_street_casual`, then retiring the Anny peds paths —
 * are all NEW bakes, and on today's code every one of them ships a near-black crown.
 *
 * ## HOW IT WAS LOCATED, INCLUDING THE INSTRUMENT THAT FAILED
 *
 * I graded the #403 stills and wrote *"dark jagged patches across both cheeks and temples"*. Then I
 * measured, and **the cheeks half of that grade is unsupported**:
 *
 * Sampling the baked skin at head-dominant vertex UVs (`_bone_dominant_vertex_indices`, joint `head`,
 * weight > 0.5) and splitting front-lower from crown:
 *
 *   asset                   | face-region black | scalp black
 *   ------------------------|-------------------|-------------
 *   nurse                   |            51.1 % |  **41.5 %**
 *   partner                 |            51.9 % |  **40.6 %**
 *   child (grades clean)    |            45.1 % |      10.2 %
 *   ob-aisha (grades clean) |            46.1 % |       8.8 %
 *
 * The scalp column separates 4x. **The face column does not separate and reads ~45 % black on figures
 * whose faces render cleanly, so that classifier is measuring something other than the face and its
 * numbers are discarded.** Recorded rather than deleted, because the next person to reach for a
 * UV-sampling face metric should know it did not work (§9g).
 *
 * Two instrument checks that were run before believing any of it: no head vertex has a degenerate
 * `(0,0)` UV and none is out of `[0,1]`; widening the sample from 1 texel to a 7x7 max moves the
 * numbers by under 3 points, so these are **large black regions, not seam sampling**.
 *
 * A global dark-pixel count over the whole atlas was tried FIRST and **cannot see this at all** —
 * every one of the six bakes is 54-57 % black because most of an atlas is unused. Filing on that
 * number would have been an unlocated grade (§11r).
 *
 * ## COMPOUNDING, MEASURED, NOT ASSERTED HERE
 *
 * The two new adults got bobs **without bangs** (2858 / 2852 t) where the clean four got
 * `_with_bangs` variants (4976 t). Less forehead coverage over a near-black crown is why the hairline
 * reads as a hard shelf. Not asserted — a bang-less style is a legitimate choice; the black shell
 * under it is not.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) no scalp | (2) hair kept | (3) known-good | result
 *   ---------------------------------------------------|--------------|---------------|----------------|--------
 *   a) today — retirement keyed per actor              |  **FAIL**    |     pass      |      pass      | REFUSED
 *   b) add the two new ids to the retirement list      |    pass      |     pass      |      pass      | ALLOWED*
 *   c) drop the scalp AND the fitted hair              |    pass      |  **FAIL**     |      pass      | REFUSED
 *   d) recolour the scalp to skin tone, keep the shell |  **FAIL**    |     pass      |      pass      | REFUSED
 *
 * ***(b) is deliberately NOT refused by the contract**, and it is the wrong fix. A contract cannot
 * tell a rule from a longer list — both produce zero scalp meshes today. It is called out here so a
 * reviewer can see which one landed: **the commit must say whether the scalp is now suppressed BY RULE
 * whenever a fitted hair mesh exists, or whether two more ids were appended.** If it is a list, say so
 * plainly and the next bake will break it again.
 *
 * **(d) is refused** by asserting the mesh is absent rather than that it is light: a skin-toned shell
 * over the crown is still a shell, and it will z-fight the hair.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED**, failing on exactly the two new
 * files. **(2) and (3) pass today** and are true nets. **(4) passes today** and guards vacuity.
 *
 * NOT TESTED:
 *   - **That removing the shell improves the pixels.** It removes a near-black surface under the hair;
 *     whether the hairline then reads well is a grade, and the orchestrator grades it after.
 *   - **The face-region blackness**, ~45-51 % on all four measured assets including the clean ones.
 *     Either the metric is wrong or there is a second defect nobody has seen. Unresolved, not filed.
 *   - **Anny-rail assets.** This enumerates `mpfb-*.glb` only.
 *   - **Whether `with_bangs` should be the default** for new adults.
 *
 * ## FIXED (medical-wardrobe 2026-08-14) — RULE, not two more ids
 *
 * `scalp_placeholder_retired_for` no longer consults a figure-id frozenset.
 * The emit site in `materialize_mpfb_humanoid_candidate.py` passes
 * `fitted_hair_present=bool(HAIR_STYLE_BY_REFERENCE.get(reference))`. A NEW bake
 * that fits hair is clean without appending an id. This slice rebakes kevin
 * only; the two #403 adults still carry the shell on disk, so (1) stays
 * `it.fails` until those files are rebaked. Do not flip (1) by growing a list.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
/** Overridable so a destructive probe can point the same logic at doctored assets. */
const DIR = process.env.OPENCLINXR_SCALP_PROBE_DIR ?? join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

/** The four that already retired the shell — the known-good column (§9h). */
const KNOWN_GOOD = [
  "mpfb-peds-nurse-kevin",
  "mpfb-peds-patient-child",
  "mpfb-ob-patient-aisha",
  "mpfb-peds-parent-aisha",
];
/** Below the smallest shipped fitted-hair mesh (kevin, 3460 t) with room to spare. */
const MIN_HAIR_TRIS = 2000;

type Asset = { id: string; scalpTris: number; hairTris: number };

async function measure(): Promise<Asset[]> {
  if (!existsSync(DIR)) return [];
  const ids = readdirSync(DIR)
    .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb"))
    .map((f) => f.replace(/\.glb$/u, ""))
    .sort();
  const io = new NodeIO();
  const out: Asset[] = [];
  for (const id of ids) {
    const doc = await io.read(join(DIR, `${id}.glb`));
    let scalpTris = 0;
    let hairTris = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const name = prim.getMaterial()?.getName() ?? "";
        const tris = Math.round((prim.getIndices()?.getCount() ?? 0) / 3);
        if (/scalp/iu.test(name)) scalpTris += tris;
        else if (/fitted_hair/iu.test(name)) hairTris += tris;
      }
    }
    out.push({ id, scalpTris, hairTris });
  }
  return out;
}

const assets = await measure();

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireAssets(): Asset[] {
  expect(assets.length, `mpfb-*.glb enumerated under ${DIR}`).toBeGreaterThanOrEqual(6);
  return assets;
}

describe("a new MPFB bake does not reintroduce the placeholder scalp", () => {
  it.fails("(1) RED: no shipped MPFB humanoid carries a placeholder scalp surface", () => {
    const offenders = requireAssets().filter((a) => a.scalpTris > 0);
    expect(
      offenders.map((a) => `${a.id} (${a.scalpTris}t)`),
      `the retirement shipped for ${KNOWN_GOOD.length} actors under #387/#399/a997ae27; a new bake must not bring the shell back`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: every MPFB humanoid still carries a fitted hair mesh", () => {
    // Refuses (c). The cheapest way to remove a scalp shell is to remove all head covering.
    for (const a of requireAssets()) {
      expect(a.hairTris, `${a.id} fitted hair triangles`).toBeGreaterThanOrEqual(MIN_HAIR_TRIS);
    }
  });

  it("(3) COUNTERWEIGHT: the four already-retired actors stay retired and keep their hair", () => {
    // The known-good column. A fix must not reach green by regressing the assets that were already right.
    const byId = new Map(requireAssets().map((a) => [a.id, a]));
    for (const id of KNOWN_GOOD) {
      const a = byId.get(id);
      expect(a, `${id} present on disk`).toBeDefined();
      expect(a!.scalpTris, `${id} placeholder scalp triangles, measured 0 on 2026-08-14`).toBe(0);
      expect(a!.hairTris, `${id} fitted hair triangles`).toBeGreaterThanOrEqual(MIN_HAIR_TRIS);
    }
  });

  it("(4) VACUITY GUARD: the population contains both classes today", () => {
    const a = requireAssets();
    expect(a.filter((x) => x.scalpTris > 0).length, "assets carrying the shell today").toBeGreaterThan(0);
    expect(a.filter((x) => x.scalpTris === 0).length, "assets already retired today").toBeGreaterThan(0);
  });
});
