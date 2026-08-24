/**
 * **OBSERVABLE: the same slice cannot be dispatched into the same wall twice.**
 *
 * ## MEASURED 2026-08-24 over all 1,156 ledger rows — do not re-derive
 *
 * Two slices consumed 33 of 584 dispatch sessions between them and produced nothing:
 *
 *     issue-436   15 distinct sessions, 12 of them CANCELLED AT ONE TURN, 12 proof failures
 *     issue-341   18 distinct sessions, repeated cancellations at exactly 150 turns
 *
 * Those two account for 16 of 62 proof failures (25.8%). The headline 14.1% refusal rate falls to
 * 11.1% once they are removed, so a quarter of the factory's measured failure is one behaviour:
 * re-dispatching an unchanged slice into an unchanged wall.
 *
 * A one-turn cancellation is the single strongest signal in the whole ledger:
 *
 *     end_turn              39/395 proof failures   9.9%
 *     cancelled             23/45                  51.1%
 *     one-turn cancelled    12/12                 100.0%
 *
 * ## WHY THE COUNTS ARE BY sessionId AND NOT BY ROW
 *
 * The ledger writes 1-3 lifecycle rows per session (122 sessions have 1, 352 have 2, 110 have 3).
 * `issue-436`'s twelve one-turn cancellations appear as TWENTY-FOUR cancellation rows. A row-based
 * counter double-counts and trips at half the intended threshold.
 *
 * claimScope: whether an automatic re-dispatch of a slice should be refused from ledger history.
 * notEvidenceFor: whether the slice is worth doing, whether a human override should be refused, or
 * any judgement about the worker — a storm is orchestrator behaviour, not task difficulty.
 */

export type BreakerRow = {
  slice?: string;
  sessionId?: string;
  at?: string;
  turns?: number | null;
  stopReason?: string | null;
  proofsOk?: boolean | null;
};

export type BreakerVerdict =
  | { refuse: false }
  | { refuse: true; clause: "startup-storm" | "repeated-ceiling" | "repeated-proof-refusal"; detail: string };

/** Turn counts that are configured ceilings rather than a worker's own stopping point. */
const CEILINGS = [50, 80, 150, 200, 250];
const MIN_CEILING = 50;

/**
 * Merge non-null fields across every row sharing a sessionId.
 *
 * NOT optional. For 330 sessions the `proofsOk` verdict exists ONLY on a row whose `phase` is null,
 * and zero sessions carry it on both a null-phase and a "completed" row. Reading the last row per
 * session finds 12 verdicts of 584; merging finds 440. That undercount is 36x and it inverted an
 * expert reviewer's conclusion about whether the contract layer works at all.
 */
export function mergeSessions(rows: readonly BreakerRow[]): BreakerRow[] {
  const byId = new Map<string, BreakerRow>();
  for (const r of rows) {
    if (!r.sessionId) continue;
    const cur = byId.get(r.sessionId) ?? { sessionId: r.sessionId };
    for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined) (cur as Record<string, unknown>)[k] = v;
    byId.set(r.sessionId, cur);
  }
  return [...byId.values()];
}

const within = (row: BreakerRow, now: number, ms: number): boolean => {
  const t = row.at ? Date.parse(row.at) : Number.NaN;
  return Number.isFinite(t) && now - t <= ms && t <= now;
};

/**
 * Refuse an AUTOMATIC re-dispatch of `slice`. A human override is a separate decision and this
 * function does not model it — it answers "would a loop be repeating itself?", nothing more.
 */
export function shouldRefuseDispatch(
  rows: readonly BreakerRow[],
  slice: string,
  nowMs: number,
): BreakerVerdict {
  const mine = mergeSessions(rows).filter((r) => r.slice === slice);

  // A. STARTUP STORM — two one-turn cancellations in 30 minutes means the environment is the wall,
  //    not the task. issue-436 did this twelve times.
  const startup = mine.filter(
    (r) => r.stopReason === "cancelled" && (r.turns ?? 0) <= 1 && within(r, nowMs, 30 * 60_000),
  );
  if (startup.length >= 2) {
    return {
      refuse: true,
      clause: "startup-storm",
      detail: `${startup.length} one-turn cancellations for ${slice} in 30 min — the dispatch dies before the first turn. Change the environment, not the attempt.`,
    };
  }

  // B. REPEATED CEILING — the same turn ceiling hit twice in 24h means the scope exceeds the budget.
  //    issue-341 hit 150 repeatedly. Raising maxTurns without changing scope is the same attempt.
  const day = mine.filter((r) => r.stopReason === "cancelled" && within(r, nowMs, 24 * 60 * 60_000));
  for (const ceiling of CEILINGS) {
    const at = day.filter((r) => r.turns === ceiling);
    if (at.length >= 2) {
      return {
        refuse: true,
        clause: "repeated-ceiling",
        detail: `${at.length} sessions for ${slice} cancelled at exactly ${ceiling} turns in 24h — scope exceeds the budget. Re-scope or re-model; do not raise the ceiling.`,
      };
    }
  }
  // Any repeated cancellation at one high turn count, even a ceiling not in the known list.
  const highCounts = new Map<number, number>();
  for (const r of day) {
    if (typeof r.turns === "number" && r.turns >= MIN_CEILING) {
      highCounts.set(r.turns, (highCounts.get(r.turns) ?? 0) + 1);
    }
  }
  for (const [turns, n] of highCounts) {
    if (n >= 2) {
      return {
        refuse: true,
        clause: "repeated-ceiling",
        detail: `${n} sessions for ${slice} cancelled at exactly ${turns} turns in 24h — a ceiling this dispatch keeps hitting.`,
      };
    }
  }

  // C. REPEATED PROOF REFUSAL — the contract has said no twice. A third identical attempt is the
  //    orchestrator arguing with its own gate.
  const refused = mine.filter((r) => r.proofsOk === false && within(r, nowMs, 24 * 60 * 60_000));
  if (refused.length >= 2) {
    return {
      refuse: true,
      clause: "repeated-proof-refusal",
      detail: `${refused.length} sessions for ${slice} failed their proofs in 24h — the contract refused twice. Fix the contract or the work; do not re-run it.`,
    };
  }

  return { refuse: false };
}
