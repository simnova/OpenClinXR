import { describe, expect, it } from "vitest";
import {
  HM08_UPPER_COVER_SHELL_ID,
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
 *
 * ## WITHDRAWN (#413) — the staged "gown" is an evening dress, not a hospital gown
 *
 * Every assertion above is WITHDRAWN. The asset's own header reads `name CrudeGown`,
 * `# author Joel Palmius`, and "gown" in the MakeHuman wardrobe vocabulary means a FORMAL
 * DRESS. The S2 bake (`436ea17f`) pixel grade showed a floor-length cyan spaghetti-strap
 * evening dress: ankle-length, fitted bodice, scooped neckline, two thin straps, no back
 * opening, no ties. The rooms lane's research line — `Patient hospital gown, hm08,
 * CC0/CC-BY — NOT FOUND` — was never falsified: the S0/S1/S2 checks covered licence,
 * index range, presence and placement, none of which is garment CLASS.
 *
 * `hospital_gown` therefore maps back to the deterministic body-derived cover shell (the
 * honest pre-S1 state). This file now asserts the WITHDRAWAL — restored on the land path
 * as a test modification, not a deletion, so the history stays visible:
 *
 *   - `garmentIdForLayers(["hospital_gown"])` is NOT `"crudegown_hm08"`
 *   - `resolveHm08UpperGarment("patient").kind === "cover_shell"`
 *
 * The S1 plant's known-good rows (nurse scrub, family/parent/spouse toigo t-shirt, unknown
 * fallback, open_cardigan shell) live in `hospital-gown-is-not-an-evening-dress.test.ts`
 * clause (3) and are not duplicated here.
 */

const GOWN_LAYERS = ["hospital_gown", "patient_gown", "ed_gown", "gown"] as const;

describe("the gown layers do not route to the withdrawn crude gown", () => {
  it("(1) WITHDRAWN: no gown layer resolves to crudegown_hm08", () => {
    for (const layer of GOWN_LAYERS) {
      expect(garmentIdForLayers([layer]), `layer ${layer}`).not.toBe("crudegown_hm08");
    }
  });

  it("(2) WITHDRAWN: the patient upper garment is the deterministic cover shell", () => {
    const spec = resolveHm08UpperGarment("patient");
    expect(spec.garmentId).toBe(HM08_UPPER_COVER_SHELL_ID);
    expect(spec.kind).toBe("cover_shell");
  });
});
