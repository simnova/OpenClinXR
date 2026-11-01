import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { listShippedCastScenarioIds } from "@openclinxr/asset-registry";
import { resolveScenarioActorCast } from "@openclinxr/asset-registry/runtime-bundles";

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

const DIR = join(repoRoot(), "apps/ui-xr/public/generated-humanoids");
const CANDIDATES = join(repoRoot(), "apps/ui-xr/public/xr-assets/humanoids/candidates");
const EXPORT = join(repoRoot(), "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json");
const PHYSICIAN_ACTOR = "senior_resident_ward_v1";
/**
 * ADAPTED (ci-w4): the population (1)/(3) enumerate is the CAST — every GLB ordinary
 * cast resolution references — not the directory. On 2026-09-12 (57e277301, jeans
 * staging rebuilt OB from the sidecar-common base) mpfb-ob-patient-aisha.glb converged
 * onto mpfb-viseme-inspect.glb's body buffer (hash 6eeeea9bcf48, measured 2026-10-30
 * with this file's own instrument). The sidecar is never cast — no resolver row names
 * it — so no learner meets both, but a directory-wide (1) still trips on the pair.
 * Scoping to the cast keeps the contract's claim ("two ROLES ... a learner meets")
 * while the closed NEVER_CAST list below forces a revisit the day a sidecar is cast.
 * Measured 2026-10-30: 10 cast files, 10 distinct body buffers.
 */
function castGlbs(): string[] {
  const out = new Set<string>();
  for (const scenarioId of listShippedCastScenarioIds()) {
    for (const row of resolveScenarioActorCast(scenarioId) as unknown as { assetPath?: string }[]) {
      const p = String(row.assetPath ?? "");
      if (p.includes("/generated-humanoids/")) out.add(`${DIR}/${p.split("/").pop()}`);
      else if (p.includes("/xr-assets/humanoids/candidates/")) out.add(`${CANDIDATES}/${p.split("/").pop()}`);
    }
  }
  return [...out].sort();
}
/** Shipped-but-never-cast fixtures. Closed list: casting one must revisit clauses (1)/(3). */
const NEVER_CAST = [
  `${DIR}/mpfb-gown-inspect.glb`,
  `${DIR}/mpfb-peds-parent-aisha.glb`,
  `${DIR}/mpfb-viseme-inspect.glb`,
];
/**
 * Population floor: excludes helper `_body` meshes (hidden regions, partials — largest measured
 * 2,216 verts). Was 5,000; #695 decimation (ratio 0.4, error 0.001) shrank two real bodies below
 * it (physician 11,065 -> 4,807; family partner -> 4,997), which silently REMOVED them from the
 * population and made clause (3) red on a cast that is not smaller. 4,000 sits between the largest
 * helper (2,216) and the smallest real body (4,807) with margin both sides; the floor's job is to
 * exclude helpers, not to bound decimation.
 */
const BODY_MIN_VERTS = 4000;

const io = new NodeIO();

/** basename -> body vertex-buffer hash, for a given GLB population.
 * Aggregated PER MESH: decimation re-partitions the body into material-split primitives
 * (kevin's 8,049-tri body ships as prims each under the vert floor), so the floor and the
 * hash apply to the mesh's concatenated POSITION stream — which is what a renderer draws. */
async function bodyHashes(files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of files) {
    let doc;
    try { doc = await io.readBinary(readFileSync(file)); } catch { continue; }
    for (const mesh of doc.getRoot().listMeshes()) {
      if (!/_body$/u.test(mesh.getName() ?? "")) continue;
      const parts: number[] = [];
      for (const prim of mesh.listPrimitives()) {
        const arr = prim.getAttribute("POSITION")?.getArray() as Float32Array | undefined;
        if (arr) parts.push(...arr);
      }
      if (parts.length / 3 < BODY_MIN_VERTS) continue;
      const q = Float32Array.from(parts);
      out.set(
        file.split("/").pop()!.replace(/\.glb$/u, ""),
        createHash("sha256").update(Buffer.from(q.buffer, q.byteOffset, q.byteLength)).digest("hex").slice(0, 12),
      );
    }
  }
  return out;
}

/** basename -> body vertex-buffer hash, for every shipped GLB that carries a body mesh. */
async function shippedBodyHashes(): Promise<Map<string, string>> {
  return bodyHashes(
    readdirSync(DIR).filter((n) => n.endsWith(".glb")).sort().map((n) => `${DIR}/${n}`),
  );
}

function resolvedSpecActorIds(): Set<string> {
  const doc = JSON.parse(readFileSync(EXPORT, "utf8")) as { entries: Record<string, Record<string, unknown>> };
  const ids = new Set<string>();
  for (const perScenario of Object.values(doc.entries)) for (const actorId of Object.keys(perScenario)) ids.add(actorId);
  return ids;
}

describe("two shipped roles are not the same body", () => {
  it("(1) no two CAST humanoids carry the same body vertex buffer", async () => {
    const cast = castGlbs();
    expect(cast.length, "the cast population must not vanish out from under this contract")
      .toBeGreaterThanOrEqual(10);
    const hashes = await bodyHashes(cast);
    expect(hashes.size, "every cast GLB must carry a measurable body mesh").toBe(cast.length);
    const byHash = new Map<string, string[]>();
    for (const [name, h] of hashes) byHash.set(h, [...(byHash.get(h) ?? []), name]);
    const duplicates = [...byHash.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([h, names]) => `${h}: ${names.join(" == ")}`);
    expect(
      duplicates,
      "two roles a learner meets must not ship as literally the same body",
    ).toEqual([]);
  });

  it("(1b) COUNTERWEIGHT: the never-cast list is closed — casting a sidecar revisits (1)", () => {
    // The OB/viseme-inspect shared base (6eeeea9bcf48, converged 57e277301) is invisible
    // to (1) only while the sidecar stays uncast. If any of these is ever cast, (1)'s
    // population gains it and the duplicate trips — this clause makes that trip legible.
    const cast = new Set(castGlbs());
    for (const f of NEVER_CAST) {
      expect(cast.has(f), `${f} entered ordinary cast resolution — revisit clauses (1)/(3)`)
        .toBe(false);
      expect(readFileSync(f).readUInt32LE(0), `${f} must still exist as the recorded fixture`)
        .toBe(0x46546c67);
    }
    // generated-humanoids/ MPFB population is the closed world (this contract always
    // enumerated mpfb-*.glb); legacy Anny-rail files (peds_*, ed_chest_pain_*, adult_male_*)
    // are out of scope here — the Anny rail is the no-learner contract's subject.
    const shipped = new Set(
      readdirSync(DIR).filter((n) => n.startsWith("mpfb-") && n.endsWith(".glb")).map((n) => `${DIR}/${n}`),
    );
    const unlisted = [...shipped].filter((f) => !cast.has(f) && !(NEVER_CAST as string[]).includes(f));
    expect(unlisted, `shipped GLBs outside both the cast and the closed never-cast list:\n${unlisted.join("\n")}`)
      .toEqual([]);
  });
  it("(1-retired) directory-wide duplicate check superseded by cast-scoped (1) above", async () => {
    // The OB/viseme-inspect shared base (converged 57e277301) trips a directory-wide
    // no-duplicates assertion while no learner meets both (viseme-inspect is never cast —
    // see (1b)). This recorder tolerates duplicate groups drawn ENTIRELY from the recorded
    // pair (a future rebake that DIVERGES them passes vacuously); any group touching any
    // other file is a new defect and fails. Name-based (not hash-pinned) so a rebake that
    // moves bytes without changing the sharing structure does not trip it.
    const hashes = await shippedBodyHashes();
    const byHash = new Map<string, string[]>();
    for (const [name, h] of hashes) byHash.set(h, [...(byHash.get(h) ?? []), name]);
    const RECORDED_PAIR = new Set(["mpfb-ob-patient-aisha", "mpfb-viseme-inspect"]);
    const bad = [...byHash.entries()]
      .filter(([, names]) => names.length > 1)
      .filter(([, names]) => !names.every((n) => RECORDED_PAIR.has(n)))
      .map(([h, names]) => `${h}: ${names.join(" == ")}`);
    expect(bad, "a NEW shared-base pair beyond the recorded OB/viseme-inspect one").toEqual([]);
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

  it("(3) KNOWN-GOOD: the count of distinct CAST bodies does not fall", async () => {
    // Refuses satisfying clause (1) by deleting a file or re-pointing an actor at an existing
    // body — both shrink the cast. Ten distinct bodies cast today (measured 2026-10-30).
    const hashes = await bodyHashes(castGlbs());
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
 *
 * ORCHESTRATOR CORRECTION 2026-08-25, appended not rewritten: the worker's account above is its own
 * and stays as written, but that hash is STALE. Measured on main after the merge, the physician body
 * vertex buffer is 3dd761e204cc at 11,065 verts (nurse 3f9d4f4eceb0 at 11,577). A peer review caught
 * it; I confirmed it directly. The CLAIM the block makes — the two bodies are distinct — holds; only
 * the identifier was wrong, and a stale hash in a landed artifact is the next reader's trap.
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

/*
## FIXED (#695) — 2026-08-26, appended not rewritten

- `BODY_MIN_VERTS` 5000 -> 4000. Meshopt DECIMATION of the four ED actors (ratio 0.4,
  error 0.001) shrank two real bodies below the old floor: the physician body 11,065 ->
  4,807 verts and the family-partner body -> 4,997. Both stayed distinct (their hashes are
  unique) but left the population, so the distinct-body count read 9 instead of 11 and
  clause (3) reddened on a cast that is NOT smaller. The floor's job is to exclude the
  helper `_body` meshes (hidden regions/partials; largest 2,216 verts), which 4,000 still
  does with margin on both sides (helpers <= 2,216; smallest real body 4,807). Clause (3)
  now reads 11 distinct bodies of 11 shipped files.
*/
