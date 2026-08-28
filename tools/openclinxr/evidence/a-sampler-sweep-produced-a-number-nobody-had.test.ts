import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: all fifteen TRELLIS sampler knobs are reachable and not one has ever been varied.
 * Every asset this repo has generated ran at the vendor's balanced tier.
 *
 * MEASURED 2026-08-26 at head 470550ef. `trellis-bake-cli.ts:380-398` exposes twelve scalar knobs
 * across the `ss`, `shape` and `tex` groups plus three `--*-guidance-interval` pairs, landed at
 * `a45bd7b7` for #662, which is CLOSED. No sweep artifact exists anywhere under
 * `.openclinxr/evidence/`.
 *
 * WHY IT MATTERS. The `trellis-baking` skill records that the shoe's 76 position-welded components
 * are present in the RAW bake at 96.7% largest share, the same count as the champion at 93.8% — so
 * the debris originates in GENERATION, not in decimation or meshopt. `sparse_structure` builds the
 * coarse occupancy grid and stray occupied voxels there become disconnected fragments.
 *
 * The skill also records, after a research pass, that measured component counts against sampler
 * settings are not published anywhere it could find. A sweep here produces a NEW number rather than
 * reproducing a known result.
 *
 * KNOWN-GOOD COLUMN: the recorded #661 bake of `lowpoly-shoe-escape` — 293,808 raw triangles, 76
 * welded components, 47 outside-hull fragments — with its input image still on disk. That is the
 * control row, taken from `hatch-report.json` rather than invented here, and clause (3) pins the
 * triangle count so the control cannot silently drift onto a different subject.
 *
 * claimScope: whether a sweep artifact exists carrying more than one sampler configuration measured
 *   on one subject.
 * notEvidenceFor: that a lower component count is better output. Multi-component output is the NORM
 *   for this generator — `o2-port` ships at 51.5% largest share and is a correctly multi-part
 *   object — so the meaningful quantity is the DELTA across configurations on ONE subject, never an
 *   absolute threshold. Nor that any winning configuration looks right, which is a pixel grade.
 *
 * ## FIXED (#693)
 *
 * Sweep artifact exists at `.openclinxr/evidence/trellis-sampler-sweep/sweep.json`: six bakes on
 * ONE subject (`lowpoly-shoe-escape`, seed 42, `--hf-demo`, `--remesh`, decimation 300000, texture
 * 2048 — identical to the #661 control bake except for the knob under test), five DISTINCT sampler
 * configurations, zero failures. Position-weld at 5dp + union-find per GLB:
 *
 * | config | ss steps/cfg | shape steps/cfg | raw tris | welded comps | largest share | wall s |
 * |---|---|---|---|---|---|---|
 * | control-a | 12 / 7.5 | 12 / 7.5 | 293719 | 78 | 96.76% | 558.3 |
 * | control-b | 12 / 7.5 | 12 / 7.5 | 294229 | 79 | 96.77% | 555.6 |
 * | quality | 20 / 9.0 | 20 / 4.5 | 276879 | 81 | 97.36% | 739.5 |
 * | fast | 6 / 7.5 | 6 / 3.0 | 277885 | **24** | **99.37%** | 387.0 |
 * | interval-0.8-1.0 | 12 / 7.5, ss interval [0.8, 1.0] | 12 / 7.5 | 293345 | 74 | 97.05% | 470.8 |
 * | interval-0.3-1.0 | 12 / 7.5, ss interval [0.3, 1.0] | 12 / 7.5 | 287358 | 78 | 96.51% | 527.7 |
 *
 * Noise floor at IDENTICAL settings (control-a vs control-b): raw tris delta 510 (0.17%), welded
 * count delta 1. The fast-tier delta (78→24 components, +2.61pp largest share) exceeds that floor
 * by ~50x, so it is attributable to the knob under test, not run-to-run variance. RECORD, not a
 * verdict: lower component count is not asserted to be better output, and no cell has been
 * pixel-graded (text-only worker; the orchestrator grades captures).
 */

const SWEEP = join(process.cwd(), ".openclinxr/evidence/trellis-sampler-sweep/sweep.json");
const CLI = join(process.cwd(), "tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts");
const HATCH = join(
  process.cwd(),
  ".openclinxr/evidence/trellis-escape-hatch/lowpoly-shoe/hatch-report.json",
);
const INPUT_IMAGE = join(
  process.cwd(),
  ".openclinxr/evidence/trellis-packs/lowpoly-shoe-escape/three_quarter_upper_alpha.png",
);

/** Recorded in hatch-report.json by the #661 bake. Not a threshold — an identity check. */
const RECORDED_RAW_TRIANGLES = 293_808;

type Row = {
  label?: unknown;
  sampler?: unknown;
  rawTriangleCount?: unknown;
  weldedComponentCount?: unknown;
  largestComponentShare?: unknown;
  wallClockSeconds?: unknown;
};

function rows(): Row[] {
  if (!existsSync(SWEEP)) return [];
  try {
    const parsed = JSON.parse(readFileSync(SWEEP, "utf8"));
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

describe("a sampler sweep produced a number nobody had", () => {
  it("(1) a sweep artifact records at least two DISTINCT sampler configurations", () => {
    const configs = rows().map((r) => JSON.stringify(r.sampler ?? null));
    expect(
      new Set(configs.filter((c) => c !== "null")).size,
      "one row is a bake, not a sweep; two rows with the same sampler settings measure run-to-run "
        + "variance and cannot attribute a delta to a knob",
    ).toBeGreaterThanOrEqual(2);
  });

  it("(2) every row carries a POSITION-WELDED component count", () => {
    const measured = rows().filter(
      (r) => typeof r.weldedComponentCount === "number" && typeof r.largestComponentShare === "number",
    );
    expect(
      measured.length,
      "an unwelded count is wrong by orders of magnitude — a Python pass once reported 6,605 "
        + "components at 58.3% largest where the welded answer was 76 at 94.1%",
    ).toBe(rows().length);
    expect(measured.length, "and there must be rows at all").toBeGreaterThanOrEqual(2);
  });

  it("(3) COUNTERWEIGHT: the control subject and its recorded raw count still exist", () => {
    expect(existsSync(HATCH), "the control row is anchored to this recorded bake").toBe(true);
    const hatch = JSON.parse(readFileSync(HATCH, "utf8"));
    expect(
      hatch.rawTriangleCount,
      "swapping to an easier subject mid-sweep would make every delta meaningless; the control is "
        + "this recorded bake and no other",
    ).toBe(RECORDED_RAW_TRIANGLES);
    expect(existsSync(INPUT_IMAGE), "and the sweep must be re-runnable from the same input").toBe(true);
  });

  it("(4) COUNTERWEIGHT: the CLI still exposes the full knob surface", () => {
    const src = readFileSync(CLI, "utf8");
    const scalar = (src.match(/flag: "--(ss|shape|tex)-[a-z-]+"/g) ?? []).length;
    const interval = (src.match(/flag: "--(ss|shape|tex)-guidance-interval"/g) ?? []).length;
    expect(
      scalar + interval,
      "deleting knobs is the cheapest way to make a sweep trivial; #662 landed twelve scalar flags "
        + "and three interval flags and the sweep must run against that surface",
    ).toBeGreaterThanOrEqual(15);
  });

  it("(5) COUNTERWEIGHT: sparse_structure specifically stays reachable", () => {
    const src = readFileSync(CLI, "utf8");
    for (const flag of ["--ss-steps", "--ss-guidance-strength", "--ss-guidance-rescale", "--ss-guidance-interval"]) {
      expect(
        src.includes(flag),
        `${flag} is the stage the debris originates in; a sweep that cannot reach it answers a `
          + "different question",
      ).toBe(true);
    }
  });
});

// NOT TESTED: whether any configuration actually reduces the component count. These clauses assert a
// sweep HAPPENED and was measured honestly. "No configuration changes the welded count on this
// subject" is a successful outcome and would satisfy every clause above.
