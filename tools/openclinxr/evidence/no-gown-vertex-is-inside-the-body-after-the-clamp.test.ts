import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: #714's derived fold clamp cut the corrected interpenetration count from 129 to 73 and
 * stopped there. 73 gown vertices still register as inside the body by two agreeing tests.
 *
 * MEASURED by the orchestrator on 2026-08-28, on BOTH trees, with `gown-shard-mechanism-measure.ts`
 * run against main's GLB (sha `e6e6f9d4…`, 9,450,684 B) via `OPENCLINXR_GOWN_PIN_SHA`/`_BYTES` and
 * against #714's rebake (sha `dd2340a9…`). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#746)` block below; do not rewrite these numbers.
 *
 *   measure                              main, pre-clamp   after the clamp
 *   upper half, two-tests-agree                129                73
 *   lower half, two-tests-agree                  0                 0
 *   lower half, primary instrument              32                31
 *
 * All 73 fall in deciles 6 and 7 of the gown's own y-range — 5 at y 1.153..1.250 and 68 at
 * y 1.250..1.348. Every other decile reads zero. On a 1.776 m figure that is armpit and sleeve-root
 * height.
 *
 * ## WHY THIS CLAUSE MOVED HERE FROM #714
 *
 * It is clause (1) of `the-gown-folds-cannot-reach-inside-the-body.test.ts`, relocated VERBATIM —
 * same metric field, same zero, same message. #714 delivered the derived clamp, the corrected metric
 * and a graded render; this residual is a separate question and holding #714's whole contract open on
 * it stranded that work. Nothing was loosened in the move: clause (1) there is now an inverted guard
 * that fails if this file stops asserting the zero.
 *
 * ## THE HYPOTHESIS UNDER TEST, WHICH IS NOT ESTABLISHED
 *
 * #714's worker reported the 73 as armpit-seam and sleeve-root overlap — a different mechanism from
 * the fold valleys the clamp governs. The orchestrator COULD NOT CONFIRM that: the measurement
 * artifact resolves height only, and the fold band spans y 0.98..1.51, overlapping both deciles. A
 * height band is equally consistent with a fold valley surviving at chest height.
 *
 * The first measurement is the per-vertex rows for those 73 — position, nearest body triangle, and
 * garment region — not another aggregate.
 *
 * ## THE THREE CHEAP WAYS TO GREEN THIS, AND WHY EACH IS REFUSED
 *
 * Counterweight (2) pins `_fold_amp686` and `_fold_k686`: flattening the gathers until nothing
 * penetrates is the fix #714's clause (3) already refused and this card does not reopen it.
 *
 * Counterweight (3) pins the metric: "two independent tests agree" is what removed the 294 X_ONLY
 * false positives. Demanding a third agreeing test, or swapping back to a single instrument, would
 * shrink the count without moving a vertex.
 *
 * Counterweight (4) pins the measured population: the assertion reads the UPPER HALF over the gown's
 * full y-range. Narrowing it to the fold band alone would drop the armpit deciles and green this file
 * while the vertices stay where they are.
 */

const REPO = join(import.meta.dirname, "../../..");
const BLENDER = join(REPO, "tools/openclinxr/asset-pipeline/anny/automate_blender.py");
const REPORT = join(REPO, "tools/openclinxr/evidence/gown-fold-clamp-measurement.json");
const SUPERSEDED_FROM = join(
  REPO,
  "tools/openclinxr/evidence/the-gown-folds-cannot-reach-inside-the-body.test.ts",
);

/** #691's pre-change baseline on the single-axis instrument, retained for the message only. */
const BASELINE_UPPER = 463;
/** The corrected two-tests-agree count on main before #714's clamp, measured by the orchestrator. */
const PRE_CLAMP_TWO_TESTS_UPPER = 129;
/** The corrected count after #714's clamp, measured by the orchestrator on the rebake. */
const POST_CLAMP_TWO_TESTS_UPPER = 73;

type Report = {
  upperVsLower?: { gownVerticesInsideBodyTwoTests?: { upper?: number; lower?: number } };
  method?: { interpenetration?: Record<string, string> };
  deciles?: { index: number; yLow: number; yHigh: number }[];
};

function reportOrNull(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("no gown vertex is inside the body after the clamp (#746)", () => {
  it.fails("(1) no gown vertex sits inside the body in the bodice half", () => {
    const report = reportOrNull();
    expect(
      report !== null,
      `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64). Re-measure with the existing instrument, gown-shard-mechanism-measure.ts.",
    ).toBe(true);
    // A vertex counts as inside only when TWO independent tests AGREE — a parity ray test AND the
    // nearest-surface signed distance (sign < -2 mm), on either the +X or +Z ray. Single-axis X-ray
    // parity is invalid on the non-watertight body hull (2,074 open boundary edges, 1,058 inside the
    // fold band): a ray crossing an open seam reads odd without the point being inside, which is how
    // the 294-vertex X_ONLY class (one +X crossing, nearest-surface 12-61 mm OUTSIDE) polluted the
    // #691 single-axis count.
    const split = report!.upperVsLower?.gownVerticesInsideBodyTwoTests;
    expect(typeof split?.upper, "upper-half two-tests-agree count must be measured").toBe("number");
    expect(
      split!.upper,
      `zero on the corrected metric is the property a derived clamp establishes — the fold trough `
        + `cannot consume more standoff than the lift created, so the fold wave cannot place a `
        + `vertex inside the body. #691 measured ${BASELINE_UPPER} upper on the single-axis +X `
        + `instrument; the corrected two-tests-agree count was ${PRE_CLAMP_TWO_TESTS_UPPER} upper `
        + `before #714's clamp and ${POST_CLAMP_TWO_TESTS_UPPER} after. Any residual is a finding, `
        + `not a relaxed clause — report the per-vertex classification rather than raising this zero.`,
    ).toBe(0);
  });

  it("(2) COUNTERWEIGHT: the amplitude and the wave count are not reduced", () => {
    const src = readFileSync(BLENDER, "utf8");
    expect(
      /_fold_amp686\s*=\s*0\.034\b/u.test(src),
      "lowering _fold_amp686 until nothing penetrates flattens the gathers the parameter exists to "
        + "create. #714's clause (3) refused it and this card does not reopen it. Restore 0.034 in "
        + "automate_blender.py and clear the residual with geometry, not amplitude.",
    ).toBe(true);
    expect(
      /_fold_k686\s*=\s*16\b/u.test(src),
      "reducing the wave count is the same cheat with a different knob. Restore 16 in "
        + "automate_blender.py.",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the metric stays two-tests-agree", () => {
    const report = reportOrNull();
    expect(report !== null, `${REPORT} must exist`).toBe(true);
    const note = report!.method?.interpenetration?.twoTestsAgree ?? "";
    expect(
      note.length,
      "the measurement artifact must keep describing the two-tests-agree rule. Demanding a third "
        + "agreeing test, or reverting to a single instrument, shrinks the count without moving a "
        + "vertex. Restore method.interpenetration.twoTestsAgree in "
        + "gown-shard-mechanism-measure.ts.",
    ).toBeGreaterThan(0);
    expect(
      /parity/iu.test(note) && /nearest/iu.test(note),
      `the rule must remain a parity test AND a nearest-surface signed distance agreeing. Got: `
        + `"${note.slice(0, 160)}"`,
    ).toBe(true);
  });

  it("(4) COUNTERWEIGHT: the measured population is not narrowed to the fold band", () => {
    const report = reportOrNull();
    expect(report !== null, `${REPORT} must exist`).toBe(true);
    const deciles = report!.deciles ?? [];
    expect(
      deciles.length,
      "the artifact must keep reporting all ten deciles of the gown's own y-range. Narrowing the "
        + "population to the fold band drops the armpit deciles, where all 73 sit, and greens "
        + "clause (1) while the vertices stay where they are.",
    ).toBe(10);
    // Bucket edges are floating point, so compare the SPAN rather than individual boundaries.
    const lowest = Math.min(...deciles.map((d) => d.yLow));
    const highest = Math.max(...deciles.map((d) => d.yHigh));
    expect(
      lowest <= 1.153 && highest >= 1.348,
      `deciles must still span y 1.153..1.348, the band holding all 73. Got `
        + `${lowest.toFixed(3)}..${highest.toFixed(3)}`,
    ).toBe(true);
  });

  it("(5) the clause this file inherited is still guarded at its origin", () => {
    const src = readFileSync(SUPERSEDED_FROM, "utf8");
    expect(
      /SUPERSEDED by #746/u.test(src),
      `${SUPERSEDED_FROM} must keep the inverted guard naming this file. A relocation with no marker `
        + "at the origin is indistinguishable from a deleted clause.",
    ).toBe(true);
  });
});
