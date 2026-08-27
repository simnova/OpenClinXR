import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: three of four mapped variants across two subjects carry jagged streaks at a concave
 * feature, absent from their own 80k references at the same 1:1 crop — and every bake ran at 512.
 *
 * MEASURED by orchestrator pixel grade at native 900x900 with 1:1 crops, #694 and #702. IMMUTABLE —
 * flip the assertion and append a `## FIXED (#703)` block below; do not rewrite this table.
 *
 *   subject           mapped variant   bake res   streaks at a concave feature
 *   lowpoly-shoe        40k + map        512      yes — heel collar
 *   lowpoly-shoe        60k + map        512      yes — heel collar, milder
 *   pulse-oximeter      25k + map        512      yes — parting seam
 *   glucometer          25k + map        512      NO
 *
 * Three yes, one no, ONE RESOLUTION. Nothing separates those four rows except the subject, so bake
 * resolution has never been varied against this defect at all.
 *
 * ## WHY 512 IS THE SUSPECT AND NOT THE CONCLUSION
 *
 * `--bake-res` defaults to 512 in the landed stage (#694). The hand-run evidence that made this
 * technique worth having reports map deviation holding at 37.82 **as resolution fell from 2048** — so
 * 2048 was the starting point and 512 is a default nobody has defended against artifact rate. A
 * resolution too low for a tight concavity is one plausible cause. Source geometry that the map
 * merely reveals is another, and #702 recorded it as undetermined. This contract does not choose
 * between them; it makes the ladder that can.
 *
 * ## THE CONTROL IS THE POINT — clause (2) exists because of it
 *
 * The three variants must share the SAME low rung and the SAME source, so resolution is the only
 * variable. A ladder that re-decimates per cell confounds bake resolution with triangle count and
 * answers nothing. `pulse-oximeter` 25k is the subject: it shows the defect, it is the one case
 * measured where the map genuinely earns its bytes (-12.6% against the shipped champion with the
 * surface restored), and its byte count reproduced the hand-run figure exactly, so the rung is
 * already well characterised.
 *
 * ## BOTH OUTCOMES CLOSE THIS CARD
 *
 * Streaks that thin or vanish as resolution rises say the default is wrong. Streaks unchanged at 2048
 * say the map is reporting the source and the defect belongs to the geometry, which is a different
 * card. No clause requires either. The verdict enum carries `reject_measured` for the second.
 *
 * ## DO NOT GATE ON COMPONENT STATISTICS OR DEVIATION
 *
 * Largest-component share failed in BOTH directions across four in-range assets: `fetal-monitor` at
 * 93.9% CONTAMINATED, `iv-pump` at 87.4% and `glucometer` at 79.8% CLEAN. Map deviation is a
 * FALSIFIER, not a rank — a flat map scores near zero and the contaminated `o2-port` map scored
 * HIGHER than the good `pulse-oximeter` one. Deviation is specifically unable to answer THIS
 * question, because streaks are exactly the high-contrast content that raises it. Counterweight (4)
 * refuses ranking on either.
 *
 * claimScope: whether a bake-resolution ladder exists on one fixed low rung with renders recorded.
 * notEvidenceFor: that any resolution is adoptable — the orchestrator grades the renders and no
 *   clause asserts an appearance; that the streaks matter at learner viewing distance, which no
 *   capture has established; that a resolution answer for `pulse-oximeter` transfers to the shoe.
 */

const REPO = join(import.meta.dirname, "../../..");
const LADDER = join(REPO, "tools/openclinxr/asset-pipeline/trellis/bake-resolution-ladder.json");
const BOXY_SWEEP = join(REPO, "tools/openclinxr/asset-pipeline/trellis/boxy-subject-bake-sweep.json");

/** The three cells. 512 is the shipped default; 2048 is where the hand-run evidence started. */
const RESOLUTIONS = [512, 1024, 2048] as const;

const VERDICTS = ["streaks_absent", "streaks_reduced", "streaks_unchanged", "reject_measured", "inconclusive_blocked", "other"] as const;

type Cell = {
  bakeResolution: number;
  triangles: number;
  sourceGlb: string;
  glbBytes: number;
  gradedVerdict: string;
  gradedBy?: string;
  verdictNote: string;
  renderPath: string;
  bakeReportPath: string;
};

type Ladder = { rankedBy?: string; cells: Cell[] };

function ladderOrNull(): Ladder | null {
  if (!existsSync(LADDER)) return null;
  return JSON.parse(readFileSync(LADDER, "utf8")) as Ladder;
}

describe("the bake resolution has never been varied against the streaks (#703)", () => {
  it.fails("(1) one low rung is baked at 512, 1024 and 2048, each rendered and reported", () => {
    const ladder = ladderOrNull();
    expect(
      ladder !== null,
      `${LADDER} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
        + "(#64), and .openclinxr/evidence is gitignored.",
    ).toBe(true);
    for (const res of RESOLUTIONS) {
      const cell = ladder!.cells.find((c) => c.bakeResolution === res);
      expect(cell, `no cell at bake resolution ${res}`).toBeTruthy();
      expect(VERDICTS, `${res}: gradedVerdict`).toContain(cell!.gradedVerdict);
      expect(cell!.verdictNote?.length ?? 0, `${res}: verdictNote`).toBeGreaterThan(0);
      expect(existsSync(join(REPO, cell!.renderPath)), `${res}: renderPath`).toBe(true);
      expect(cell!.glbBytes, `${res}: glbBytes`).toBeGreaterThan(0);
      const report = join(REPO, cell!.bakeReportPath);
      expect(existsSync(report), `${res}: ${cell!.bakeReportPath} must exist`).toBe(true);
      const parsed = JSON.parse(readFileSync(report, "utf8")) as { status?: string };
      expect(parsed.status, `${res}: bake status — the stage must have produced this cell`).toBe("baked");
    }
  });

  it.fails("(2) the three cells differ ONLY in bake resolution", () => {
    const ladder = ladderOrNull();
    expect(ladder !== null, `${LADDER} must exist`).toBe(true);
    const cells = RESOLUTIONS.map((res) => ladder!.cells.find((c) => c.bakeResolution === res)).filter(Boolean) as Cell[];
    expect(cells.length, "all three cells present").toBe(RESOLUTIONS.length);
    expect(
      new Set(cells.map((c) => c.triangles)).size,
      "a ladder that re-decimates per cell confounds bake resolution with triangle count and answers "
        + "nothing — every cell must be baked onto the SAME low rung",
    ).toBe(1);
    expect(
      new Set(cells.map((c) => c.sourceGlb)).size,
      "every cell must bake from the same high-res source",
    ).toBe(1);
  });

  it("(3) COUNTERWEIGHT: a non-escape verdict carries an orchestrator grade, never a computed one", () => {
    const ladder = ladderOrNull();
    if (ladder === null) return;
    const escapes = new Set(["inconclusive_blocked", "reject_measured", "other"]);
    for (const c of ladder.cells) {
      if (escapes.has(c.gradedVerdict)) continue;
      expect(
        c.gradedBy,
        `${c.bakeResolution}: the streaks were found by a 1:1 crop against a reference. No byte count, `
          + "deviation figure or component statistic sees them, so streaks_absent / _reduced / "
          + "_unchanged are the orchestrator's to write.",
      ).toBe("orchestrator_pixel_grade");
    }
  });

  it("(4) COUNTERWEIGHT: not ranked on deviation or share, and #702's graded result stands", () => {
    const ladder = ladderOrNull();
    if (ladder !== null) {
      expect(
        String(ladder.rankedBy ?? "").toLowerCase(),
        "deviation is a falsifier, not a rank, and it is specifically blind here — streaks ARE the "
          + "high-contrast content that raises it. Largest-component share is retired, wrong in both "
          + "directions on 2 of 4 in-range assets.",
      ).not.toMatch(/deviation|component|share/u);
    }
    const boxy = JSON.parse(readFileSync(BOXY_SWEEP, "utf8")) as {
      championPerSubject?: Record<string, { triangles?: number; mapped?: boolean }>;
    };
    expect(
      boxy.championPerSubject?.["pulse-oximeter"],
      "#702's landed grade is pulse-oximeter 25k MAPPED. Editing it so a resolution cell looks "
        + "better would rewrite a graded result rather than measure a new variable.",
    ).toEqual({ triangles: 25000, mapped: true });
  });
});

// NOT TESTED: whether the streaks are visible at learner viewing distance in a station, which no
// capture has established and which decides whether any of this matters. Nor whether bake resolution
// interacts with the low rung's triangle count — clause (2) deliberately holds triangles fixed, so
// this ladder cannot see that interaction. Nor whether the glucometer's clean result at 512 is
// because its concavities are shallower or for some other reason entirely.
