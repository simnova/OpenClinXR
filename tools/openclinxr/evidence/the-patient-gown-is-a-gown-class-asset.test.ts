import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: a garment mesh records the source asset it was fitted from, and the patient's upper
 * garment comes from a gown- or labcoat-class source.**
 *
 * ## MEASURED ON HEAD f335971c, 2026-08-23 — do not re-derive
 *
 * `mpfb-gown-adult-patient.glb`, mesh/material dump:
 *
 *     openclinxr_real_garment_peds_upper_v1_mesh   mat=…hospital_gown_phenotype_L0   5829 tris
 *     makeclothes_library_toigo_t_shirt_…          mat=mat_…toigo_t_shirt            2700 tris
 *     openclinxr_declared_upper_layers__hospital_gown_mesh                              1 tri
 *
 * **The shipped "hospital gown" is the peds UPPER shell wearing a material named `hospital_gown`.**
 * Relabelled geometry — the S2 resolver-swap that P1 is parked on, and the reason the Anny rail
 * cannot be retired: there is no gown to retire TO.
 *
 * ## WHY THE OBVIOUS ASSERTION CANNOT BE WRITTEN YET — measured, and it reorders this card
 *
 *     mpfb-gown-adult-patient.glb        asset keys: generator,version   asset.extras: NONE
 *     mpfb-clinical-physician-adult.glb  asset keys: generator,version   asset.extras: NONE
 *     mesh-level extras on garment meshes: none
 *     sidecars: *.provenance.json exists for every ANNY asset and for NO mpfb-* asset
 *
 * **Nothing anywhere records which `.mhclo` a garment was fitted from.** So "read the source asset,
 * not the material name" has no data to read, and the ONLY thing distinguishing a real gown from a
 * relabelled shell is the material string — precisely the field that lies. Provenance must be
 * emitted BEFORE the swap can be verified, which is why clause (1) comes first.
 *
 * ## THE BAKE ALREADY HOLDS THE PATH — this is a stamp, not plumbing (D1)
 *
 * `materialize_mpfb_humanoid_candidate.py` has the `.mhclo` in hand at fit time:
 * `read_hair_mhclo_licence(mhclo_path)` (:603), `mhmat_for_mhclo(mhclo_path)` (:408),
 * and `ClothesService.fit_clothes_to_human` reads that same file's vertex refs. The bake KNOWS the
 * source and discards it. Persist what it already has.
 *
 * ## THE STAND-IN IS CHOSEN AND IT IS CC0
 *
 * `makehuman-community-crude-labcoat-female` / `crudelabcoatopen.mhclo` — CC0 (header + page agree,
 * author Joel Palmius), already cached, max interpolation ref 13,351 < 13,380 so it fits the #318
 * helper-stripped basemesh, and ALREADY consumed by the physician bake. E1's inventory recorded
 * **zero gowns** in the cache; `crudegown.mhclo` is classed `evening_dress` and is the asset that
 * burned S0/S1/S2. Do not reach for it.
 *
 * claimScope: garment source provenance on the MPFB rail, and the patient's upper garment class.
 * notEvidenceFor: how the gown looks; fit quality; whether the Anny assets are retired.
 *
 * ## FIXED (#596)
 *
 * Provenance stamp (`stamp-garment-provenance.ts`) writes `sourceMhclo` / `garmentClass` /
 * `licence` onto every MakeClothes / real_garment mesh extra. Patient upper is now
 * `openclinxr_real_garment_labcoat_crudelabcoatopen_mesh` fitted from CC0
 * `crudelabcoatopen.mhclo` via ClothesService (bake_mpfb_gown_inspect.py); peds_upper shell
 * removed. Physician lab coat records the same source+CC0. hm08 role map routes
 * hospital_gown → lab coat (garment-selection-by-role.ts). Flipped it.fails → it.
 */

const GOWN = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
const PHYSICIAN = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
/** Classes E1 recorded in the licence ledger. `evening_dress` is deliberately absent. */
const GOWN_CLASSES = ["gown", "labcoat"] as const;

type GarmentProvenance = { sourceMhclo?: string; garmentClass?: string; licence?: string };

async function garmentProvenance(glb: string): Promise<Array<{ mesh: string; prov: GarmentProvenance }>> {
  const { NodeIO } = await import("@gltf-transform/core");
  const doc = await new NodeIO().read(glb);
  const out: Array<{ mesh: string; prov: GarmentProvenance }> = [];
  for (const m of doc.getRoot().listMeshes()) {
    const name = m.getName();
    if (!/real_garment|makeclothes_library/i.test(name)) continue;
    if (/eyes|hair|eyelash|eyebrow|teeth|tongue/i.test(name)) continue;
    out.push({ mesh: name, prov: (m.getExtras() ?? {}) as GarmentProvenance });
  }
  return out;
}

describe("the patient gown is a gown-class asset", () => {
  it("(1) RED: every garment mesh records the .mhclo it was fitted from", async () => {
    // Today: asset.extras is NONE and no mesh carries extras. Without this, clause (2) has nothing
    // to read and the material name is the only signal — which is the defect.
    const rows = await garmentProvenance(GOWN);
    expect(rows.length, "the gown patient must carry garment meshes").toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.prov.sourceMhclo, `${r.mesh} records no source .mhclo`).toBeTruthy();
      expect(r.prov.licence, `${r.mesh} records no licence`).toBeTruthy();
    }
  });

  it("(2) RED: the patient's upper garment derives from a gown- or labcoat-class source", async () => {
    // Refuses the shipped state: peds_upper_v1 relabelled `hospital_gown`.
    const rows = await garmentProvenance(GOWN);
    const upper = rows.filter((r) => /real_garment/i.test(r.mesh));
    expect(upper.length, "the patient must carry a real garment upper").toBeGreaterThan(0);
    const classes = upper.map((r) => r.prov.garmentClass ?? "unrecorded");
    expect(classes.some((c) => (GOWN_CLASSES as readonly string[]).includes(c)),
      `upper garment classes were ${JSON.stringify(classes)} — none is gown or labcoat`).toBe(true);
  });

  it("(3) COUNTERWEIGHT: a material NAMED hospital_gown does not satisfy clause (2)", async () => {
    // The exact cheat that shipped. The class must come from recorded PROVENANCE; a mesh whose only
    // gown evidence is its material string must still fail. Asserting the negative directly: no
    // upper garment may claim a gown class while its source .mhclo is the peds upper shell.
    const rows = await garmentProvenance(GOWN);
    for (const r of rows) {
      const src = r.prov.sourceMhclo ?? "";
      const cls = r.prov.garmentClass ?? "unrecorded";
      if ((GOWN_CLASSES as readonly string[]).includes(cls)) {
        expect(/peds_upper|toigo_t_shirt/i.test(src),
          `${r.mesh} claims class ${cls} but its source is ${src}`).toBe(false);
      }
    }
    // And at least one upper must actually carry a recorded class, or this clause is vacuous.
    expect(rows.some((r) => r.prov.garmentClass), "no garment records a class at all").toBe(true);
  });

  it("(4) KNOWN-GOOD COLUMN: the physician's lab coat records crudelabcoatopen and CC0", async () => {
    // The physician bake ALREADY fits this asset successfully — it is the proof the stand-in works
    // on this rail. Planted RED only because provenance does not exist yet; it must go green for
    // the right reason (the stamp), not because the assertion was loosened.
    const rows = await garmentProvenance(PHYSICIAN);
    const coat = rows.find((r) => /lab_coat/i.test(r.mesh));
    expect(coat, "the physician must still wear the lab coat").toBeTruthy();
    expect(coat!.prov.sourceMhclo ?? "", "the lab coat's source must be recorded").toMatch(/crudelabcoatopen/iu);
    expect((coat!.prov.licence ?? "").toUpperCase(), "the lab coat is CC0 and must record it").toContain("CC0");
  });
});
