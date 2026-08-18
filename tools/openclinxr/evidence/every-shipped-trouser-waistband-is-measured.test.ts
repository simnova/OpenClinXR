import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E5 slice 1 (#422) — MEMBERSHIP, NOT THE BOUND.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * `the-waistband-is-as-smooth-as-the-hem.test.ts:157` hardcodes its population:
 *
 *     const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"]
 *
 * Enumerating `apps/ui-xr/public/generated-humanoids/*.glb` and keeping every file with a mesh
 * matching /pants|trouser|cargo/ gives **seven** MPFB actors carrying trousers. The contract
 * measures **three**. Four ship unmeasured:
 *
 * | actor | trouser mesh | measured by #373? |
 * |---|---|---|
 * | mpfb-ob-patient-aisha        | cargo_pants  | yes |
 * | mpfb-peds-nurse-kevin        | scrub_pants  | yes |
 * | mpfb-peds-patient-child      | cargo_pants  | yes |
 * | **mpfb-clinical-nurse-adult**     | scrub_pants  | **NO** |
 * | **mpfb-clinical-physician-adult** | scrub_pants  | **NO** |
 * | **mpfb-family-partner-adult**     | cargo_pants  | **NO** |
 * | **mpfb-peds-parent-aisha**        | cargo_pants  | **NO** |
 *
 * **The existing vacuity guard cannot see this.** It asserts `rows.length === ACTORS.length` —
 * the list checked against itself. It is satisfied by any hardcoded list, including a list of one.
 * That is the #373 test being green about three sevenths of the rail (SS7j: whenever a check names
 * its subjects explicitly, that list is the thing that will be wrong later).
 *
 * ## WHAT THIS SLICE IS NOT
 *
 * **It does not raise `MAX_WAISTBAND_TO_HEM_HF_RATIO`.** That constant stays 4. Clause (3) refuses
 * any change to it.
 *
 * **It does not require the four new actors to PASS the 4x bound, and it must not.** Their rings
 * are unmeasured; some may be ragged. Making them pass would need a bake, which is out of scope for
 * this slice. This contract asserts that they are MEASURED and their numbers RECORDED — the ratio
 * is data here, not an assertion. A membership contract that smuggled in a pass requirement would
 * force exactly the bake it forbids.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                    | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — three hardcoded actors                            |FAIL |FAIL | pass| pass| REFUSED
 *   b) append the four names to the hardcoded list               |FAIL | pass| pass| pass| REFUSED
 *   c) enumerate from disk, but raise the bound so all 7 pass    | pass| pass|FAIL | pass| REFUSED
 *   d) enumerate from disk, then filter the ragged ones back out |FAIL |FAIL | pass| pass| REFUSED
 *   e) enumerate from disk, record every ratio, bound untouched  | pass| pass| pass| pass| ALL PASS
 *
 * **(b) is the one to watch.** Adding four strings satisfies the letter of "measure seven" and
 * leaves the defect exactly where it was — the eighth actor will be missed the same way. Clause (1)
 * requires the artifact to declare the directory it walked and the count it found there, so a
 * hardcoded list cannot satisfy it.
 *
 * Row (d) column (1) was measured, not predicted: filtering the ragged actors also drops the row
 * count below seven, so (1) refuses it too. I had predicted (1) would pass. Probe output is the
 * record.
 *
 * **(d) is the subtle one.** Once enumeration is honest, the fastest route to a quiet artifact is to
 * drop the actors whose rings are rough. Clause (2) pins the four by name.
 *
 * ## KNOWN-GOOD COLUMN — #373's own immutable table
 *
 * The three already-measured actors have published hfP95 ratios: **aisha 9.4x, kevin 23.0x,
 * child 8.4x**. Clause (4) requires the artifact to reproduce them within 15%, which proves the
 * worker measured with the same instrument rather than inventing a second one that happens to be
 * quiet. Those numbers are IMMUTABLE — they are #373's recorded measurement, not a target.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1) and (2) are RED** — no artifact exists. **(3) and
 * (4) pass today**: (3) reads the untouched constant on main, (4) reads the absent artifact via a
 * guard that tolerates absence only while (1) is red. Once (1) is green, (4) becomes load-bearing.
 *
 * NOT TESTED: whether any waistband is actually smooth; whether the four new actors clear 4x (data,
 * not assertion); the cause of any raggedness; any bake; the anny rail (`peds_*`, `ed_*`,
 * `adult_male_street_casual`) which is out of the MPFB scope of #373.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const EXISTING = join(REPO_ROOT, "tools/openclinxr/evidence/the-waistband-is-as-smooth-as-the-hem.test.ts");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/waistband-membership.json");

/** Measured 2026-08-18 by enumerating the shipped directory. Not a target — the current population. */
const UNMEASURED_TODAY = [
  "mpfb-clinical-nurse-adult",
  "mpfb-clinical-physician-adult",
  "mpfb-family-partner-adult",
  "mpfb-peds-parent-aisha",
] as const;
/** #373's immutable published ratios. */
const PUBLISHED_RATIO: Record<string, number> = {
  "mpfb-ob-patient-aisha": 9.4,
  "mpfb-peds-nurse-kevin": 23.0,
  "mpfb-peds-patient-child": 8.4,
};
const RATIO_TOLERANCE = 0.15;

type Row = { actor: string; trouserMesh: string; waistHfP95Mm: number; hemHfP95Mm: number; ratio: number };
type Membership = { enumeratedFrom?: string; glbFilesScanned?: number; rows: Row[] };

function membership(): Membership {
  expect(existsSync(ARTIFACT), `${ARTIFACT} — E5 writes this; the rail has never been enumerated`).toBe(true);
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Membership;
}
/** Ground truth, recomputed here so the artifact cannot under-report the population. */
const shippedGlbCount = (): number =>
  existsSync(GENERATED) ? readdirSync(GENERATED).filter((f) => f.endsWith(".glb")).length : 0;

describe("every shipped MPFB trouser waistband is in the measured population", () => {
  it("(1) RED: the population is enumerated from the shipped directory, not from a literal list", () => {
    const m = membership();
    expect(m.enumeratedFrom, "the artifact must name the directory it walked").toMatch(/generated-humanoids/);
    expect(m.glbFilesScanned, "GLB files scanned must match what ships today").toBe(shippedGlbCount());
    expect(m.rows.length, "MPFB actors carrying a trouser mesh").toBeGreaterThanOrEqual(7);
  });

  it("(2) COUNTERWEIGHT: the four unmeasured actors are present by name, not filtered back out", () => {
    const m = membership();
    const have = new Set(m.rows.map((r) => r.actor));
    const missing = UNMEASURED_TODAY.filter((a) => !have.has(a));
    expect(missing, `shipped with trousers and still unmeasured: ${missing.join(", ")}`).toEqual([]);
    for (const a of UNMEASURED_TODAY) {
      const row = m.rows.find((r) => r.actor === a)!;
      expect(Number.isFinite(row?.ratio), `${a}: ratio must be RECORDED (a rough ring is data, not a failure)`).toBe(true);
    }
  });

  it("(3) COUNTERWEIGHT: the 4x bound is untouched", () => {
    // Refuses (c). Widening the bound is the one-line route to a quiet rail and is forbidden.
    const src = readFileSync(EXISTING, "utf8");
    expect(src, "MAX_WAISTBAND_TO_HEM_HF_RATIO must remain 4").toMatch(
      /const MAX_WAISTBAND_TO_HEM_HF_RATIO\s*=\s*4\s*;/,
    );
  });

  it("(4) KNOWN-GOOD: the three published ratios are reproduced within 15%", () => {
    // Proves the same instrument was used. Tolerant of absence only while (1) is red.
    if (!existsSync(ARTIFACT)) return;
    const m = JSON.parse(readFileSync(ARTIFACT, "utf8")) as Membership;
    for (const [actor, published] of Object.entries(PUBLISHED_RATIO)) {
      const row = m.rows.find((r) => r.actor === actor);
      expect(row, `${actor} is in #373's table and must be in the artifact`).toBeTruthy();
      const drift = Math.abs(row!.ratio - published) / published;
      expect(drift, `${actor}: artifact ${row!.ratio} vs #373's published ${published}`).toBeLessThanOrEqual(RATIO_TOLERANCE);
    }
  });
});
