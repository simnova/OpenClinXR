import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: the reference a shipped humanoid was baked from still resolves to a manifest.
 *
 * ## MEASURED 2026-08-26 on db7fc38f — executed, not read
 *
 * Every shipped `mpfb-*.glb` embeds the reference id it was baked from in its eye material
 * (`mat_makeclothes_library_eyes_<reference_id>`). Six of the eleven name `ob_patient_aisha`, and
 * `apps/ui-xr/public/generated-humanoids/ob_patient_aisha.anny_manifest.json` DOES NOT EXIST.
 *
 *     asset                              reference                    manifest
 *     mpfb-clinical-physician-adult      ob_patient_aisha             MISSING
 *     mpfb-gown-adult-patient            ob_patient_aisha             MISSING
 *     mpfb-gown-inspect                  ob_patient_aisha             MISSING
 *     mpfb-ob-patient-aisha              ob_patient_aisha             MISSING
 *     mpfb-peds-parent-aisha             ob_patient_aisha             MISSING
 *     mpfb-viseme-inspect                ob_patient_aisha             MISSING
 *     mpfb-clinical-nurse-adult          ed_chest_pain_nurse_adult    found     <- KNOWN-GOOD
 *     mpfb-family-partner-adult          ed_chest_pain_spouse_adult   found     <- KNOWN-GOOD
 *     mpfb-peds-nurse-kevin              peds_nurse_kevin             found     <- KNOWN-GOOD
 *     mpfb-peds-patient-child            peds_patient_child           found     <- KNOWN-GOOD
 *     mpfb-street-adult-male             adult_male_street_casual     found     <- KNOWN-GOOD
 *
 * IT IS ONE MISSING FILE WITH SIX DEPENDENTS, not six separate defects. `ob_patient_aisha` is the
 * most-used reference id in the tree and the only one of the six distinct ids with no manifest.
 *
 * ## THE CONSEQUENCE, executed against the real readers
 *
 * `materialize_mpfb_humanoid_candidate.py` resolves phenotype through `_anny_manifest_for`, which
 * returns None when no manifest exists, and both readers then return their documented defaults:
 *
 *     phenotype_eye_colour("ob_patient_aisha")          -> ''          (role fallback decides)
 *     phenotype_skin_tone("ob_patient_aisha")           -> 'default'
 *     phenotype_eye_colour("peds_patient_child")        -> 'hazel'     (manifest FOUND)
 *     phenotype_skin_tone("ed_chest_pain_nurse_adult")  -> 'medium_warm'
 *
 * So for six of eleven shipped humanoids — more than half the cast — neither the case's declared
 * skin tone nor its declared eye colour reaches the bake. The role default decides both. That is
 * the #568 monopoly mechanism arriving through a different door: not an inherited value this time,
 * but an absent one.
 *
 * ## WHY THE CHECK READS CONTENTS AND NOT NAMES
 *
 * #687 records four artifacts whose contents contradict what they are called, and this is one of
 * them. A check that compared a material NAME against a manifest NAME would be a fifth instance of
 * that defect inside the check written to catch it, so clause (2) requires the manifest to carry a
 * phenotype block with real values rather than merely to exist.
 *
 * claimScope: whether each shipped humanoid's baked-from reference resolves to a manifest carrying
 *   a phenotype block.
 * notEvidenceFor: whether the phenotype values in any manifest are CORRECT; whether re-baking the
 *   six would change their appearance; whether `ob_patient_aisha` should be six actors' shared
 *   reference at all (that is #687's question, not this one).
 */

const REPO = join(import.meta.dirname, "../../..");
const GENERATED = join(REPO, "apps/ui-xr/public/generated-humanoids");

/** The bake writes the reference id into the eye material name. This reads what the bake used. */
const EYE_REFERENCE = /mat_makeclothes_library_eyes_([a-z0-9_]+)/;

/** The five references that resolve today. A zero here means the reader broke, not the tree. */
const KNOWN_GOOD_REFERENCES = [
  "ed_chest_pain_nurse_adult", "ed_chest_pain_spouse_adult", "peds_nurse_kevin",
  "peds_patient_child", "adult_male_street_casual",
] as const;

function shippedAssets(): string[] {
  return readdirSync(GENERATED).filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb")).sort();
}

function manifestPath(referenceId: string): string {
  return join(GENERATED, `${referenceId}.anny_manifest.json`);
}

/** `input_params.phenotype` from the manifest, or null when absent or unreadable. */
function phenotypeBlock(referenceId: string): Record<string, unknown> | null {
  const p = manifestPath(referenceId);
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const input = m["input_params"] as Record<string, unknown> | undefined;
    const pheno = input?.["phenotype"] as Record<string, unknown> | undefined;
    return pheno ?? null;
  } catch {
    return null;
  }
}

async function bakedFromReference(asset: string): Promise<string | null> {
  const doc = await new NodeIO().read(join(GENERATED, asset));
  for (const m of doc.getRoot().listMaterials()) {
    const hit = EYE_REFERENCE.exec(m.getName());
    if (hit) return hit[1]!;
  }
  return null;
}

async function referenceTable(): Promise<Array<{ asset: string; reference: string | null }>> {
  return Promise.all(
    shippedAssets().map(async (asset) => ({ asset, reference: await bakedFromReference(asset) })),
  );
}

describe("every shipped humanoid resolves the reference it was baked from (#688)", () => {
  it.fails("(1) each shipped humanoid's baked-from reference has a manifest", async () => {
    const rows = await referenceTable();
    expect(rows.length, "no shipped mpfb assets found — the enumeration is broken").toBeGreaterThan(0);
    const unresolved = rows
      .filter((r) => r.reference !== null && !existsSync(manifestPath(r.reference)))
      .map((r) => `${r.asset} -> ${r.reference}.anny_manifest.json`);
    expect(
      unresolved,
      "these shipped humanoids name a reference with no manifest, so `_anny_manifest_for` returns "
        + "None and both phenotype readers fall back: phenotype_eye_colour -> '' and "
        + "phenotype_skin_tone -> 'default'. Neither the case's declared skin tone nor its declared "
        + "eye colour reaches the bake. Write the missing manifest from the case that authored the "
        + "reference; do NOT repoint the material at a manifest that happens to exist.",
    ).toEqual([]);
  }, 180_000);

  it("(2) COUNTERWEIGHT: a resolving manifest carries a real phenotype block", async () => {
    // Refuses the cheapest fix: dropping an empty `{}` at the missing path so `existsSync` passes
    // while both readers still return their defaults. `input_params.phenotype` must exist and hold
    // at least one of the two channels this defect silences. Measured today, all five known-good
    // references satisfy this, so the requirement is met by real shipped manifests rather than
    // invented by me.
    const rows = await referenceTable();
    const hollow: string[] = [];
    for (const r of rows) {
      if (r.reference === null || !existsSync(manifestPath(r.reference))) continue;
      const pheno = phenotypeBlock(r.reference);
      const hasChannel = pheno !== null
        && (typeof pheno["skin_tone"] === "string" || typeof pheno["eye_color"] === "string");
      if (!hasChannel) hollow.push(`${r.reference} (via ${r.asset})`);
    }
    expect(
      hollow,
      "these manifests resolve but carry no `input_params.phenotype.skin_tone` or `.eye_color`, so "
        + "the readers still fall back to their defaults. A file that exists is not a manifest. "
        + "Widening or deleting this clause is wrong — it is what stops clause (1) being satisfied "
        + "by an empty JSON object at the missing path.",
    ).toEqual([]);
  }, 180_000);

  it("(3) COUNTERWEIGHT: the reader still recovers the five references that resolve today", async () => {
    // Refuses the way clause (1) goes green about nothing. If EYE_REFERENCE stops matching or the
    // manifest directory moves, every reference reads as null, `unresolved` is empty, and clause (1)
    // passes while measuring no asset at all.
    //
    // MEASURED: an earlier version of this clause compared KNOWN_GOOD_REFERENCES against
    // existsSync alone. A destructive probe that broke EYE_REFERENCE left it GREEN, because file
    // existence does not depend on the reader. It now goes through the same reference table clause
    // (1) uses, so a broken reader fails here first.
    const rows = await referenceTable();
    const recovered = new Set(rows.map((r) => r.reference).filter((r): r is string => r !== null));
    const lost = KNOWN_GOOD_REFERENCES.filter((r) => !recovered.has(r) || !existsSync(manifestPath(r)));
    expect(
      lost,
      "references that both parsed out of the shipped bytes and resolved to a manifest on db7fc38f "
        + "no longer do. Either EYE_REFERENCE stopped matching, a manifest was deleted, or the "
        + "lookup path changed. Clause (1) cannot be trusted while this is red, because an "
        + "unreadable reference is indistinguishable from a resolving one there.",
    ).toEqual([]);
  }, 180_000);
});
