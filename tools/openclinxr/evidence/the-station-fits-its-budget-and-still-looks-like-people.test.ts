import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: an assembled station fits the triangle budget its own docs declare.
 *
 * ## MEASURED 2026-08-26 on dbabd957 — do not re-derive
 *
 * The ED four-actor station is 360,524 triangles of ACTORS ALONE against an authored budget of
 * 180,000 visible triangles per Quest 3 station bundle (`asset-generation-pipeline.md:87`). Over by
 * 180,524 before a wall, a bed or a monitor. Peds three-actor is 238,804.
 *
 *     gown patient  129,885   nurse 75,854   family partner 72,331   physician 82,454
 *
 * 51,281 of that is mine: #686 subdivided the gown bodice 3,419 -> 29,309 verts to stop it
 * conforming to the body, and I graded and landed it without checking triangle cost.
 *
 * ## THE MECHANISM EXISTS AND WAS NEVER WIRED
 *
 * "Nothing decimates a humanoid" was true of the PIPELINE and false of the assets, and I repeated it
 * for cycles as though it were a property of the meshes. `@gltf-transform/functions` `simplify` with
 * `meshoptimizer` works on them today; only the wiring is TRELLIS-only. Measured across all four:
 *
 *     ratio 0.34, error 0.001    360,524 -> 152,306   2.37x   UNDER
 *     ratio 0.34, error 0.01     360,524 -> 133,666   2.70x   UNDER
 *
 * A RATIO WITHOUT ITS ERROR BOUND IS NOT REPRODUCIBLE. A peer measured the child at 3.13x; at the
 * same ratio 0.34 with error 0.001 I measure 2.18x. Meshopt will not overshoot the error budget to
 * reach a ratio. Both numbers must be recorded together.
 *
 * ## THE SILHOUETTE IS THE BINDING CONSTRAINT AND NO CLAUSE HERE MEASURES IT
 *
 * I decimated the gown patient to 46,184 triangles (2.81x) and graded the lit render at native
 * resolution: the outline HELD — head, shoulders, three-quarter sleeves with cuffs, skirt hem, legs
 * and shoes all read as before, no holes, no detached fragments. What degraded was surface detail:
 * the hands became angular wedges, the shins showed faint faceting, the face flattened slightly.
 *
 * That is the opposite of the shoe, where a 25k+512 rung recovered the shading and left the OUTLINE
 * faceted. A normal map shades facets and cannot move an outline; a human is more organic than a
 * shoe and still held. But one subject at one rung is a lead, not a rule.
 *
 * **Clause (4) is the gate, and it is deliberately satisfied by a RECORDED VERDICT rather than by a
 * statistic.** #692 gated a bake on largest-component share, a variable `trellis-baking`
 * SKILL.md:292-305 records failing in both directions across four assets, and I built a withdrawn
 * conclusion on it the same day. A count under budget with a faceted silhouette is the same trap as
 * a green contract over bad pixels. Hands are where to look first.
 *
 * ## THIS CARD CARRIES NO `live:` PROOF, DELIBERATELY
 *
 * #692's `live:` rule demanded every `it.fails` be flipped, which made its honest `reject_measured`
 * stop unsatisfiable and threw at the end of an otherwise correct 46-turn run. Two clauses here are
 * `it.fails` and they can legitimately flip at different times — the budget can be met while the
 * silhouette is still ungraded. A `live:` rule would forbid that intermediate state.
 *
 * claimScope: whether the shipped ED station total fits 180,000 triangles, and whether a graded
 *   silhouette verdict exists for every actor whose triangles were reduced.
 * notEvidenceFor: whether any ratio is the right one (that is a sweep I grade); how decimation reads
 *   at room framing; runtime skinning of decimated meshes; the peds station's own rung.
 */

const GENERATED = join(import.meta.dirname, "../../../apps/ui-xr/public/generated-humanoids");
const VERDICTS = join(import.meta.dirname, "../../../.openclinxr/evidence/issue-695/silhouette-verdicts.json");

/** The four actors an ED-shaped station casts. */
const ED_STATION = [
  "mpfb-gown-adult-patient", "mpfb-clinical-nurse-adult",
  "mpfb-family-partner-adult", "mpfb-clinical-physician-adult",
] as const;

/** `asset-generation-pipeline.md:87`, authored, not chosen here. */
const STATION_BUDGET_TRIS = 180_000;

/** Mesh counts on dbabd957. Deleting a mesh is the cheapest way to clear clause (1). */
const SHIPPED_MESH_COUNT: Readonly<Record<string, number>> = {
  "mpfb-gown-adult-patient": 11, "mpfb-clinical-nurse-adult": 10,
  "mpfb-family-partner-adult": 10, "mpfb-clinical-physician-adult": 11,
};

/** Primitives carrying TEXCOORD_0 on dbabd957. Dropping UVs is the second cheapest. */
const SHIPPED_UV_PRIMITIVES: Readonly<Record<string, number>> = {
  "mpfb-gown-adult-patient": 16, "mpfb-clinical-nurse-adult": 15,
  "mpfb-family-partner-adult": 15, "mpfb-clinical-physician-adult": 16,
};

interface AssetShape {
  readonly triangles: number;
  readonly meshes: number;
  readonly uvPrimitives: number;
}

async function readAsset(name: string): Promise<AssetShape> {
  const doc = await new NodeIO().read(join(GENERATED, `${name}.glb`));
  let triangles = 0;
  let uvPrimitives = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      triangles += (idx?.getCount() ?? pos?.getCount() ?? 0) / 3;
      if (prim.getAttribute("TEXCOORD_0")) uvPrimitives += 1;
    }
  }
  return { triangles: Math.round(triangles), meshes: doc.getRoot().listMeshes().length, uvPrimitives };
}

describe("the station fits its budget and still looks like people (#695)", () => {
  it.fails("(1) the ED four-actor station fits the 180,000-triangle budget", async () => {
    const shapes = await Promise.all(ED_STATION.map((n) => readAsset(n)));
    const total = shapes.reduce((sum, s) => sum + s.triangles, 0);
    expect(
      total,
      `ED four-actor station is ${total.toLocaleString()} triangles of ACTORS ALONE against the `
        + `${STATION_BUDGET_TRIS.toLocaleString()} authored at asset-generation-pipeline.md:87 — over `
        + `by ${(total - STATION_BUDGET_TRIS).toLocaleString()} before a wall, a bed or a monitor. `
        + "Decimate via @gltf-transform simplify + meshoptimizer; do not strip meshes (clause 2), "
        + "do not drop UVs (clause 3), and do not undo #686's subdivision to recover triangles.",
    ).toBeLessThanOrEqual(STATION_BUDGET_TRIS);
  }, 180_000);

  it("(2) COUNTERWEIGHT: no ED actor loses a mesh", async () => {
    // Deleting the garment, hair, brow, lash or eye meshes is the cheapest way to clear clause (1)
    // and would strip the actor rather than decimate it. The floor is what shipped on dbabd957.
    const stripped: string[] = [];
    for (const name of ED_STATION) {
      const a = await readAsset(name);
      if (a.meshes < SHIPPED_MESH_COUNT[name]!) stripped.push(`${name}: ${a.meshes} < ${SHIPPED_MESH_COUNT[name]}`);
    }
    expect(stripped, "clause (1) must be cleared by decimation, not by deletion").toEqual([]);
  }, 180_000);

  it("(3) COUNTERWEIGHT: no ED actor loses UV coverage", async () => {
    // The second cheapest clearance: discard TEXCOORD_0 so the simplifier is unconstrained by seams.
    // Measured today, decimation at ratio 0.34 PRESERVES UVs (16/17 on the child, 16/18 on the gown
    // patient), so this costs a correct implementation nothing and refuses a lossy shortcut.
    const lost: string[] = [];
    for (const name of ED_STATION) {
      const a = await readAsset(name);
      if (a.uvPrimitives < SHIPPED_UV_PRIMITIVES[name]!) {
        lost.push(`${name}: ${a.uvPrimitives} < ${SHIPPED_UV_PRIMITIVES[name]}`);
      }
    }
    expect(lost, "decimation preserves UVs at the ratios measured; losing them is a shortcut").toEqual([]);
  }, 180_000);

  it.fails("(4) a graded silhouette verdict exists for every actor whose triangles were reduced", () => {
    // THE GATE, and it is deliberately a recorded verdict rather than a statistic. #692 gated a bake
    // on largest-component share — a variable that predicts wrong in both directions — and a
    // conclusion built on it was withdrawn the same day. A count under budget with a faceted
    // silhouette is a green contract over bad pixels.
    //
    // Satisfied by a REFUSAL as readily as by an adoption: a verdict recording that a ratio wrecks
    // the hands is a graded verdict and closes this clause. What it refuses is silence.
    expect(
      existsSync(VERDICTS),
      "no silhouette verdict recorded at .openclinxr/evidence/issue-695/silhouette-verdicts.json. "
        + "One entry per reduced actor: the ratio, the error bound, the before and after triangle "
        + "counts, and a graded verdict naming what held and what degraded. Hands degrade first — "
        + "measured on the gown patient at 2.81x, where the outline held and the fingers became "
        + "angular wedges. Widening or deleting this clause is wrong: it is the only thing here "
        + "standing between a budget-compliant station and one that stopped looking like people.",
    ).toBe(true);
  });
});
