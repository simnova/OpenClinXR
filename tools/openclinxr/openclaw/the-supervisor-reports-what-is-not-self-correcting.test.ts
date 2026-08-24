import { describe, expect, it } from "vitest";
import { CHRONIC_AFTER, READY_DEPTH_TARGET, markChronic, readyDepth, resolvedSince, verifyDoneClaim } from "./supervisor-audit.js";
import type { Finding } from "./supervisor-audit.js";

/**
 * OBSERVABLE: the supervisor loop's four duties are measurements, and each has a way to lie.
 *
 * Operator directive 2026-08-24 — each iteration must (1) find issues that are NOT self-correcting,
 * (2) keep >= 10 prioritized ready items that move the PRODUCT forward, (3) re-verify work reported
 * done, (4) issue corrections.
 *
 * Each clause below pins the specific way its duty degrades into a number that looks fine:
 *
 *   duty 1  "chronic" reported for a finding seen ONCE — every transient becomes an alarm, and the
 *           real chronic ones drown. Recurrence is not a property of a finding; it is a property of
 *           a finding SEEN AGAIN, which is why this module keeps history at all.
 *   duty 2  a ready set of ten INSTRUMENT cards satisfying a directive about moving the product
 *           forward. `board-brief.ts` already names `instrument` as the non-station; the floor reads
 *           from that same enum rather than from an opinion.
 *   duty 3  a commit that cites an issue treated as proof the work landed. MEASURED 2026-08-24: I
 *           closed #596 on a `grep VERIFIED` that also matched UNVERIFIED, against a commit never on
 *           main, and reopened it four minutes later. Existing is not landing.
 *
 * claimScope: the recurrence, ready-depth and done-verification predicates.
 * notEvidenceFor: whether any finding matters, whether a landed change was CORRECT (this cannot
 *   re-run contracts or grade pixels), or the cadence of the loop itself.
 */

const f = (key: string, duty: 1 | 2 | 3 | 4 = 1): Finding => ({ duty, key, detail: key });

describe("the supervisor reports what is not self-correcting", () => {
  it("(1) DUTY 1: a finding seen once is not chronic", () => {
    const prior = [["other-a"], ["other-b"]];
    const [only] = markChronic([f("seen-once")], prior);
    expect(only!.chronic, "one sighting is a transient, not a pattern").toBeFalsy();
  });

  it("(2) DUTY 1: a finding present in every prior audit IS chronic", () => {
    const prior = Array.from({ length: CHRONIC_AFTER }, () => ["stuck-thing"]);
    const [only] = markChronic([f("stuck-thing")], prior);
    expect(only!.chronic).toBe(true);
    expect(only!.occurrences).toBe(CHRONIC_AFTER + 1);
  });

  it("(3) DUTY 1 COUNTERWEIGHT: a FLICKERING finding is not chronic", () => {
    // present, gone, present. It is self-correcting under load, and calling it chronic would bury
    // the ones that never clear. EVERY prior run must carry it, not ANY.
    const prior = [["flicker"], ["something-else"]];
    const [only] = markChronic([f("flicker")], prior);
    expect(only!.chronic, "an unbroken run is required, not a majority").toBeFalsy();
  });

  it("(4) DUTY 1: a finding that vanished is REPORTED as resolved, not silently dropped", () => {
    const resolved = resolvedSince([f("still-here")], [["still-here", "went-away"]]);
    expect(resolved, "a defect that fixed itself is information, not absence").toEqual(["went-away"]);
  });

  it("(5) DUTY 2: ten instrument cards do NOT satisfy a product-forward floor", () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({
      number: 900 + i, dispatchable: true, planted: true, prioritized: true, factoryStep: "instrument",
    }));
    const d = readyDepth(cards);
    expect(d.includingInstrument, "twelve are ready...").toBe(12);
    expect(d.productForward, "...and none moves a factory station").toBe(0);
    expect(d.shortfall).toBe(READY_DEPTH_TARGET);
  });

  it("(6) DUTY 2 COUNTERWEIGHT: real stations count, and unready cards never do", () => {
    const cards = [
      { number: 1, dispatchable: true, planted: true, prioritized: true, factoryStep: "body_param" },
      { number: 2, dispatchable: true, planted: true, prioritized: true, factoryStep: "clothing_generate" },
      { number: 3, dispatchable: true, planted: false, prioritized: true, factoryStep: "room_generate" },   // not Planted
      { number: 4, dispatchable: false, planted: true, prioritized: true, factoryStep: "lip_sync" },        // no contract
      { number: 5, dispatchable: true, planted: true, prioritized: false, factoryStep: "staging" },         // unprioritized
    ];
    const d = readyDepth(cards);
    expect(d.productForward, "only #1 and #2 are ready AND product-forward").toBe(2);
    expect(d.cards).toEqual([1, 2]);
    expect(d.shortfall).toBe(READY_DEPTH_TARGET - 2);
  });

  it("(7) DUTY 3: a card claiming done with NO commit citing it fails verification", () => {
    // 999999 is not an issue in this repo, so nothing can cite it.
    const c = verifyDoneClaim(process.cwd(), 999999, "Landed");
    expect(c.ok).toBe(false);
    expect(c.commitOnMain).toBe(false);
    expect(c.why).toContain("no commit cites");
  });

  it("(8) DUTY 3 COUNTERWEIGHT: a genuinely landed slice verifies", () => {
    // #627's RED was planted in ccab1942 and is an ancestor of main. If this clause ever fails, the
    // verifier has become unable to see real work, which is worse than missing a fake claim.
    const c = verifyDoneClaim(process.cwd(), 627, "Landed");
    expect(c.commitOnMain, "ccab1942 cites #627 and is on main").toBe(true);
    expect(c.ok).toBe(true);
  });
});
