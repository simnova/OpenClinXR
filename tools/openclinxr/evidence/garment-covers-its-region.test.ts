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
 */

const load = async () =>
  import("./garment-covers-its-region.js") as Promise<Record<string, unknown>>;

describe("garment covers the region it claims (#272)", () => {
  it("the shipped 392-triangle cargo trousers DO NOT cover the leg region (RED)", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentCoversItsRegion"] as
      | (() => Promise<{
          figures: Array<{
            bodyClassId: string;
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
      if (lower.verdict !== "does_not_cover") {
        broken.push(
          `${f.bodyClassId}: trousers judged "${lower.verdict}" — the 392-triangle shell must not cover`,
        );
      }
      if (lower.outwardRaycastCoverage >= 0.9) {
        broken.push(
          `${f.bodyClassId}: trousers outward coverage ${lower.outwardRaycastCoverage.toFixed(3)} ≥ 0.9 — `
          + "this is the sparse shell that reads see-through in the capture",
        );
      }
    }
    expect(broken, `the shipped trousers were not rejected:\n${broken.join("\n")}`).toEqual([]);
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
