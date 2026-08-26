import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: the materializer refuses to bake an unnamed subject instead of guessing one.
 *
 * ## MEASURED 2026-08-26 at source — do not re-derive
 *
 * `materialize_mpfb_humanoid_candidate.py:1672-1673` declares `--reference` with `default=None`, so
 * the flag is optional. Eight sites then substitute a hardcoded identity when it is absent:
 *
 *     :2931  skin_material_name    = f"mpfb_skin_{args.reference or 'ob_patient_aisha'}"
 *     :3129  eyes_asset.data.name  = f"..._mpfb_{args.reference or 'ob_patient_aisha'}_mesh"
 *     :3413  mat_makeclothes_library_eyes_{args.reference or 'ob_patient_aisha'}
 *     :3485  _hair_ref_tag  = args.reference or "ob_patient_aisha"
 *     :3552  _brow_ref_tag  = args.reference or "ob_patient_aisha"
 *     :3648  _pre_ref_tag   = args.reference or "ob_patient_aisha"
 *     :3661  _feature_ref_tag = args.reference or "ob_patient_aisha"
 *
 * Six of eleven shipped assets carry `ob_patient_aisha` in their material names. Five carry an
 * explicit reference (`ed_chest_pain_nurse_adult`, `ed_chest_pain_spouse_adult`, `peds_nurse_kevin`,
 * `peds_patient_child`, `adult_male_street_casual`) and are the known-good column: the flag works
 * and is used.
 *
 * ## WHY THIS CONTRACT ASSERTS ON THE SOURCE AND NOT ON THE ASSETS
 *
 * I first intended to assert that no shipped asset carries the default string. **That contract
 * cannot be written correctly, and finding out why is the point.** `mpfb-ob-patient-aisha.glb`
 * legitimately depicts an actor called Aisha. A bake run WITH `--reference ob_patient_aisha` and a
 * bake run WITHOUT the flag at all produce a byte-identical material name. **The shipped bytes
 * cannot distinguish a declared identity from an absent one**, and the artifact that once could —
 * the missing manifest — was written by #688 before I looked.
 *
 * So the defect is not "six assets have the wrong name". It is that **a bake may run without saying
 * who it is baking, and the pipeline silently attributes the result to a particular actor.** That is
 * a property of the source, checkable today, and it is where D13's rule applies: the factory should
 * refuse an unbuildable or unspecified value loudly so the layer above resolves it, exactly as
 * `eye_iris_colour` refuses `hazel` rather than picking a colour.
 *
 * ## THE COUNTERWEIGHT IS THE REAL RISK HERE
 *
 * The cheapest way to clear clause (1) is to delete the fallbacks and let `None` flow into the
 * f-strings, which produces material names containing the literal `None` and looks fixed. Clause (2)
 * refuses that: the five explicitly-referenced assets must still parse to their real reference ids,
 * so the naming path has to keep working for a bake that DOES declare its subject.
 *
 * claimScope: whether the materializer substitutes a hardcoded identity when `--reference` is absent.
 * notEvidenceFor: whether any of the six default-carrying assets was in fact baked deliberately as
 *   Aisha — the bytes cannot say; whether `--reference` should be required rather than defaulted,
 *   which is the fix's shape and not asserted here; whether other flags carry silent defaults.
 */

const MATERIALIZER = join(
  import.meta.dirname, "blender/materialize_mpfb_humanoid_candidate.py",
);
const GENERATED = join(import.meta.dirname, "../../../apps/ui-xr/public/generated-humanoids");

/** The hardcoded identity substituted when `--reference` is absent. */
const SUBSTITUTED_IDENTITY = "ob_patient_aisha";

/** Assets baked with an explicit `--reference`. The naming path must keep working for these. */
const EXPLICITLY_REFERENCED: Readonly<Record<string, string>> = {
  "mpfb-clinical-nurse-adult": "ed_chest_pain_nurse_adult",
  "mpfb-family-partner-adult": "ed_chest_pain_spouse_adult",
  "mpfb-peds-nurse-kevin": "peds_nurse_kevin",
  "mpfb-peds-patient-child": "peds_patient_child",
  "mpfb-street-adult-male": "adult_male_street_casual",
};

/** Lines substituting the hardcoded identity for an absent `--reference`. */
function fallbackSites(): string[] {
  const src = readFileSync(MATERIALIZER, "utf8").split("\n");
  const hits: string[] = [];
  for (const [i, line] of src.entries()) {
    if (line.includes(`args.reference or`) && line.includes(SUBSTITUTED_IDENTITY)) {
      hits.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
    }
  }
  return hits;
}

/** The reference id a shipped asset's eye material records, read from the bytes. */
function bakedFromReference(asset: string): string | null {
  const bytes = readFileSync(join(GENERATED, `${asset}.glb`));
  const hit = /mat_makeclothes_library_eyes_([a-z0-9_]+)/.exec(bytes.toString("latin1"));
  return hit ? hit[1]! : null;
}

describe("a bake says who it is baking (#687)", () => {
  it.fails("(1) the materializer does not substitute an identity for an absent --reference", () => {
    const sites = fallbackSites();
    expect(
      sites,
      `${sites.length} site(s) substitute "${SUBSTITUTED_IDENTITY}" when --reference is absent, so a `
        + "bake that never says who it is baking still produces material names claiming a particular "
        + "actor. Six of eleven shipped assets carry that string. The fix is to refuse an unnamed "
        + "subject loudly — the same rule that makes eye_iris_colour raise on an unbuildable colour "
        + "instead of picking one — not to let None flow into the f-strings (clause 2 refuses that).",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: an explicitly-referenced bake still names its real subject", () => {
    // The cheapest way to clear clause (1) is to delete the fallbacks and let `None` reach the
    // f-strings, producing material names containing the literal "None" while the grep goes quiet.
    // These five assets were baked WITH --reference and their names must keep resolving.
    const wrong: string[] = [];
    for (const [asset, expected] of Object.entries(EXPLICITLY_REFERENCED)) {
      const actual = bakedFromReference(asset);
      if (actual !== expected) wrong.push(`${asset}: ${actual ?? "(unreadable)"} != ${expected}`);
    }
    expect(
      wrong,
      "the naming path must keep working for a bake that DOES declare its subject. If these stopped "
        + "resolving, clause (1) was cleared by breaking the mechanism rather than by fixing it.",
    ).toEqual([]);
  }, 120_000);

  it("(3) COUNTERWEIGHT: the substituted identity is still a real reference id somewhere", () => {
    // Guards the reader, not the data. If `SUBSTITUTED_IDENTITY` were renamed or the material-name
    // convention changed, clause (1)'s grep would go quiet and clause (2) would still pass on five
    // untouched assets — clause (1) would then be green having measured nothing.
    const carriers = Object.keys(EXPLICITLY_REFERENCED).length;
    expect(carriers, "the known-good column emptied").toBeGreaterThan(0);
    const src = readFileSync(MATERIALIZER, "utf8");
    expect(
      src.includes("--reference"),
      "the --reference flag no longer exists in the materializer. Clause (1) cannot detect a "
        + "substitution for a flag that is gone; restore the flag or re-derive this contract.",
    ).toBe(true);
  });
});
