import { existsSync, readFileSync, statSync } from "node:fs";
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

/** The sweep report, read whole. `rungs()` below returns just its rows for the older clauses. */
function report(): { rungs?: Array<Record<string, any>>; verdict?: unknown } {
  if (!existsSync(SWEEP)) return {};
  try { return JSON.parse(readFileSync(SWEEP, "utf8")); } catch { return {}; }
}

describe("decimated rungs are baked, rendered and graded before a champion is named", () => {
  /**
   * CORRECTED 2026-08-26. The clause here was a REGEX OVER SOURCE TEXT:
   *
   *     const bakes = /selected_to_active|use_selected_to_active|normalTexture|bake_/i.test(src);
   *
   * PROBED, and it is worse than weak. Appending the single line
   * `// TODO: someday add a bake_ stage here. This comment is not a bake.`
   * to `iterate-optimize.ts` flipped the clause green. A worker handed this card could satisfy its
   * headline requirement with a comment. That is the marker check this repo keeps re-committing —
   * a name match standing in for substance — inside the contract meant to prevent it.
   *
   * It also asserted no ORDERING despite the file being named "bake before it decimates", and the
   * real dependency graph runs the other way: a high-to-low transfer bake REQUIRES a low mesh, so it
   * is decimate -> UV -> bake_onto_low -> attach -> render siblings -> grade.
   *
   * Now asserts against a REPORT. Per the rule this session earned, an it.fails under a file-wide
   * `live:` must assert a MEASUREMENT EXISTS, never that the hoped-for result won: two rungs in the
   * open band must be GRADED, and the verdict may be `reject_measured`.
   */
  it.fails("(1) at least two rungs in the open 25k-80k band completed the measured graph", () => {
    const r = report();
    const graded = (r.rungs ?? []).filter(
      (x: Record<string, any>) => x.status === "graded" && Number(x.triangleCount) > 25_000 && Number(x.triangleCount) < 80_000,
    );
    expect(
      graded.length,
      "25k is too deep for this subject and 80k is what ships; the answer is in the band nobody has "
        + "measured. NEITHER RUNG IS REQUIRED TO WIN",
    ).toBeGreaterThanOrEqual(2);
    expect(
      ["adopt_rung", "reject_measured"],
      "a measured refusal closes this card as readily as an adoption",
    ).toContain(String(r.verdict));
  });

  /**
   * (1b) The ordering the old clause never asserted, proved by HASH LINKAGE rather than timestamps.
   *
   * A timestamp comparison would be self-attested by whoever writes the report — the same weakness
   * that got `measured-before:` removed from the plant-protection set, where it asserted ordering by
   * mtime and said nothing about what was actually done. Hash linkage is different: each stage's
   * declared input must equal its predecessor's declared output, so a stage cannot claim to have
   * consumed something that did not exist in that form.
   */
  it.fails("(1b) every graded rung links each stage's input to its predecessor's output by hash", () => {
    const graded = (report().rungs ?? []).filter((x: Record<string, any>) => x.status === "graded");
    expect(graded.length, "nothing graded, so there is no chain to check").toBeGreaterThanOrEqual(2);
    for (const x of graded) {
      expect(x.stageOrder, `rung ${x.id}: wrong graph`).toEqual([
        "decimate", "uv", "bake_onto_low", "attach", "render_siblings", "grade",
      ]);
      expect(x.uv?.inputSha256, `rung ${x.id}: uv did not consume the decimate output`).toBe(x.decimate?.output?.sha256);
      expect(x.attach?.lowInputSha256, `rung ${x.id}: attach did not consume the uv output`).toBe(x.uv?.output?.sha256);
      expect(x.attach?.normalMapInputSha256, `rung ${x.id}: attach did not consume the baked map`).toBe(x.bake?.normalMap?.sha256);
      expect(x.renders?.unmapped?.modelInputSha256, `rung ${x.id}: unmapped sibling is not the uv output`).toBe(x.uv?.output?.sha256);
      expect(x.renders?.mapped?.modelInputSha256, `rung ${x.id}: mapped sibling is not the attached output`).toBe(x.attach?.output?.sha256);
      expect(typeof x.grade?.outlineVerdict, `rung ${x.id}: no graded outline verdict`).toBe("string");
    }
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
    // ONE SHAPE. Clause (1b) reads the verdict at `grade.outlineVerdict` inside the stage record;
    // this clause read a flat `outlineVerdict`. A probe caught them disagreeing, which would have let
    // a report satisfy one clause and fail the other on the same rung. Accept either position, and
    // require it wherever the producer put it.
    const verdictOf = (r: Record<string, any>): unknown => r.grade?.outlineVerdict ?? r.outlineVerdict;
    const missing = (report().rungs ?? []).filter(
      (r: Record<string, any>) => typeof verdictOf(r) !== "string" || String(verdictOf(r)).length === 0,
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

  /**
   * CORRECTED 2026-08-26, same day it was written. The original compared `SHIPPED_80K_BYTES` to the
   * literal it is declared as — a constant against itself, which cannot fail. That is the vacuous
   * proof my own `contract-design` rule tells workers to flag, committed by me hours after writing
   * the rule. Caught by a consult, not by my own self-review.
   */
  it("(6) COUNTERWEIGHT: the shipped shoe champion on disk is not silently replaced", () => {
    const shipped = join(
      process.cwd(),
      ".openclinxr/evidence/trellis-escape-hatch/lowpoly-shoe/optimize/champion.glb",
    );
    expect(existsSync(shipped), "every 'vs shipped' percentage is against this file").toBe(true);
    expect(
      statSync(shipped).size,
      "re-baselining the comparison by swapping the champion would make every percentage in the "
        + "sweep meaningless while every other clause stayed green",
    ).toBe(SHIPPED_80K_BYTES);
  });
});

// KNOWN WEAKNESS IN CLAUSE (1b), named by a consult AFTER it landed at 252e3370 and recorded here
// rather than left for the next reader to discover. It compares hash STRINGS INSIDE ONE REPORT and
// never recomputes a hash from an artifact on disk. A worker can author a perfectly self-consistent
// fictional chain and satisfy it, and nothing here proves `iterate-optimize.ts` produced the report
// at all. It is strictly better than the source grep it replaced — a comment no longer satisfies
// anything — and it is NOT SOUND.
//
// The sound form recomputes SHA-256 from every referenced artifact path, asserts BOTH bake inputs
// (the high source and the UV-bearing low mesh), binds the grade plan by hash before execution, and
// proves the pipeline command produced the receipts. Timestamps stay diagnostic metadata and are
// never acceptance evidence: `gradePlan.createdAt <= bake.startedAt` is self-declared chronology and
// weaker than the filesystem `measured-before:` rule this repo already removed from the
// plant-protection set.
//
// #694 IS QUARANTINED (`Factory: Idle`) until that lands and #693 returns. A comment on a card does
// not stop a dequeue; clearing Planted does.

// NOT TESTED: whether any rung in the band actually beats the shipped 80k. "No rung beats it, the
// technique does not pay on this asset" satisfies every clause above and closes the card.
