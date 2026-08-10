import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#272). The RED is the shipped 392-triangle cargo trouser.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED ON THE SHIPPED ARTIFACTS — trust these, do not re-derive
 *
 * The spouse in `ed_chest_pain_priority_v2` renders see-through. The live scene dump
 * (`pre-fix.json`) names the loaded meshes: `hm08_basemesh_adult_lean_female` (26,756 t),
 * `makeclothes_library_cargo_pants_adult_lean_female` (392 t), scrub shirt (9,384 t).
 * Nothing transparent is visible on the spouse — the "see-through" is geometry, not
 * materials. The trousers are 392 triangles / 211 position-welded vertices / **32 open
 * boundary edges**: a sparse partial shell that leaves ~26-30% of the leg surface bare
 * (outward-raycast coverage ≈ 0.71). The scrub shirt on the same body is 9,384 triangles,
 * a CLOSED shell (0 boundary edges) hugging the body — it reads as a garment.
 *
 * `ClothesService.fit_clothes_to_human` (clothesservice.py:120-257) never alters garment
 * topology — it only repositions each garment vertex to a weighted sum of three body
 * vertices plus the mhclo offset. The 392-triangle trouser is therefore the source
 * asset's own geometry (a sparse open shell), not something the fit "emitted".
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIX, AND WHAT THIS TEST PROVES
 *
 * `body_param_stage.py` now measures every fitted garment against the body region it
 * claims, using the SAME predicate this test drives (`garment_coverage.py`, pure numpy,
 * shared by the Blender factory stage and this evidence test):
 *
 *   covers  ⇔  garment_adherence ≥ 0.90 AND (garment_boundary_edges == 0
 *                                            OR outward_raycast_coverage ≥ 0.90)
 *
 * A garment that does not cover is REPLACED by a deterministic body-derived cover shell
 * (the body's own region surface offset 1.5 cm outward — covers by construction), and
 * accepted garments get a uniform outward cloth standoff so they stop z-fighting with
 * the skin. Nothing is gated on triangle counts (meshoptimizer runs later; D9).
 *
 * The three assertions below are the coverage contract:
 *   (1) the SHIPPED cargo trousers do NOT cover the leg region (the RED),
 *   (2) the SHIPPED scrub shirt DOES cover the torso region (the counterweight — the
 *       MakeClothes fit mechanism is not broken in general; a fix that regresses the
 *       shirt is not a fix),
 *   (3) the deterministic cover shell the stage ships as the fallback COVERS (≥ 0.95).
 *
 * The predicate is geometric: it runs on mesh geometry, never on garment names, and a
 * synthetic sparse open shell must fail while a synthetic closed shell must pass.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#277)
 *
 * The gate was consumed: `pnpm asset:body-param:fit -- --once` re-baked both body classes
 * THROUGH the stage gate. Two stage-integration defects surfaced on the first real run and
 * were fixed mechanically (no threshold, no assertion, no predicate semantics changed):
 *
 *   (a) the stage measures the Z-up Blender scene (height along Z), but the gate's region
 *       band used world Y (the body's THICKNESS axis) — the upper shirt measured 13,400
 *       boundary edges / 0.085 raycast while the evidence module measures the same shirt
 *       (on the exported Y-up GLB) at 0 boundary edges / covers. Fix: `height_axis` is now
 *       an explicit parameter of the shared predicate (default 1 = Y-up exported GLBs, the
 *       evidence frame); the stage passes 2.
 *   (b) `_numpy_mesh` fed raw quad polygons (shirt 4,692 quads = 9,384 tris) to a
 *       triangle-only predicate, making the closed shirt read 13,400 boundary edges. Fix:
 *       fan triangulation in the stage's mesh reader. Body faces too (13,378 quads =
 *       26,756 tris).
 *
 * Re-baked measurements (rebake-report.json, evidence module on the shipped GLBs):
 *
 *   adult_lean_female  lower `makeclothes_library_cargo_pants_adult_lean_female` 392 t
 *                      does_not_cover (0.7089, 32 open edges) → REPLACED by body-derived
 *                      cover shell 1,356 v / 2,617 f, now covers (0.9877)
 *   adult_lean_female  upper scrub shirt 9,384 t, covers (0 boundary edges) — unchanged
 *   adult_heavy_male   lower 392 t does_not_cover (0.4698, 32 open edges) → REPLACED by
 *                      cover shell 2,002 v / 3,779 f, now covers (0.9899)
 *   adult_heavy_male   upper scrub shirt 9,384 t, covers — unchanged
 *
 * The ED spouse (`spouse_anna_hayes_v1`) resolves to
 * `/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb` — the exact
 * file this bake rewrites (no blob indirection for this slot), so the promoted asset IS
 * the one the running station loads.
 *
 * Assertion (1) below is flipped from the RED ("trousers do NOT cover") to the post-fix
 * state: the shipped lower garment now COVERS (the cover shell) and the 392-triangle
 * sparse trouser is gone. Assertions (2) and (3) are unchanged — the shirt counterweight
 * and the shell ≥ 0.95 guarantee both still bind.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#283)
 *
 * The coverage predicate let CLOSURE ALONE carry the verdict: a 14%-covering shirt
 * (issue headline, measured against the then-shipped scrub shirt) was graded `covers`
 * because `covers = adheres and (closure_ok or coverage_ok)` and the shirt was a closed
 * shell. Measured on the CURRENT shipped GLBs the same disjunction grades the heavy-male
 * scrub shirt `covers` at 0.3500 raycast coverage with 0 open boundary edges.
 *
 * THE BAND WAS THE PROBLEM, NOT THE DISJUNCTION. The region band was only bounded in
 * height (the garment's own vertical extent); every body face in that band was in the
 * region, including the ARMS — which hang through any torso band and which no shirt
 * without sleeves claims. The arms are 0%-covered, ~17% of the region's area and ~54%
 * of its faces (small-face over-count in the face-weighted sample), so they depressed
 * the number an order of magnitude.
 *
 * Fixed in `garment_coverage.py`: the region a garment claims is now laterally bounded
 * by the garment's own per-slice silhouette (`_lateral_footprint`). Re-measured on the
 * shipped GLBs, the coverage clause ALONE now passes for every current upper garment —
 * closure no longer carries any of them:
 *
 *   adult_lean_female upper (civilian cover shell, #275)  0.9974  (was 0.9974)
 *   adult_heavy_male  upper (scrub shirt)                 0.9266  (was 0.3500)
 *
 * The disjunction `covers = adheres and (closure_ok or coverage_ok)` is UNCHANGED
 * (issue-283 decision tree: band was too large → leave the predicate). The counterweights
 * hold: lower cover shells still pass ≥ 0.90, the sparse-shell class (the 392-triangle
 * trouser's class) is still refused, and no upper garment fails so the stage never ships
 * a bare torso.
 *
 * Known residual, deliberately not fixed here: a genuinely too-small closed tube can
 * still pass on closure over its own (narrow) claim, and the male scrub shirt does not
 * reach the shoulder caps (torso-proper coverage excluding arms ≈ 0.76-0.82, area 0.82).
 * That is a garment-fit/quality residual — the gate's claimScope explicitly does not
 * claim garment quality/aesthetics — and the orchestrator's pixel grade is the check for
 * it, not this predicate.
 */

const load = async () =>
  import("./garment-covers-its-region.js") as Promise<Record<string, unknown>>;

describe("garment covers the region it claims (#272/#277)", () => {
  it("the re-baked lower garment (body-derived cover shell) DOES cover the leg region (#277)", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentCoversItsRegion"] as
      | (() => Promise<{
          figures: Array<{
            bodyClassId: string;
            lowerGarmentTriangleCount: number;
            lower: { verdict: string; outwardRaycastCoverage: number };
          }>;
        }>)
      | undefined;
    expect(inspect).toBeTypeOf("function");
    const report = await inspect!();
    expect(report.figures.length).toBeGreaterThanOrEqual(2);
    const broken: string[] = [];
    for (const f of report.figures) {
      const lower = f.lower;
      expect(lower, `${f.bodyClassId}: no lower garment measured`).toBeTruthy();
      if (!lower) continue;
      if (lower.verdict !== "covers") {
        broken.push(
          `${f.bodyClassId}: lower garment judged "${lower.verdict}" — the cover shell must cover`,
        );
      }
      if (lower.outwardRaycastCoverage < 0.9) {
        broken.push(
          `${f.bodyClassId}: lower outward coverage ${lower.outwardRaycastCoverage.toFixed(3)} < 0.9 — `
          + "the body-derived shell must present a surface over the legs",
        );
      }
      if (f.lowerGarmentTriangleCount === 392) {
        broken.push(
          `${f.bodyClassId}: lower garment is still the 392-triangle sparse trouser — the gate did not replace it`,
        );
      }
    }
    expect(broken, `the re-baked lower garments do not cover:\n${broken.join("\n")}`).toEqual([]);
  }, 300_000);

  it("the shipped 9,384-triangle scrub shirt DOES cover the torso region (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentCoversItsRegion"] as
      | (() => Promise<{ figures: Array<{ bodyClassId: string; upper: { verdict: string } }> }>)
      | undefined;
    const report = await inspect!();
    const broken: string[] = [];
    for (const f of report.figures) {
      const upper = f.upper;
      expect(upper, `${f.bodyClassId}: no upper garment measured`).toBeTruthy();
      if (!upper) continue;
      if (upper.verdict !== "covers") {
        broken.push(
          `${f.bodyClassId}: scrub shirt judged "${upper.verdict}" — a dense closed shell on the same `
          + `body must cover; a fix that regresses the shirt is not a fix`,
        );
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 300_000);

  it("the deterministic body-derived cover shell covers the leg region ≥ 0.95 (THE GUARANTEE)", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentCoversItsRegion"] as
      | (() => Promise<{ coverShell: { coverage: { verdict: string; outwardRaycastCoverage: number } } | null }>)
      | undefined;
    const report = await inspect!();
    expect(report.coverShell, "no cover-shell measured — the stage fallback must be buildable").toBeTruthy();
    const shell = report.coverShell!;
    expect(shell.coverage.verdict).toBe("covers");
    expect(shell.coverage.outwardRaycastCoverage).toBeGreaterThanOrEqual(0.95);
  }, 300_000);
});
