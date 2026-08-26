import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the optimize path decimates and never bakes, so every bake this repo has produced ran
 * by hand from a probe script.
 *
 * MEASURED 2026-08-26 at head 473a5351. `iterate-optimize.ts` is "3-iter high-error direct targets +
 * weld + quantize" — meshopt decimation and nothing else. It contains no `selected_to_active` call,
 * no cage derivation, and never attaches a `normalTexture`. Every bake ran from
 * `tools/openclinxr/asset-pipeline/trellis/bake-probe/hl_bake.py`, which was UNTRACKED until
 * `470550ef`.
 *
 * THE SHOE LOST, and its own ladder says why. Graded at native resolution from
 * `.openclinxr/evidence/trellis-escape-hatch/lowpoly-shoe/normal-bake/shoe-ladder.png`:
 *
 *   80k no map (ships)   9,234,576 B    toe box a continuous curve, tread steps clean
 *   25k no map           7,001,276 B    -24.2%, hard planes across the toe
 *   25k + 512 map        8,400,604 B    -9.0%, shading recovered, OUTLINE STILL FACETED
 *
 * A normal map shades facets and cannot move an outline. `pulse-oximeter` is boxy and survives 25k;
 * the shoe is organic and does not. Nobody has swept the band BETWEEN 25k and 80k on this subject,
 * and 40k is exactly where pulse-oximeter showed a bare-unusable budget becoming usable mapped.
 *
 * KNOWN-GOOD COLUMN: `pulse-oximeter` at 25k + a 512 map, 8,682,420 bytes, 12.6% UNDER its shipped
 * 80k champion, with map deviation holding at 37.82 as resolution fell from 2048. That is what a win
 * looks like, measured, and it is the column clause (3) anchors the shoe's sweep against.
 *
 * DO NOT GATE ON COMPONENT STATISTICS. Predicting contamination from largest-component share failed
 * in BOTH directions across four assets — fetal-monitor at 93.9% came back contaminated, iv-pump at
 * 87.4% and glucometer at 79.8% came back clean. A rule that fails both ways is the wrong variable.
 * The render is the only oracle. Clause (4) refuses a sweep that reports statistics instead of a
 * graded verdict.
 *
 * claimScope: whether the optimize path can bake, and whether the shoe's rung band has been swept.
 * notEvidenceFor: that a bake stage helps humanoids. #692 measured every MPFB actor at 0.199-0.446
 *   largest-component share, but that variable is retired as a predictor, so the humanoid question
 *   is open and these clauses do not touch it.
 */

const OPTIMIZE = join(process.cwd(), "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts");
const PROBE = join(process.cwd(), "tools/openclinxr/asset-pipeline/trellis/bake-probe/hl_bake.py");
const SWEEP = join(process.cwd(), ".openclinxr/evidence/trellis-shoe-rung-sweep/rungs.json");
const LADDER = join(
  process.cwd(),
  ".openclinxr/evidence/trellis-escape-hatch/lowpoly-shoe/normal-bake/shoe-ladder.png",
);

/** Bytes of the shoe champion that ships today, read off its own ladder. Identity, not a threshold. */
const SHIPPED_80K_BYTES = 9_234_576;

type Rung = {
  triangleCount?: unknown;
  mapResolution?: unknown;
  bytes?: unknown;
  formPredictionBeforeBake?: unknown;
  outlineVerdict?: unknown;
};

function rungs(): Rung[] {
  if (!existsSync(SWEEP)) return [];
  try {
    const parsed = JSON.parse(readFileSync(SWEEP, "utf8"));
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rungs) ? parsed.rungs : [];
  } catch {
    return [];
  }
}

describe("the optimize path can bake before it decimates", () => {
  it.fails("(1) the optimize path has a high-to-low bake stage", () => {
    const src = readFileSync(OPTIMIZE, "utf8");
    const bakes = /selected_to_active|use_selected_to_active|normalTexture|bake_/i.test(src);
    expect(
      bakes,
      "the stage is the durable deliverable; a bake that only exists in bake-probe/hl_bake.py "
        + "depends on someone remembering to run it, which is the D1 hand-authored anti-pattern",
    ).toBe(true);
  });

  it.fails("(2) the band between 25k and 80k has been swept on the shoe", () => {
    const between = rungs().filter(
      (r) => typeof r.triangleCount === "number" && r.triangleCount > 25_000 && r.triangleCount < 79_998,
    );
    expect(
      between.length,
      "25k is too deep for this subject and 80k is what ships; the answer is in the band nobody "
        + "has measured, and 40k is where pulse-oximeter showed a bare-unusable budget become usable",
    ).toBeGreaterThanOrEqual(2);
  });

  it("(3) COUNTERWEIGHT: the reference implementation and the graded ladder both survive", () => {
    expect(existsSync(PROBE), "hl_bake.py is the proven selected_to_active reference").toBe(true);
    expect(existsSync(LADDER), "the graded 25k ladder is why this card exists").toBe(true);
    const src = readFileSync(PROBE, "utf8");
    expect(
      /objectDiagonal|dimensions|diag/i.test(src),
      "the cage must stay derived from the object's measured diagonal; a hardcoded millimetre value "
        + "does not transfer across subjects of different scale",
    ).toBe(true);
  });

  it("(4) COUNTERWEIGHT: every swept rung carries a graded outline verdict, not a statistic", () => {
    const missing = rungs().filter(
      (r) => typeof r.outlineVerdict !== "string" || r.outlineVerdict.length === 0,
    );
    expect(
      missing,
      "component share failed as a predictor in both directions across four assets and map "
        + "deviation ranked a contaminated map above a good one; the render is the only oracle",
    ).toHaveLength(0);
  });

  it("(5) COUNTERWEIGHT: every rung records the FORM prediction made BEFORE its bake", () => {
    const unpredicted = rungs().filter((r) => typeof r.formPredictionBeforeBake !== "string");
    expect(
      unpredicted,
      "FORM is 1 for 1 and stated as a hypothesis; recording the prediction after seeing the render "
        + "would make the count meaningless in the direction that flatters it",
    ).toHaveLength(0);
  });

  it("(6) COUNTERWEIGHT: the shipped champion's byte figure is unchanged", () => {
    expect(
      SHIPPED_80K_BYTES,
      "every 'vs shipped' percentage in this sweep is against this number; moving it silently "
        + "re-baselines the whole comparison",
    ).toBe(9_234_576);
  });
});

// NOT TESTED: whether any rung in the band actually beats the shipped 80k. "No rung beats it, the
// technique does not pay on this asset" satisfies every clause above and closes the card.
