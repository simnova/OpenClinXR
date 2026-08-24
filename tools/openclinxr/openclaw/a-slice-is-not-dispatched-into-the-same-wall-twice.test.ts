import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeSessions, shouldRefuseDispatch, type BreakerRow } from "./retry-circuit-breaker.js";

/**
 * **OBSERVABLE: the breaker fires on the two measured storms and on nothing else.**
 *
 * The fixture is REAL ledger rows, not a synthetic stand-in — `issue-341` and `issue-436` are the
 * actual storms, and the six control slices are ordinary multi-session slices from the same ledger
 * that must stay dispatchable. A fixture that does not exhibit the failure class proves nothing.
 *
 * MEASURED: 33 of 584 dispatch sessions went to those two slices; they hold 16 of 62 proof failures.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "fixtures/retry-storm-ledger.json");
const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  stormSlices: string[]; controlSlices: string[]; rows: BreakerRow[];
};
/** Evaluate as of just after the newest row, so the windows are live. */
const NOW = Math.max(...fx.rows.map((r) => (r.at ? Date.parse(r.at) : 0))) + 1000;

describe("a slice is not dispatched into the same wall twice", () => {
  // MEASURED trigger instants — the moment a LIVE breaker would have seen the second event.
  // issue-436: one-turn cancellations at 03:57:06.139Z and 03:57:21.389Z, FIFTEEN SECONDS apart.
  // issue-341: 150-turn cancellations at 08:58:41.705Z and 10:11:02.825Z, 1.2 h apart.
  // Evaluating at the END of a storm instead measures nothing: issue-341's last ceiling sits 45.1 h
  // after its sixth, so a 24 h window at that point legitimately holds one event. The breaker is a
  // live gate, and testing it at a dead time was my error, not the module's.
  const T436 = Date.parse("2026-08-19T03:57:21.389Z") + 1000;
  const T341 = Date.parse("2026-08-12T10:11:02.825Z") + 1000;

  it("(1) refuses issue-436 at its second one-turn cancellation — the environment is the wall", () => {
    const v = shouldRefuseDispatch(fx.rows, "issue-436", T436);
    expect(v.refuse, "issue-436 is a measured startup storm").toBe(true);
    if (v.refuse) expect(v.clause).toBe("startup-storm");
  });

  it("(2) refuses issue-341 at its second 150-turn ceiling — scope exceeds the budget", () => {
    const v = shouldRefuseDispatch(fx.rows, "issue-341", T341);
    expect(v.refuse, "issue-341 repeatedly cancelled at one ceiling").toBe(true);
    if (v.refuse) expect(v.clause).toBe("repeated-ceiling");
  });

  it("(3) firing at those instants is what makes it worth having — count the sessions saved", () => {
    const after = (slice: string, t: number) =>
      mergeSessions(fx.rows).filter((r) => r.slice === slice && r.at && Date.parse(r.at) > t).length;
    // Everything after the trigger is a dispatch the breaker would have refused.
    expect(after("issue-436", T436), "issue-436 sessions after its trigger").toBeGreaterThanOrEqual(9);
    expect(after("issue-341", T341), "issue-341 sessions after its trigger").toBeGreaterThanOrEqual(5);
  });

  it("(4) COUNTERWEIGHT: ordinary multi-session slices stay dispatchable", () => {
    // Without this, a breaker that refuses everything passes clauses (1) and (2).
    const refused = fx.controlSlices.filter((s) => shouldRefuseDispatch(fx.rows, s, NOW).refuse);
    expect(refused, `these are normal slices and must not trip: ${refused.join(", ")}`).toEqual([]);
    expect(fx.controlSlices.length, "the control set must be non-trivial").toBeGreaterThanOrEqual(4);
  });

  it("(5) counts by sessionId, not by row — the ledger writes up to 3 rows per session", () => {
    const rows436 = fx.rows.filter((r) => r.slice === "issue-436");
    const sessions436 = mergeSessions(rows436);
    expect(rows436.length, "rows outnumber sessions — this is why row counting trips early")
      .toBeGreaterThan(sessions436.length);
    // A single session, duplicated into many rows, must NOT look like a storm.
    const one = rows436.find((r) => r.stopReason === "cancelled" && (r.turns ?? 0) <= 1)!;
    const cloned = Array.from({ length: 6 }, () => ({ ...one }));
    expect(
      shouldRefuseDispatch(cloned, one.slice!, Date.parse(one.at!) + 1000).refuse,
      "six rows of ONE session is one attempt, not six",
    ).toBe(false);
  });

  it("(6) an empty or unrelated history never refuses", () => {
    expect(shouldRefuseDispatch([], "issue-999", NOW).refuse).toBe(false);
    expect(shouldRefuseDispatch(fx.rows, "issue-999", NOW).refuse).toBe(false);
  });
});
