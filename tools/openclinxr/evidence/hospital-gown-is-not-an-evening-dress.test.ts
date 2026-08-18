import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HM08_TOIGO_T_SHIRT_ID,
  HM08_UPPER_COVER_SHELL_ID,
  HM08_UPPER_GARMENT_FALLBACK_ID,
  garmentIdForLayers,
  resolveHm08UpperGarment,
} from "../asset-pipeline/makeclothes/garment-selection-by-role.js";

/**
 * S3, 2026-08-18 — WITHDRAW `crudegown` AS THE HOSPITAL GOWN. It is an evening dress.
 *
 * ## WHAT HAPPENED, MEASURED
 *
 * S0 (`bf64ff70`) measured `crudegown.mhclo`'s index range: 13,351 < the 13,380 helper-strip
 * boundary. TRUE, and still true — that slice is not withdrawn.
 * S1 (`364a5b6d`) mapped the four gown layers to `crudegown_hm08`. Green.
 * S2 (`436ea17f`) baked `mpfb-inpatient-adult-male.glb` with it. Six clauses green, including a
 * PLACEMENT clause (§11s) requiring the garment to straddle body mid-height.
 *
 * Then the orchestrator graded the pixels: a **floor-length cyan spaghetti-strap evening dress**.
 * Ankle-length, fitted bodice, scooped neckline, two thin straps, no back opening, no ties.
 *
 * **The asset's own header says so and nobody read it as a class:**
 *
 *     # author Joel Palmius   # license CC0   name CrudeGown
 *
 * "Gown" in the MakeHuman wardrobe vocabulary means a FORMAL DRESS. The rooms lane's own research
 * doc still says `Patient hospital gown, hm08, CC0/CC-BY — NOT FOUND`, and that line was never
 * falsified. Licence was checked. Vertex indices were checked. Nobody checked what the garment IS.
 *
 * ## WHY EVERY GREEN CLAUSE WAS HONEST
 *
 *   slice | asserted                          | true? | can it see "hospital"?
 *   ------|-----------------------------------|-------|-----------------------
 *   S0    | max vertex ref < 13,380           |  yes  | no
 *   S1    | resolver id + kind = library      |  yes  | no
 *   S2    | presence, PLACEMENT, provenance   |  yes  | no
 *
 * A floor-length dress straddles body mid-height perfectly, so even the §11s placement fix passes.
 * Presence, placement and provenance are three different questions and none of them is CLASS.
 *
 * ## WHY THIS IS URGENT AND NOT COSMETIC
 *
 * S1 left a landmine: `hospital_gown` resolves to `crudegown_hm08` for EVERY `--actor-role patient`
 * bake. The next rebake of `mpfb-ob-patient-aisha` — a SHIPPED actor — would silently dress her in
 * the evening dress. This contract removes that before it fires.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                              | (1) | (2) | (3) | (4) | (5) | result
 *   -------------------------------------------------------|-----|-----|-----|-----|-----|--------
 *   a) today — gown maps to crudegown, GLB on disk         |FAIL |FAIL | pass|FAIL |FAIL | REFUSED
 *   b) point hospital_gown at the toigo t-shirt instead    |pass |FAIL | pass|FAIL |FAIL | REFUSED
 *   c) unmap the resolver but keep the GLB "as a candidate"|pass |pass | pass|FAIL |pass | REFUSED
 *   d) edit crudegown geometry to "look like" a gown       |FAIL |FAIL | pass|FAIL |FAIL | REFUSED
 *   e) unmap, revert the materializer, delete the artifacts|pass |pass | pass|pass |pass | ALL PASS
 *
 * **(b)** is refused because a tucked t-shirt is not a hospital gown either — clause (2) requires the
 * honest answer, which is the deterministic cover shell that stood here before S1.
 * **(c)** is the tempting one: leaving 20 MB of unreferenced evening dress in `generated-humanoids/`
 * where any future glob, census or cagematch picks it up as a patient candidate. Clause (4) deletes it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1), (2), (4), (5) are the REDs** — today the map, the
 * materializer and the baked GLB all still exist. **(3) passes today** and refuses collateral damage
 * to the roles S1 correctly left alone.
 *
 * NOT TESTED:
 *   - That the cover shell LOOKS like a hospital gown. It does not; it is a deterministic body-derived
 *     shell. Restoring it returns the rail to its pre-S1 honesty, not to a solved gown.
 *   - S0's measurement. 13,351 < 13,380 is still true of that file and is NOT withdrawn.
 *   - Whether any hospital gown exists anywhere. Still NOT FOUND; a class inventory of cached
 *     `.mhclo` is the next slice, not this one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GEN = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const MATERIALIZER = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");
const GOWN_LAYERS = ["hospital_gown", "patient_gown", "ed_gown", "gown"] as const;

describe("the hospital gown layers do not resolve to an evening dress", () => {
  it("(1) RED: no gown layer resolves to crudegown", () => {
    for (const layer of GOWN_LAYERS) {
      expect(garmentIdForLayers([layer]), `layer ${layer} must not name the evening dress`).not.toBe(
        "crudegown_hm08",
      );
    }
  });

  it("(2) RED: the patient falls back to the deterministic cover shell, not another wrong garment", () => {
    // Refuses (b). A tucked t-shirt is not a hospital gown either. The honest answer while no gown
    // exists is the body-derived shell that stood here before S1.
    const spec = resolveHm08UpperGarment("patient");
    expect(spec.garmentId).toBe(HM08_UPPER_COVER_SHELL_ID);
    expect(spec.kind).toBe("cover_shell");
  });

  it("(3) NET known-good: the roles S1 left alone are still correct", () => {
    expect(resolveHm08UpperGarment("nurse").garmentId).toBe(HM08_UPPER_GARMENT_FALLBACK_ID);
    for (const r of ["family", "parent", "spouse"]) {
      expect(resolveHm08UpperGarment(r).garmentId, `role ${r}`).toBe(HM08_TOIGO_T_SHIRT_ID);
    }
    expect(resolveHm08UpperGarment("no_such_role_xyz").garmentId).toBe(HM08_UPPER_GARMENT_FALLBACK_ID);
    expect(garmentIdForLayers(["open_cardigan"])).toBe(HM08_UPPER_COVER_SHELL_ID);
  });

  it("(4) RED: the baked evening-dress body is gone from generated-humanoids", () => {
    // Refuses (c). 20 MB of unreferenced dress in the humanoid directory is picked up by any future
    // glob, census or cagematch as a patient candidate. The pool inventory globs that directory.
    for (const f of [
      "mpfb-inpatient-adult-male.glb",
      "mpfb-inpatient-adult-male.skin-baked.png",
      "mpfb-inpatient-adult-male.skin-normal.png",
    ]) {
      expect(existsSync(join(GEN, f)), `${f} must be deleted, not parked as a candidate`).toBe(false);
    }
  });

  it("(5) RED: the materializer patient branch no longer selects crudegown.mhclo", () => {
    expect(
      /crudegown\.mhclo/i.test(readFileSync(MATERIALIZER, "utf8")),
      "the patient upper branch must be back on the toigo path",
    ).toBe(false);
  });
});
