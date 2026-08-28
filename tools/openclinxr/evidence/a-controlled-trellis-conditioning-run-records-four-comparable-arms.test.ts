import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: every TRELLIS asset this repo ships was generated from ONE conditioning image, and no
 * controlled comparison of view selection or view count exists.
 *
 * MEASURED 2026-08-26. All 13 `bake-measure.json` records under
 * `.openclinxr/evidence/trellis-escape-hatch/` carry `viewCount: 1`. The 4-view pack contract in
 * `MULTIVIEW-GROK-PACKS.md`, the every-PNG pass in `trellis-bake-cli.ts:13-15` and the embedding
 * concat in `run_bake_isolated.py` were never exercised on a shipped asset.
 *
 * THE OPERATOR ASKED FOR SIX CARDINAL VIEWS, and two measurements bear on that:
 *
 *   components.py:135   MultiImageConditionedMixin max_image_cond_view = 4, sampling 1..4.
 *                       Six conditioning views is OUTSIDE the learned envelope.
 *   issue-255           the only controlled same-seed 1-vs-4 run (seed 237255): selected
 *                       rear-coverage measures improved AND boundaryEdgeCount worsened
 *                       470,269 -> 547,259, with neither arm watertight.
 *
 * So multiview is not established as an improvement, and six views is not established as usable.
 * This card MEASURES that; it does not assume it.
 *
 * KNOWN-GOOD COLUMN: issue-255's report is the only same-seed conditioning comparison in the tree and
 * clause (4) pins it, so the arms here are compared against a real prior rather than an invented one.
 *
 * claimScope: whether four comparable arms were generated and graded against a rubric fixed in
 *   advance.
 * notEvidenceFor: that any arm wins. `retain_single_view` and `reject_all_measured` close this card
 *   as readily as `adopt_multiview` — the shipped fleet is single-view and staying there is a result.
 *
 * ## FIXED (#697)
 *
 * All four arms were baked from one eight-image source set, one seed (20260828), one sampler
 * configuration and a byte-identical front image at input zero. `cardinal_six` (viewCount 6)
 * carries `experimentalOutOfTrainingEnvelope: true` and is not the default. RAW outputs only.
 *
 * `measure_conditioning_geometry.py` now emits the metric set under camelCase keys, matching the
 * report contract this file's clause (3) looks up and the camelCase reads in
 * `trellis-conditioning-run.ts` `decidePolicy` — previously it wrote snake_case keys, so the
 * report's geometry carried no readable metric values and the policy read all-zero ties.
 *
 * Policy: `retain_single_view` at `geometry_diagnostics`. With real measurements the control
 * (single_shared_front) has boundaryEdgeCount 23140; cardinal_four regressed to 30596 and
 * cardinal_six to 24935, both also >2x the control's welded component count (fragmentation);
 * no arm is watertight. No multiview arm improved, so ties/regressions retain the single-view
 * control per conditioning-v1.json. Comparison boards were produced and the orchestrator's pixel
 * grade of `boards/` is the visual verdict (pending); no default changed.
 */

const ROOT = process.cwd();
const REPORT = resolve(ROOT, ".openclinxr/evidence/trellis-conditioning-policy/conditioning-report.json");
const RUBRIC = resolve(ROOT, "tools/openclinxr/asset-pipeline/trellis/rubrics/conditioning-v1.json");
const PRIOR = resolve(ROOT, ".openclinxr/evidence/issue-255/multiview-report.json");
const SHA256 = /^[a-f0-9]{64}$/;

/** Arms and their ORDERED conditioning views. front is input zero in every arm. */
const EXPECTED_ARM_VIEWS: Record<string, readonly string[]> = {
  single_shared_front: ["front"],
  current_four: ["front", "right", "three_quarter_left", "three_quarter_right"],
  cardinal_four: ["front", "back", "left", "right"],
  cardinal_six: ["front", "back", "left", "right", "top", "bottom"],
};

type HashedFile = { path: string; sha256: string };
type Arm = {
  armId?: string; status?: string; seed?: number; samplerParameterSha256?: string;
  inputImages?: Array<HashedFile & { viewId?: string }>;
  experimentalOutOfTrainingEnvelope?: boolean;
  geometry?: Record<string, unknown>; reviewReceipt?: HashedFile; failure?: { reason?: string };
};
type Report = { arms?: Arm[]; rubric?: HashedFile; policy?: { conclusion?: string; reason?: string } };

function report(): Report {
  if (!existsSync(REPORT)) return {};
  try { return JSON.parse(readFileSync(REPORT, "utf8")) as Report; } catch { return {}; }
}
function assertHashed(f: HashedFile | undefined, what: string): void {
  expect(f?.path, `${what}: no path`).toBeTruthy();
  expect(isAbsolute(String(f?.path)), `${what}: paths must be repo-relative`).toBe(false);
  expect(String(f?.sha256), `${what}: not a sha256`).toMatch(SHA256);
}

describe("a controlled trellis conditioning run records four comparable arms", () => {
  it("(1) four arms exist with the declared ordered view sets and front at input zero", () => {
    const arms = report().arms ?? [];
    expect(
      arms.map((a) => a.armId).sort(),
      "single_shared_front is the SHIPPED condition and is the control; omitting it compares two "
        + "things the fleet has never used",
    ).toEqual(Object.keys(EXPECTED_ARM_VIEWS).sort());
    for (const arm of arms) {
      const expected = EXPECTED_ARM_VIEWS[String(arm.armId)];
      expect(arm.inputImages?.map((i) => i.viewId), `${arm.armId}: view order`).toEqual(expected);
      expect(arm.inputImages?.[0]?.viewId, `${arm.armId}: front must be input zero`).toBe("front");
    }
  });

  it("(2) all arms share one seed, one sampler hash, and one front image hash", () => {
    const arms = report().arms ?? [];
    expect(arms.length, "nothing to compare").toBeGreaterThanOrEqual(4);
    const seeds = new Set(arms.map((a) => a.seed));
    const samplers = new Set(arms.map((a) => a.samplerParameterSha256));
    const fronts = new Set(arms.map((a) => a.inputImages?.find((i) => i.viewId === "front")?.sha256));
    expect(seeds.size, `arms used ${seeds.size} seeds; a view-count delta cannot be read off different seeds`).toBe(1);
    expect(samplers.size, "sampler parameters must be identical across arms").toBe(1);
    expect(fronts.size, "the shared front image must be byte-identical in every arm").toBe(1);
    expect(
      arms.find((a) => a.armId === "cardinal_six")?.experimentalOutOfTrainingEnvelope,
      "six views exceeds max_image_cond_view = 4 and must be flagged, not quietly promoted",
    ).toBe(true);
  });

  it("(3) every arm carries the full fixed metric set or a measured failure", () => {
    const rubric = JSON.parse(readFileSync(RUBRIC, "utf8"));
    const required: string[] = [...rubric.geometryMetrics, ...rubric.costMetrics];
    const arms = report().arms ?? [];
    // WITHOUT THIS the loop body never runs on an empty report and the clause passes vacuously —
    // measured here, the first draft did exactly that.
    expect(arms.length, "no arms recorded, so there is nothing to check the metric set against")
      .toBeGreaterThanOrEqual(4);
    for (const arm of arms) {
      if (arm.status === "failed_measured") {
        expect(String(arm.failure?.reason ?? "").length, `${arm.armId}: a failure needs a reason`).toBeGreaterThan(0);
        continue;
      }
      for (const metric of required) {
        const key = metric.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        expect(arm.geometry?.[key], `${arm.armId}: missing predeclared metric ${metric}`).toBeDefined();
      }
      assertHashed(arm.reviewReceipt, `${arm.armId} review receipt`);
    }
  });

  it("(4) the run reaches a terminal conclusion and cites the issue-255 prior", () => {
    const r = report();
    assertHashed(r.rubric, "rubric reference");
    expect(
      r.rubric?.sha256,
      "the rubric must be the one on disk at plant time, so metrics cannot be swapped after grading",
    ).toBe(require("node:crypto").createHash("sha256").update(readFileSync(RUBRIC)).digest("hex"));
    expect(
      ["adopt_multiview", "retain_single_view", "reject_all_measured"],
      "retain_single_view is a real outcome: the fleet is single-view today",
    ).toContain(String(r.policy?.conclusion));
    expect(String(r.policy?.reason ?? "").length).toBeGreaterThan(0);
  });

  it("(5) COUNTERWEIGHT: the rubric is fixed before the run and names no scalar score", () => {
    const rubric = JSON.parse(readFileSync(RUBRIC, "utf8"));
    expect(rubric.decisionRules, "a scalar score lets one metric bury a regression")
      .toContain("no_scalar_quality_score");
    expect(rubric.decisionRules).toContain("all_geometry_regressions_are_reported");
    expect(
      rubric.decisionRules,
      "largest-component share failed as a predictor in BOTH directions on four assets; it must "
        + "not creep back in as a selector",
    ).toContain("largest_component_share_is_not_a_quality_predictor");
  });

  it("(6) COUNTERWEIGHT: the issue-255 prior survives with its regression intact", () => {
    expect(existsSync(PRIOR), "the only same-seed conditioning comparison in the tree").toBe(true);
    const prior = JSON.parse(readFileSync(PRIOR, "utf8"));
    const s = JSON.stringify(prior);
    expect(s.includes("470269") && s.includes("547259"),
      "the four-view arm WORSENED boundary edges 470,269 -> 547,259; deleting that number would "
        + "leave multiview looking like a settled win").toBe(true);
  });
});

// NOT TESTED: that multiview improves anything, that six views are usable, or that any arm wins.
// retain_single_view closes this card successfully.
