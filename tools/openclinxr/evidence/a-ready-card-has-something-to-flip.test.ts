import { describe, expect, it } from "vitest";
import { readyDepth } from "../openclaw/supervisor-audit.js";

/**
 * OBSERVABLE: the supervisor audit counts a card as READY when every one of its proofs is already
 * satisfied — so a worker dispatched against it has nothing to flip.
 *
 * MEASURED. `readyDepth` (`supervisor-audit.ts:605`) filtered:
 *
 *     cards.filter((c) => c.dispatchable && c.planted && c.prioritized)
 *
 * No redness check anywhere, and `planted` is not a measurement — it is the board's
 * `factory == "Planted"` LABEL, i.e. somebody's claim that a RED exists.
 *
 * #510 satisfied all three and was unflippable. Its named proof runs `3 passed (3)` on main because
 * it is a COMPLETED licence measurement (`reject_measured` closes it successfully), not a mis-
 * contracted build card. A delegator probed it before dispatch and stopped; without that probe it
 * would have spent a worker on a card with no RED, against a fix path the card's own report proves
 * is licence-blocked.
 *
 * Running the proofs of the five product-forward cards at the time:
 *
 *     #181  2 passed | 1 expected fail   <- flippable
 *     #597  3 passed | 1 expected fail   <- flippable
 *     #510  3 passed (3)                 <- NOT flippable, counted as ready
 *     #588  only proof is exists:<absent json>  <- unmet, but satisfiable by writing the file
 *     #526  on HOLD, gate proven invalid
 *
 * So "5 product-forward ready" was really TWO. The chronic shortfall finding — reported for 31
 * consecutive audits — has been measuring against a number that never meant what it claimed.
 *
 * claimScope: whether a card with nothing to flip counts toward ready depth.
 * notEvidenceFor: whether any card's RED is a GOOD red; whether `planted` should exist at all; the
 *   `exists:`-satisfiable-by-writing-a-file weakness, which is a contract-design problem, not this.
 */

type Card = Parameters<typeof readyDepth>[0][number];
const card = (n: number, over: Partial<Card> = {}): Card => ({
  number: n, dispatchable: true, factoryStep: "staging", planted: true, prioritized: true, ...over,
} as Card);

describe("a ready card has something to flip", () => {
  it("(1) RED: a card whose proofs are all satisfied is NOT ready", () => {
    const d = readyDepth([card(1, { flippable: false } as Partial<Card>)]);
    expect(d.productForward, "nothing to flip means a worker has nothing to do").toBe(0);
    expect(d.cards).not.toContain(1);
  });

  it("(2) a card with at least one unmet proof IS ready", () => {
    const d = readyDepth([card(2, { flippable: true } as Partial<Card>)]);
    expect(d.productForward).toBe(1);
    expect(d.cards).toContain(2);
  });

  it("(3) COUNTERWEIGHT: unknown flippability still counts — silence is not exoneration", () => {
    // A card whose proofs cannot be evaluated cheaply must NOT be silently dropped from the queue.
    // Dropping on unknown would make the gauge read low for a reason nobody can see, which is the
    // report-clean-about-what-you-never-read defect inverted.
    const d = readyDepth([card(3)]);
    expect(d.productForward, "undetermined is not the same as unflippable").toBe(1);
  });

  it("(4) COUNTERWEIGHT: the other three gates still apply", () => {
    expect(readyDepth([card(4, { dispatchable: false, flippable: true } as Partial<Card>)]).productForward).toBe(0);
    expect(readyDepth([card(5, { planted: false, flippable: true } as Partial<Card>)]).productForward).toBe(0);
    expect(readyDepth([card(6, { prioritized: false, flippable: true } as Partial<Card>)]).productForward).toBe(0);
    expect(readyDepth([card(7, { factoryStep: "instrument", flippable: true } as Partial<Card>)]).productForward).toBe(0);
  });

  it("(5) VACUITY GUARD: the old rule genuinely counted the unflippable card", () => {
    const c = card(8, { flippable: false } as Partial<Card>);
    const oldRule = [c].filter((x) => x.dispatchable && x.planted && x.prioritized).length;
    expect(oldRule, "if the old rule already excluded it, this contract proves nothing").toBe(1);
    expect(readyDepth([c]).productForward).toBe(0);
  });
});
