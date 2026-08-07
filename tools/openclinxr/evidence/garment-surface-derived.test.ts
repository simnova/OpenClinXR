import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#121) — the garment is a free-standing ring-and-tube cage placed near the body,
 * not a surface derived from it. That is why it reads as a sheet hanging off the shoulders, and it is
 * why six gates have passed on it.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the body must not be deleted under the garment. It is
 * `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * READ THIS FIRST: THIS IS AN AUTHORING-CLASS CHANGE, AND NO GATE HERE CLAIMS "LOOKS WORN"
 *
 * A research round was unambiguous on both halves:
 *
 *   - **Ring + tube parametric shells are the ceiling.** `automate_blender.py` builds an elliptical
 *     torso ring plus side sleeve tubes from body-height fractions. That scales correctly — I measured
 *     the garment top at 82.6% of body height on the adult and 82.2% on the child, so my earlier
 *     "child-sized garment on an adult" theory was wrong. But this class of geometry cannot produce a
 *     continuous cap over the deltoid, a neckline that follows the neck root, or a silhouette where
 *     the body is INSIDE the garment volume rather than beside a hanging sheet. **No amount of sleeve
 *     flare or higher top_y on the same topology fixes it.**
 *
 *   - **Garment fit is graded by eye in this industry.** Machine checks bound the absurd — a garment
 *     exists, it has volume, it is not a one-triangle marker, it is weighted to bones. They do not
 *     prove "worn". Production pipelines author fitted assets and review renders; they do not ship a
 *     raycast-fraction threshold.
 *
 * So: **the pixel grade closes this issue and it is mine.** These contracts assert that the garment is
 * DERIVED FROM the body surface and is CONTINUOUS across the shoulder. Both are structural facts about
 * how the mesh was built. Neither claims it looks right.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE PREVIOUS SIX GATES DIED, AND WHY THESE TWO ARE DIFFERENT
 *
 * From our own rules (§6t): max-Y in a mid-X band, nearest-garment proximity, max-Y over the lateral
 * shoulder footprint, a body hide-mask, and an area-weighted outward-normal raycast fraction. Every
 * one was a body-relative test of garment PRESENCE, and a detached blade satisfies presence — it is
 * near, it is high, it intercepts outward normals — while being attached to nothing.
 *
 * §6t's own conclusion, never implemented: **test continuity of the covering surface.** Contract (1)
 * is that test. A pair of flaps cannot form one connected component spanning front → over the deltoid
 * → back, and a ring that terminates at the shoulder line cannot either.
 *
 * §6t also records a fact that must shape the implementation: a previous worker authored a lofted
 * sector that DID share torso-rim and sleeve-root indices and it still exported as detached blades.
 * **Sharing indices at authoring time is not sufficient for a continuous exported surface in this
 * pipeline, and why remains undiagnosed.** Measure continuity from the EXPORTED glTF, never from the
 * Blender script's intent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ALTERNATIVE ALGORITHM, WHICH NEEDS NO NEW DEPENDENCIES
 *
 * Surface-fitting procedural, still pure Blender python:
 *   1. take the body mesh around torso and shoulders
 *   2. offset it along outward normals (solidify / shrinkwrap / duplicate-and-push)
 *   3. cut neck and arm holes from body landmarks — clavicle, neck root, armpit
 *   4. transfer skin weights from the body
 *   5. optionally hide the body faces underneath
 *
 * That is a different algorithm from ring+tube, using the same tools. The research round ranked it as
 * the best available bet here because the alternatives are closed: **StableGen is GPL-3 and blocked**,
 * the **`anny` package does not import in this environment**, and **MakeClothes/MPFB is the right
 * technique class but is licence-gated** behind a garment allowlist that is not closed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * REGENERATION PATH — take the right one, per §6r
 *
 * `tools/openclinxr/asset-pipeline/anny/rebake_role_wardrobe_blender_only.py` re-bakes on the tracked
 * `*.anny_base.obj` bases. Do NOT run full `orchestrate_character`: without the `anny` package it
 * silently emits ~0.8 MB stub GLBs that pass file checks. The six humanoids under
 * `apps/ui-xr/public/generated-humanoids/` are TRACKED, so they have a real land path.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - The offset distance, and whether it is constant or varies over the body. Cloth is not equidistant
 *    from skin everywhere.
 *  - Where the neck and arm holes are cut from. Landmark bones exist; a hard-coded height fraction
 *    would reintroduce the class this slice is replacing.
 *  - Whether the body faces under the garment are hidden. #73 removed painted clothing where a real
 *    garment existed and left a figure topless under an open cardigan — so if you hide body faces,
 *    prove the garment covers what you hid.
 *  - Whether the lower-body PAINT survives untouched. It is deliberate (`automate_blender.py:1703-1708`)
 *    and this slice is about the upper garment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands one connected surface across the shoulder and is satisfiable by a closed tube that never
 * touches the body. (2) demands the surface be derived from the body — every garment vertex within a
 * plausible offset band of a body surface point — which a free-standing cage cannot satisfy. (3) is
 * green today and forbids buying either by deleting the body underneath, which is #73's exact failure.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectGarmentSurfaceDerivation()`. What must not
 * change: measurements come from the EXPORTED glTF via NodeIO — not from Blender, which creates
 * objects on import and double-converts axes — and every shipped humanoid is enumerated rather than
 * listed.
 *
 * REQUIRED, the observable half: re-capture psych and oncology and state what the garment looks like.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill — a verdict scoped to one region hid a defect last
 * slice:
 *     IN-SCOPE VISUAL: shoulders ___ ; neckline ___ ; overall garment ___
 * and the enum: CONTRACT_MET_VISUAL: still_wrong | improved_not_natural | reads_as_worn | other:<text>
 *
 * If you satisfy these contracts and it still reads as a sheet, SAY SO. That is the single most useful
 * thing you could tell me, because it would mean the authoring class needs to change again and I would
 * rather know than ship a seventh green gate.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: how the garment mesh is constructed. Says NOTHING about whether it looks like clothing — that
 * is my pixel grade — nor about fabric, colour, or clinical appropriateness, which needs a clinician.
 */

const load = async () => import("./garment-surface-derived.js") as Promise<Record<string, unknown>>;

type GarmentDerivation = {
  assetPath: string;
  garmentMeshName: string;
  /** Connected components of the garment mesh, by shared vertex indices in the EXPORTED glTF. */
  connectedComponentCount: number;
  /** True when one component spans front torso, over the deltoid, to the back. */
  shoulderSpannedByOneComponent: boolean;
  /** Per-vertex distance to the nearest body surface point: how derived the surface is. */
  offsetMinMeters: number;
  offsetMaxMeters: number;
  /** Fraction of garment vertices within a plausible cloth offset of the body. */
  fractionWithinOffsetBand: number;
  /** Body triangle count, so the counterweight can see deletion. */
  bodyTriangleCount: number;
};
type Inspect = () => Promise<{ assets: GarmentDerivation[] }>;

/** Cloth sits close to skin. A free-standing cage does not. */
const MIN_FRACTION_WITHIN_OFFSET_BAND = 0.9;

describe("the garment is a surface derived from the body (#121)", () => {
  it.fails("one connected surface spans the shoulder", async () => {
    // §6t's never-implemented conclusion. Two flaps satisfy every presence test ever written here and
    // fail this one, because they are not one surface.
    const mod = await load();
    const inspect = mod["inspectGarmentSurfaceDerivation"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.assets.length, "no shipped humanoids were inspected").toBeGreaterThan(0);

    const broken: string[] = [];
    for (const a of report.assets) {
      if (!a.shoulderSpannedByOneComponent) {
        broken.push(
          `${a.assetPath} ${a.garmentMeshName}: shoulder not spanned by a single component `
          + `(${a.connectedComponentCount} components)`,
        );
      }
    }
    expect(broken, `garments that are not one surface over the shoulder:\n${broken.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("the garment surface follows the body it is worn on", async () => {
    // Kills the cheap satisfaction of the first contract: a closed tube floating around the torso is
    // one connected component and is not worn by anything.
    const mod = await load();
    const inspect = mod["inspectGarmentSurfaceDerivation"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const floating: string[] = [];
    for (const a of report.assets) {
      if (a.fractionWithinOffsetBand < MIN_FRACTION_WITHIN_OFFSET_BAND) {
        floating.push(
          `${a.assetPath} ${a.garmentMeshName}: only ${(a.fractionWithinOffsetBand * 100).toFixed(0)}% `
          + `of vertices track the body (offset ${a.offsetMinMeters.toFixed(3)}–${a.offsetMaxMeters.toFixed(3)}m)`,
        );
      }
    }
    expect(floating, `garments not derived from the body surface:\n${floating.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("the body underneath is not deleted (COUNTERWEIGHT — #73's lesson)", async () => {
    // #73 removed painted clothing where a real garment existed and left a figure topless under an
    // open cardigan. Hiding or deleting body faces to make a garment "fit" repeats that exactly.
    const mod = await load();
    const inspect = mod["inspectGarmentSurfaceDerivation"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const a of report.assets) {
      expect(
        a.bodyTriangleCount,
        `${a.assetPath} lost its body mesh`,
      ).toBeGreaterThan(20_000);
    }
  }, 900_000);
});
