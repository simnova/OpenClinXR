import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#82) — four metrics for "is the shoulder covered", four passes on bare shoulders.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#82)` block below, and leave the measured table intact.
 *
 * THE HISTORY, because it is the reason this contract is shaped the way it is:
 *
 *   #73  max garment Y in a mid-X band            defeated by a collar point above the clavicle
 *   #75  nearest-garment proximity to body samples defeated by any cloth within ~11 cm
 *   #76  max garment Y over the lateral footprint  defeated by TWO THIN FLAPS
 *   --   a proposed hide-mask                      WRONG DEFECT CLASS (see below)
 *
 * Every implementation was faithful. Every contract was a SCALAR over extrema or minima, so a single
 * vertex could satisfy it. The orchestrator wrote all four.
 *
 * THE RESEARCH REFRAME AND ITS LIMIT. Industry does not measure coverage — it hides or deletes body
 * under garment (Second Life alpha masks, Reallusion auto-hide, RPM/VRM authored visibility), and the
 * term is POKE-THROUGH, not "coverage". But a peer round refuted applying that here: hide-masking
 * fixes skin showing THROUGH cloth that is already present; it does NOT fix cloth that never reaches.
 * On a bare deltoid a correct mask leaves the skin, and an over-eager one deletes skin with no cloth
 * behind it and leaves A HOLE. Industry hide-masks assume a garment that already owns the region, and
 * `automate_blender.py:2060-2182` builds a torso ring plus separate sleeve tubes from
 * `_arm_p(±0.18, 0.74)` with NOTHING SPANNING THE ACROMION.
 *
 * SO THE FIX IS GEOMETRY: a shoulder cap that occupies the silhouette. #76 built a yoke and it came
 * out as two thin flaps angled away from the body — right idea, wrong construction.
 *
 * THE MEASURE IS AN AREA-WEIGHTED OUTWARD-NORMAL RAYCAST FRACTION, and the fraction is the point:
 *
 *   for body faces in the shoulder region with outward normal n:
 *       hit   = raycast(p + eps*n, direction n, maxDist D) -> garment
 *       score = area-weighted mean(hit exists)
 *
 * It fails closed on all three real counterexamples: rays from the deltoid miss a collar; hanging
 * cloth is off-axis from the shoulder normal; a 1-2 cm strip catches too few rays to move a fraction.
 *
 * ITS OWN STATED FAILURE MODES, which none of my four had: a dense lattice of thin strips can still
 * score high; genuinely baggy sleeves count as covering despite an air gap (correct for visibility);
 * double-sided or inward-facing meshes need a backface policy; it does not detect interpenetration.
 * If you hit any of these, SAY SO in the FIXED block rather than tightening the number.
 *
 * THREE FIXED, EXTERNAL, HUMAN-GRADED NEGATIVES — calibrate against these BEFORE choosing any
 * threshold, which is what makes this different from the four that came before:
 *
 *   56b6998  parent  graded "topless under an open cardigan, bare shoulders"
 *   8ff963f  parent  graded "torso dressed, shoulders still bare"
 *   3f84082  nurse   graded "bare shoulders, two thin flaps"   <- #76's own output
 *
 * The third is the most valuable: measured `shoulderTopY 1.3663` vs `garmentMaxYOverShoulder 1.3858`,
 * so it is GREEN under a max-versus-max comparison and BARE to the eye.
 *
 * THE THREE CONTRACTS PULL APART. The first two bind the INSTRUMENT whatever the assets look like —
 * refuse three graded blobs, and do not let a flap move the number. The third binds the PRODUCT and
 * needs the cap. So the metric cannot be made to pass by changing assets, and the assets cannot be
 * made to pass by weakening the metric. If you find yourself editing the metric to turn the third
 * contract green, STOP — that is the failure four slices in a row.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `assessShoulderRaycastCoverage({ glbPath })`
 * returning per-side fractions, and a pure `coverageFractionVerdict` so it can be probed without an
 * asset. `three-mesh-bvh` is the natural fit for this stack; trimesh/Open3D/Blender BVH are the
 * alternatives. What must not change: rays leave the BODY along its own normals, the score is
 * AREA-WEIGHTED, and no threshold is chosen before the three negatives are refused.
 *
 * IF SATISFYING THIS WILL MAKE THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then satisfy it
 * anyway. #76's flaps were a visible regression that nobody flagged until I graded the render.
 *
 * SCOPE: whether garment occupies the shoulder silhouette. Says nothing about drape, fabric, or
 * poke-through — that last is the research's actual subject and is deliberately a later slice.
 *
 * ## FIXED (#82)
 *
 * Instrument: `shoulder-raycast-coverage.ts` — area-weighted outward-normal raycast fraction.
 * Implementation: pure Möller–Trumbore against garment tris (no three-mesh-bvh at tools root;
 * nested under iwsdk only). Same semantics as BVH raycastFirst. Shoulder belt: body faces with
 * yn∈[0.68,0.90], lateral ≥0.32 half-width, outward normal ny≥0.15. MAX_DIST=0.12, EPS=0.003.
 * Floor COVERAGE_FRACTION_FLOOR=0.5 chosen AFTER measuring the three graded negatives.
 *
 * Calibration (before any product bake — instrument must refuse all three):
 *
 *   ref       asset    left frac  right frac  verdict
 *   56b6998   parent   0.1623     0.1544      refuse
 *   8ff963f   parent   0.2260     0.2133      refuse
 *   3f84082   nurse    0.1758     0.1689      refuse   (#76 flaps: max-Y green, fraction refuse)
 *
 * Thin-flap pure probe: 0.05 / 0.30 → false; 0.95 → true (floor is not "always false").
 *
 * Product geometry (`automate_blender.py`): body-face offset deltoid cap — for each body face in
 * the shoulder belt, emit parallel cloth tris offset along the face outward normal (0.016 / 0.034 m
 * dual shell) + supplemental 8×12 ellipsoidal dome for visual continuity. Replaces #76 free yoke
 * straps and a mid-slice welded torso↔sleeve loft that still scored ~0.23 (surface sat off-axis
 * from deltoid outward rays). Do NOT raise top_y for coverage.
 *
 * Post-bake regenerated (Blender-only on real Anny bases, export_yup=False):
 *
 *   asset    left frac  right frac  verdict
 *   parent   0.9298     0.9298      pass
 *   nurse    0.9225     0.9225      pass
 *
 * Stated failure modes preserved (not tightened away): dense thin-strip lattice can still score
 * high; baggy sleeves cover despite air gap; two-sided raycast; no interpenetration detection.
 * Hide-mask / poke-through deliberately out of scope (peer: mask assumes garment already owns
 * the region — this slice creates that precondition).
 */

const load = async () =>
  import("./shoulder-raycast-coverage.js") as Promise<Record<string, unknown>>;

type SideCoverage = { side: "left" | "right"; coveredFraction: number; sampleCount: number };
type Assess = (input: { glbPath: string }) => Promise<{ sides: SideCoverage[] }>;
type Verdict = (input: { coveredFraction: number }) => boolean;

const PARENT = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";
const NURSE = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

describe("garment occupies the shoulder silhouette (#82)", () => {
  it("the raycast coverage fraction refuses all three assets graded as bare-shouldered", async () => {
    const mod = await load();
    const assess = mod["assessShoulderRaycastCoverage"] as Assess | undefined;
    const verdict = mod["coverageFractionVerdict"] as Verdict | undefined;
    expect(assess).toBeTypeOf("function");
    expect(verdict).toBeTypeOf("function");

    // Extract the two historical blobs alongside HEAD — fixed, external, already graded bare.
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "openclinxr-82-"));
    const graded: string[] = [];
    for (const [ref, path] of [
      ["56b6998", "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb"],
      ["3f84082", "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb"],
    ] as const) {
      const out = join(dir, `${ref}.glb`);
      writeFileSync(out, execFileSync("git", ["show", `${ref}:${path}`], { maxBuffer: 256 * 1024 * 1024, encoding: "buffer" }));
      graded.push(out);
    }

    for (const glbPath of graded) {
      const { sides } = await assess!({ glbPath });
      expect(sides.length, `${glbPath} produced no shoulder samples`).toBeGreaterThan(0);
      for (const side of sides) {
        expect(side.sampleCount, `${glbPath} ${side.side} had no samples`).toBeGreaterThan(0);
        expect(
          verdict!({ coveredFraction: side.coveredFraction }),
          `${glbPath} ${side.side}: fraction ${side.coveredFraction} passed on an asset graded bare`,
        ).toBe(false);
      }
    }
  }, 600_000);

  it("a thin flap rising above the shoulder does not raise the coverage fraction", async () => {
    // Kills #76's defeat directly. A flap is high but narrow: it catches almost no outward rays, so
    // the fraction must stay near the floor. Probed on the verdict alone so it cannot be satisfied by
    // a lucky asset.
    const mod = await load();
    const verdict = mod["coverageFractionVerdict"] as Verdict | undefined;
    expect(verdict).toBeTypeOf("function");

    expect(verdict!({ coveredFraction: 0.05 })).toBe(false);
    expect(verdict!({ coveredFraction: 0.3 })).toBe(false);
    // And a genuinely capped shoulder must pass, or "always false" satisfies the line above.
    expect(verdict!({ coveredFraction: 0.95 })).toBe(true);
  });

  it("the regenerated parent and nurse reach the coverage fraction on both deltoids", async () => {
    // The product half. Needs a cap spanning the acromion, not a flap and not a higher neckline —
    // top_y has already been raised twice for this and changed nothing visible.
    const mod = await load();
    const assess = mod["assessShoulderRaycastCoverage"] as Assess | undefined;
    const verdict = mod["coverageFractionVerdict"] as Verdict | undefined;
    expect(assess).toBeTypeOf("function");
    expect(verdict).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const { sides } = await assess!({ glbPath });
      expect(sides.map((s) => s.side).sort()).toEqual(["left", "right"]);
      for (const side of sides) {
        expect(
          verdict!({ coveredFraction: side.coveredFraction }),
          `${glbPath} ${side.side}: fraction ${side.coveredFraction} still below the floor`,
        ).toBe(true);
      }
    }
  }, 600_000);
});
