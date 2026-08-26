import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: `iterate-optimize.ts --bake` has run on exactly one subject, and on that subject the
 * graded answer was to use no map at all.
 *
 * MEASURED 2026-08-26 at head d05734dc by #694, orchestrator pixel grade at native 900x900 with 1:1
 * crops. IMMUTABLE — flip the assertion and append a `## FIXED (#702)` block below; do not rewrite
 * these numbers or verdicts.
 *
 *   lowpoly-shoe rung      bytes       vs shipped 9,234,576   graded verdict
 *   40k bare               7,242,324        -21.6%            loses  — hard plane across the toe cap
 *   40k + 512 map          8,755,768         -5.2%            loses  — outline still faceted, NEW
 *                                                                      dark heel-collar streaks
 *   60k bare               8,422,752         -8.8%            BEATS  — the sweep's answer
 *   60k + 512 map         10,322,168        +11.8%            loses  — LARGER than what it replaces
 *
 * The map is three for three against on that subject across 25k, 40k and 60k. So the stage's only
 * recorded outcome is rejection of its own output, on a curved subject. That is not evidence the
 * stage works and it is not evidence it does not.
 *
 * ## THE SUBJECT WHERE THE MAP HAS ALREADY WON, BY HAND
 *
 * `pulse-oximeter`: 296,226 raw to 25,000 plus a 512 map, 12.6% under its shipped 80k champion, with
 * map deviation holding at 37.82 as resolution fell from 2048. That bake ran from
 * `bake-probe/hl_bake.py` BY HAND, before the stage existed. `glucometer` is the second candidate:
 * boxy handheld, predicted before its bake to hold its silhouette at 25k on FORM grounds, and it did.
 *
 * Both raws are present: `.openclinxr/evidence/trellis-escape-hatch/{pulse-oximeter,glucometer}/optimize/raw-copy.glb`.
 *
 * ## THE DECISION THIS CONTRACT ENCODES, AND WHY IT IS NOT THE PIPELINE'S TO MAKE
 *
 * #694 settled it: the evidence that separated 60k bare from 60k mapped was a 1:1 crop of the heel
 * collar showing dark streaks absent from the reference. No byte count, deviation figure or component
 * statistic distinguishes those two rungs — 60k mapped is simply larger and dirtier, and only the
 * pixels say the second part. **The stage produces both variants and records them; a human grades.**
 * Counterweight (3) refuses a verdict the pipeline computed for itself.
 *
 * ## THE RETIRED PREDICTOR — do not gate on it, do not re-derive it
 *
 * Largest-component share failed in BOTH directions across four in-range assets: `fetal-monitor` at
 * 93.9% CONTAMINATED, `iv-pump` at 87.4% and `glucometer` at 79.8% CLEAN. Map deviation is a
 * FALSIFIER, not a rank — a flat map scores near zero, and the contaminated `o2-port` map scored
 * HIGHER than the good `pulse-oximeter` one. Counterweight (4) refuses ranking on either.
 *
 * ## FORM IS 3 OF 4, NOT 1 OF 1
 *
 * #694 recorded four predictions before their bakes: correct for 40k bare, 40k mapped and 60k mapped,
 * WRONG for 60k bare, which held its silhouette and beat the shipped asset. Every FORM failure so far
 * is on the curved side, which is exactly why a boxy subject is the next test. Clause (1) requires the
 * prediction written before the bake so the count can keep going either way.
 *
 * ## A MAP THAT LOSES ON BOTH SUBJECTS CLOSES THIS CARD
 *
 * If the map loses on `pulse-oximeter` too, that is a finding about the stage worth more than a win:
 * it would mean the hand-run result did not reproduce through the stage, and the verdict enum carries
 * `loses_to_shipped` and `reject_measured` for it. No clause requires a map to win.
 *
 * claimScope: whether the landed `--bake` stage has produced bare and mapped variants of a subject
 *   other than `lowpoly-shoe`, with predictions recorded before the bakes.
 * notEvidenceFor: that any variant is adoptable — the orchestrator grades the renders and no clause
 *   asserts an appearance; that the stage's 512 default suits these subjects, since the hand-run
 *   pulse-oximeter evidence swept 2048 downward; that the shoe's verdict generalises to curved
 *   subjects as a class, which one subject cannot establish.
 */

const REPO = join(import.meta.dirname, "../../..");
const SWEEP = join(REPO, "tools/openclinxr/asset-pipeline/trellis/boxy-subject-bake-sweep.json");
const SHOE_SWEEP = join(REPO, "tools/openclinxr/asset-pipeline/trellis/shoe-rung-sweep.json");

/** The two candidates named above. Both raws are present in the tree. */
const SUBJECTS = ["pulse-oximeter", "glucometer"] as const;

const VERDICTS = ["beats_shipped", "loses_to_shipped", "reject_measured", "inconclusive_blocked", "other"] as const;
const PREDICTIONS = ["holds_silhouette", "loses_silhouette", "no_prediction"] as const;

type Rung = {
  subject: string;
  triangles: number;
  mapped: boolean;
  glbBytes: number;
  formPredictionBeforeBake: string;
  gradedVerdict: string;
  gradedBy?: string;
  verdictNote: string;
  renderPath: string;
  bakeReportPath?: string;
};

type Sweep = { rankedBy?: string; rungs: Rung[] };

function sweepOrNull(): Sweep | null {
  if (!existsSync(SWEEP)) return null;
  return JSON.parse(readFileSync(SWEEP, "utf8")) as Sweep;
}

describe("the bake stage has run on a subject where the map wins (#702)", () => {
  it.fails("(1) both subjects have a bare and a mapped variant at the same target, predictions first", () => {
    const sweep = sweepOrNull();
    expect(
      sweep !== null,
      `${SWEEP} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64), and .openclinxr/evidence is gitignored.",
    ).toBe(true);
    for (const subject of SUBJECTS) {
      const rows = sweep!.rungs.filter((r) => r.subject === subject);
      expect(rows.length, `${subject}: no rungs recorded`).toBeGreaterThanOrEqual(2);
      const paired = rows.some((bare) =>
        !bare.mapped && rows.some((m) => m.mapped && m.triangles === bare.triangles));
      expect(
        paired,
        `${subject}: a bare and a mapped variant at the SAME triangle target are what make the map's `
          + "contribution separable; two rungs at different targets confound budget with mapping",
      ).toBe(true);
      for (const r of rows) {
        expect(PREDICTIONS, `${subject} ${r.triangles}: formPredictionBeforeBake`).toContain(r.formPredictionBeforeBake);
        expect(VERDICTS, `${subject} ${r.triangles}: gradedVerdict`).toContain(r.gradedVerdict);
        expect(r.verdictNote?.length ?? 0, `${subject} ${r.triangles}: verdictNote`).toBeGreaterThan(0);
        expect(existsSync(join(REPO, r.renderPath)), `${subject} ${r.triangles}: renderPath`).toBe(true);
        expect(r.glbBytes, `${subject} ${r.triangles}: glbBytes`).toBeGreaterThan(0);
      }
    }
  });

  it.fails("(2) each mapped variant was produced by the stage, not by hand", () => {
    const sweep = sweepOrNull();
    expect(sweep !== null, `${SWEEP} must exist`).toBe(true);
    for (const r of sweep!.rungs.filter((x) => x.mapped)) {
      expect(
        r.bakeReportPath,
        `${r.subject} ${r.triangles}: every bake in this repo before #694 ran by hand from `
          + "bake-probe/hl_bake.py. A mapped variant with no bake report from the stage does not "
          + "distinguish 'the stage works on this subject' from 'someone ran the script again'.",
      ).toBeTruthy();
      const report = join(REPO, String(r.bakeReportPath));
      expect(existsSync(report), `${r.subject} ${r.triangles}: ${r.bakeReportPath} must exist`).toBe(true);
      const parsed = JSON.parse(readFileSync(report, "utf8")) as { status?: string };
      expect(parsed.status, `${r.subject} ${r.triangles}: bake status`).toBe("baked");
    }
  });

  it("(3) COUNTERWEIGHT: a non-escape verdict carries an orchestrator grade, never a computed one", () => {
    const sweep = sweepOrNull();
    if (sweep === null) return;
    const escapes = new Set(["inconclusive_blocked", "reject_measured", "other"]);
    for (const r of sweep.rungs) {
      if (escapes.has(r.gradedVerdict)) continue;
      expect(
        r.gradedBy,
        `${r.subject} ${r.triangles}: what separated 60k bare from 60k mapped on the shoe was a 1:1 `
          + "crop of the heel collar. No byte count, deviation figure or component statistic sees "
          + "that, so beats_shipped and loses_to_shipped are the orchestrator's to write.",
      ).toBe("orchestrator_pixel_grade");
    }
  });

  it("(4) COUNTERWEIGHT: not ranked on map deviation or component share, and the shoe result stands", () => {
    const sweep = sweepOrNull();
    if (sweep !== null) {
      expect(
        String(sweep.rankedBy ?? "").toLowerCase(),
        "deviation is a falsifier, not a rank — the CONTAMINATED o2-port map scored HIGHER than the "
          + "good pulse-oximeter one. Largest-component share is retired, wrong in both directions "
          + "on 2 of 4 in-range assets.",
      ).not.toMatch(/deviation|component|share/u);
    }
    const shoe = JSON.parse(readFileSync(SHOE_SWEEP, "utf8")) as { champion?: string; championMapped?: boolean };
    expect(
      [String(shoe.champion), shoe.championMapped],
      "#694's landed answer is 60k BARE. Editing it so a mapped variant looks better here would "
        + "rewrite a graded result rather than measure a new subject.",
    ).toEqual(["59999", false]);
  });
});

// NOT TESTED: whether any variant is adoptable — the orchestrator grades the renders and no clause
// here asserts an appearance. Nor whether 512 is the right bake resolution for these subjects; the
// hand-run pulse-oximeter evidence swept 2048 downward and this contract fixes nothing about it. Nor
// whether the heel-collar contamination seen on both mapped shoe rungs appears on a boxy subject,
// which is the thing the renders are for.
