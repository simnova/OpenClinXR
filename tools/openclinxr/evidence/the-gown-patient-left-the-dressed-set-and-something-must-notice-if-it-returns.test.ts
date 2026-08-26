import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * INVERTED GUARD: `mpfb-gown-adult-patient` ships no pants-class lower garment, and if that
 * changes, something says so.
 *
 * ## WHY THIS FILE EXISTS (#685)
 *
 * #684 (`ca2d5d79`) re-baked the gowned patient so the hospital gown replaced its base
 * `cargo_pants`. Its worker then removed the asset from `ACTORS` in
 * `overlapping-garments-do-not-interpenetrate.test.ts` and deleted its `BASELINE` row, because
 * that set is defined as actors carrying BOTH a lower garment and footwear and this asset now
 * carries neither trousers nor a trouser/boot overlap to measure.
 *
 * The reasoning is correct against what ships and the worker disclosed it in its commit. The
 * STRUCTURE was wrong: a deletion where this repo's rule is supersede-never-delete. If a later
 * re-bake restores `cargo_pants` to this asset, it belongs in `ACTORS` again and nothing will put
 * it there. The coverage stays gone, and it stays green.
 *
 * That is the same shape as the defect #684 was filed to fix. `f3bf8d13` re-baked this asset for
 * HEIGHT and silently dropped its gown; the height contract passed 3/3 because nothing measured
 * what the re-bake discarded. A rebake station still has no invariant that it preserves what an
 * asset already had, so the absence has to be recorded where a re-bake will trip over it.
 *
 * ## MEASURED 2026-08-26 on ca2d5d79
 *
 *     mpfb-gown-adult-patient.glb   pants-class materials matching /(cargo|scrub|trouser)_pants/i: 0
 *                                   openclinxr_real_garment_hospital_gown_phenotype_L0 present
 *     the nine assets still in ACTORS                                                  all >= 1
 *
 * The nine remaining members are the KNOWN-GOOD COLUMN: the predicate is satisfiable, meaningful
 * and non-vacuous on real shipped bytes today, so a zero for the gowned patient is a fact about
 * that asset rather than a broken selector.
 *
 * ## THE SELECTOR IS THE ONE THE DELETED ENTRY WAS JUDGED BY
 *
 * `/(cargo|scrub|trouser)_pants/i` is the lower-garment CLASS from
 * `overlapping-garments-do-not-interpenetrate.test.ts` (see its FIXED #598 block: the wardrobe
 * campaign moved staff from `cargo_pants` to `scrub_pants` and a `/cargo_pants/i` selector
 * silently stopped matching kevin). Reusing it is deliberate — a guard judged by a different
 * predicate than the enumeration it guards would drift apart from it.
 *
 * claimScope: whether the gowned patient ships a pants-class lower garment, and whether the
 *   enumeration that dropped it still reflects that.
 * notEvidenceFor: whether the gown is the right garment for the station; whether any OTHER asset
 *   was removed from an enumeration without a guard (that sweep is #685's own out-of-scope slot);
 *   whether trousers under a gown would be correct if restored.
 */

const REPO = join(import.meta.dirname, "../../..");
const GENERATED = join(REPO, "apps/ui-xr/public/generated-humanoids");
const SUBJECT = "mpfb-gown-adult-patient";
const ENUMERATION = join(
  REPO, "tools/openclinxr/evidence/overlapping-garments-do-not-interpenetrate.test.ts",
);

/** The lower-garment CLASS, copied deliberately from the enumeration this guard covers. */
const PANTS_CLASS = /(cargo|scrub|trouser)_pants/i;

/** The nine members of ACTORS as of ca2d5d79, after #684 removed the gowned patient. */
const STILL_ENUMERATED = [
  "mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child",
  "mpfb-clinical-nurse-adult", "mpfb-clinical-physician-adult", "mpfb-family-partner-adult",
  "mpfb-peds-parent-aisha", "mpfb-street-adult-male", "mpfb-viseme-inspect",
] as const;

async function pantsClassMaterialCount(asset: string): Promise<number> {
  const doc = await new NodeIO().read(join(GENERATED, `${asset}.glb`));
  return doc.getRoot().listMaterials().filter((m) => PANTS_CLASS.test(m.getName())).length;
}

describe("the gown patient left the dressed set and something must notice if it returns (#685)", () => {
  it("(1) the gowned patient ships no pants-class lower garment", async () => {
    const count = await pantsClassMaterialCount(SUBJECT);
    expect(
      count,
      `${SUBJECT} now ships ${count} pants-class material(s) matching ${PANTS_CLASS}. It was `
        + "REMOVED from ACTORS in overlapping-garments-do-not-interpenetrate.test.ts by #684 on the "
        + "ground that it has none. RESTORATION: re-add \"" + SUBJECT + "\" to that ACTORS list and "
        + "re-pin its BASELINE row { cuffReachMm, shoeTris } against a fresh measurement of the "
        + "current bytes — the pre-#684 row was { cuffReachMm: 13.3, shoeTris: 1004 } and is stale. "
        + "Do NOT widen or delete this clause to make it pass; its failing IS the notification.",
    ).toBe(0);
  }, 120_000);

  it("(2) COUNTERWEIGHT: the selector still matches on the nine assets that stayed enumerated", async () => {
    // Refuses the way clause (1) goes green about nothing. A selector that matches NOTHING — a
    // renamed material class, a broken regex, an empty read — reports zero for the subject and
    // looks like a healthy guard. The nine remaining ACTORS members all carry a pants-class
    // material today, so a zero among them means the instrument died rather than the wardrobe.
    const counts = await Promise.all(
      STILL_ENUMERATED.map(async (a) => [a, await pantsClassMaterialCount(a)] as const),
    );
    expect(
      counts.filter(([, n]) => n === 0).map(([a]) => a),
      `these assets are still listed in ACTORS but carry no material matching ${PANTS_CLASS}. `
        + "Either the selector broke or the wardrobe changed. If a wardrobe change is genuine, that "
        + "asset needs its own guard here before it leaves the enumeration — do not simply delete "
        + "it from ACTORS, which is the defect this file was written to prevent.",
    ).toEqual([]);
  }, 120_000);

  it("(3) COUNTERWEIGHT: the enumeration still records why the subject is absent", () => {
    // Refuses the cheapest way to make this whole file moot: quietly re-adding the subject to
    // ACTORS, or stripping the comment that explains its absence, so a later reader cannot tell
    // a deliberate removal from an oversight. The guard and the note are one mechanism.
    const src = readFileSync(ENUMERATION, "utf8");
    const actorsBlock = /const ACTORS = \[([\s\S]*?)\] as const;/.exec(src);
    expect(actorsBlock, `ACTORS array not found in ${ENUMERATION}`).not.toBeNull();
    const block = actorsBlock![1]!;
    expect(
      block.includes(`"${SUBJECT}"`),
      `${SUBJECT} is listed in ACTORS again. If that is deliberate because it now ships trousers, `
        + "clause (1) will already have failed and told you to re-pin its BASELINE row. If clause "
        + "(1) still passes, the asset has no lower garment and does not belong in the set.",
    ).toBe(false);
    expect(
      block.includes("#684"),
      "the note recording WHY " + SUBJECT + " is absent from ACTORS has been removed. Restore a "
        + "comment citing #684 and the reason (the gown re-bake replaced cargo_pants), so the "
        + "removal stays distinguishable from an oversight.",
    ).toBe(true);
  });
});
