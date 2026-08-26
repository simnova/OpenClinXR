import { existsSync, readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { resolveHumanoidVariantOrCastPath } from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";

/**
 * OBSERVABLE: an actor whose case describes a height renders a body that height.
 *
 * MEASURED 2026-08-25, do not re-derive. Body mesh isolated from garments and hair — the whole-file
 * Y extent is padded by hair (Kevin: 177.0 whole-file vs 176.0 body) and is NOT the instrument.
 *
 *   actor                     declared  body    err     body mesh
 *   nurse_kevin_lee_v1          176     176.0    0.0    mpfb_peds_nurse_kevin_body
 *   parent_tara_johnson_v1      166     165.3   -0.7    mpfb_ob_patient_aisha_body
 *   patient_maya_johnson_v1     125     124.1   -0.9    mpfb_peds_patient_child_body
 *   patient_robert_hayes_v1     178     166.6  -11.4    mpfb_ob_patient_aisha_body
 *
 * THE BAND IS DERIVED FROM AMBIENT VARIATION, NOT FITTED TO THE DEFECT. Three actors agree within
 * 0.9 cm. The threshold below references that ambient spread; the defect is 11.4 cm, which is 12.7x
 * the worst ambient error. The epsilon does not contain the measured quantity, so a treatment that
 * moves the mesh cannot green it by construction.
 *
 * IT IS ONE BAD MAPPING, NOT ONE BAD ASSET. parent_tara_johnson_v1 renders the SAME body mesh —
 * mpfb_ob_patient_aisha_body — and FITS it at -0.7 cm because she declares 166. The asset is correct
 * for a 166 cm human. patient_robert_hayes_v1 declares 178 and is cast onto it anyway.
 *
 * WHY NO EXISTING GATE SEES THIS:
 *   - byte hash: all 18 shipped GLBs are distinct, so a file hash reports 18 distinct humans
 *   - vertex hash: mpfb-gown-adult-patient and mpfb-ob-patient-aisha DIFFER (963c75f0 vs 2e07050a)
 *     while agreeing on stature to 0.1 cm and on vertex count to 7 in ~11,100. A hash says
 *     "distinct"; a measurement says "same person"
 *   - mesh name: names track the SOURCE MANIFEST, not the actor. mpfb-clinical-nurse-adult carries
 *     mpfb_ed_chest_pain_nurse_adult_body. A name check proves nothing about who a body is
 *   - triangle count: both bodies are 26,756 triangles
 *   Only measuring the body sees it.
 *
 * FAILED TREATMENT, refused by clause (2): editing height_cm: 178 down toward 167 in
 * ed-chest-pain.ts. That satisfies any pure height-agreement assertion arithmetically. Clause (2)
 * pins the declared value, so the mesh must move rather than the case definition.
 *
 * FAILED TREATMENT, refused by construction: renaming the mesh. No clause reads a mesh name for its
 * assertion — names are used only to FIND the body primitive, and the assertion is on its extent.
 *
 * KNOWN-GOOD COLUMN: clause (3). The three actors already within band must stay within band, so a
 * fix that rescales every body, or that swaps the shared asset without regard to who else uses it,
 * fails. parent_tara_johnson_v1 shares the offending mesh and must survive.
 *
 * COVERAGE, recorded not asserted: 4 of 42 bank actors carry a phenotype block at all, and of the
 * 7 actors resolving mpfb-gown-adult-patient.glb exactly ONE declares a height. The other six adult
 * patients in the bank describe no body, so this contract can only see the one case that does.
 *
 * claimScope: whether a resolved body mesh's stature matches the height its case declares.
 * notEvidenceFor: bmi, age, brow_tension or any other phenotype dimension; whether the body looks
 *   like the described person in any respect other than height; the 38 actors with no phenotype.
 */

const PUBLIC_ROOT = "apps/ui-xr/public";

/** Ambient agreement among the three in-band actors is <=0.9 cm. This is 2.2x that spread. */
const HEIGHT_BAND_CM = 2.0;

/** Body primitives are the large ones; garment and hair primitives are far smaller. */
const BODY_MIN_VERTS = 4000; // was 5000; #695 decimation shrank the physician body to 4,807 verts — see FIXED below

type Row = { actorId: string; declaredCm: number; bodyCm: number | null; asset: string };

const io = new NodeIO();

async function measureAuthoredActors(): Promise<Row[]> {
  const rows: Row[] = [];
  const bank = scenarioBank as unknown as {
    scenarioId: string;
    actors?: { actorId: string; role: string; phenotype?: { height_cm?: number } }[];
  }[];
  for (const s of bank) {
    const roster = (s.actors ?? []).map((a) => ({ actorId: a.actorId, role: a.role }));
    for (const a of s.actors ?? []) {
      const declaredCm = a.phenotype?.height_cm;
      if (typeof declaredCm !== "number") continue;
      const path = resolveHumanoidVariantOrCastPath({
        scenarioId: s.scenarioId, actorId: a.actorId, role: a.role,
        fallbackPath: "/generated-humanoids/__FALLBACK__.glb", siblings: roster,
      });
      const disk = `${PUBLIC_ROOT}${path.startsWith("/") ? path : `/${path}`}`;
      let bodyCm: number | null = null;
      if (existsSync(disk)) {
        const doc = await io.readBinary(readFileSync(disk));
        for (const mesh of doc.getRoot().listMeshes()) {
          if (!/_body$/u.test(mesh.getName() ?? "")) continue;
          for (const prim of mesh.listPrimitives()) {
            const pos = prim.getAttribute("POSITION");
            if (!pos || pos.getCount() < BODY_MIN_VERTS) continue;
            const q = pos.getArray() as ArrayLike<number>;
            let lo = Infinity; let hi = -Infinity;
            for (let i = 1; i < q.length; i += 3) {
              if (q[i]! < lo) lo = q[i]!;
              if (q[i]! > hi) hi = q[i]!;
            }
            const cm = Math.round((hi - lo) * 1000) / 10;
            if (bodyCm === null || cm > bodyCm) bodyCm = cm;
          }
        }
      }
      rows.push({ actorId: a.actorId, declaredCm, bodyCm, asset: path.split("/").pop() ?? path });
    }
  }
  return rows;
}

describe("a described patient gets a body that height", () => {
  it("(1) every actor whose case declares a height renders a body that height", async () => {
    const rows = await measureAuthoredActors();
    expect(rows.length, "the authored population must not vanish out from under this contract")
      .toBeGreaterThan(3);
    const outOfBand = rows
      .filter((r) => r.bodyCm === null || Math.abs(r.bodyCm - r.declaredCm) > HEIGHT_BAND_CM)
      .map((r) => `${r.actorId}: declared ${r.declaredCm} cm, body ${r.bodyCm} cm (${r.asset})`);
    expect(
      outOfBand,
      "a case that describes a human's height must produce a body that height; the ambient agreement "
        + "among the other authored actors is within 0.9 cm",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the declared height is the case's, and the mesh must move to meet it", async () => {
    // Refuses editing height_cm down to match the short body. The case definition describes a
    // 178 cm man; that is the requirement, not the variable.
    const rows = await measureAuthoredActors();
    const robert = rows.find((r) => r.actorId === "patient_robert_hayes_v1");
    expect(robert, "patient_robert_hayes_v1 must remain an authored actor").toBeDefined();
    expect(
      robert!.declaredCm,
      "ed-chest-pain.ts declares a 178 cm patient; lowering it to match a short body is the cheap "
        + "cheat this clause exists to refuse",
    ).toBe(178);
  });

  it("(3) KNOWN-GOOD: the three already-agreeing actors stay in band", async () => {
    // Refuses a global rescale, and refuses swapping the shared asset without regard to its other
    // users: parent_tara_johnson_v1 renders the SAME mesh as Robert and fits it at -0.7 cm.
    const rows = await measureAuthoredActors();
    const known = ["nurse_kevin_lee_v1", "parent_tara_johnson_v1", "patient_maya_johnson_v1"];
    const drifted = rows
      .filter((r) => known.includes(r.actorId))
      .filter((r) => r.bodyCm === null || Math.abs(r.bodyCm - r.declaredCm) > HEIGHT_BAND_CM)
      .map((r) => `${r.actorId}: declared ${r.declaredCm}, body ${r.bodyCm}`);
    expect(drifted, "these three agree today and must still agree after the fix").toEqual([]);
  });
});

/*
 * ## FIXED (#651)
 *
 * Clause (1) flipped from `it.fails` to `it` on 2026-08-25. Measured after the
 * fix (same instrument, same band):
 *
 *   actor                     declared  body    err     body mesh
 *   nurse_kevin_lee_v1          176     176.0    0.0    mpfb_peds_nurse_kevin_body
 *   parent_tara_johnson_v1      166     165.3   -0.7    mpfb_ob_patient_aisha_body
 *   patient_maya_johnson_v1     125     124.1   -0.9    mpfb_peds_patient_child_body
 *   patient_robert_hayes_v1     178     177.6   -0.4    mpfb_ob_patient_aisha_body (rebaked, male)
 *
 * THE FIX IS A REBAKE DRIVEN BY ROBERT'S OWN PHENOTYPE, not an asset swap and not a
 * rescale. The #576 case-driven numeric-identity bake path in materialize_mpfb_humanoid_candidate.py
 * (--eye-colour-reference manifest -> phenotype_numeric_block -> body_param_stage.derive_macro_dict_from_authored_phenotype
 * -> solve_height_macro against height_cm) already existed on main but had never been run for this actor.
 *
 *   MACRO_BASE   {"gender": 1.0, "age": 0.7532, "muscle": 0.5, "weight": 0.5929, ...}
 *                (adult_male / age 52 / bmi 26.0, straight from ed-chest-pain.ts:126-141 via the
 *                staged robert_reference anny manifest — the same schema generate_mesh.py writes)
 *   MACRO_SOLVED height=0.5627 target_stature=1.7800 (bake-measure-interpolate, tol 5 mm; no closed-form scale)
 *
 * The shipped body went 166.6 cm -> 177.6 cm (-0.4 cm vs declared, inside the 0.9 cm ambient
 * spread), and the body is now MALE (gender macro 1.0 vs the previous androgynous 0.5 default).
 * The defect was never the mapping table in humanoid-runtime-asset-url.ts — Robert's ED_RUNTIME_CAST_BY_ACTOR
 * row is correct; the ASSET it names carried the wrong person. All seven actors resolving
 * mpfb-gown-adult-patient.glb keep that asset id; the six undeclared adults are unchanged relative
 * to casting (they now share a taller gowned adult instead of Tara's body).
 *
 * UNLOCKED DECISIONS TAKEN:
 *   1. Drive the existing bake from Robert's phenotype (option 3). Re-mapping him onto the 176 cm
 *      street/kevin bodies would land exactly ON the 2.0 cm contract edge (176.0 measured) with zero
 *      margin, would put him in street clothes/cargo trousers under a hospital gown station, and the
 *      nurse body is female. No shipped adult stands at 178.
 *   2. The other six actors resolving the gown asset declare no height, so clause (1) cannot see them;
 *      they ride along with the rebaked asset (same wardrobe, hide masks, hair, eyes as before).
 *
 * Materializer changes (tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py):
 *   - _anny_manifest_for(): shared manifest locator — shipped generated-humanoids first, then the
 *     issue's staged evidence reference (same input_params schema).
 *   - EYE_DIAMETER_TARGET_MM: registered the output stem at the adult 24 mm axial length (the gate
 *     refuses unregistered new actors by design).
 *   - hair_licence_permits(): header-first licence read + the existing named uuid allowlist applied
 *     INSIDE the fit gate, so the mhair02 page-CC0/header-AGPL3 exception is enforced at one place.
 */

/*
 * ## FIXED (#695) — 2026-08-26, appended not rewritten
 *
 * `BODY_MIN_VERTS` 5000 -> 4000. #695 meshopt DECIMATION of the four ED actors (ratio 0.4,
 * error 0.001) shrank the physician body to 4,807 verts (was 11,065), below the 5,000 body
 * primitive floor, so the measurement read `body null cm` and clause (1) reddened on an actor
 * whose height did not change. The floor's job is to separate BODY primitives from garment/hair
 * primitives (far smaller); 4,000 still does with margin both sides (garment/hair <= 2,216;
 * smallest real body 4,807). The physician body still measures its height at the same stature.
 */
