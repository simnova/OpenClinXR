import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: `wristLateralOffsetMeters` is not a lateral offset, and the abduction ratio divides it
 * by a term measured in a different space.
 *
 * MEASURED 2026-08-27 at head 9372f2a0, read from the current source. IMMUTABLE — flip the assertion
 * and append a `## FIXED (#678)` block below; do not rewrite these paths or numbers.
 *
 *   idle-arm-hang.ts:439-441
 *     const dx = wristWp.x - rootWp.x;
 *     const dz = wristWp.z - rootWp.z;
 *     const lateral = Math.sqrt(dx * dx + dz * dz);
 *
 * That is an XZ RADIUS from the actor root. A wrist held straight out in FRONT of the body — dz
 * large, dx zero — reports maximal "lateral". The field's own docstring is honest ("Horizontal
 * distance from the body mid-line (actor root XZ) to the wrist") and its NAME is not, and every
 * consumer reads it as sideways.
 *
 *   arm-abduction-ceiling.ts:225-226
 *     row.halfShoulderSpanMeters > 0
 *       ? row.wristLateralOffsetMeters / row.halfShoulderSpanMeters
 *
 * The denominator is, by the decision comment at `:401-402`, a "full 3D distance / 2" between the
 * upper_arm L and R world positions. So the ratio is a 2D XZ radius over a 3D half-span. Mixed
 * spaces, and the quotient is not the abduction fraction it is read as.
 *
 * ## WHY THIS IS NOT COSMETIC
 *
 * Arm posture was TUNED against these numbers. #117 moved `upper_arm` local z against a lateral
 * reading and #91 set a wrist bound on one. A metric that folds forward reach into sideways reach
 * was the instrument for both, so the constants they landed were fitted to a quantity nobody
 * intended to measure.
 *
 * ## EXPECT OTHER CONTRACTS TO MOVE, AND DO NOT SILENCE THEM
 *
 * Splitting the numerator will change values that existing arm contracts assert on. That is the
 * point, not a regression: a threshold fitted to a wrong metric is not evidence. If one goes red,
 * say which and why in your report and leave it red for a follow-on card rather than retuning it
 * here — retuning against a freshly corrected metric in the same slice is how a fitted constant gets
 * laundered into a derived one.
 *
 * ## KNOWN-GOOD COLUMN
 *
 * Pythagoras. `lateral² + forward² == radius²` is an identity, not a tolerance anyone chose, so
 * clause (1) needs no invented threshold — 1 mm is float slack on a metre-scale measurement, not a
 * band fitted to an observation.
 *
 * claimScope: whether the arm instrument records sideways and forwards as separate components, and
 *   whether the abduction ratio's terms share a space.
 * notEvidenceFor: that any posture is correct; that the corrected ratio's thresholds are right, which
 *   is exactly what a follow-on must re-derive; that the actor coverage is complete, which #675 owns.
 */

const REPO = join(import.meta.dirname, "../../..");
const REPORT = join(REPO, "tools/openclinxr/evidence/arm-metric-decomposition.json");
const IDLE = join(REPO, "tools/openclinxr/evidence/idle-arm-hang.ts");

/** Float slack on a metre-scale world measurement, not a fitted band. */
const QUADRATURE_SLACK_M = 0.001;

type Row = {
  scenarioId: string;
  actorId: string;
  side: string;
  wristLateralOffsetMeters: number;
  wristForwardOffsetMeters: number;
  wristHorizontalRadiusMeters: number;
  halfShoulderSpanMeters: number;
  halfShoulderSpanLateralMeters: number;
  abductionRatio: number;
  ratioSpace: string;
};

function reportOrNull(): { rows: Row[] } | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as { rows: Row[] };
}

describe("the arm metric separates sideways from forwards (#678)", () => {
  /**
   * ## FIXED (#678)
   * idle-arm-hang.ts + arm-abduction-ceiling.ts now decompose the wrist's XZ offset about the
   * actor's OWN shoulder mid-line: lateral = component along the L→R shoulder axis, forward =
   * component along the perpendicular, radius = the same vector's length (identity by
   * construction, worst |hypot(lateral,forward) − radius| = 0.000 m on 28 rows). The abduction
   * ratio divides the lateral component by the LATERAL half-span (same space); the 3D half-span
   * stays recorded but is not the denominator. Measured on this tree across 3 runs (see
   * arm-metric-decomposition.json rows + stabilityAcrossRuns): corrected standing ratios span
   * 0.10–1.18 (was up to 1.46 conflated), so the 1.3 ceiling no longer fires on main — the old
   * numerator inflated every ratio by its anterior-posterior component. Cross-run spread of the
   * corrected ratio is ≤0.08 for every actor (the conflated metric showed 211% spread on
   * noah_chen). NO threshold changed; #91/#117 clauses that move are left red for a follow-on card.
   */
  it("(1) lateral and forward are recorded separately and square to the horizontal radius", () => {
    const report = reportOrNull();
    expect(
      report !== null,
      `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64). Measure ONCE into this artifact and assert against it; do not boot a dev server per "
        + "test case.",
    ).toBe(true);
    expect(report!.rows.length, "no rows measured").toBeGreaterThan(0);
    for (const r of report!.rows) {
      const id = `${r.scenarioId}/${r.actorId}.${r.side}`;
      const quad = Math.hypot(r.wristLateralOffsetMeters, r.wristForwardOffsetMeters);
      expect(
        Math.abs(quad - r.wristHorizontalRadiusMeters),
        `${id}: lateral and forward must be the components of the horizontal radius. A wrist held `
          + "straight out in front reports maximal lateral today, which is the defect.",
      ).toBeLessThanOrEqual(QUADRATURE_SLACK_M);
    }
  });

  it("(2) the abduction ratio divides same-space terms and says which space", () => {
    const report = reportOrNull();
    expect(report !== null, `${REPORT} must exist`).toBe(true);
    for (const r of report!.rows) {
      const id = `${r.scenarioId}/${r.actorId}.${r.side}`;
      expect(r.ratioSpace, `${id}: the report must name the space the ratio is in`).toBe("lateral");
      expect(
        r.halfShoulderSpanLateralMeters,
        `${id}: the denominator today is a full 3D distance halved (arm-abduction-ceiling.ts:401-402) `
          + "while the numerator is a 2D XZ radius",
      ).toBeGreaterThan(0);
      const expected = r.wristLateralOffsetMeters / r.halfShoulderSpanLateralMeters;
      expect(
        Math.abs(r.abductionRatio - expected),
        `${id}: the recorded ratio must be the lateral offset over the LATERAL half-span`,
      ).toBeLessThanOrEqual(0.001);
    }
  });

  it("(3) COUNTERWEIGHT: the horizontal radius is still recorded, so nothing is lost", () => {
    const report = reportOrNull();
    if (report === null) return;
    for (const r of report.rows) {
      expect(
        r.wristHorizontalRadiusMeters,
        `${r.scenarioId}/${r.actorId}.${r.side}: renaming the old quantity away instead of adding `
          + "the decomposition would break every consumer that legitimately wants reach",
      ).toBeGreaterThan(0);
      expect(
        r.halfShoulderSpanMeters,
        "the 3D half-span is a real measurement and stays available; clause (2) only forbids using "
          + "it as the ratio's denominator",
      ).toBeGreaterThan(0);
    }
  });

  it("(4) COUNTERWEIGHT: the settle fix is not regressed to make the numbers easier", () => {
    const src = readFileSync(IDLE, "utf8");
    expect(
      /\bwaitForSceneAssetsSettled\s*\(/u.test(src),
      "#675 wired waitForSceneAssetsSettled into this instrument because it was silently dropping "
        + "actors — 18 to 28 rows on unchanged trees. Dropping slow actors is the cheapest way to "
        + "make a decomposition tidy, and it would pass clause (1) while measuring fewer people. "
        + "The check is the CALL form, not a substring: a probe showed `src.includes(name)` is "
        + "satisfied by renaming the symbol to `waitForSceneAssetsSettledXX`.",
    ).toBe(true);
  });
});

// NOT TESTED: whether any posture is correct — no clause here asserts an appearance or a bound. Nor
// whether the thresholds in #91 and #117, both fitted against the uncorrected metric, are right once
// the numerator changes; that re-derivation is a follow-on and must not happen in this slice. Nor the
// sign convention for lateral and forward, which the identity in clause (1) does not constrain, so a
// consumer reading direction rather than magnitude still has nothing to rely on.
