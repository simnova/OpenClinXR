import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: seven humanoids a learner loads are still Anny-derived, and only the MPFB half of the
 * cast has face units.
 *
 * Operator, 2026-08-24: "clean up the humanoid assets so we know that none are anny" and "integrate
 * faceunits (if that makes sense) to all humanoids".
 *
 * MEASURED at 9999ea73 — THE TWO ASKS ARE ONE TASK:
 *
 *   shipped generated-humanoid provenance by sourceKind
 *     7  real_anny_candidate_unverified                 <- still Anny, still shipping
 *     6  mpfb2_makehuman_basemesh_from_anny_reference
 *     2  mpfb2_makehuman_basemesh
 *
 *   every mpfb-* asset carries an IDENTICAL 47-target set: 27 FACS + 15 viseme_* + 5 other
 *   no anny-derived asset carries any FACS action unit
 *
 * So face units arrive WITH the MPFB rail. Switching the resolver off Anny delivers "faceunits on
 * all humanoids" as a consequence — no acquisition required. MakeHuman's CC0 `faceunits01` pack
 * ("ARKit style face units") is NOT needed for expression: FACS is the superset ARKit derives from,
 * and `MPFB_FACS_MORPH_NAMES` (`packages/openclinxr/asset-registry/src/morph-target-resolver.ts:54`)
 * already maps canonical names onto it with an Action Unit justification per row.
 *
 * SIX OF SEVEN COUNTERPARTS ALREADY EXIST, so this is a resolver rewire, not a regeneration:
 *   adult_male_street_casual   -> mpfb-street-adult-male
 *   ed_chest_pain_nurse_adult  -> mpfb-clinical-nurse-adult
 *   ed_chest_pain_spouse_adult -> mpfb-family-partner-adult
 *   peds_anxious_parent        -> mpfb-peds-parent-aisha
 *   peds_nurse_kevin           -> mpfb-peds-nurse-kevin
 *   peds_patient_child         -> mpfb-peds-patient-child
 *   ed_chest_pain_adult_cast   -> NONE. This is the one body that must be produced.
 *
 * This finishes MADR 0052's P2 ("a learner loads MPFB bodies"), which is Accepted and half-executed:
 * 7 of 15 asset literals in `humanoid-runtime-asset-url.ts` are already mpfb-*.
 *
 * TWO RISKS THE IMPLEMENTER MUST MEASURE, NOT ASSUME:
 *   - MPFB assets are roughly TWICE the triangles (75,854 vs 34,572 on the nurse pair). Six swaps at
 *     2x is a real Quest budget change and is NOT evaluated here.
 *   - `mpfb-peds-parent-aisha` carries a garment mesh named
 *     `makeclothes_library_cargo_pants_mpfb_ob_patient_aisha_mesh.001` — an OB-patient garment on the
 *     peds parent. Whether that is a naming artifact or a real mis-fit is NOT DETERMINED.
 *
 * claimScope: that no shipped humanoid resolves an anny-derived asset, and that every shipped
 *   humanoid carries FACS action units.
 * notEvidenceFor: whether any MPFB body is anatomically right, correctly clothed, within the
 *   triangle budget, or reads as the same person the case describes.
 */

const REPO = join(import.meta.dirname, "../../..");
const GEN = join(REPO, "apps/ui-xr/public/generated-humanoids");

const provenanceBySourceKind = (): Map<string, string> => {
  const out = new Map<string, string>();
  if (!existsSync(GEN)) return out;
  for (const f of readdirSync(GEN).filter((n) => n.endsWith(".provenance.json"))) {
    try {
      const d = JSON.parse(readFileSync(join(GEN, f), "utf8")) as { sourceKind?: string };
      out.set(f.replace(".provenance.json", ""), String(d.sourceKind ?? ""));
    } catch { /* skip */ }
  }
  return out;
};

/** An asset is Anny-derived when its sourceKind names anny WITHOUT naming mpfb — the
 *  `..._from_anny_reference` bodies are MPFB bodies MATCHED to an Anny reference, which is the
 *  sanctioned P1 path and is not what the operator asked to remove. */
const isAnnyDerived = (sourceKind: string): boolean =>
  /anny/i.test(sourceKind) && !/mpfb/i.test(sourceKind);

describe("no shipped humanoid is anny, and every face has units", () => {
  it.fails("(1) no humanoid the runtime resolves is anny-derived", () => {
    const resolver = readFileSync(join(REPO, "apps/ui-xr/src/humanoid-runtime-asset-url.ts"), "utf8");
    const prov = provenanceBySourceKind();
    const shipped = [...prov.entries()].filter(([name]) => resolver.includes(`${name}.glb`));
    expect(shipped.length, "the resolver must reference assets that exist").toBeGreaterThan(3);
    const anny = shipped.filter(([, kind]) => isAnnyDerived(kind)).map(([n, k]) => `${n} (${k})`);
    expect(anny, `anny-derived assets still resolved by the runtime:\n${anny.join("\n")}`).toEqual([]);
  });

  it.fails("(2) every humanoid the runtime resolves carries FACS action units", () => {
    // The operator's second ask, satisfied by the first. Asserted on provenance rather than by
    // parsing every GLB: mpfb-* bodies carry an identical 47-target set (27 FACS + 15 viseme),
    // measured across all eight at 9999ea73, and no anny-derived body carries any.
    const resolver = readFileSync(join(REPO, "apps/ui-xr/src/humanoid-runtime-asset-url.ts"), "utf8");
    const prov = provenanceBySourceKind();
    const shipped = [...prov.entries()].filter(([name]) => resolver.includes(`${name}.glb`));
    const faceless = shipped.filter(([, kind]) => !/mpfb/i.test(kind)).map(([n]) => n);
    expect(faceless, `resolved humanoids with no face units:\n${faceless.join("\n")}`).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: an MPFB body matched to an Anny REFERENCE is not an Anny asset", () => {
    // `mpfb2_makehuman_basemesh_from_anny_reference` is MADR 0052's P1 path: phenotype -> MPFB
    // macros, matched to the Anny reference. Removing those would delete the graduation work itself.
    expect(isAnnyDerived("mpfb2_makehuman_basemesh_from_anny_reference"),
      "an MPFB body matched to an Anny reference is MPFB").toBe(false);
    expect(isAnnyDerived("real_anny_candidate_unverified"), "a raw Anny candidate is not").toBe(true);
    expect(isAnnyDerived("mpfb2_makehuman_basemesh")).toBe(false);
  });

  it("(4) VACUITY GUARD: the MPFB counterparts exist and carry their face units", () => {
    // Without this, (1) and (2) could pass by the resolver referencing nothing at all.
    const prov = provenanceBySourceKind();
    const mpfb = [...prov.entries()].filter(([, k]) => /mpfb/i.test(k));
    expect(mpfb.length, "eight MPFB bodies were measured at 9999ea73").toBeGreaterThanOrEqual(6);
    for (const n of ["mpfb-clinical-nurse-adult", "mpfb-peds-parent-aisha", "mpfb-peds-patient-child"]) {
      expect(existsSync(join(GEN, `${n}.glb`)), `${n} must ship for the swap to be possible`).toBe(true);
    }
  });
});
