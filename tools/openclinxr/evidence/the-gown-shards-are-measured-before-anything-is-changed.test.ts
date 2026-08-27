import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the gown's bodice renders as torn cloth with skin-coloured slivers showing through it,
 * and nobody has measured why.
 *
 * GRADED 2026-08-27 by the orchestrator at native 4096 with 1:1 crops. IMMUTABLE — flip the assertion
 * and append a `## FIXED (#691)` block below; do not rewrite this description.
 *
 *   pnpm asset:model-vetting:glb-grade -- --glb apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb
 *   run dir .openclinxr/evidence/glb-grade-capture/2026-08-27T06-06-10Z/, self-check agrees=true,
 *   relative error 0.00018, asset 64,802 triangles.
 *
 * WHAT THE PIXELS SHOW, by region:
 *   bodice centre-front  a dense field of self-intersecting angular shards the full height of the
 *                        placket, with TAN AND GOLD SLIVERS VISIBLE THROUGH THE BLUE at the neck
 *                        opening and down the button line
 *   bodice sides         fan-shaped triangular shards across the whole chest, not fabric folds
 *   skirt                CLEAN — a smooth drape, one vertical column of small notches on the
 *                        wearer's left, shards only where the skirt meets the bodice
 *
 * The defect is BODICE-LOCALISED and fades downward. That asymmetry is the only structural fact the
 * grade establishes, and clause (2) is built on it.
 *
 * ## THE CARD'S OWN DESCRIPTION IS SUPERSEDED
 *
 * #691 was filed as "16 triangle-wave gathers read as dense vertical crinkle". At 1:1 it does not
 * read as crinkle. It reads as torn cloth, and the tan slivers are a separate observation the card
 * never made.
 *
 * ## NOT SUPERSEDED BY #695
 *
 * The asset was decimated to 64,802 triangles on 2026-08-26 and the defect survives. The crops under
 * `.openclinxr/evidence/humanoid-grade-sweep/crops/` are dated 2026-08-23 and depict the PRE-
 * decimation mesh; they are not evidence about this asset.
 *
 * ## THE MECHANISM IS NOT KNOWN AND MUST NOT BE ASSUMED
 *
 * Interpenetration between the gown shell and the body is a HYPOTHESIS I formed from the tan slivers.
 * I have not measured it, and mechanisms I have filed from pixels have been withdrawn before. Two
 * other candidates are equally unexamined — degenerate triangles, and inward-facing normals showing
 * the gown's interior. **All three may be wrong.** This slice measures; it changes no asset.
 *
 * ## GEOMETRY, so the measurement has somewhere to start
 *
 *   gown  openclinxr_real_garment_peds_upper_v1_mesh   28,967 tris   y 0.568 .. 1.542
 *   body  mpfb_ob_patient_aisha_body (largest prim)     9,810 tris   y 0.000 .. 1.776
 *
 * The gown mesh's name says `peds_upper_v1`. That name is historical and is NOT a size claim; do not
 * re-litigate it.
 *
 * ## NO BAND BOUNDARY IS INVENTED HERE
 *
 * The artifact reports per-decile counts over the gown's own y-range, so the concentration is visible
 * without anyone choosing where the waist is. Clause (2) compares the upper half against the lower
 * half of those deciles, which is a property of the reported data rather than a threshold.
 *
 * claimScope: whether the three candidate mechanisms have been measured on this asset, and whether
 *   any of them is concentrated where the shards are.
 * notEvidenceFor: that any mechanism is the cause — a concentration is consistent with a cause and
 *   does not establish one; that the defect predates decimation, which no prior render can settle;
 *   that it is visible at learner viewing distance, which no station capture has established.
 */

const REPO = join(import.meta.dirname, "../../..");
const GLB = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
const REPORT = join(REPO, "tools/openclinxr/evidence/gown-shard-mechanism-measurement.json");

/** The graded asset. Counterweight (3) pins it: this slice measures and changes no bytes. */
const GLB_SHA256 = "7bd12d06aec497a939aa62301c73274cf23e6dd7b1da6d5c085db6c17f57fd4a";
const GLB_BYTES = 7_116_988;

const MECHANISMS = ["interpenetration", "degenerate_triangles", "inward_facing_normals", "none_of_these", "inconclusive_blocked", "other"] as const;
const CONCENTRATED = new Set(["interpenetration", "degenerate_triangles", "inward_facing_normals"]);

type Decile = {
  index: number;
  yLow: number;
  yHigh: number;
  gownVerticesInsideBody: number;
  degenerateTriangles: number;
  inwardFacingTriangles: number;
};

type Report = {
  gownMesh?: string;
  gownVertexCount?: number;
  bodyVertexCount?: number;
  deciles?: Decile[];
  supportedMechanism?: string;
  mechanismNote?: string;
};

function reportOrNull(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function halfTotals(deciles: Decile[], field: keyof Decile): { upper: number; lower: number } {
  const sorted = [...deciles].sort((a, b) => a.index - b.index);
  const mid = Math.floor(sorted.length / 2);
  const sum = (rows: Decile[]) => rows.reduce((acc, d) => acc + Number(d[field] ?? 0), 0);
  return { lower: sum(sorted.slice(0, mid)), upper: sum(sorted.slice(mid)) };
}

describe("the gown shards are measured before anything is changed (#691)", () => {
  it("(1) all three candidate mechanisms are measured, per decile of the gown's height", () => {
    const report = reportOrNull();
    expect(
      report !== null,
      `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64), and .openclinxr/evidence is gitignored.",
    ).toBe(true);
    expect(report!.gownMesh, "name the mesh measured").toBe("openclinxr_real_garment_peds_upper_v1_mesh");
    const deciles = report!.deciles ?? [];
    expect(deciles.length, "ten bands over the gown's own y-range, so no waist boundary is invented").toBe(10);
    for (const d of deciles) {
      expect(d.yHigh, `decile ${d.index}: yHigh above yLow`).toBeGreaterThan(d.yLow);
      for (const field of ["gownVerticesInsideBody", "degenerateTriangles", "inwardFacingTriangles"] as const) {
        expect(
          typeof d[field],
          `decile ${d.index}: ${field} must be measured, not omitted — a candidate left unmeasured `
            + "cannot be ruled out, and ruling one out is as valuable as confirming one",
        ).toBe("number");
        expect(d[field], `decile ${d.index}: ${field} cannot be negative`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("(2) the named mechanism is concentrated where the shards are, or is an escape value", () => {
    const report = reportOrNull();
    expect(report !== null, `${REPORT} must exist`).toBe(true);
    expect(MECHANISMS, "supportedMechanism").toContain(report!.supportedMechanism);
    expect(
      report!.mechanismNote?.length ?? 0,
      "every verdict cites the measured numbers behind it; an escape value needs a note most of all",
    ).toBeGreaterThan(0);
    if (!CONCENTRATED.has(String(report!.supportedMechanism))) return;
    const field = ({
      interpenetration: "gownVerticesInsideBody",
      degenerate_triangles: "degenerateTriangles",
      inward_facing_normals: "inwardFacingTriangles",
    } as const)[report!.supportedMechanism as "interpenetration" | "degenerate_triangles" | "inward_facing_normals"];
    const { upper, lower } = halfTotals(report!.deciles ?? [], field);
    expect(
      upper,
      `${report!.supportedMechanism} is offered as the mechanism, but the shards are bodice-localised `
        + `and the skirt is clean. ${field} measured ${upper} in the upper half against ${lower} in `
        + "the lower. A mechanism spread evenly over the garment does not explain a defect that is "
        + "not — report none_of_these or inconclusive_blocked instead.",
    ).toBeGreaterThan(lower);
  });

  it("(3) COUNTERWEIGHT: this slice changes no asset bytes", () => {
    const bytes = readFileSync(GLB);
    expect(bytes.byteLength, "the graded asset's size").toBe(GLB_BYTES);
    expect(
      createHash("sha256").update(bytes).digest("hex"),
      "rebaking or re-decimating the gown would change the thing being measured mid-diagnosis, and "
        + "the grade in the header would stop describing the asset in the tree",
    ).toBe(GLB_SHA256);
  });

  it("(4) COUNTERWEIGHT: the measurement is not vacuously empty", () => {
    const report = reportOrNull();
    if (report === null) return;
    expect(report.gownVertexCount ?? 0, "gown vertices sampled").toBeGreaterThan(0);
    expect(
      report.bodyVertexCount ?? 0,
      "the body surface is the reference for two of the three candidates; zero body vertices means "
        + "nothing was tested against anything",
    ).toBeGreaterThan(0);
  });
});

// NOT TESTED: whether any measured mechanism is the CAUSE — concentration is consistent with a cause
// and does not establish one, and this file deliberately asserts no fix. Nor whether the defect
// predates decimation, which the 2026-08-23 crops cannot settle because they depict a different mesh.
// Nor whether the tan slivers are body skin, an underlayer, or the gown's own backface. Nor whether
// any of this is visible at learner viewing distance, which no station capture has established.

/*
 * ## FIXED (#691)
 *
 * Clauses (1) and (2) flipped from `it.fails` to `it` on 2026-08-27. The measurement is in
 * `tools/openclinxr/evidence/gown-shard-mechanism-measure.ts` + `gown-shard-mechanism-measurement.json`
 * (TRACKED). No asset bytes changed: the GLB is pinned at sha256 `7bd12d06…fd4a`, 7,116,988 bytes,
 * and clause (3) verifies it on every run.
 *
 * PER-DECILE, +X-ray even-odd (primary), over the gown's own y-range 0.568..1.542 m:
 *
 *   decile  y-range      verts  inside  degen(<1e-8)  inward(axis)
 *   0       0.568..0.666   405      5        7           18
 *   1       0.666..0.763   168      4        9            8
 *   2       0.763..0.860   183     14        3            1
 *   3       0.860..0.958   163      0        5            5
 *   4       0.958..1.055   898      1        8           50
 *   5       1.055..1.153  2051     47        2          410
 *   6       1.153..1.250  2795     46        5         1843
 *   7       1.250..1.348  4115    356       11         2212
 *   8       1.348..1.445  2359     14       24          754
 *   9       1.445..1.542  1608      0       79         1026
 *
 * SUPPORTED MECHANISM: interpenetration. `gownVerticesInsideBody` measures 463 (upper half) vs 24
 * (lower half); the +Z-ray cross-check measures 817 vs 111 and the nearest-body-surface cross-check
 * 593 vs 3 — all three instruments concentrate in the upper half, where the grade localises the
 * shards. The code trace (automate_blender.py #686, `_fold_amp686 = 0.034` m triangle-wave on a
 * 10-22 mm conformal normal offset) puts the wave valleys 12-24 mm inside the body surface across
 * the gather band (body f 0.55..0.86, y 0.98..1.51), fading at both band edges — the band is where
 * the shards are densest and where they fade. The accordion flanks are the angular "shard" geometry;
 * the body skin visible in the V-gaps between crests is the "tan/gold slivers" the grade reports.
 *
 * The other two candidates were measured and not supported: degenerate triangles are negligible
 * (153 below 1e-8 m^2 of 28,967; 10 below 1e-12) and sit near the collar, not the placket; the
 * axis-reference inward-normal count (6,327) is upper-heavy but dominated by geometrically-correct
 * inner-sleeve tube surfaces and accordion flank normals near dot~0 — the nearest-surface variant
 * is biased at free rims, so neither is the discriminator.
 *
 * The gown material is `doubleSided: true`, OPAQUE — so the inward facets shade rather than cull,
 * and the "slivers through the blue" read as the body/t-shirt visible in the accordion V-gaps where
 * the valley fabric has retreated behind the body surface.
 */
