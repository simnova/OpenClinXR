import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_AUDIT_GAP_MS,
  priorFindingKeys,
  priorReadyWindows,
  readyDepthTrend,
} from "../openclaw/supervisor-audit.js";

/**
 * OBSERVABLE: `readyDepthTrend` reports queue movement computed from the operator's own re-run
 * cadence, because `priorReadyWindows` reads raw history rows while its sibling collapses them.
 *
 * MEASURED on HEAD a3440ada. Two functions answer the same duty-1 question from the same history
 * file and use different windows:
 *
 *   priorFindingKeys   supervisor-audit.ts:185   if (lastMs - t < MIN_AUDIT_GAP_MS) continue;
 *   priorReadyWindows  supervisor-audit.ts:357   .slice(-limit)          <- no spacing at all
 *
 * `priorFindingKeys` carries the reason in its own comment: "running the audit three times inside
 * five minutes marked every finding CHRONIC, because recurrence counted invocations... the metric
 * would scream loudest exactly when someone is iterating on the audit itself." That is exactly the
 * defect `priorReadyWindows` still has.
 *
 * NOT HYPOTHETICAL. The live history at a3440ada carried rows at 13:34, 14:37, 14:39, 16:09, 16:21,
 * 16:22, 16:25 and 16:32 — three of them inside the 20-minute gap, all from one supervisor
 * iteration. With the rule applied, 8 raw rows collapse to 6 windows.
 *
 * WHAT THIS DOES NOT DO, measured before claiming it. The live verdict is UNCHANGED: with spacing
 * applied the trend still reports `CHURNING; entered 683, left 577`, because 16:09 and 16:32 are
 * 23 minutes apart and both survive. An earlier version of this header claimed the fix would
 * overturn that verdict. It does not, and the corrected claim is narrower: the two functions now
 * answer duty 1 over ONE window rule instead of two, and a burst entirely inside the gap can no
 * longer manufacture a movement verdict on its own.
 *
 * KNOWN-GOOD COLUMN: `priorFindingKeys` on the SAME rows, at the same timestamps, already collapses
 * them. Clause (2) pins that behaviour, so this is not a threshold invented here — the in-tree
 * sibling defines the window and the fix is to stop having two answers.
 *
 * claimScope: which history rows `priorReadyWindows` returns, and the trend computed from them.
 * notEvidenceFor: whether the ready-depth FLOOR of 3 is right, or whether a shortfall means work is
 *   missing. Duty 2's threshold is a separate question this clause does not touch.
 */

/** Minutes before a fixed reference instant, as an ISO string. */
const T0 = Date.parse("2026-08-26T16:32:00.000Z");
/** Explicit upper bound for the sibling's future-row guard. Every fixture row is before it. */
const NOW = T0 + 60_000;
const ago = (minutes: number) => new Date(T0 - minutes * 60_000).toISOString();

/**
 * Row values are ILLUSTRATIVE. The only properties under test are the timestamps' spacing and the
 * `cards` membership; the issue numbers are deliberately outside any real range so nothing here
 * reads as a statement about a particular card.
 */
function historyRoot(rows: Array<{ at: string; cards?: number[] }>): string {
  const root = mkdtempSync(join(tmpdir(), "ready-trend-"));
  mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
  writeFileSync(
    join(root, ".openclinxr/openclaw/supervisor-audit-history.jsonl"),
    `${rows.map((r) => JSON.stringify({ at: r.at, head: "0".repeat(40), keys: ["ready-depth-below-floor"], cards: r.cards })).join("\n")}\n`,
  );
  return root;
}

/**
 * The live shape: one genuinely old window, then a burst of re-runs inside the gap during which a
 * card appeared. Spaced windows: 240m and one of the burst. Raw windows: all five.
 */
const RERUN_BURST = [
  { at: ago(240), cards: [9001] },
  { at: ago(23), cards: [] },
  { at: ago(11), cards: [] },
  { at: ago(10), cards: [9002] },
  { at: ago(7), cards: [9002] },
  { at: ago(0), cards: [9002] },
];

describe("the ready-queue trend does not measure my own re-run cadence", () => {
  it("(1) collapses history rows closer together than MIN_AUDIT_GAP_MS", () => {
    const root = historyRoot(RERUN_BURST);
    const windows = priorReadyWindows(root, 6);
    const stamps = windows.map((w) => Date.parse(w.at)).sort((a, b) => a - b);
    const tooClose = stamps.slice(1).filter((t, idx) => t - stamps[idx]! < MIN_AUDIT_GAP_MS);
    expect(
      tooClose,
      "two windows inside the gap are one observation; keeping both lets the trend read the "
        + "operator's re-run cadence as queue movement",
    ).toEqual([]);
  });

  it("(2) KNOWN-GOOD: priorFindingKeys already collapses the identical rows", () => {
    const root = historyRoot(RERUN_BURST);
    expect(
      priorFindingKeys(root, 6, NOW).length,
      "the sibling function defines the window; if this ever exceeds the spaced count the "
        + "known-good column has moved and clause (1)'s threshold is no longer anchored",
    ).toBeLessThanOrEqual(3);
  });

  it("(3) a burst entirely inside one gap collapses to a single window", () => {
    // The property the fix actually has. CORRECTED after measuring: an earlier version of this
    // clause asserted the live 16:09 -> 16:32 CHURNING verdict would change, and it does not —
    // those two rows are 23 minutes apart and both survive the 20-minute rule. The spacing change
    // removes re-run noise; it does not overturn a verdict computed across genuinely spaced rows.
    const root = historyRoot([
      { at: ago(14), cards: [] },
      { at: ago(9), cards: [] },
      { at: ago(4), cards: [9002] },
      { at: ago(0), cards: [9002] },
    ]);
    const windows = priorReadyWindows(root, 6);
    expect(windows.length, "four re-runs inside 14 minutes are ONE observation").toBe(1);
    expect(
      readyDepthTrend(windows).status,
      "one window cannot support a movement verdict; reporting churn from a single burst is the "
        + "gauge reading the operator's re-run cadence",
    ).toBe("unknown");
  });

  it("(4) COUNTERWEIGHT: genuinely spaced windows are all kept", () => {
    const root = historyRoot([
      { at: ago(300), cards: [9001] },
      { at: ago(200), cards: [9001, 9002] },
      { at: ago(100), cards: [9002] },
      { at: ago(25), cards: [9003] },
    ]);
    const windows = priorReadyWindows(root, 6);
    expect(
      windows.length,
      "over-collapsing would blind the trend entirely; four windows 75+ minutes apart are four "
        + "genuine observations",
    ).toBe(4);
  });

  it("(5) COUNTERWEIGHT: a window with no recorded membership still yields unknown", () => {
    const root = historyRoot([
      { at: ago(300) },
      { at: ago(200), cards: [9001] },
      { at: ago(100), cards: [9002] },
    ]);
    const trend = readyDepthTrend(priorReadyWindows(root, 6));
    expect(
      trend.status,
      "rows written before card recording have no cards; reading that as an empty queue "
        + "fabricates DRAINING across the whole backfill",
    ).toBe("unknown");
  });

  it("(6) COUNTERWEIGHT: a genuinely churning queue across spaced windows still reads churning", () => {
    const root = historyRoot([
      { at: ago(300), cards: [9001, 9002] },
      { at: ago(200), cards: [9002] },
      { at: ago(100), cards: [9002, 9003] },
      { at: ago(25), cards: [9003, 9004] },
    ]);
    const trend = readyDepthTrend(priorReadyWindows(root, 6));
    expect(
      trend.status,
      "returning 'stagnant' or 'unknown' for everything is the cheapest way to pass clauses (1) "
        + "and (3) and would delete the signal duty 1 depends on",
    ).toBe("churning");
  });
});

// NOT TESTED: whether MIN_AUDIT_GAP_MS of 20 minutes is the right window for the TREND specifically.
// It is adopted here because the sibling already uses it for the chronic predicate and two windows
// answering one duty is the defect. Whether a trend needs a LONGER window than a recurrence counter
// is a real and separate question.
