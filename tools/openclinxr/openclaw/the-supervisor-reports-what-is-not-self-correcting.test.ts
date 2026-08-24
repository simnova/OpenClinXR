import { describe, expect, it } from "vitest";
import { CHRONIC_AFTER, MIN_AUDIT_GAP_MS, READY_DEPTH_TARGET, markChronic, priorFindingKeys, readyDepth, resolvedSince, verifyDoneClaim } from "./supervisor-audit.js";
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

  it("(9) DUTY 3 COUNTERWEIGHT: discussing an issue is not fixing it", () => {
    // FOUND BY THIS MODULE'S OWN FIRST LIVE RUN. #181 and #622 each matched four commits, two of
    // which were the supervisor's own commits whose BODIES read "#181 and #622 are verified Landed
    // and still OPEN". The audit's prose about a card counted as a claim the card was done.
    //
    // #632 is a card filed today and discussed in commit bodies, with NO `fix(#632)`/`feat(#632)`
    // subject anywhere. It must not read as a subject-line fix.
    const c = verifyDoneClaim(process.cwd(), 632, "Landed");
    expect(
      c.why,
      "a body mention must be labelled as such, not reported as a fix commit",
    ).toMatch(/MENTION ONLY|no commit cites/u);
  });

  it("(10) DUTY 3 COUNTERWEIGHT: a real conventional fix is still recognised as one", () => {
    // Refuses the over-correction of demanding a subject line so strictly that real work fails.
    // `ec5cbd42 fix(#181): distributed upper-spine/neck flex...` is exactly the conventional form.
    const c = verifyDoneClaim(process.cwd(), 181, "Landed");
    expect(c.ok).toBe(true);
    expect(c.why).toContain("subject-line fix commit");
  });

  it("(11) DUTY 1: three audits in five minutes are ONE observation, not three", () => {
    // FOUND ON THE FIRST LIVE DAY. Running the audit three times inside five minutes reported every
    // finding CHRONIC, because recurrence counted invocations. That makes "not self-correcting" a
    // function of how often someone hits enter — the metric would scream loudest exactly while a
    // person iterates on the audit itself.
    const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const root = mkdtempSync(join(tmpdir(), "sup-"));
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    const now = Date.parse("2026-08-24T12:00:00Z");
    // APPEND ORDER — oldest first, exactly as the real history jsonl is written. Writing it
    // newest-first made this fixture disagree with production and hid the real ordering.
    const rows = [2, 1, 0].map((i) => JSON.stringify({
      at: new Date(now - i * 60_000).toISOString(), keys: ["same-thing"],
    })).join("\n");
    writeFileSync(join(root, ".openclinxr/openclaw/supervisor-audit-history.jsonl"), `${rows}\n`);

    const prior = priorFindingKeys(root, CHRONIC_AFTER, now);
    expect(prior.length, "three runs one minute apart collapse to one observation").toBe(1);
    const [f] = markChronic([{ duty: 1, key: "same-thing", detail: "x" }], prior);
    expect(f!.chronic, "one real observation cannot establish chronic").toBeFalsy();
  });

  it("(12) DUTY 1 COUNTERWEIGHT: genuinely spaced audits DO establish chronic", () => {
    // Refuses the over-correction of spacing so aggressively that a real chronic finding never
    // qualifies. Two observations a full gap apart are exactly what the metric is for.
    const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const root = mkdtempSync(join(tmpdir(), "sup2-"));
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    const now = Date.parse("2026-08-24T12:00:00Z");
    const rows = [2, 1, 0].map((i) => JSON.stringify({
      at: new Date(now - i * (MIN_AUDIT_GAP_MS + 60_000)).toISOString(), keys: ["stuck"],
    })).join("\n");
    writeFileSync(join(root, ".openclinxr/openclaw/supervisor-audit-history.jsonl"), `${rows}\n`);

    const prior = priorFindingKeys(root, CHRONIC_AFTER, now);
    expect(prior.length).toBe(CHRONIC_AFTER);
    const [f] = markChronic([{ duty: 1, key: "stuck", detail: "x" }], prior);
    expect(f!.chronic, "spaced observations are what chronic means").toBe(true);
  });
});
