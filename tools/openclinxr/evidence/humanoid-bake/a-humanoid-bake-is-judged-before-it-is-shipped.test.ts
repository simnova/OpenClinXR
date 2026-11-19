import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the shipped MPFB cast exceeds the station triangle budget on its own, and no stage of
 * the pipeline ever decimates a humanoid.
 *
 * MEASURED 2026-08-26 at head 72eed35d, NodeIO over
 * `apps/ui-xr/public/generated-humanoids/mpfb-*.glb`:
 *
 *   mpfb-gown-adult-patient       129,885 tris   11 meshes
 *   mpfb-peds-nurse-kevin         102,968        10
 *   mpfb-street-adult-male         96,400        10
 *   mpfb-clinical-physician-adult  82,454        11
 *   mpfb-clinical-nurse-adult      75,854        10
 *   mpfb-peds-parent-aisha         74,768        10
 *   mpfb-ob-patient-aisha          74,642        10
 *   mpfb-family-partner-adult      72,331        10
 *   mpfb-peds-patient-child        61,068        10
 *
 * An ED-shaped four-actor station is 360,524 triangles of ACTORS ALONE against a budget of 180,000
 * visible triangles per Quest 3 station bundle (`docs/openclinxr/asset-generation-pipeline.md:87`).
 * Over by 180,524 before a wall, a bed, or a monitor. The peds three-actor station is 238,804.
 *
 * The budget is AUTHORED DATA, not a number chosen here. It is also NOT VALIDATED ON HARDWARE
 * (grep "never been validated on hardware" in
 * docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md records that plainly), so clause (1) proves a declared budget
 * is breached and says nothing about what a Quest actually renders.
 *
 * Nothing decimates these: `grep -il decimat tools/openclinxr/asset-pipeline/` matches only
 * `equipment/kenney-promote-cli.ts` and the `trellis/` tree, and no `MeshoptSimplifier` or
 * `simplify(` call exists outside the TRELLIS path.
 *
 * KNOWN-GOOD COLUMN: `pulse-oximeter` on the TRELLIS rail went 296,226 raw to 25,000 plus a 512
 * normal map at 8,682,420 bytes, 12.6% under its shipped 80k champion, with map deviation holding at
 * 37.82 as resolution fell from 2048. That is a measured win on an asset whose largest-component
 * share was 99.7%. An MPFB humanoid is body plus garments plus hair plus eyes plus brows plus
 * lashes, and its share is UNMEASURED — which is why clause (2) demands the census before any bake.
 *
 * claimScope: shipped triangle counts, shipped mesh counts, and whether a component census exists.
 * notEvidenceFor: that a high-to-low bake WORKS on these assets. The `o2-port` case (51.5% largest
 *   component) produced a contaminated map that scored HIGHER on deviation than a good one, so
 *   `reject_measured` is a real outcome and these clauses do not presume otherwise.
 */

const DIR = join(process.cwd(), "apps/ui-xr/public/generated-humanoids");
const CENSUS = join(process.cwd(), ".openclinxr/evidence/mpfb-bake-question/component-census.json");

/** Authored budget, read from the pipeline doc rather than chosen here. */
const STATION_TRIANGLE_BUDGET = 180_000;

/** The ED-shaped station: patient, nurse, family partner, physician. */
const ED_STATION = [
  "mpfb-gown-adult-patient",
  "mpfb-clinical-nurse-adult",
  "mpfb-family-partner-adult",
  "mpfb-clinical-physician-adult",
] as const;

/**
 * Shipped mesh counts at the planting commit. These are a FLOOR for clause (3), not a target: the
 * counterweight refuses "delete the garments to hit the budget", and any correct decimation leaves
 * the mesh count alone while reducing triangles.
 *
 * ADAPTED (ci-w4): mpfb-gown-adult-patient 11 -> 10 — the approved supine fix 4aaf5ba16
 * (2026-10-08) deliberately removed the tee mesh. The floor follows the deliberate state;
 * deleting ANY further mesh (garment, hair, eye, brow, lash) still fails this clause.
 */
const SHIPPED_MESH_COUNT: Readonly<Record<string, number>> = {
  "mpfb-gown-adult-patient": 10,
  "mpfb-clinical-nurse-adult": 10,
  "mpfb-family-partner-adult": 10,
  "mpfb-clinical-physician-adult": 11,
};

/**
 * Shipped SKIN normal-map state. ADAPTED (ci-w4): two ED actors deliberately ship WITHOUT a
 * skin normal — the gown patient (unbound 1814a43c1, 2026-10-10, factory-skin-publication
 * proof) and the family partner (unbound fc57e5a9d, same proof lane). The clause pins the
 * SKIN state per-actor: nurse and physician must KEEP theirs (a silent future unbind
 * still fails), and the two recorded skin-normal-free actors are named so a future rebake
 * that restores/drops maps without updating this record fails loudly. A HAIR normal (the
 * MAPS-TOIGO family hair map) must never satisfy this clause.
 */
const SHIPPED_HAS_SKIN_NORMAL_MAP: Readonly<Record<string, boolean>> = {
  "mpfb-gown-adult-patient": false,
  "mpfb-clinical-nurse-adult": true,
  "mpfb-family-partner-adult": false,
  "mpfb-clinical-physician-adult": true,
};

/**
 * Body-skin material per ED actor, from cited sources — NOT a name pattern:
 * - gown: tools/openclinxr/asset-pipeline/anny/automate_blender.py names
 *   "mpfb-gown-adult-patient.glb, material mpfb_skin_robert_reference".
 * - nurse: own sidecar `--reference ed_chest_pain_nurse_adult` plus the bake rule in
 *   tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py
 *   (`skin_material_name = f"mpfb_skin_{subject_id}"`);
 *   corroborated by ACTOR_SKIN_SUB in rebake_actor_skin_normal.py.
 * - family: own sidecar `--reference ed_chest_pain_spouse_adult` plus the same bake rule.
 * - physician: ACTOR_SKIN_SUB in rebake_actor_skin_normal.py (explicit shipped-GLB skin-material record;
 *   the sidecar `--reference ed_chest_pain_nurse_adult` is stale for skin after the
 *   ward-delirium re-subjecting, and the live census confirms the rebind name).
 */
const SKIN_MATERIAL: Readonly<Record<string, string>> = {
  "mpfb-gown-adult-patient": "mpfb_skin_robert_reference",
  "mpfb-clinical-nurse-adult": "mpfb_skin_ed_chest_pain_nurse_adult",
  "mpfb-family-partner-adult": "mpfb_skin_ed_chest_pain_spouse_adult",
  "mpfb-clinical-physician-adult": "mpfb_skin_ward_delirium_senior_resident_adult",
};

type Asset = { tris: number; meshes: number; hasSkinNormalMap: boolean };

function probeDocument(name: string, doc: Document): Asset {
  const meshes = doc.getRoot().listMeshes();
  let tris = 0;
  for (const m of meshes) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      tris += idx ? idx.getCount() / 3 : (p.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
  }
  const skinName = SKIN_MATERIAL[name];
  if (skinName === undefined) throw new Error(`${name}: no cited body-skin material for this actor`);
  const candidates = doc
    .getRoot()
    .listMaterials()
    .filter((m) => m.getName() === skinName);
  if (candidates.length === 0)
    throw new Error(`${name}: cited body-skin material ${skinName} not found in the GLB`);
  if (candidates.length > 1)
    throw new Error(`${name}: more than one body-skin candidate named ${skinName} in the GLB`);
  const candidate = candidates[0]!;
  if (!meshes.some((m) => m.listPrimitives().some((p) => p.getMaterial() === candidate)))
    throw new Error(`${name}: cited body-skin material ${skinName} not bound to any primitive`);
  return { tris: Math.round(tris), meshes: meshes.length, hasSkinNormalMap: !!candidate.getNormalTexture() };
}

async function readAsset(name: string): Promise<Asset> {
  const doc = await new NodeIO().read(join(DIR, `${name}.glb`));
  return probeDocument(name, doc);
}

describe("a humanoid bake is judged before it is shipped", () => {
  /**
   * CORRECTED 2026-08-26 after a consult caught it. This clause used to REQUIRE the station to fit
   * the budget, and it is protected by a file-wide `live:` rule that passes only when every
   * `it.fails` in this file is flipped (`board-brief.ts:245`, `done-when-rules.ts:413`).
   *
   * So a card whose honest outcome is a measured REFUSAL could not satisfy its own contract: a
   * contaminated render flips clause (7) and leaves this one red forever. That is the same trap this
   * repo records for `changed:` rules, arriving through `live:`.
   *
   * THE RULE IT EARNS, and it generalises: an `it.fails` under a file-wide `live:` must assert that
   * a MEASUREMENT OR VERDICT EXISTS, never that the hoped-for result won.
   *
   * The number is still measured from the shipped assets and the budget is still the authored 180,000
   * (`asset-generation-pipeline.md:87`). What changed is that "over budget, by this much" now closes
   * the card as readily as "under".
   */
  it.fails("(1) the ED station's triangle total is measured against the budget and recorded", async () => {
    const RECORD = join(process.cwd(), ".openclinxr/evidence/mpfb-bake-question/station-budget.json");
    expect(
      existsSync(RECORD),
      "record the four ED actors, their sum, the 180,000 authored budget and an under|over verdict "
        + "with its margin — a measured 'over' closes this as readily as a fix",
    ).toBe(true);
    const rec = JSON.parse(readFileSync(RECORD, "utf8"));
    const measured = (await Promise.all(ED_STATION.map(readAsset))).reduce((a, b) => a + b.tris, 0);
    expect(
      rec.edStationTriangles,
      "the record must carry the number this instrument measures NOW, so a stale artifact cannot "
        + `answer for a tree it no longer describes (measured ${measured})`,
    ).toBe(measured);
    expect(
      ["under", "over"].includes(String(rec.verdict)),
      "an explicit under|over against the authored budget, not an omission",
    ).toBe(true);
  });

  /**
   * CORRECTED 2026-08-26, in place rather than appended, because the next reader starts at the top.
   *
   * This clause originally justified itself with: "largest-component share is the discriminator
   * between a safe cage bake and the o2-port cross-component contamination case." THAT IS FALSE, and
   * the falsifier was already in this repo when I wrote it. `trellis-baking` SKILL.md:292-305
   * records the predictor failing in BOTH directions across four assets — fetal-monitor at 93.9%
   * came back CONTAMINATED, iv-pump at 87.4% and glucometer at 79.8% came back CLEAN — and concludes
   * that a rule failing both ways is the wrong variable and the render is the only oracle.
   *
   * The census is still worth having: cheap, reproducible, and a real record of the asset
   * population. It is a RECORD, not a gate. Clause (7) holds the gate.
   */
  it("(2) a component census exists as a record of the asset population", () => {
    expect(
      existsSync(CENSUS),
      "worth recording before any bake — but this number decides nothing on its own; share has "
        + "predicted wrong on 2 of 4 in-range assets, so see clause (7)",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: no ED actor loses a mesh", async () => {
    for (const name of ED_STATION) {
      const a = await readAsset(name);
      expect(
        a.meshes,
        `${name}: deleting garment, hair, eye, brow or lash meshes is the cheapest way to clear `
          + "clause (1) and would strip the actor rather than decimate it",
      ).toBeGreaterThanOrEqual(SHIPPED_MESH_COUNT[name]!);
    }
  });

  it("(4) COUNTERWEIGHT: no ED actor loses its skin normal map", async () => {
    for (const name of ED_STATION) {
      const a = await readAsset(name);
      expect(
        a.hasSkinNormalMap,
        `${name}: the recorded skin normal-map state is ${SHIPPED_HAS_SKIN_NORMAL_MAP[name]} `
          + "(gown 1814a43c1, family fc57e5a9d — deliberate factory-skin-publication "
          + "unbinds; nurse/physician maps still doing work since 114265f4). A new bake "
          + "must not silently change which actors carry a SKIN normal; a hair normal "
          + "on the fitted hair material does not count",
      ).toBe(SHIPPED_HAS_SKIN_NORMAL_MAP[name]);
    }
  });

  /**
   * FU12 plants: the SKIN probe, not the any-material probe, decides clause (4).
   * All mutations are in-memory (NodeIO read of the live GLB, same probeDocument
   * the clause runs; no file writes). Each plant prints skin/hair normal state
   * before and after the mutation.
   */
  async function familyDoc(): Promise<Document> {
    return new NodeIO().read(join(DIR, "mpfb-family-partner-adult.glb"));
  }
  function skinAndHair(doc: Document, skinName: string) {
    const mats = doc.getRoot().listMaterials();
    const skin = mats.find((m) => m.getName() === skinName)!;
    const hair = mats.find((m) => /fitted_hair/i.test(m.getName() ?? ""))!;
    return { skin, hair };
  }
  function printStates(label: string, skinName: string, doc: Document): string {
    const { skin, hair } = skinAndHair(doc, skinName);
    const s =
      `${label}: skin(${skinName}).normal=${!!skin.getNormalTexture()} ` +
      `hair(${hair.getName()}).normal=${!!hair.getNormalTexture()}`;
    // eslint-disable-next-line no-console
    console.log(s);
    return s;
  }

  it("(4P1) plant: family skin rebound to the hair normal REDs the skin clause", async () => {
    const skinName = SKIN_MATERIAL["mpfb-family-partner-adult"]!;
    const doc = await familyDoc();
    const before = printStates("P1 before", skinName, doc);
    expect(before).toContain("skin(mpfb_skin_ed_chest_pain_spouse_adult).normal=false");
    const { skin, hair } = skinAndHair(doc, skinName);
    const hairTex = hair.getNormalTexture();
    expect(hairTex, "live family hair must carry its MAPS-TOIGO normal").not.toBeNull();
    skin.setNormalTexture(hairTex);
    hair.setNormalTexture(null);
    const after = printStates("P1 after", skinName, doc);
    expect(after).toContain("skin(mpfb_skin_ed_chest_pain_spouse_adult).normal=true");
    const probe = probeDocument("mpfb-family-partner-adult", doc);
    expect(probe.hasSkinNormalMap).toBe(true);
    // Clause (4) would RED: recorded false, measured true.
    expect(probe.hasSkinNormalMap).not.toBe(SHIPPED_HAS_SKIN_NORMAL_MAP["mpfb-family-partner-adult"]);
  });

  it("(4P2) plant: family hair-only normal (live) keeps the skin clause GREEN", async () => {
    const skinName = SKIN_MATERIAL["mpfb-family-partner-adult"]!;
    const doc = await familyDoc();
    printStates("P2 live", skinName, doc);
    const probe = probeDocument("mpfb-family-partner-adult", doc);
    expect(probe.hasSkinNormalMap).toBe(false);
    expect(probe.hasSkinNormalMap).toBe(SHIPPED_HAS_SKIN_NORMAL_MAP["mpfb-family-partner-adult"]);
  });

  it("(4P3) plant: nurse skin normal removed REDs the skin clause", async () => {
    const name = "mpfb-clinical-nurse-adult";
    const skinName = SKIN_MATERIAL[name]!;
    const doc = await new NodeIO().read(join(DIR, `${name}.glb`));
    const before = printStates("P3 before", skinName, doc);
    expect(before).toContain(`skin(${skinName}).normal=true`);
    skinAndHair(doc, skinName).skin.setNormalTexture(null);
    const after = printStates("P3 after", skinName, doc);
    expect(after).toContain(`skin(${skinName}).normal=false`);
    const probe = probeDocument(name, doc);
    expect(probe.hasSkinNormalMap).toBe(false);
    // Clause (4) would RED: recorded true, measured false.
    expect(probe.hasSkinNormalMap).not.toBe(SHIPPED_HAS_SKIN_NORMAL_MAP[name]);
  });

  it("(4P4) plant: family with both skin and hair normals REDs (hair cannot mask a skin rebind)", async () => {
    const skinName = SKIN_MATERIAL["mpfb-family-partner-adult"]!;
    const doc = await familyDoc();
    printStates("P4 before", skinName, doc);
    const { skin, hair } = skinAndHair(doc, skinName);
    skin.setNormalTexture(hair.getNormalTexture());
    const after = printStates("P4 after", skinName, doc);
    expect(after).toContain(`skin(${skinName}).normal=true`);
    expect(after).toContain(
      "hair(openclinxr_fitted_hair_toigo_curled_under_bob_mpfb_ed_chest_pain_spouse_adult_mat).normal=true",
    );
    const probe = probeDocument("mpfb-family-partner-adult", doc);
    // Clause (4) REDs on the skin state alone, hair normal notwithstanding.
    expect(probe.hasSkinNormalMap).toBe(true);
    expect(probe.hasSkinNormalMap).not.toBe(SHIPPED_HAS_SKIN_NORMAL_MAP["mpfb-family-partner-adult"]);
  });

  it("(4P5) plant: zero, many, or unknown skin candidates throw naming the actor", async () => {
    const doc = await familyDoc();
    expect(() => probeDocument("mpfb-unknown-actor", doc)).toThrow("mpfb-unknown-actor");
    const skinName = SKIN_MATERIAL["mpfb-family-partner-adult"]!;
    skinAndHair(doc, skinName).skin.setName(`${skinName}-renamed`);
    expect(() => probeDocument("mpfb-family-partner-adult", doc)).toThrow("mpfb-family-partner-adult");
    const doc2 = await familyDoc();
    skinAndHair(doc2, skinName).hair.setName(skinName);
    expect(() => probeDocument("mpfb-family-partner-adult", doc2)).toThrow("mpfb-family-partner-adult");
  });

  it("(4P6) plant: nurse and physician skin primitives repointed to slot 0 leave the cited skin declared but unbound and are refused", async () => {
    for (const name of ["mpfb-clinical-nurse-adult", "mpfb-clinical-physician-adult"]) {
      const skinName = SKIN_MATERIAL[name]!;
      const doc = await new NodeIO().read(join(DIR, `${name}.glb`));
      const root = doc.getRoot();
      const slot0 = root.listMaterials()[0]!;
      const skin = root.listMaterials().find((material) => material.getName() === skinName)!;
      expect(slot0.getNormalTexture(), `${name}: slot 0 normal`).toBeNull();
      expect(skin.getNormalTexture(), `${name}: cited skin normal`).not.toBeNull();
      for (const mesh of root.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          if (primitive.getMaterial() === skin) primitive.setMaterial(slot0);
        }
      }
      // Before the fix this plant returned hasSkinNormalMap true (Codex r4 F1).
      expect(() => probeDocument(name, doc)).toThrow(
        new RegExp(`${name}: cited body-skin material ${skinName} not bound to any primitive`),
      );
    }
  });

  it("(5) COUNTERWEIGHT: the station still casts four actors", () => {
    for (const name of ED_STATION) {
      expect(existsSync(join(DIR, `${name}.glb`)), `${name} must still ship`).toBe(true);
    }
    expect(
      ED_STATION.length,
      "removing an actor is the other cheapest way to clear clause (1), and it changes the "
        + "encounter rather than the asset",
    ).toBe(4);
  });

  it("(6) COUNTERWEIGHT: the shipped humanoid population has not shrunk", () => {
    const shipped = readdirSync(DIR).filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb"));
    expect(
      shipped.length,
      "eleven mpfb-*.glb shipped at the planting commit; clearing a budget by deleting assets is "
        + "not decimation",
    ).toBeGreaterThanOrEqual(11);
  });

  /**
   * (7) ADDED 2026-08-26. The gate this card was missing.
   *
   * A `reject_measured` verdict on this card must rest on a RENDER, not on component statistics.
   * Five assets have been baked and graded, and the share predictor was wrong on two of them in
   * OPPOSITE directions. Extrapolating it to humanoids at 0.199-0.446 — far below 61.6%, the lowest
   * value ever tested — is weaker than the four in-range predictions that already failed.
   *
   * One humanoid, one cage bake, one render is cheap and is the only instrument that has ever
   * discriminated a clean map from a contaminated one on this generator's output.
   *
   * This clause is satisfied by the REFUSAL as readily as by the adoption: a render showing
   * contamination is a graded verdict and closes the card successfully.
   */
  it.fails("(7) a bake verdict rests on a graded render, not on component statistics", () => {
    const graded = join(process.cwd(), ".openclinxr/evidence/mpfb-bake-question/one-humanoid-bake-grade.json");
    expect(
      existsSync(graded),
      "share predicted wrong on 2 of 4 in-range assets and this extrapolates below every tested "
        + "value; bake ONE humanoid, render it, and let the pixels decide",
    ).toBe(true);
  });
});

// NOT TESTED: whether 180,000 is the right budget. It has never been validated on Quest hardware
// (grep "never been validated on hardware" in the PROTO_VERIFY_DELEGATION incident archive), so clause (1) proves a DECLARED budget is breached and nothing
// about real frame cost. Nor whether decimation is the right remedy: fewer actors, a shared body
// mesh, and GPU instancing are alternatives these clauses do not evaluate.

// ## FIXED (#692) — clause (2) only
//
// The census exists at `.openclinxr/evidence/mpfb-bake-question/component-census.json`, produced by
// `tools/openclinxr/evidence/mpfb-component-census.ts` with the same NodeIO instrument this file
// uses, positions welded at 5dp across all primitives and meshes before the union-find.
//
// MEASURED, eleven shipped assets: largest-component share 0.199–0.446, 1,218–2,125 welded
// components each. On ten of eleven the largest component is the body mesh (26,756 tris, 21–37% of
// the asset). On the gown patient it is the GOWN mesh at 57,935 tris — 44.6% of that asset and 2.2x
// its body — which makes the gown the single largest mesh on the single largest actor.
//
// WHAT THIS DOES NOT SAY. The worker's commit concluded from these numbers that every asset is the
// o2-port contamination class and a cage bake would be contaminated. THAT INFERENCE IS WITHDRAWN and
// is not reproduced here. Largest-component share is a retired predictor — see the clause (2)
// docblock above and `trellis-baking` SKILL.md:292-305, where it predicts wrong in both directions.
// These numbers are a record of the asset population and decide nothing about a bake.
//
// Clauses (1) and (7) stay red. (7) names what is actually missing: one humanoid, one cage bake,
// one graded render. No bake was run and no asset bytes were changed by this landing.
