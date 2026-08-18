import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E5 slice 2 (#422) — A RATIO WHOSE DENOMINATOR IS A DIFFERENT GARMENT IS NOT A PASS.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * #427 landed honest membership: all seven shipped MPFB trouser actors, enumerated from disk. One
 * row is green for the wrong reason.
 *
 * | actor | waist hfP95 | hem hfP95 | ratio |
 * |---|---:|---:|---:|
 * | mpfb-clinical-nurse-adult     | 1.880 | 0.475 | 3.958 |
 * | mpfb-peds-nurse-kevin         | 1.880 | 0.475 | 3.958 |
 * | mpfb-ob-patient-aisha         | 4.106 | 1.234 | 3.327 |
 * | mpfb-peds-parent-aisha        | 4.106 | 1.234 | 3.327 |
 * | mpfb-peds-patient-child       | 2.500 | 1.471 | 1.700 |
 * | mpfb-family-partner-adult     | 1.673 | 1.051 | 1.592 |
 * | **mpfb-clinical-physician-adult** | 1.880 | **7.869** | **0.239** |
 *
 * The physician's denominator is **5.3x to 16.6x** every other hem. Measured cause — one actor in
 * seven wears two upper garments:
 *
 *     mpfb-clinical-physician-adult  upper=[lab_coat, scrub_shirt]   <-- ambiguous hem
 *     every other actor              upper=[exactly one]             <-- unambiguous
 *
 * So 0.239 is not a smooth waistband; it is a **lab-coat hem** standing in for a shirt hem. A ratio
 * built that way passes on any waistband however ragged, because the denominator can absorb it.
 * That is the SS11s shape: the bound is on a quantity, and the defect lives in which geometry the
 * quantity was taken from.
 *
 * ## THE DISCRIMINATOR IS DERIVED, NOT A NAME LIST
 *
 * Comparability follows from **how many upper garments the actor carries**, measured from the GLB.
 * One upper garment -> the hem ring is unambiguous -> comparable. Two or more -> not comparable,
 * and the report must say which garments made it ambiguous. Nothing here keys on the string
 * "physician": if a second actor gains a lab coat tomorrow it is caught by the same rule, and if
 * the physician loses its coat it becomes comparable with no edit.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                     | (1) | (2) | (3) | (4) | result
 *   ----------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no per-garment provenance in the artifact          |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) drop the physician row so every remaining row is clean     |FAIL |FAIL | pass| pass| REFUSED
 *   c) mark EVERY row notComparable — nothing is asserted         | pass|FAIL | pass| pass| REFUSED
 *   d) keep the physician as a PASS at 0.239                      | pass|FAIL | pass| pass| REFUSED
 *   e) name both ring sources, derive comparable, six asserted    | pass| pass| pass| pass| ALL PASS
 *
 * **(b) is the one to watch** — deleting the awkward row is the fastest green and it is exactly how
 * the population got to three in the first place (#427). Clause (1) requires all seven present.
 *
 * Row (c) col (1) was corrected from probe output: marking rows incomparable leaves their
 * provenance intact, so only clause (2) catches it. That is the clause's whole job.
 *
 * **(c) is the vacuity route.** Marking everything incomparable asserts nothing at all. Clause (2)
 * requires at least six comparable, which is what the shipped bytes support today.
 *
 * ## DO NOT
 *
 * Do not raise `MAX_WAISTBAND_TO_HEM_HF_RATIO` — it stays 4, and clause (3) reads it. Do not "fix"
 * the lab-coat hem; no bake, no geometry change. Do not drop the physician silently.
 *
 * ## KNOWN-GOOD COLUMN — shipped bytes, same instrument
 *
 * `mpfb-family-partner-adult` 1.592 and `mpfb-peds-patient-child` 1.700, measured by #427 on the
 * bytes under test. Unlike the column I planted in #427, these describe **today's** artifact rather
 * than a historical measurement of a subject that has since been fixed — that error is recorded in
 * #427's FIXED block and is not repeated here.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1) and (2) are RED** — no artifact carries ring
 * provenance. **(3) passes today** (reads the untouched constant). **(4) is a net** that becomes
 * load-bearing once (1) is green.
 *
 * NOT TESTED: whether any waistband looks right (no pixel grade); the identity twins on #424
 * (clinical-nurse == kevin, aisha == peds-parent are byte-identical, and the physician's meshes are
 * named `..._ed_chest_pain_nurse_adult_mesh`); the lab coat's own hem quality; any bake.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const EXISTING = join(REPO_ROOT, "tools/openclinxr/evidence/the-waistband-is-as-smooth-as-the-hem.test.ts");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/waistband-ratio-provenance.json");

/** Measured from the shipped GLBs 2026-08-18. One actor in seven carries two upper garments. */
const AMBIGUOUS_ACTOR = "mpfb-clinical-physician-adult";
const EXPECTED_ROWS = 7;
const MIN_COMPARABLE = 6;
/** #427's shipped-bytes values — today's artifact, not a historical one. */
const KNOWN_GOOD: Record<string, number> = {
  "mpfb-family-partner-adult": 1.592,
  "mpfb-peds-patient-child": 1.700,
};
const TOLERANCE = 0.1;

type Row = {
  actor: string;
  waistRingMesh: string;
  hemRingMesh: string;
  upperGarments: string[];
  comparable: boolean;
  notComparableReason?: string;
  ratio: number;
};

function rows(): Row[] {
  expect(existsSync(ARTIFACT), `${ARTIFACT} — E5.2 writes this`).toBe(true);
  const d = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { rows: Row[] };
  return d.rows ?? [];
}

describe("the waistband ratio compares rings from one garment pairing", () => {
  it("(1) RED: every row names the mesh behind BOTH rings and its upper-garment set", () => {
    // Refuses (b) and (c)'s cousin: a ratio with no provenance cannot be audited at all.
    const r = rows();
    expect(r.length, "all shipped MPFB trouser actors must still be present").toBe(EXPECTED_ROWS);
    for (const row of r) {
      expect(row.waistRingMesh, `${row.actor}: mesh that supplied the waist ring`).toBeTruthy();
      expect(row.hemRingMesh, `${row.actor}: mesh that supplied the hem ring`).toBeTruthy();
      expect(Array.isArray(row.upperGarments) && row.upperGarments.length > 0, `${row.actor}: upperGarments`).toBe(true);
      expect(typeof row.comparable, `${row.actor}: comparable`).toBe("boolean");
    }
  });

  it("(2) COUNTERWEIGHT: comparability is derived from the garment count, and six rows stay asserted", () => {
    // Refuses (c) — marking everything incomparable asserts nothing — and (d), passing 0.239.
    const r = rows();
    for (const row of r) {
      const derived = row.upperGarments.length === 1;
      expect(row.comparable, `${row.actor}: comparable must equal (upperGarments.length === 1)`).toBe(derived);
      if (!row.comparable) {
        expect(row.notComparableReason, `${row.actor}: must say which garments made the hem ambiguous`).toBeTruthy();
      }
    }
    const amb = r.find((x) => x.actor === AMBIGUOUS_ACTOR);
    expect(amb, `${AMBIGUOUS_ACTOR} must be PRESENT, not dropped`).toBeTruthy();
    expect(amb!.comparable, `${AMBIGUOUS_ACTOR} wears a lab coat over a scrub shirt`).toBe(false);
    expect(r.filter((x) => x.comparable).length, "comparable rows still asserted").toBeGreaterThanOrEqual(MIN_COMPARABLE);
  });

  it("(3) COUNTERWEIGHT: the 4x bound is untouched and every COMPARABLE row is under it", () => {
    const src = readFileSync(EXISTING, "utf8");
    expect(src, "MAX_WAISTBAND_TO_HEM_HF_RATIO must remain 4").toMatch(
      /const MAX_WAISTBAND_TO_HEM_HF_RATIO\s*=\s*4\s*;/,
    );
    if (!existsSync(ARTIFACT)) return;
    const over = rows().filter((x) => x.comparable && x.ratio > 4).map((x) => `${x.actor} ${x.ratio}`);
    expect(over, "comparable rows above the bound").toEqual([]);
  });

  it("(4) KNOWN-GOOD: two shipped-bytes ratios are reproduced", () => {
    if (!existsSync(ARTIFACT)) return;
    for (const [actor, expected] of Object.entries(KNOWN_GOOD)) {
      const row = rows().find((x) => x.actor === actor);
      expect(row, `${actor} must be measured`).toBeTruthy();
      expect(Math.abs(row!.ratio - expected), `${actor}: ${row!.ratio} vs #427's ${expected}`).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
