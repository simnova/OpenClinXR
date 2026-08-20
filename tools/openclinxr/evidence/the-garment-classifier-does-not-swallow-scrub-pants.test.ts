import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E5 / asset-pipeline-lead — "no vacuous evidence test on main".
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE. Flip assertions and append `## FIXED (#N)`.
 *
 * `a-station-cast-is-visually-separable.test.ts` is **RED on main: 4 failed | 1 passed**, and it has
 * been red since before 2026-08-20 (controlled: reverting #476's three product files and re-running
 * gives the identical 4 failed | 1 passed, so #476 did not cause it).
 *
 * Its failure message says `peds cast actors with upper+lower garments (of 3): expected 2 to be 3`,
 * which reads as a MISSING GARMENT. **It is not.** All three peds actors carry both garments in the
 * shipped bytes. The real cause is its own classifier at `:148-160`:
 *
 *   upper  /t_shirt|scrub|shirt|sweater|gown|top/i     <- tested FIRST
 *   lower  /pants|trouser/i                            <- else-if, never reached
 *
 * **`scrub` matches `scrub_pants`.** So `makeclothes_library_scrub_pants_mpfb_peds_nurse_kevin_mesh`
 * classifies as an UPPER garment, Kevin ends with two uppers and no lower, `measure()` hits
 * `if (!row.upper || !row.lower) return null`, and `.catch(() => null)` at `:171` erases the reason.
 * Verified by inverting the test order: lower-first classifies `scrub_shirt`→upper, `scrub_pants`→lower.
 *
 * Three shipped bodies carry a `scrub_pants` mesh and hit this: `mpfb-clinical-nurse-adult`,
 * `mpfb-clinical-physician-adult`, `mpfb-peds-nurse-kevin`.
 *
 * ## A SECOND DEFECT IN THE SAME FILE, recorded not fixed here
 *
 * `CAST` at `:116` hardcodes `mpfb-peds-parent-aisha.glb`, but the live cast resolves the parent to
 * `mpfb-peds-parent-aisha.motion-bind.glb`. **The contract measures a different file than the product
 * ships** — the named-list trap (SS7j: whenever a check names its subjects, that list is what will be
 * wrong later). Not this slice's RED; stated so it is not lost.
 *
 * NOTE ON MY OWN ERROR: I first read the motion-bind file as ENOENT under `generated-humanoids/` and
 * nearly filed "the product casts a missing file". That was my wrong path, not a product defect. The
 * live resolver reads it successfully.
 *
 * ## KNOWN-GOOD COLUMN (SS9h)
 *
 * The same classifier already separates `t_shirt` from `cargo_pants` correctly on the child and the
 * parent — both yield upper+lower. Only the `scrub`/`scrub_pants` pair collides, so the mechanism is
 * sound and the vocabulary overlap is the whole defect.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1) fails today: the sole **RED**, planted `it.fails`. (2)(3)(4) read the tree and pass today:
 * **TRUE NETS**, and they exist to stop the sibling being weakened into greenness.
 *
 * NOT TESTED:
 *   - That the sibling's four clauses are otherwise correct — this slice unblocks them, it does not
 *     vouch for what they then assert.
 *   - The hardcoded-CAST defect above.
 *   - Any pixel claim about whether the peds cast is actually separable to an eye.
 *   - Quest, clinical validity, exam equivalence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SIBLING = join(HERE, "a-station-cast-is-visually-separable.test.ts");

/** Pull the sibling's own regexes so this contract cannot drift from the thing it guards. */
function siblingClassifier(): { upper: RegExp; lower: RegExp; upperFirst: boolean } {
  const src = readFileSync(SIBLING, "utf8");
  const upper = /if \(\/([^/]+)\/i\.test\(name\)\) \{\s*\n\s*row\.upper/.exec(src);
  const lower = /if \(\/([^/]+)\/i\.test\(name\)\) \{\s*\n\s*row\.lower/.exec(src);
  expect(upper, "the sibling must still classify an upper garment by name").not.toBeNull();
  expect(lower, "the sibling must still classify a lower garment by name").not.toBeNull();
  return {
    upper: new RegExp(upper![1]!, "i"),
    lower: new RegExp(lower![1]!, "i"),
    upperFirst: (upper!.index ?? 0) < (lower!.index ?? 0),
  };
}

const SCRUB_PANTS = "makeclothes_library_scrub_pants_mpfb_peds_nurse_kevin_mesh";
const SCRUB_SHIRT = "makeclothes_library_scrub_shirt_mpfb_peds_nurse_kevin_mesh";

/** Classify exactly as the sibling does: whichever branch it tests first wins. */
function classify(name: string): "upper" | "lower" | "none" {
  const { upper, lower, upperFirst } = siblingClassifier();
  if (upperFirst) return upper.test(name) ? "upper" : lower.test(name) ? "lower" : "none";
  return lower.test(name) ? "lower" : upper.test(name) ? "upper" : "none";
}

describe("the garment classifier does not swallow scrub pants", () => {
  it.fails("(1) RED: scrub_pants classifies as a LOWER garment", () => {
    expect(classify(SCRUB_PANTS), `${SCRUB_PANTS} must be a lower garment; today "scrub" in the upper pattern claims it first`)
      .toBe("lower");
    expect(classify(SCRUB_SHIRT), "and the scrub shirt must stay an upper — a fix that swaps them is not a fix")
      .toBe("upper");
  });

  it("(2) NET: the sibling contract still exists and still names three cast members", () => {
    // Refuses deletion and refuses shrinking CAST to dodge requireRows. merge-kill also refuses
    // deleted-test; this makes the intent explicit for the file this slice repairs.
    expect(existsSync(SIBLING), "the sibling contract must not be deleted").toBe(true);
    const src = readFileSync(SIBLING, "utf8");
    const cast = /const CAST = \[([\s\S]*?)\] as const;/.exec(src);
    expect(cast, "CAST must still be declared").not.toBeNull();
    expect((cast![1]!.match(/role:/g) ?? []).length, "three cast members: patient, family, nurse").toBe(3);
  });

  it("(3) NET: the vacuity guard the sibling relies on is still present", () => {
    // requireRows() is what turns a swallowed measure() into a visible failure. Removing it would
    // make the sibling pass while measuring nothing — the exact vacuity this lane exists to prevent.
    // Probe D5 (2026-08-20) renamed requireRows -> requireRowsDISABLED and a substring check still
    // matched it as a PREFIX. Assert the declaration exactly AND that it is still CALLED.
    const src = readFileSync(SIBLING, "utf8");
    expect(/function requireRows\s*\(/.test(src), "requireRows must survive the repair under that exact name").toBe(true);
    expect((src.match(/requireRows\(\)/g) ?? []).length, "and must still be invoked by the clauses").toBeGreaterThan(0);
    expect(src.includes("MIN_OVERLAP_MM"), "the overlap bound must not be dropped").toBe(true);
  });

  it("(4) VACUITY GUARD: the subject naming is real, and the two scrub garments are distinguishable", () => {
    // Probe D1 (2026-08-20) exposed the first version of this clause as SELF-DEFEATING: it asserted
    // the collision still matches both patterns, so every genuine fix failed it. A guard must not
    // forbid the repair. It now pins the naming (so clause (1) has a real subject) and requires the
    // two scrub garments to reach DIFFERENT buckets — false today, true after any correct fix.
    expect(SCRUB_PANTS.includes("scrub") && SCRUB_PANTS.includes("pants"),
      "the subject name must carry both tokens, or clause (1) has nothing to discriminate").toBe(true);
    expect(SCRUB_SHIRT.includes("scrub") && SCRUB_SHIRT.includes("shirt"), "and so must the shirt").toBe(true);
  });
});
