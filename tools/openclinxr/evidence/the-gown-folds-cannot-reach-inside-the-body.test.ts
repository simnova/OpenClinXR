import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the bodice fold wave swings further inward than the standoff it rides on, so its
 * valleys land inside the body.
 *
 * MEASURED by #691 on the shipped asset, three independent instruments. IMMUTABLE — flip the
 * assertion and append a `## FIXED (#714)` block below; do not rewrite these numbers.
 *
 *   instrument                      upper half   lower half
 *   +X-ray even-odd (primary)          463           24
 *   +Z-ray                             817          111
 *   nearest-surface                    593            3
 *
 * Peak at decile 7, y 1.250..1.348 — the chest, which is where the pixels are worst. The material is
 * `doubleSided: true`, so intrusions render as skin-coloured slivers rather than holes.
 *
 * ## THE MECHANISM, read at source
 *
 * `tools/openclinxr/asset-pipeline/anny/automate_blender.py:2613-2618`:
 *
 *     s     = 1.0 + _lift686 * wy * wx                       # radial lift — this MAKES the standoff
 *     wfold = wx * min(1.0, _smooth686(...)) * (1.0 - ...)
 *     d     = _fold_amp686 * _tri_wave686(...) * wfold       # radial fold — signed, swings BOTH ways
 *     v.co.x = cx + rx * s + nx * d
 *
 * The lift pushes each vertex out by `rr * (s - 1.0)`. The fold then displaces it by `d`, whose
 * trough is `-_fold_amp686 * wfold`. Nothing relates the two, so wherever the trough exceeds the
 * lift the vertex ends up inside the body. `_fold_amp686 = 0.034` at `:2588` against a standoff that
 * tapers to nothing at the band edges (`0.55 < f < 0.86`, `:2599`).
 *
 * ## THE FIX IS A CLAMP, AND IT INTRODUCES NO NEW MILLIMETRE
 *
 * Operator direction, `operator-steering-needed-questions.md:323`: the gown `kind` is already
 * parameterized and the work is **"not new millimetres"**. A sweep of amplitudes is therefore the
 * wrong shape and is not what this contract asks for.
 *
 * Every term needed to bound the inward excursion is already in that loop — `rr`, `s`, `_lift686`,
 * `wy`, `wx`. A clamp derived from them makes penetration structurally impossible while leaving
 * `_fold_amp686` the artistic control it was added to be. Counterweight (3) pins the amplitude and
 * the wave count so a reduction cannot be passed off as a fix.
 *
 * Other candidates, unranked and possibly all wrong: make the offset track the amplitude instead;
 * push the whole shell out; taper the wave where the standoff is thinnest.
 *
 * ## WHY ZERO IS A PROPERTY AND NOT A FITTED TARGET
 *
 * Clause (1) asks for zero gown vertices inside the body in the upper half. That is the physical
 * property the clamp establishes, not a number chosen to be just out of reach — a clamp that works
 * cannot leave one. The other two instruments are RECORDED and NOT asserted: #691 established that
 * the +Z-ray and nearest-surface references are biased at free rims, so a residual there is not
 * evidence of penetration.
 *
 * ## GARMENT BAKES ARE ALLOWED
 *
 * `an-exemption-is-not-universal.test.ts:71` calls `OPENCLINXR_RUN_GARMENT_BAKES=1` "a standing
 * prohibition on this machine". That claim is RETRACTED at `operator-steering-needed-questions.md:323`
 * and `garment-bake-matrix.ts:52` calls it "a COST gate, not a correctness gate". It is opt-in
 * because a broad `vitest` run once drove an M1 Max to load 60 respawning Blender per variant, so set
 * it deliberately and never let a broad evidence-directory run start a sweep by accident.
 *
 * claimScope: whether the fold wave can still place a gown vertex inside the body in the bodice.
 * notEvidenceFor: that the gathers still read as gathers — only the orchestrator's grade of the
 *   render in clause (2) can say that, and no clause here asserts an appearance; that the same fold
 *   code is safe on other garments, none of which is measured here.
 *
 * ## FIXED (#714)
 *
 * The clamp landed in `_build_body_surface_derived_garment` (automate_blender.py:2624-2632 and
 * 2666-2672): the fold trough is bounded by the standoff the lift created, in BOTH fold loops —
 *
 *     d  = _fold_amp686  * _tri_wave686(...) * wfold        # trunk (bodice)
 *     if d  < -rr      * (s - 1.0):                 d  = -rr      * (s - 1.0)
 *     d2 = _sleeve_amp686 * math.cos(_sleeve_k686 * phi)    # sleeve (arm axis)
 *     if d2 < -rad_len * _sleeve_lift686:          d2 = -rad_len * _sleeve_lift686
 *
 * `_fold_amp686` (0.034), `_fold_k686` (16) and the sleeve amplitudes are untouched; the bounds are
 * derived from each loop's own terms (`rr`, `s`, `_lift686`, `wy`, `wx` for the trunk;
 * `rad_len`, `_sleeve_lift686` for the sleeve) and introduce no new millimetre. The bake log on the
 * rebaked asset records `clamped=1582` of 12,764 trunk verts — the trough bound bit on 12.4% of
 * the fold band.
 *
 * THE REBAKE, from current main (2026-08-28): the shipped `mpfb-gown-adult-patient.glb` (robert
 * body, 4 materials with base-colour textures per #740) was used as the bake input through
 * `bake_mpfb_gown_inspect.py` — which now purges the input's orphaned gown mesh data so the
 * rebuilt shell keeps the canonical mesh name (`openclinxr_real_garment_peds_upper_v1_mesh`).
 * Only the GOWN mesh was replaced in the shipped file (the full-res bake's gown, decimated
 * per-mesh at meshopt ratio 0.61 / error 0.001, with JOINTS_0 remapped into the shipped skin's
 * joint order); every other mesh — body, hair, eyebrows, lashes, t-shirt, shoes, eyes — is
 * byte-identical to the shipped asset. Body height 1.776 m preserved; body skin 9,810 tris
 * unchanged; gown 14,746 -> 14,899 verts / 28,976 -> 29,185 tris (the 0.5 ratio of the #695 rung
 * would have undershot the shipped vertex count on this body, so 0.61 lands the gown at the
 * shipped resolution — the #695 error bound is kept).
 *
 * MEASURED with the #691 instrument (`gown-shard-mechanism-measure.ts`, BODY_PRIM updated to the
 * robert skin, report path + pin moved to this card), pre-fix on the current-tree asset at commit
 * 1c33dda6 vs post-fix on the rebake:
 *
 *     instrument                       pre-fix      post-fix
 *     +X-ray even-odd (primary)         471 / 32     395 / 31
 *     two-tests-agree (corrected)       129 /  0      73 /  0
 *
 * The corrected metric (`gownVerticesInsideBodyTwoTests`) counts a vertex inside only when a
 * parity test AND the nearest-surface signed distance AGREE (either ray + nearest < -2 mm).
 * Single-axis parity is invalid on the non-watertight body hull — it carries 2,074 open boundary
 * edges (1,058 inside the fold band), and a ray crossing an open seam reads odd without the point
 * being inside. That is why clause (1) below was corrected per the 2026-08-28 direction: the
 * 294-vertex X_ONLY class (one +X crossing, nearest-surface 12-61 mm OUTSIDE) is removed from the
 * count, while the real-penetration class stays visible.
 *
 * The residual 73 upper (post-fix) are NOT fold valleys — each was traced per vertex
 * (`gown-fold-residual-diagnose.ts`, three instruments + the body's boundary-edge map):
 *
 * | class | n | +X | +Z | nearest | where |
 * |---|---|---|---|---|---|
 * | X_ONLY | 292 | in | out | OUTSIDE | torso-side / armpit seam |
 * | X_N_AGREE | 68 | in | out | 3-4 mm inside by sign | |x| 0.22-0.24, y 1.29-1.33 — armpit seam |
 * | XZ_ONLY | 30 | in | in | within 2 mm | sleeve |
 * | ALL_IN | 5 | in | in | 4-6 mm inside | |x| ~0.35, y ~1.19 — sleeve root |
 *
 * Every one of the 68 X_N_AGREE and 5 ALL_IN has `radiallyInside: false` in the per-vertex trace:
 * its radius from the body axis is OUTSIDE the body's radius along that ray. The +X parity reads
 * odd through a single open-seam crossing (nX=1 for all 68) and the nearest-surface sign flips at
 * concave creases (armpit hollow, sleeve root) — the shell/hull overlap class, not the fold. The
 * front-centre fold-valley column reads 0 on the corrected metric, where #691 measured its
 * chest-peak. The pre-fix 129 -> post-fix 73 drop is the fold-valley contribution the clamp
 * removed.
 *
 * Clause (1) below asserts ZERO on the corrected metric, per the 2026-08-28 direction. The count
 * after the clamp is 73, so the clause STAYS INVERTED — a residual a fold-side clamp cannot clear
 * without pushing the shell out (the card's rejected candidate) is a finding, not a green. The
 * counterweights (3) and (4) are untouched: `_fold_amp686` and `_fold_k686` are unchanged, the
 * lower half is not worse, and no geometry is deleted.
 *
 * Clause (4)'s lower-half bound is compared against the CURRENT tree's pre-fix lower (32, #740-era
 * asset) rather than #691's 24: the asset changed between #691 and this slice, and "not worse" is
 * a same-generation comparison. Post-fix lower = 31 <= 32.
 */

const REPO = join(import.meta.dirname, "../../..");
const BLENDER = join(REPO, "tools/openclinxr/asset-pipeline/anny/automate_blender.py");
const REPORT = join(REPO, "tools/openclinxr/evidence/gown-fold-clamp-measurement.json");

/** #691's pre-change baseline, primary instrument. */
const BASELINE_UPPER = 463;
const BASELINE_LOWER = 24;
/**
 * #714 — the lower-half comparator is the CURRENT tree's pre-fix lower, not #691's 24. The asset
 * changed between #691 and this slice (#740 re-materialization), and the pre-fix current-tree
 * measurement (taken 2026-08-28 on commit 1c33dda6 with the same instrument) reads 32 lower.
 * "The lower half does not get worse" is a same-generation comparison: post-fix lower = 31 <= 32.
 * Do NOT lower this further to clear a red.
 */
const CURRENT_TREE_PRE_FIX_LOWER = 32;
/**
 * Gown vertices at the planting commit.
 *
 * CORRECTED 2026-08-27, and the correction is mine rather than a worker's. The first form of
 * counterweight (4) required `>= 14_745` exactly. #714's first attempt rebaked to 14,505 — 240
 * fewer, 1.6% — with NO deletion anywhere in its diff (the clamp is three lines that bound `d`),
 * and with 243 upper-half penetrations still outstanding. Vertices had plainly not been deleted to
 * clear the clause, because the clause was not cleared.
 *
 * So the exact bound was measuring rebake drift, not the cheat. A rebake perturbs the count; the
 * cheat this guards against is deleting the offending band, which is hundreds to thousands of
 * vertices concentrated where the penetrations were. A 5% floor still refuses that and stops
 * charging a worker for the pipeline's own jitter.
 *
 * Do NOT lower this further to clear a red. If a rebake ever drops more than 5%, that is a finding
 * about the rebake and belongs in a report, not in this constant.
 */
const BASELINE_GOWN_VERTICES = 14_745;
const MIN_GOWN_VERTEX_FRACTION = 0.95;

type Report = {
  gownVertexCount?: number;
  upperVsLower?: {
    gownVerticesInsideBody?: { upper?: number; lower?: number };
    gownVerticesInsideBodyTwoTests?: { upper?: number; lower?: number };
  };
  renderPath?: string;
  renderNote?: string;
};

function reportOrNull(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function blenderSource(): string {
  return readFileSync(BLENDER, "utf8");
}

describe("the gown folds cannot reach inside the body (#714)", () => {
  it.fails("(1) no gown vertex sits inside the body in the bodice half", () => {
    const report = reportOrNull();
    expect(
      report !== null,
      `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64). Re-measure with the existing instrument, gown-shard-mechanism-measure.ts.",
    ).toBe(true);
    // #714 CORRECTION (2026-08-28): a vertex counts as inside only when TWO independent tests
    // AGREE — a parity ray test AND the nearest-surface signed distance (sign < -2 mm), on
    // either the +X or +Z ray. Single-axis X-ray parity is invalid on the non-watertight body
    // hull (2,074 open boundary edges, 1,058 inside the fold band): a ray crossing an open
    // seam reads odd without the point being inside, which is how the 294-vertex X_ONLY class
    // (one +X crossing, nearest-surface 12-61 mm OUTSIDE) polluted the #691 single-axis count.
    // The corrected field is `gownVerticesInsideBodyTwoTests`.
    const split = report!.upperVsLower?.gownVerticesInsideBodyTwoTests;
    expect(typeof split?.upper, "upper-half two-tests-agree count must be measured").toBe("number");
    expect(
      split!.upper,
      `zero on the corrected metric is the property a derived clamp establishes — the fold trough `
        + `cannot consume more standoff than the lift created, so the fold wave cannot place a `
        + `vertex inside the body. #691 measured ${BASELINE_UPPER} upper on the single-axis +X `
        + `instrument; the same instrument's corrected two-tests-agree count was 129 upper before `
        + `the clamp and ${split!.upper} after. Any residual is a finding, not a relaxed `
        + `clause — see the FIXED block for the per-vertex classification.`,
    ).toBe(0);
  });

  it("(2) a fresh render exists for the orchestrator to grade", () => {
    const report = reportOrNull();
    expect(report !== null, `${REPORT} must exist`).toBe(true);
    expect(
      report!.renderPath,
      "the gathers are why _fold_amp686 exists, and no count can say whether they survive — the "
        + "orchestrator grades the pixels and needs a render of the rebaked asset to do it",
    ).toBeTruthy();
    expect(existsSync(join(REPO, String(report!.renderPath))), `${report!.renderPath} must exist`).toBe(true);
    expect(report!.renderNote?.length ?? 0, "say what was captured and how").toBeGreaterThan(0);
  });

  it("(3) COUNTERWEIGHT: the amplitude and the wave count are not reduced", () => {
    const src = blenderSource();
    expect(
      /_fold_amp686\s*=\s*0\.034\b/u.test(src),
      "lowering _fold_amp686 until nothing penetrates is the cheap fix, and it flattens the gathers "
        + "the parameter exists to create. The operator's direction is explicit: not new millimetres "
        + "(operator-steering-needed-questions.md:323). The bound must be DERIVED from the lift.",
    ).toBe(true);
    expect(
      /_fold_k686\s*=\s*16\b/u.test(src),
      "reducing the wave count is the same cheap fix by another route — fewer troughs, fewer "
        + "intrusions, fewer gathers",
    ).toBe(true);
  });

  it("(4) COUNTERWEIGHT: the lower half does not get worse and no geometry is deleted", () => {
    const report = reportOrNull();
    if (report === null) return;
    const split = report.upperVsLower?.gownVerticesInsideBody;
    expect(
      split?.lower ?? 0,
      `the skirt already renders clean at ${CURRENT_TREE_PRE_FIX_LOWER} lower on the current tree `
        + `(pre-fix, same instrument) — a clamp that fixes the bodice by pushing the problem `
        + "downward is not a fix",
    ).toBeLessThanOrEqual(CURRENT_TREE_PRE_FIX_LOWER);
    expect(
      report.gownVertexCount ?? 0,
      "deleting the offending vertices satisfies clause (1) and removes the garment's gathers with "
        + `them. Floor is ${MIN_GOWN_VERTEX_FRACTION * 100}% of the ${BASELINE_GOWN_VERTICES} at `
        + "planting — see the constant's note for why an exact bound was the wrong instrument.",
    ).toBeGreaterThanOrEqual(Math.floor(BASELINE_GOWN_VERTICES * MIN_GOWN_VERTEX_FRACTION));
  });
});

// NOT TESTED: whether the gathers still read as gathers — that is the orchestrator's grade of the
// render from clause (2), and this file deliberately asserts no appearance. Nor whether the same fold
// code is safe on any other garment; only this asset is measured. Nor whether the +Z-ray and
// nearest-surface instruments also reach zero — #691 established both are biased at free rims, so
// they are recorded and not asserted. Nor whether the clamp changes the silhouette at the band edges
// where the standoff tapers to nothing, which is where a derived bound bites hardest.
