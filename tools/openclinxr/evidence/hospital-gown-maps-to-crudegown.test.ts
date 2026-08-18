import { readFileSync } from "node:fs";
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
 * S1 of the superagent plan, 2026-08-18 — CONSUME THE STAGED GOWN.
 *
 * S0 landed (`bf64ff70`) and measured the gate: `crudegown.mhclo` references a maximum body-vertex
 * index of **13,351** against the 13,380 helper-strip boundary, so it is index-compatible with the
 * stripped basemesh. Known-good column `toigo_basic_tucked_t-shirt.mhclo` measures 11,017. The
 * margin is 29 indices — thin, and recorded as a fact rather than a concern.
 *
 * TODAY the four gown layers route to the deterministic body-derived cover shell
 * (`garment-selection-by-role.ts:121-124`), because when that map was written no gown existed in any
 * cached pack — the file says so in its own comment at `:126-128`. One now does, staged CC0 by the
 * rooms lane before it closed:
 *
 *   .openclinxr-local/provider-cache/garments/sources/makehuman-community-crude-gown/crudegown.mhclo
 *   `# author Joel Palmius` / `# license CC0`
 *
 * ## WHY THIS MATTERS BEYOND ONE GARMENT
 *
 * `.openclinxr/probe/mpfb-midriff/anny-patient-pool.json`: 14 scenarios, 39 actor slots, **11
 * distinct meshes**. SEVEN patients share `ed_chest_pain_adult_cast.glb`. The gown is the gate on
 * the largest measured identity gap in the bank. This slice changes the RAIL, not the seven-on-one
 * count — no bake, no resolver-to-actor mapping, no `actor-casting.ts`.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                  | (1-2) | (3-5) known-good | (6) | (7) | result
 *   -----------------------------------------------------------|-------|------------------|-----|-----|--------
 *   a) today — gown layers on the cover shell                  | FAIL  |       pass       |pass |FAIL | REFUSED
 *   b) point the gown layers at the toigo t-shirt              | FAIL  |       pass       |pass |FAIL | REFUSED
 *   c) rename the cover shell "crudegown" and change nothing   | pass  |       pass       |FAIL |FAIL | REFUSED
 *   d) drop the scrub fallback so everything reads "library"   | pass  |     **FAIL**     |pass |pass | REFUSED
 *   e) register crudegown_hm08 and remap the four gown layers  | pass  |       pass       |pass |pass | ALL PASS
 *
 * **(b) MEASURED 2026-08-18, and the first version of this table was WRONG.** I predicted routing the
 * gown to the already-consumed t-shirt would green clauses (1) and (2) because `kind` becomes
 * "library". It does not: I ran that exact remap and (1), (2) AND (7) all still failed, because (1)
 * and (2) assert the EXACT id rather than the kind. Corrected above rather than left as written.
 * Clause (7) is still load-bearing — it is what refuses a RELABEL, treatment (c), where the id is
 * right and the backing asset is not.
 *
 * **(d)** is the other: deleting `HM08_UPPER_GARMENT_FALLBACK_ID` would make everything resolve
 * "library" trivially. #275 says the default must become the fallback, not disappear, and clause (5)
 * pins it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1), (2) and (7) are the REDs** — no `crudegown_hm08`
 * is registered and the gown layers still name the shell. **(3), (4), (5) and (6) pass today** and
 * exist to stop the reds being satisfied by demolition.
 *
 * NOT TESTED:
 *   - That the gown FITS. S0 proved index range only; poke-through, coverage and drape are S2/S3.
 *   - Any bake. No GLB changes in this slice and none is asserted.
 *   - Which ACTOR wears it. `actor-casting.ts` is untouched; Hayes is S4.
 *   - The missing `CrudeGown.png`. A texture gap is not a mapping gap.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const SELECTOR_SRC = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts");
const MATERIALIZER_SRC = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

const CRUDEGOWN_ID = "crudegown_hm08";
const GOWN_LAYERS = ["hospital_gown", "patient_gown", "ed_gown", "gown"] as const;

describe("the staged CC0 crude gown is the patient upper garment", () => {
  it("(1) RED: the patient role resolves to a fitted library gown, not the cover shell", () => {
    const spec = resolveHm08UpperGarment("patient");
    expect(spec.garmentId, `patient garmentId (today: ${spec.garmentId})`).toBe(CRUDEGOWN_ID);
    expect(spec.kind, "a staged .mhclo is a library fit, not a body-derived shell").toBe("library");
  });

  it("(2) RED: every gown layer routes to the same registered gown id", () => {
    for (const layer of GOWN_LAYERS) {
      expect(garmentIdForLayers([layer]), `layer ${layer}`).toBe(CRUDEGOWN_ID);
    }
  });

  it("(3) NET known-good: the nurse still wears the WojackOWL scrub shirt", () => {
    const spec = resolveHm08UpperGarment("nurse");
    expect(spec.garmentId).toBe(HM08_UPPER_GARMENT_FALLBACK_ID);
    expect(spec.kind).toBe("library");
  });

  it("(4) NET known-good: the family roles still wear the CC0 toigo t-shirt", () => {
    for (const role of ["family", "parent", "spouse"]) {
      expect(resolveHm08UpperGarment(role).garmentId, `role ${role}`).toBe(HM08_TOIGO_T_SHIRT_ID);
    }
  });

  it("(5) COUNTERWEIGHT: an unknown role still falls back to the scrub shirt — the default is not deleted", () => {
    // Refuses (d). #275: make the default the FALLBACK, do not remove it. Deleting it would make
    // every role resolve "library" and green clauses (1) and (2) by demolition.
    const spec = resolveHm08UpperGarment("no_such_role_xyz");
    expect(spec.garmentId, "unknown role fallback").toBe(HM08_UPPER_GARMENT_FALLBACK_ID);
    expect(spec.kind).toBe("library");
  });

  it("(6) COUNTERWEIGHT: open_cardigan still uses the cover shell — no open-front garment is staged", () => {
    // Refuses (c). The shell must survive for the layer that genuinely has no library asset;
    // renaming the shell to satisfy the gown clauses would break this one.
    expect(garmentIdForLayers(["open_cardigan"])).toBe(HM08_UPPER_COVER_SHELL_ID);
  });

  it("(7) COUNTERWEIGHT: the gown id is backed by crudegown, not by the toigo asset", () => {
    // Refuses (b) and (c). The resolver alone cannot tell a real remap from a relabel, so this reads
    // the two source files: the registered mesh prefix must be its own, and the materializer's
    // patient upper branch must name the staged .mhclo.
    const selector = readFileSync(SELECTOR_SRC, "utf8");
    const materializer = readFileSync(MATERIALIZER_SRC, "utf8");
    expect(selector, "the gown id must be registered in the selector").toContain(CRUDEGOWN_ID);
    expect(
      /crudegown/i.test(selector),
      "the registered gown must carry its own crudegown mesh prefix, not the toigo prefix",
    ).toBe(true);
    expect(
      /crudegown\.mhclo/i.test(materializer),
      "the materializer patient upper branch must select crudegown.mhclo",
    ).toBe(true);
  });
});
