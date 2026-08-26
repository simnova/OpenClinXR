import { NodeIO } from "@gltf-transform/core";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
 * (`PROTO_VERIFY_DELEGATION.md:3424` records that plainly), so clause (1) proves a declared budget
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
 */
const SHIPPED_MESH_COUNT: Readonly<Record<string, number>> = {
  "mpfb-gown-adult-patient": 11,
  "mpfb-clinical-nurse-adult": 10,
  "mpfb-family-partner-adult": 10,
  "mpfb-clinical-physician-adult": 11,
};

type Asset = { tris: number; meshes: number; hasNormalMap: boolean };

async function readAsset(name: string): Promise<Asset> {
  const doc = await new NodeIO().read(join(DIR, `${name}.glb`));
  const meshes = doc.getRoot().listMeshes();
  let tris = 0;
  let hasNormalMap = false;
  for (const m of meshes) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      tris += idx ? idx.getCount() / 3 : (p.getAttribute("POSITION")?.getCount() ?? 0) / 3;
      if (p.getMaterial()?.getNormalTexture()) hasNormalMap = true;
    }
  }
  return { tris: Math.round(tris), meshes: meshes.length, hasNormalMap };
}

describe("a humanoid bake is judged before it is shipped", () => {
  it.fails("(1) the ED station's actors fit the authored station triangle budget", async () => {
    const assets = await Promise.all(ED_STATION.map(readAsset));
    const total = assets.reduce((a, b) => a + b.tris, 0);
    expect(
      total,
      `${total} triangles of actors alone against an authored budget of ${STATION_TRIANGLE_BUDGET} `
        + "(asset-generation-pipeline.md:87), before any room, equipment or prop",
    ).toBeLessThanOrEqual(STATION_TRIANGLE_BUDGET);
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

  it("(4) COUNTERWEIGHT: no ED actor loses its normal map", async () => {
    for (const name of ED_STATION) {
      const a = await readAsset(name);
      expect(
        a.hasNormalMap,
        `${name}: these assets already carry a normal map that three.js consumes without TANGENT `
          + "(114265f4); a new bake must not silently drop the one already doing work",
      ).toBe(true);
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
// (PROTO_VERIFY_DELEGATION.md:3424), so clause (1) proves a DECLARED budget is breached and nothing
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
