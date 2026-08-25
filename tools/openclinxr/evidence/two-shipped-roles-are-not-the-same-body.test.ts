import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: two shipped clinical roles are not literally the same body.
 *
 * MEASURED 2026-08-25, do not re-derive. Across every shipped humanoid GLB, hashing the BODY mesh's
 * vertex buffer (not the file):
 *
 *   shipped GLBs with a body mesh: 11      DISTINCT body shapes: 10
 *   DUPLICATE x2  3f9d4f4eceb0  mpfb-clinical-nurse-adult, mpfb-clinical-physician-adult
 *
 * Exactly ONE duplicate pair exists. Ten of eleven files already satisfy this contract, so it is a
 * narrow assertion about a specific defect, not a sweeping demand on the cast.
 *
 * PIXEL-GRADED 2026-08-25 by the orchestrator, both isolated and lit
 * (.openclinxr/evidence/nurse-physician-grade/): identical face, hair, skin, teal scrubs, shoes and
 * stance. The physician is the nurse with a white lab coat over the top. A learner in
 * ed_chest_pain_priority_v1 meets both.
 *
 * WHY FOUR EXISTING INSTRUMENTS ARE BLIND TO IT:
 *   - file byte hash: the two GLBs DIFFER, so a file hash reports two distinct assets
 *   - mesh name: names track the SOURCE MANIFEST, not the actor. Both carry
 *     `mpfb_ed_chest_pain_nurse_adult_body`
 *   - triangle / vertex count: identical by construction, 11,577 verts on both
 *   - stature: 175.2 cm on both, and stature cannot separate bodies in general —
 *     mpfb-street-adult-male and mpfb-peds-nurse-kevin are DIFFERENT bodies both at 176.0 cm
 *   Only the body's vertex buffer separates them.
 *
 * FAILED TREATMENT, refused by clause (2): perturbing the physician's vertices so the hash differs.
 * That satisfies clause (1) and produces the same person. Clause (2) requires the physician actor to
 * carry a resolved-spec entry, which a jitter does not create.
 *
 * FAILED TREATMENT, refused by clause (3): deleting one of the two files, or pointing the physician at
 * an existing body. Either satisfies clause (1) by shrinking the cast. Clause (3) pins the count of
 * distinct bodies at today's level or better.
 *
 * KNOWN-GOOD COLUMN: the other ten shipped bodies, distinct today and pinned by clause (3).
 *
 * NO SCALAR THRESHOLD APPEARS IN THIS CONTRACT. Every assertion is set membership or a count over an
 * enumerated population.
 *
 * claimScope: whether two shipped humanoid files carry the same body vertex buffer, and whether the
 *   physician actor is described anywhere the factory reads.
 * notEvidenceFor: whether any body is anatomically right, correctly clothed, or reads as the person a
 *   case describes; materials and textures, which this contract does not read; the other 12 actors
 *   with no resolved-spec entry.
 */

const DIR = "apps/ui-xr/public/generated-humanoids";
const EXPORT = "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json";
const PHYSICIAN_ACTOR = "senior_resident_ward_v1";
const BODY_MIN_VERTS = 5000;

const io = new NodeIO();

/** basename -> body vertex-buffer hash, for every shipped GLB that carries a body mesh. */
async function shippedBodyHashes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of readdirSync(DIR).filter((n) => n.endsWith(".glb")).sort()) {
    let doc;
    try { doc = await io.readBinary(readFileSync(`${DIR}/${file}`)); } catch { continue; }
    for (const mesh of doc.getRoot().listMeshes()) {
      if (!/_body$/u.test(mesh.getName() ?? "")) continue;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos || pos.getCount() < BODY_MIN_VERTS) continue;
        const q = pos.getArray() as Float32Array;
        out.set(
          file.replace(/\.glb$/u, ""),
          createHash("sha256").update(Buffer.from(q.buffer, q.byteOffset, q.byteLength)).digest("hex").slice(0, 12),
        );
      }
    }
  }
  return out;
}

function resolvedSpecActorIds(): Set<string> {
  const doc = JSON.parse(readFileSync(EXPORT, "utf8")) as { entries: Record<string, Record<string, unknown>> };
  const ids = new Set<string>();
  for (const perScenario of Object.values(doc.entries)) for (const actorId of Object.keys(perScenario)) ids.add(actorId);
  return ids;
}

describe("two shipped roles are not the same body", () => {
  it("(1) no two shipped humanoids carry the same body vertex buffer", async () => {
    const hashes = await shippedBodyHashes();
    expect(hashes.size, "the shipped population must not vanish out from under this contract")
      .toBeGreaterThan(8);
    const byHash = new Map<string, string[]>();
    for (const [name, h] of hashes) byHash.set(h, [...(byHash.get(h) ?? []), name]);
    const duplicates = [...byHash.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([h, names]) => `${h}: ${names.join(" == ")}`);
    expect(
      duplicates,
      "two roles a learner meets in one station must not ship as literally the same body",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the physician actor is described where the factory reads", () => {
    // Refuses a vertex jitter that satisfies clause (1) while producing the same person: a jitter
    // creates no resolved-spec entry. The physician is the bank's only one and today has none.
    expect(
      [...resolvedSpecActorIds()].filter((id) => id === PHYSICIAN_ACTOR),
      `${PHYSICIAN_ACTOR} must be described in the resolved spec the factory consumes; a body that no `
        + "case describes is a body nobody chose",
    ).toEqual([PHYSICIAN_ACTOR]);
  });

  it("(3) KNOWN-GOOD: the count of distinct shipped bodies does not fall", async () => {
    // Refuses satisfying clause (1) by deleting a file or re-pointing the physician at an existing
    // body — both shrink the cast. Ten distinct bodies ship today.
    const hashes = await shippedBodyHashes();
    const distinct = new Set(hashes.values()).size;
    expect(
      distinct,
      "a fix that removes a body to remove a duplicate has made the cast smaller, not more distinct",
    ).toBeGreaterThanOrEqual(10);
  });
});

/*
## FIXED (#665)

- `ward-delirium.ts`: `senior_resident_ward_v1` now authors its phenotype — a male
  senior resident, age 34, height_cm 172, bmi 23.5, average build, medium-warm
  skin, dark-brown hair, brown eyes, body_profile `adult_clinical_physician` (a
  new atlas cell: adult × male × 172 cm — the first male clinical body). The sex
  is authored for the PERSON in the case definition, not derived from the role
  descriptor (#664: the lookup must never invent a person's sex; authored
  phenotypes state it themselves).
- `actor-phenotype.v1.json` regenerated: 32 -> 33 entries;
  `senior_resident_ward_v1` now has a resolved-spec row under
  `ward_delirium_med_rec_v1` (clause 2).
- New tracked Anny reference `ward_delirium_senior_resident_adult`
  (.anny_base.obj + .anny_manifest.json) generated by the deterministic rail
  (generate_mesh.py, params resolved from the case-definition export,
  phenotypeSource=case_definition).
- `mpfb-clinical-physician-adult.glb` re-baked via
  materialize_mpfb_humanoid_candidate.py (no-reference authored-identity path,
  --eye-colour-reference ward_delirium_senior_resident_adult, --actor-role
  physician): MACRO gender 1.0 (gender_presentation), age 0.6191 (34y), weight
  0.4798 (bmi 23.5), height solved to 1.720 m (measured 1.7219 m). Body vertex
  buffer now b0d889cd5af7 (was the nurse's 3f9d4f4eceb0); the two bodies are
  distinct and 11 of 11 shipped GLBs carry distinct bodies (clauses 1 and 3). Wardrobe: CC-BY
  scrub shirt + scrub pants, CC0 crude-labcoat-female as a third layer (locked
  white), mhair02 male hair (page-CC0/header-AGPL3 uuid allowlist), toigo_mj_
  cloth_shoes, brown iris.
- `materialize_mpfb_humanoid_candidate.py`: `HAIR_STYLE_BY_OUTPUT_STEM` added —
  the no-reference authored-identity path has no reference id to key the hair
  table on, so the default female bob would have dressed a male physician.
  Keyed by output GLB stem, the same convention as EYE_DIAMETER_TARGET_MM.
- SCOPE DECISIONS (recorded per brief):
  1. Identity values (age 34 / 172 cm / bmi 23.5 / male) chosen for
     within-scenario distinctness: the co-present nurse-class body is
     female-presenting, and the learner must meet two different people; a male
     senior resident is a plausible unremarkable identity for this inpatient
     ward station. 172 cm was chosen over 178 so the baked body sits clearly off
     every generator-default height band (1.76 / 1.666 / 1.655 within the
     a-second-case-drives 2 cm tolerance), making the new atlas cell measurable.
     Not derived from the role descriptor.
  2. No resolver change: the physician GLB path is unchanged; only its bytes
     changed. The lab coat stays on the physician file only (nurse file
     untouched).
  3. Skin tone ships as the MPFB default (the no-reference path reads tone from
     --reference, not the manifest); the authored medium_warm reaches the
     manifest and is available to any consumer that reads it.
- Clauses (1) and (2) flipped `it.fails` -> `it`; the out-of-scope defects
  listed in the issue header (throat fragments, cuff shards, waistband strip,
  placket strip) are NOT addressed by this slice.
*/
