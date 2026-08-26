import { describe, expect, it } from "vitest";
import { proofsCanDetectFlip } from "../openclaw/supervisor-audit.js";

/**
 * OBSERVABLE: a card can carry a genuine live RED, be correctly classified dispatchable and
 * flippable, and still have a `done_when` that CANNOT TELL whether the RED was flipped.
 *
 * MEASURED 2026-08-26 by running every dispatchable card's `run:` proof:
 *
 *     dispatchable with run: proofs — detects 1, CANNOT detect 8, no run: 2
 *
 * #181 #510 #526 #587 #593 #597 #600 #643 all exit ZERO today with their reds unflipped. Only #642
 * exits nonzero, and only because it currently carries a real regression.
 *
 * WHY, and it is structural rather than per-card: **vitest counts an expected failure as a pass.**
 * A planted `it.fails` that is still failing exits 0. Flip it to `it` and it exits 0. The `run:`
 * rule is satisfied identically before and after the work. `changed:<file>` is no better — touching
 * the file satisfies it.
 *
 * MEASURED on the live tree, the discriminating fact:
 *
 *     vitest run <file containing unflipped it.fails>  ->  EXIT 0
 *
 * Found by the delegator on #644, whose four proofs ALL PASSED while its three planted `it.fails`
 * were byte-identical to pre-dispatch. That worker stopped honestly, so it cost nothing — a worker
 * that did nothing at all would have gone green identically.
 *
 * This is the THIRD axis of readiness. `dispatchable` says a contract exists; `flippable` (added
 * after #510) says a RED exists; neither says the contract can SEE the flip.
 *
 * DELIBERATELY A READING, NOT A FILTER. Excluding undetectable cards would drop 8 of 9 and report a
 * queue of zero, which is less true than the number it replaces. The defect is in how contracts are
 * written repo-wide, and it is surfaced so it can be fixed at the source.
 *
 * claimScope: whether a card's own proofs change state when its RED is flipped.
 * notEvidenceFor: whether any card's RED is real; whether the work behind it is good; how to write a
 *   detecting contract — the shape (plant an ordinary `it()` asserting the FIXED state alongside the
 *   `it.fails`, so the suite reds until the work lands) is INFERRED and untested.
 */

describe("a done_when can detect its own flip", () => {
  it("(1) RED: a proof set that exits zero today cannot detect the flip", () => {
    expect(proofsCanDetectFlip([{ rule: "run:vitest x.test.ts", exitsNonZeroToday: false }])).toBe(false);
  });

  it("(2) a proof that currently FAILS can detect it", () => {
    expect(proofsCanDetectFlip([{ rule: "run:vitest x.test.ts", exitsNonZeroToday: true }])).toBe(true);
  });

  it("(3) any one detecting proof is enough", () => {
    expect(proofsCanDetectFlip([
      { rule: "run:vitest a.test.ts", exitsNonZeroToday: false },
      { rule: "run:vitest b.test.ts", exitsNonZeroToday: true },
    ])).toBe(true);
  });

  it("(4) COUNTERWEIGHT: unknown is not 'cannot' — it is undetermined", () => {
    // A card whose proofs were never executed must not be reported as undetectable. That would
    // manufacture a finding out of an absence of measurement, which is the defect this audit exists
    // to catch, pointed at itself.
    expect(proofsCanDetectFlip([{ rule: "changed:tools/x.py" }])).toBeUndefined();
    expect(proofsCanDetectFlip([])).toBeUndefined();
  });

  it("(5) VACUITY GUARD: the two states are genuinely distinguishable", () => {
    const undetectable = [{ rule: "run:vitest x.test.ts", exitsNonZeroToday: false }];
    const detectable = [{ rule: "run:vitest x.test.ts", exitsNonZeroToday: true }];
    expect(proofsCanDetectFlip(undetectable)).not.toBe(proofsCanDetectFlip(detectable));
  });
});
