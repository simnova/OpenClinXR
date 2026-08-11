import { dirname, resolve as pathResolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Operator steer 2026-08-11: *"try to find makeclothes related clothes rather than hand-coded."* One is
 * cached, unused, and it is what three of the four learner-facing roles wear.
 *
 * `garment-selection-by-role.ts:64-72` routes `casual_top` / `open_cardigan` / `hospital_gown` / `tshirt`
 * to `HM08_UPPER_COVER_SHELL_ID` — a procedural shell offset from the body surface — on the stated
 * grounds that *"the .mhclo library cannot provide"* them. The role map sends **family /
 * family_member / parent / spouse** to `["casual_top", "open_cardigan"]`, so every non-patient,
 * non-nurse actor gets hand-coded geometry.
 *
 * THE CLAIM IS FALSE FOR `casual_top`. Measured across the provider cache:
 *
 *   cached .mhclo                    | licence | basemesh | refs >= 13,380 | tags                  | W/H
 *   ---------------------------------|---------|----------|----------------|-----------------------|------
 *   Scrub_Shirt                      | CC-BY   | hm08     |       0        | profession, Medical   |  -
 *   **toigo_basic_tucked_t-shirt**   | **CC0** | hm08     |     **0**      | t-shirt, top, CASUAL  | 1.40
 *   elvs_crude_t-shirt_male          | CC0     | hm08     |       0        | -                     | 1.07
 *   namuhekam_male_polo_shirt        | CC0     | hm08     |   **3,648**    | male, casual          |  -
 *   cortu_cargo_pants                | CC0     | hm08     |       0        | -                     |  -
 *
 * `toigo_basic_tucked_t-shirt` is a CC0 casual top on hm08 topology with **zero helper-vertex
 * references** — so it fits the helper-stripped basemesh (#318) — shipping its own `.obj`, `.mhmat` and
 * textures, and it has never been consumed. Its width/height of 1.40 on an A-pose basemesh means
 * geometry extending laterally along the arms: **it has sleeves**, which the shell does not (#319).
 * `namuhekam_male_polo_shirt` is the one to avoid: 3,648 of its fitting refs are helper vertices.
 *
 * A SECOND DEFECT, found while measuring, and it is why clause (2) exists. `body-param-catalog.json`
 * records for the lean female:
 *
 *   garmentId    "openclinxr_hm08_upper_cover_shell"     garmentKind "cover_shell"
 *   licenseToken "CC-BY"
 *   licenseSource "mhclo_header:Scrub_Shirt.mhclo; license=CC-BY; author=WojackOWL; ..."
 *
 * **The licence record attributes WojackOWL's CC-BY Scrub Shirt to geometry generated from the body
 * surface.** The shell did not come from that garment. It is conservative (over-attribution, not
 * under-) so it is not a licence violation, but it is false provenance in a compliance surface, and a
 * compliance surface that names the wrong source cannot be audited. Routing to a real `.mhclo` makes the
 * record TRUE as well as removing the hand-coded geometry.
 *
 * KNOWN-GOOD COLUMN, real and non-vacuous: the heavy male already carries `garmentKind: "library"` with
 * `wojackowl_scrubs_shirt_hm08`, fitted through the same `ClothesService.fit_clothes_to_human` the
 * catalog records for both. **This wires a proven path to a second role (D1), not a new one.**
 *
 * WHY THIS RATHER THAN TUNING THE SHELL. Both open garment defects are shell defects and the known-good
 * in each is a fitted `.mhclo`: #320's waist gap was 14/22 angles on the shell versus 0/16 for the scrub
 * shirt on the same trousers, and #320's landing left the hem still ragged at 23.7 mm span. #319's
 * missing sleeve is the shell's. Replacing the mechanism beats tuning its rim.
 *
 * WHAT THE CACHE STILL CANNOT PROVIDE, so the shell must survive this slice: **`hospital_gown`** (no
 * gown in any cached pack — and it is what the PATIENT wears, the highest-value acquisition target) and
 * **`open_cardigan`** (an open-front garment is a different shape, #46). Clause (4) keeps the shell
 * mechanism intact for them.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | (5) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|-----|--------
 *   a) today                                           |FAIL |FAIL |pass |pass |pass | REFUSED
 *   b) rename the shell's garmentId to a library id    |pass |**FAIL**|pass|pass|pass| REFUSED
 *   c) delete the cover-shell mechanism outright       |pass |pass |pass |**FAIL**|pass| REFUSED
 *   d) fit the polo (3,648 helper refs)                |  -  |  -  |  -  |  -  |  -  | cannot bake
 *   e) fit a sleeved garment that re-wraps the hands   |pass |pass |pass |pass |**FAIL**| REFUSED
 *   f) fit toigo_basic_tucked_t-shirt via ClothesService|pass |pass |pass |pass |pass | ALL PASS
 *
 * (b) is the tempting one — the shell already wears a `makeclothes_library_*` mesh prefix, so relabelling
 * looks like a fix. Clause (2) requires the recorded licence SOURCE to name the same garment as
 * `garmentId`, which a relabelled shell cannot satisfy without also lying about provenance. (e) is the
 * #295 mitten regression: a real sleeved garment must still terminate at the wrist.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today on the lean female.
 * (3), (4) and (5) PASS today on real values and constrain the fix.
 *
 * NOT TESTED: nothing is rendered and no fit quality is asserted. The t-shirt has **never been fitted to
 * any body in this repo** — zero helper-refs plus an `hm08` basemesh declaration say `ClothesService`
 * should accept it, but that is inference from the file, not a bake. The W/H 1.40 sleeve reading is a
 * bounding-box proxy, not a sleeve-length measurement; how far down the arm it reaches is unknown until
 * it is fitted. The hem raggedness #320 left open (23.7 mm span) is not bounded here and a fitted garment
 * may or may not improve it. Whether a tucked t-shirt suits a parent or spouse in a clinical station is a
 * staging judgement (P3) and mine to grade.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CANDIDATES = `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates`;
const CATALOG = `${CANDIDATES}/body-param-catalog.json`;

type Entry = {
  bodyClassId?: string;
  garmentId?: string;
  garmentKind?: string;
  licenseToken?: string;
  licenseSource?: string;
};

const catalog = JSON.parse(readFileSync(CATALOG, "utf8")) as { entries?: Entry[] };
const entries = catalog.entries ?? [];

const GARMENT_MATERIAL = /makeclothes/i;
const HAND_JOINT = /hand|wrist|finger|thumb/i;

const io = new NodeIO();

/** Hand-dominant vertices owned by a garment material — #295's mitten measure. */
async function garmentHandVerts(id: string): Promise<number> {
  const doc = await io.read(`${CANDIDATES}/${id}.glb`);
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return -1;
  const handJoints = new Set(
    skin.listJoints().map((j, i) => ({ i, n: j.getName() })).filter((j) => HAND_JOINT.test(j.n)).map((j) => j.i),
  );
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!GARMENT_MATERIAL.test(prim.getMaterial()?.getName() ?? "")) continue;
      const joints = prim.getAttribute("JOINTS_0");
      const weights = prim.getAttribute("WEIGHTS_0");
      if (!joints || !weights) continue;
      const je: [number, number, number, number] = [0, 0, 0, 0];
      const we: [number, number, number, number] = [0, 0, 0, 0];
      for (let i = 0; i < joints.getCount(); i += 1) {
        joints.getElement(i, je);
        weights.getElement(i, we);
        let dominant = -1;
        let best = 0;
        for (let k = 0; k < 4; k += 1) if (we[k]! > best) { best = we[k]!; dominant = je[k]!; }
        if (dominant >= 0 && handJoints.has(dominant)) count += 1;
      }
    }
  }
  return count;
}

const handVerts = {
  female: await garmentHandVerts("body-param-adult_lean_female-library"),
  male: await garmentHandVerts("body-param-adult_heavy_male-library"),
};

/** An empty catalog must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(entries.length, "catalog entries").toBeGreaterThanOrEqual(2);
  for (const e of entries) expect(e.bodyClassId, "entry has a bodyClassId").toBeTruthy();
}

describe("the casual upper garment is a real MakeClothes garment, not a hand-coded shell", () => {
  it.fails("(1) RED: every shipped upper garment is a fitted library garment, not a cover shell", () => {
    requireMeasured();
    const shells = entries
      .filter((e) => e.garmentKind !== "library")
      .map((e) => `${e.bodyClassId}: garmentKind=${e.garmentKind} id=${e.garmentId}`);
    expect(shells, "bodies still wearing a procedural cover shell").toEqual([]);
  });

  it.fails("(2) RED: the recorded licence source names the garment actually used", () => {
    requireMeasured();
    const mismatched: string[] = [];
    for (const e of entries) {
      const id = e.garmentId ?? "";
      const source = e.licenseSource ?? "";
      // A library garment's licence must be read from ITS OWN .mhclo header, not another garment's.
      const stem = id.replace(/_hm08$/, "").replace(/^openclinxr_/, "").split("_")[0] ?? "";
      if (!stem || !source.toLowerCase().includes(stem.toLowerCase())) {
        mismatched.push(`${e.bodyClassId}: garmentId="${id}" but licenseSource="${source.slice(0, 60)}"`);
      }
    }
    expect(mismatched, "licence records naming a different garment than the one used").toEqual([]);
  });

  it("(3) NET known-good: the heavy-male rail keeps its fitted library scrub shirt", () => {
    requireMeasured();
    const male = entries.find((e) => e.bodyClassId === "adult_heavy_male");
    expect(male?.garmentKind, "heavy male garmentKind").toBe("library");
    expect(male?.garmentId, "heavy male garmentId").toBe("wojackowl_scrubs_shirt_hm08");
  });

  it("(4) COUNTERWEIGHT: the cover-shell mechanism survives — hospital_gown and open_cardigan still need it", () => {
    const source = readFileSync(
      `${REPO_ROOT}/tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts`,
      "utf8",
    );
    expect(source, "HM08_UPPER_COVER_SHELL_ID must still exist").toContain("HM08_UPPER_COVER_SHELL_ID");
    for (const layer of ["hospital_gown", "open_cardigan"]) {
      expect(source, `${layer} must still be routable`).toContain(layer);
    }
  });

  it("(5) COUNTERWEIGHT: no garment owns a hand-dominant vertex — the #295 mitten regression is refused", () => {
    expect(handVerts.female, "lean female garment-owned hand vertices").toBe(0);
    expect(handVerts.male, "heavy male garment-owned hand vertices").toBe(0);
  });
});
