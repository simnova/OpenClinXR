import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * S2 of the superagent plan, 2026-08-18 — BAKE ONE MPFB INPATIENT WEARING THE STAGED GOWN.
 *
 * S0 (`bf64ff70`) measured the gate: `crudegown.mhclo` max body-vertex ref **13,351** against the
 * 13,380 helper-strip boundary — index-compatible, margin 29.
 * S1 (`364a5b6d`) wired the resolver: `hospital_gown` → `crudegown_hm08`, `kind: library`,
 * mesh prefix `makeclothes_library_crudegown`, and the materializer patient branch names the mhclo.
 *
 * Neither produced a body. This slice does, at a NEW path, and it is the first time a fitted gown
 * reaches a mesh on this rail.
 *
 * ## WHY A NEW PATH AND NOT A REBAKE
 *
 * `.openclinxr/probe/mpfb-midriff/anny-patient-pool.json`: SEVEN of fourteen patients share
 * `ed_chest_pain_adult_cast.glb`. The target is one NEW inpatient body, not a rewrite of a shipped
 * actor — clauses (5) and (6) freeze the two MPFB adults this lane baked last night so a "bake over
 * aisha" can never satisfy this contract.
 *
 * ## THE REFERENCE FLAG IS LOAD-BEARING
 *
 * `derive_macro_dict` hardcodes `gender: 0.5`, so `--reference` cannot emit a male macro and NO sex
 * knob is invented here. What `--reference ed_chest_pain_adult_cast` DOES buy is stature and age
 * solved from Hayes's own tracked `.anny_base.obj` rather than the default-macro Aisha body.
 * OMITTING the flag is the forbidden path: it produces the Aisha default body in a gown and calls it
 * an inpatient. Clause (1) is the guard — a body solved from a different reference cannot be
 * byte-identical to the Anny cast it was solved from.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                              | (1) | (2) | (3) | (4) | (5-6) | result
 *   -------------------------------------------------------|-----|-----|-----|-----|-------|--------
 *   a) today — no such GLB                                 |FAIL |FAIL |FAIL |FAIL | pass  | REFUSED
 *   b) copy ed_chest_pain_adult_cast.glb to the new path   |FAIL |pass |FAIL |FAIL | pass  | REFUSED
 *   c) rename the toigo prim "gown" on an existing bake    |pass |pass |pass |FAIL | pass  | REFUSED
 *   d) paint a gown region instead of fitting one          |pass |FAIL |FAIL |FAIL | pass  | REFUSED
 *   e) bake the gown OVER aisha at her own path            |pass |pass |pass |pass |**FAIL**| REFUSED
 *   f) bake a new body with the fitted crudegown           |pass |pass |pass |pass | pass  | ALL PASS
 *
 * **(c) is the one to watch.** A rename makes the name and the vertex count right while the mesh is
 * still a t-shirt. Clause (4) separates them by reading the inspect JSON's recorded SOURCE basename,
 * which the bake writes from the mhclo it actually consumed.
 *
 * **(b) MEASURED 2026-08-18 — the first version of this table said clause (2) would FAIL and it does
 * NOT.** I copied `ed_chest_pain_adult_cast.glb` to the new path and ran it: (1), (3) and (4) failed,
 * (2) PASSED. The Anny cast is the "male base + hospital_gown" asset, so it already carries
 * gown-named geometry. Corrected above rather than left as predicted. The consequence is worth
 * stating plainly: **clause (2) alone cannot tell a fitted crudegown from the Anny cast's existing
 * painted gown region.** (1), (3) and (4) carry that weight — a name match is not an asset check.
 *
 * **(3) bounds PLACEMENT, not presence** (§11s). A gown primitive with vertices proves geometry
 * exists; it does not prove the geometry is on the torso. The band is derived from the body's own
 * mid-height, never an authored coordinate.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1)–(4) are the REDs** — the GLB does not exist.
 * **(5) and (6) pass today** and exist to refuse treatment (e).
 *
 * NOT TESTED:
 *   - That it LOOKS like a gown. The orchestrator grades pixels after land; no clause asserts it.
 *   - Sex. `gender: 0.5` is unchanged and this body is not claimed to be male-shaped.
 *   - Hair. No `HAIR_STYLE_BY_REFERENCE` row is added, so a scalp placeholder is expected.
 *   - Which actor loads it. `actor-casting.ts` is untouched; Hayes is S4.
 *   - Fit quality, poke-through, coverage, drape, the missing `CrudeGown.png`.
 *
 * ## WITHDRAWN (#413) — the bake it demanded was an evening dress, and it is deleted
 *
 * The GLB this contract demanded is WITHDRAWN and deleted from the tree. The fitted "gown"
 * was `CrudeGown` — `# author Joel Palmius`, CC0 — and in the MakeHuman wardrobe vocabulary
 * a "gown" is a FORMAL DRESS. The pixel grade of the S2 bake showed a floor-length cyan
 * spaghetti-strap evening dress: ankle-length, fitted bodice, scooped neckline, two thin
 * straps, no back opening, no ties. This contract's own NOT TESTED line — "That it LOOKS
 * like a gown" — is exactly where it failed: presence, placement and provenance cannot
 * see garment CLASS.
 *
 * This file now guards against the bake RETURNING — restored on the land path as a test
 * modification, not a deletion, so the history stays visible:
 *
 *   - `apps/ui-xr/public/generated-humanoids/mpfb-inpatient-adult-male.glb` does NOT exist
 *   - no value in the layer->garment map is `"crudegown_hm08"`
 *
 * The known-good rows this contract once froze (the shipped aisha / peds-parent GLBs) are
 * untouched by the withdrawal and covered by the surviving runtime contracts; the resolver
 * known-goods live in `hospital-gown-is-not-an-evening-dress.test.ts` clause (3).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GEN = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const NEW_GLB = join(GEN, "mpfb-inpatient-adult-male.glb");
const SELECTOR_SRC = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts",
);

describe("the evening-dress bake does not return", () => {
  it("(1) WITHDRAWN: the baked evening-dress body does not exist", () => {
    expect(
      existsSync(NEW_GLB),
      `${NEW_GLB} must stay deleted — a rebake that selects crudegown again would recreate the evening dress as a patient body`,
    ).toBe(false);
  });

  it("(2) WITHDRAWN: no layer->garment map value is crudegown_hm08", () => {
    // HM08_GARMENT_BY_LAYER is module-private in garment-selection-by-role.ts, so the
    // registered id's absence from the source is read directly (the same two-source read
    // the #411 plant's clause (7) used). If the id is absent from the file it cannot be
    // a map value.
    const selector = readFileSync(SELECTOR_SRC, "utf8");
    expect(
      selector,
      "crudegown_hm08 must not appear anywhere in the selector source",
    ).not.toContain("crudegown_hm08");
  });
});
