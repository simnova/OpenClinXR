import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a clamp derived from the `#686` lift barely moved the penetration it was designed to
 * remove, and nobody has measured the clearance the garment actually has.
 *
 * MEASURED by #714, two runs, ~300 turns. IMMUTABLE — flip the assertion and append a
 * `## FIXED (#719)` block below; do not rewrite these numbers.
 *
 *   state                       upper   lower
 *   baseline, unclamped          463      24
 *   trunk clamp only             243       5
 *   trunk + sleeve clamps        411      21
 *
 * `_fold_amp686` stayed 0.034 and `_fold_k686` stayed 16 throughout, so none of that is a millimetre
 * change. Orchestrator grade at native 4096: the bodice is still a field of jagged shards, the
 * gathers read as spiky serrations rather than cloth, and tan slivers remain at both sleeve cuffs.
 *
 * The clamp bounds the trough by `rr * (s - 1.0)`, where `s = 1.0 + _lift686 * wy * wx`
 * (`automate_blender.py:2613-2618`). That is the lift THE FOLD CODE ITSELF APPLIES. Whether it is the
 * clearance the garment actually has is the assumption this card exists to test — and it was my
 * assumption, written into #714 as the preferred candidate, so treat it as suspect rather than as
 * background.
 *
 * ## THE 243 IS NOT COMPARABLE AND IS RECORDED ONLY FOR HONESTY
 *
 * #714's final commit records "body 1.776m preserved", so the intermediate bake may have had a
 * different body height. Only 463 against 411 was taken with the same instrument on comparable
 * meshes. Do not treat 243 as a datum.
 *
 * ## "THE FOLD SIDE CANNOT FIX THIS" IS A LANDABLE ANSWER
 *
 * #714 burned a second 150 turns partly because I offered a measured partial in prose while its
 * contract demanded zero. The contract won, correctly, and the worker had no legal way to stop at
 * the finding. So clause (2) here carries the verdict as a closed enum in which
 * `upstream_shell_required` is a first-class outcome. Nothing in this file requires the fold side to
 * be sufficient.
 *
 * ## SUPPRESS THE FOLD AT RUNTIME, NOT BY EDITING THE CONSTANT
 *
 * Counterweight (3) pins `_fold_amp686` and `_fold_k686`. The operator's direction is that this work
 * is "not new millimetres" (`operator-steering-needed-questions.md:323`), and a constant edited to
 * take a measurement is indistinguishable afterwards from a constant edited to pass a gate.
 *
 * claimScope: whether the garment shell's pre-fold clearance has been measured, and whether the fold
 *   side can reach the penetration at all.
 * notEvidenceFor: that any fix works — this file asserts no repair and pins the shipped asset
 *   unchanged; that the gathers survive anything, which only a render grade can say.
 */

const REPO = join(import.meta.dirname, "../../..");
const GLB = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
const BLENDER = join(REPO, "tools/openclinxr/asset-pipeline/anny/automate_blender.py");
const REPORT = join(REPO, "tools/openclinxr/evidence/gown-shell-clearance-measurement.json");

/** The shipped asset on main. Counterweight (4) pins it: this slice measures and changes no bytes. */
const GLB_SHA256 = "7bd12d06aec497a939aa62301c73274cf23e6dd7b1da6d5c085db6c17f57fd4a";
const GLB_BYTES = 7_116_988;

/** Every value is landable. `upstream_shell_required` is the answer #714's evidence points at. */
const VERDICTS = ["fold_side_sufficient", "upstream_shell_required", "mixed", "inconclusive_blocked", "other"] as const;

type Band = {
  index: number;
  yLow: number;
  yHigh: number;
  /** Signed metres from the body surface with the fold SUPPRESSED. Negative means already inside. */
  preFoldClearanceMedian: number;
  preFoldVerticesAtOrInside: number;
  foldOnVerticesInside: number;
  sampled: number;
};

type Report = { bands?: Band[]; foldReachability?: string; reachabilityNote?: string };

function reportOrNull(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("the gown shell clearance is measured, not assumed (#719)", () => {
  it.fails("(1) pre-fold clearance is measured per band, with the fold suppressed", () => {
    const report = reportOrNull();
    expect(
      report !== null,
      `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64). Reuse gown-shard-mechanism-measure.ts; a second instrument makes these numbers "
        + "incomparable with everything #691 and #714 measured.",
    ).toBe(true);
    const bands = report!.bands ?? [];
    expect(bands.length, "ten bands over the gown's own y-range, as #691 used").toBe(10);
    for (const b of bands) {
      expect(b.yHigh, `band ${b.index}: yHigh above yLow`).toBeGreaterThan(b.yLow);
      expect(b.sampled, `band ${b.index}: vertices sampled`).toBeGreaterThan(0);
      for (const field of ["preFoldClearanceMedian", "preFoldVerticesAtOrInside", "foldOnVerticesInside"] as const) {
        expect(
          typeof b[field],
          `band ${b.index}: ${field} must be measured. The fold-suppressed column is the whole point — `
            + "without it the clamp's assumption stays untested.",
        ).toBe("number");
      }
      expect(b.preFoldVerticesAtOrInside, `band ${b.index}: count cannot be negative`).toBeGreaterThanOrEqual(0);
    }
  });

  it.fails("(2) the verdict names whether the fold side can reach it, and matches the data", () => {
    const report = reportOrNull();
    expect(report !== null, `${REPORT} must exist`).toBe(true);
    expect(VERDICTS, "foldReachability").toContain(report!.foldReachability);
    expect(
      report!.reachabilityNote?.length ?? 0,
      "cite the measured numbers behind the verdict; an escape value needs a note most of all",
    ).toBeGreaterThan(0);
    if (report!.foldReachability !== "fold_side_sufficient") return;
    const inside = (report!.bands ?? []).reduce((sum, b) => sum + Number(b.preFoldVerticesAtOrInside ?? 0), 0);
    expect(
      inside,
      "fold_side_sufficient claims a bound on the fold could remove the penetration. That is only "
        + "true if nothing is already at or inside the skin before the fold runs. Measured "
        + `${inside} such vertices — report upstream_shell_required or mixed instead.`,
    ).toBe(0);
  });

  it("(3) COUNTERWEIGHT: the amplitude and wave count are untouched", () => {
    const src = readFileSync(BLENDER, "utf8");
    expect(
      /_fold_amp686\s*=\s*0\.034\b/u.test(src),
      "suppress the fold at RUNTIME to take the control measurement. A constant edited to measure is "
        + "indistinguishable afterwards from a constant edited to pass a gate, and the operator's "
        + "direction is that this is not a millimetre exercise.",
    ).toBe(true);
    expect(/_fold_k686\s*=\s*16\b/u.test(src), "wave count untouched").toBe(true);
  });

  it("(4) COUNTERWEIGHT: this slice changes no asset bytes", () => {
    const bytes = readFileSync(GLB);
    expect(bytes.byteLength, "the shipped asset's size").toBe(GLB_BYTES);
    expect(
      createHash("sha256").update(bytes).digest("hex"),
      "rebaking the shipped gown mid-diagnosis changes the thing being measured, and the numbers in "
        + "the header would stop describing the asset in the tree. Bake to a scratch path instead.",
    ).toBe(GLB_SHA256);
  });
});

// NOT TESTED: whether any fix works — this file asserts no repair. Nor whether the gathers survive
// anything, which only a render grade can say. Nor whether the rebake path can suppress the fold
// without editing the pinned constant, which is the slice's first real obstacle and may make
// `inconclusive_blocked` the honest verdict. Nor whether #714's intermediate 243 is comparable; its
// bake may have had a different body height and it is deliberately excluded above.
