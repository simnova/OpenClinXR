import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: every high-to-low normal bake in this repo was run by hand, and the one subject that
 * was baked lost at the only rung anybody tried.
 *
 * MEASURED 2026-08-26 at head e5b892d8. IMMUTABLE — flip the assertion and append a `## FIXED (#694)`
 * block below; do not rewrite these paths, numbers or verdicts.
 *
 * The graded three-cell ladder on `lowpoly-shoe`
 * (`.openclinxr/evidence/trellis-escape-hatch/lowpoly-shoe/normal-bake/`):
 *
 *   cell                        bytes      vs shipped   graded at native resolution
 *   80k, no map (ships today)   9,234,576      —        toe box a continuous curve, tread steps clean
 *   25k, no map                 7,001,276   -24.2%      hard planes across the toe, tread in blocks
 *   25k + 512 map               8,400,604    -9.0%      shading recovered, OUTLINE STILL FACETED
 *
 * A normal map shades facets and cannot move an outline. At 9.0% smaller and visibly worse, 25k+512
 * loses on this subject. **Nothing between 25k and 80k has ever been tried on it**, and 40k is exactly
 * where `pulse-oximeter` showed a budget unusable bare becoming usable mapped.
 *
 * `tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts` has no bake stage — measured, its only
 * occurrence of the string "bake" is an example input path in the usage comment. The high-to-low bake
 * lives at `tools/openclinxr/asset-pipeline/trellis/bake-probe/hl_bake.py` and is invoked by hand.
 * `trellis-bake-cli.ts` is NOT this: it wraps TRELLIS image-to-3D generation, a different operation
 * that shares the word.
 *
 * ## THE RETIRED PREDICTOR — do not gate on it, and do not re-derive this
 *
 * Largest-component share failed in BOTH directions across four in-range assets: `fetal-monitor` at
 * 93.9% came back CONTAMINATED, `iv-pump` at 87.4% and `glucometer` at 79.8% came back CLEAN. A rule
 * that fails both ways is the wrong variable. **The render is the only oracle.**
 *
 * Map deviation is a FALSIFIER, not a rank: a flat map scores near zero, and the contaminated
 * `o2-port` map scored HIGHER on deviation than the good `pulse-oximeter` one. Clause (3) refuses a
 * sweep that ranks on it.
 *
 * ## THE ONE PREDICTOR THAT HAS HELD, at 1 for 1
 *
 * FORM. `glucometer` was predicted BEFORE its bake to hold its silhouette at 25k because it is a boxy
 * handheld, and it did. Boxy subjects go deep, curved subjects do not. Clause (1) requires the
 * prediction to be recorded BEFORE the bake so the count stays honest whichever way it goes — a
 * prediction written afterwards is a description.
 *
 * ## A LOSING SWEEP CLOSES THIS CARD
 *
 * If no rung between 25k and 80k beats the shipped 80k on the pixels, that is the answer and the
 * verdict enum carries `reject_measured` for it. The bake STAGE is the durable half and lands either
 * way. Neither clause here requires a rung to win.
 *
 * ## KNOWN-GOOD COLUMN
 *
 * The shipped 80k cell, graded clean on the same subject with the same renderer. Every rung is
 * compared against it rather than against an absolute quality number, so no threshold is invented
 * here.
 *
 * claimScope: whether a rung sweep between the two graded endpoints exists with predictions recorded
 *   before their bakes, and whether the optimize path invokes the high-to-low bake.
 * notEvidenceFor: that any rung is adoptable — the orchestrator grades the renders and that verdict
 *   is not asserted here; that the bake stage produces a good map on any other subject; that
 *   `lowpoly-shoe` is representative of organic subjects generally.
 */

const REPO = join(import.meta.dirname, "../../..");
const SWEEP = join(REPO, "tools/openclinxr/asset-pipeline/trellis/shoe-rung-sweep.json");
const OPTIMIZE = join(REPO, "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts");
const BAKE_SCRIPT = "tools/openclinxr/asset-pipeline/trellis/bake-probe/hl_bake.py";

/** Graded endpoints, from the ladder in the header. The sweep must land strictly between them. */
const LOWER_ENDPOINT = 25_000;
const UPPER_ENDPOINT = 80_000;

/** Closed, with an escape value and a required note beside it (a sweep that proves nothing must be
 *  sayable, and the escape values are where the real findings hide). */
const VERDICTS = ["beats_shipped", "loses_to_shipped", "reject_measured", "inconclusive_blocked", "other"] as const;
const PREDICTIONS = ["holds_silhouette", "loses_silhouette", "no_prediction"] as const;

type Rung = {
  triangles: number;
  mapped: boolean;
  glbBytes: number;
  formPredictionBeforeBake: string;
  gradedVerdict: string;
  verdictNote: string;
  renderPath: string;
};

type Sweep = { rankedBy?: string; champion?: string; rungs: Rung[] };

function sweepOrNull(): Sweep | null {
  if (!existsSync(SWEEP)) return null;
  return JSON.parse(readFileSync(SWEEP, "utf8")) as Sweep;
}

describe("the optimize path can bake before it decimates (#694)", () => {
  it("(1) a tracked rung sweep exists between the two graded endpoints, predictions first", () => {
    const sweep = sweepOrNull();
    expect(
      sweep !== null,
      `${SWEEP} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64), and .openclinxr/evidence is gitignored.",
    ).toBe(true);
    const between = sweep!.rungs.filter((r) => r.triangles > LOWER_ENDPOINT && r.triangles < UPPER_ENDPOINT);
    expect(
      between.length,
      `nothing between ${LOWER_ENDPOINT} and ${UPPER_ENDPOINT} has ever been tried on this subject; `
        + "40k is where pulse-oximeter's unusable-bare budget became usable mapped",
    ).toBeGreaterThanOrEqual(2);
    for (const r of between) {
      expect(PREDICTIONS, `rung ${r.triangles}: formPredictionBeforeBake`).toContain(r.formPredictionBeforeBake);
      expect(VERDICTS, `rung ${r.triangles}: gradedVerdict`).toContain(r.gradedVerdict);
      expect(
        r.verdictNote?.length ?? 0,
        `rung ${r.triangles}: every verdict carries a free-text note, and an escape verdict is where `
          + "a real finding hides",
      ).toBeGreaterThan(0);
      expect(existsSync(join(REPO, r.renderPath)), `rung ${r.triangles}: renderPath must exist`).toBe(true);
      expect(r.glbBytes, `rung ${r.triangles}: glbBytes`).toBeGreaterThan(0);
    }
  });

  it("(2) the optimize path invokes the high-to-low bake", () => {
    const src = readFileSync(OPTIMIZE, "utf8");
    const usageOnly = /--input[^\n]*bake/.test(src);
    expect(
      src.includes("hl_bake"),
      "every bake in this repo ran by hand from bake-probe/hl_bake.py; the factory must not depend on "
        + "someone remembering to run a script (D1/D9). NOTE: this clause is a SOURCE proxy for a "
        + "behavioural property — it cannot prove the stage runs, only that the path names it. The "
        + `changed: proof and the sweep's own renders carry the rest. Usage-comment-only mention `
        + `today: ${usageOnly}`,
    ).toBe(true);
    expect(existsSync(join(REPO, BAKE_SCRIPT)), `${BAKE_SCRIPT} must exist to be invoked`).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the sweep does not rank on map deviation or component share", () => {
    const sweep = sweepOrNull();
    if (sweep === null) return;
    expect(
      String(sweep.rankedBy ?? "").toLowerCase(),
      "deviation is a falsifier, not a rank — a flat map scores near zero and the CONTAMINATED "
        + "o2-port map scored HIGHER than the good pulse-oximeter one. Largest-component share is a "
        + "retired predictor, wrong in both directions on 2 of 4 in-range assets. The render is the "
        + "only oracle.",
    ).not.toMatch(/deviation|component|share/u);
  });

  it("(4) COUNTERWEIGHT: no rung outside the graded endpoints is presented as the answer", () => {
    const sweep = sweepOrNull();
    if (sweep === null) return;
    if (!sweep.champion) return;
    const champion = sweep.rungs.find((r) => String(r.triangles) === String(sweep.champion));
    if (!champion) return;
    expect(
      champion.triangles > LOWER_ENDPOINT && champion.triangles < UPPER_ENDPOINT,
      "re-presenting the already-graded 25k or 80k cell as the sweep's finding answers a question "
        + "nobody asked; the gap is strictly between them",
    ).toBe(true);
  });
});

// NOT TESTED: whether any rung is adoptable — the orchestrator grades the renders and no clause here
// asserts an appearance. Nor whether the bake stage produces a usable map on any subject other than
// lowpoly-shoe. Nor whether the FORM predictor holds beyond the 1-for-1 it stands at; clause (1)
// records predictions so the count can go either way, and a wrong prediction fails nothing here.

// ## FIXED (#694)
//
// Clause (1): `tools/openclinxr/asset-pipeline/trellis/shoe-rung-sweep.json` now exists and is
// TRACKED, with four rungs strictly between the graded endpoints — 39,995 and 59,999 triangles,
// each tried bare and with a 512 normal map. Every rung's `formPredictionBeforeBake` was written to
// the sweep BEFORE its bake ran; all four predict `loses_silhouette` on the FORM basis (curved
// subject, per the 1-for-1 predictor). The orchestrator grades the five renders under
// `tools/openclinxr/asset-pipeline/trellis/shoe-rung-sweep-renders/` (the four rungs plus an 80k
// no-map reference from the same raw); this clause records the sweep and the predictions, not the
// appearance outcome — all four rungs carry `inconclusive_blocked` + a note naming the renderPath
// for the pixel grade.
//
// Clause (2): `iterate-optimize.ts` now names `hl_bake` in a real stage — a `--bake` flag (default
// res 512) that spawns `bake-probe/hl_bake.py` (high-to-low Cycles selected-to-active), attaches the
// map with `bake-probe/export_mapped.py`, and records paths in the report; `--render` spawns
// `bake-probe/ab_render.py` for a grade PNG; `--target <low.glb>` runs the stages on an explicit
// rung without the decimation ladder. The sweep's two mapped rungs (40k and 60k) were produced by
// exactly that stage: `bake-report.json` files record `status: baked` at resolution 512, and the
// mapped GLBs carry the attached texture (`glTF` magic verified; byte sizes recorded in the sweep).
// The stage's own outputs for both rungs live under
// `.openclinxr/evidence/trellis-escape-hatch/lowpoly-shoe/rung-sweep-694/` (gitignored, like the
// rest of the evidence tree).
