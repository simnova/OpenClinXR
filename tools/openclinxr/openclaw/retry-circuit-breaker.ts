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
  /** Terminal lifecycle phase. `died` and `spawned` are sessions that never reached a verdict. */
  phase?: string | null;
  sessionId?: string;
  at?: string;
  turns?: number | null;
  stopReason?: string | null;
  proofsOk?: boolean | null;
};

export type BreakerClause = "startup-storm" | "repeated-ceiling" | "repeated-proof-refusal" | "repeated-process-death";

/**
 * A refusal carries the evidence that produced it.
 *
 * The gate is otherwise SILENT: it throws to its immediate caller, runs before the board update and
 * before any session ledger row, so nothing durable explains why a slice stopped dispatching. The
 * next reader would have to re-run the breaker to find out — and could not tell a correct refusal
 * from a false one at all.
 *
 * `lastPassAt` is the field that makes that distinguishable. A refusal whose `lastPassAt` is recent
 * relative to `triggeredBy` is the false-refusal shape: the slice was making progress and the gate
 * ignored it. That is exactly the defect measured on issue-341 and fixed in 3baa71af.
 */
export type BreakerVerdict =
  | { refuse: false }
  | {
      refuse: true;
      clause: BreakerClause;
      detail: string;
      /** Sessions that produced the refusal — the reader should not have to re-derive them. */
      triggeredBy: { sessionId?: string; at?: string; turns?: number | null; stopReason?: string | null; proofsOk?: boolean | null }[];
      /** Most recent PASS at or before evaluation, or null. Recent + refused = suspect. */
      lastPassAt: string | null;
      evaluatedAt: string;
    };

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
    // `phase` is the one field where LAST wins rather than any-non-null: a session that was
    // "spawned" and then "completed" is completed, and clause D must not read the earlier value.
    if (r.phase !== undefined) cur.phase = r.phase;
    byId.set(r.sessionId, cur);
  }
  return [...byId.values()];
}

/** Project a row down to the fields a later reader needs to judge the refusal. */
const evidence = (r: BreakerRow) => ({
  sessionId: r.sessionId, at: r.at, turns: r.turns, stopReason: r.stopReason, proofsOk: r.proofsOk,
});

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
  const all = mergeSessions(rows).filter((r) => r.slice === slice);

  /**
   * SUCCESS RESETS THE BREAKER. Only sessions since the slice's most recent PASS count.
   *
   * CORRECTED 2026-08-24, same night as the original, after a peer attacked it against the ledger.
   * The first version counted every session in the window. On `issue-341` that would have refused
   * FOUR sessions with `proofsOk: true` — 12:52 (cancelled at 150 turns and still passing its
   * contract), 16:41, 18:16 and 22:10. A slice that is passing its proofs is not walking into a
   * wall, and a breaker that cannot see progress refuses the recovery it exists to allow.
   *
   * Note the shape of the worst case: a session CANCELLED at a ceiling can still pass every proof.
   * Cancellation is a budget outcome, not a verdict on the work, so a ceiling hit alone must never
   * be treated as failure.
   *
   * My own test asserted those four sessions were "saved". Counting passes as waste is the
   * wrong-direction assertion this repo already documents.
   */
  // Bounded by nowMs: a breaker evaluated at time T cannot see a pass that happens after T.
  // Without this bound the reset reads the future and the gate never fires at the moment it should.
  const lastPass = all
    .filter((r) => r.proofsOk === true && r.at)
    .map((r) => Date.parse(r.at as string))
    .filter((t) => Number.isFinite(t) && t <= nowMs)
    .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
  const lastPassAt = Number.isFinite(lastPass) ? new Date(lastPass).toISOString() : null;
  const evaluatedAt = new Date(nowMs).toISOString();
  const mine = all.filter((r) => {
    const t = r.at ? Date.parse(r.at) : Number.NaN;
    return !Number.isFinite(lastPass) || !Number.isFinite(t) || t > lastPass;
  });

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
      triggeredBy: startup.map(evidence),
      lastPassAt,
      evaluatedAt,
    };
  }

  // B. REPEATED CEILING — the same turn ceiling hit twice in 24h means the scope exceeds the budget.
  //    issue-341 hit 150 repeatedly. Raising maxTurns without changing scope is the same attempt.
  // A ceiling hit that PASSED its proofs is productive work meeting a budget, not a wall.
  const day = mine.filter(
    (r) => r.stopReason === "cancelled" && r.proofsOk !== true && within(r, nowMs, 24 * 60 * 60_000),
  );
  for (const ceiling of CEILINGS) {
    const at = day.filter((r) => r.turns === ceiling);
    if (at.length >= 2) {
      return {
        refuse: true,
        clause: "repeated-ceiling",
        detail: `${at.length} sessions for ${slice} cancelled at exactly ${ceiling} turns in 24h — scope exceeds the budget. Re-scope or re-model; do not raise the ceiling.`,
        triggeredBy: at.map(evidence),
        lastPassAt,
        evaluatedAt,
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
        triggeredBy: day.filter((r) => r.turns === turns).map(evidence),
        lastPassAt,
        evaluatedAt,
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
      triggeredBy: refused.map(evidence),
      lastPassAt,
      evaluatedAt,
    };
  }

  /**
   * D. REPEATED PROCESS DEATH — sessions that never reached a verdict at all.
   *
   * Clauses A-C read `stopReason` and `proofsOk`, so a session that dies or hangs before either is
   * written is INVISIBLE to them. Measured across 584 sessions: 11 terminal `died` across 7 slices
   * and 13 terminal `spawned` across 10 slices, none of which any earlier clause can see.
   *
   * THRESHOLD 3, NOT 2, AND THE REASON IS OUTCOME — not a tuned number:
   *
   *     issue-594  3 died     gaps 4.3, 36.6 min    later passes: 0
   *     issue-569  3 spawned  gaps 28.8, 25.1 min   later passes: 0
   *     issue-585  2 died     gap  7.1 min          later passes: 1   <- recovered
   *     issue-591  2 died     gap  7.2 min          later passes: 1   <- recovered
   *
   * At 2 this clause fires on all four and interrupts two genuine recoveries. At 3 it fires on
   * exactly the two slices that never recovered. The 60-minute window is the span the two firing
   * slices actually needed (40.9 and 53.9 min end to end), not a round number.
   *
   * NOT TESTED, and the honest limit: this separates 2 cases from 2 cases. It is a small-n
   * discriminator validated by outcome rather than a law, and the override exists precisely because
   * a rule this thinly evidenced will sometimes be wrong.
   */
  const DEAD_PHASES = new Set(["died", "spawned"]);
  const dead = mine.filter(
    (r) => typeof r.phase === "string" && DEAD_PHASES.has(r.phase) && within(r, nowMs, 60 * 60_000),
  );
  if (dead.length >= 3) {
    return {
      refuse: true,
      clause: "repeated-process-death",
      detail: `${dead.length} sessions for ${slice} never reached a verdict in 60 min (phase died/spawned) — the process is failing before the work starts, so a fourth attempt changes nothing.`,
      triggeredBy: dead.map(evidence),
      lastPassAt,
      evaluatedAt,
    };
  }

  return { refuse: false };
}
