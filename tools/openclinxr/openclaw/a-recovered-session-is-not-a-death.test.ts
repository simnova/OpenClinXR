import { describe, expect, it } from "vitest";
import { buildScorecard } from "./delegation-scorecard.js";
import type { DispatchLedgerEntry } from "./dispatch-worker.js";

/**
 * OBSERVABLE: the scorecard's death note counts dispatches that STAYED dead.
 *
 * #565 landed the exclusion and it is correct on the metric it was written for — a `died` session no
 * longer enters the scoreable set. It also surfaces a count as a note. `diedSessionIds.add(...)` is
 * unconditional, and nothing removes an id when a later `completed` row arrives for the SAME session,
 * which is exactly what happens when a reaped dispatch is resumed to completion.
 *
 * The `## FIXED (#565)` block in `a-provider-death-is-not-a-delegate-failure.test.ts` claims the
 * opposite in as many words:
 *
 *     A died id whose session later resumed and completed stays scoreable through its completed line
 *     and is NOT reported dead.
 *
 * MEASURED against main, same `sessionId`, a `died` row followed by a `completed` row:
 *
 *     totalDispatched: 1        <- correct; the resumed session IS scoreable
 *     death note present: true  <- the comment says it should not be
 *
 * So the SCORED metric is right and the NOTE over-counts. #565's contract was about the scored metric,
 * so it passed honestly; this sits just outside it.
 *
 * The defect is that the code and its own comment disagree. Either resolution is defensible — count
 * "deaths observed" or count "dispatches lost" — but they are different metrics and one of the two
 * statements is currently false. Which one to keep is recorded on #567 as a decision, not settled
 * here; this contract only requires that they agree.
 *
 * claimScope: whether a session that died and later completed is reported in the scorecard's death
 *   note.
 * notEvidenceFor: the scored metric (that is #565, landed and correct), the land rate, or anything
 *   about why a dispatch died.
 */

const REPO = "/Volumes/files/src/openclinxr";
const NO_MERGES = { events: [], mergeSubjects: [] };
const DEATH_NOTE = /died before any worker turn/;

/** A dispatch reaped, then resumed to completion — one session, two terminal rows. */
const DIED_THEN_RESUMED: DispatchLedgerEntry[] = [
  { slice: "issue-r", sessionId: "s-same", phase: "died", worktree: "/wt/r", at: "2026-08-22T07:00:00Z" },
  { slice: "issue-r", sessionId: "s-same", phase: "completed", turns: 30, proofsOk: true, worktree: "/wt/r", at: "2026-08-22T07:30:00Z" },
] as unknown as DispatchLedgerEntry[];

/** A dispatch that died and was never recovered — the case the note exists for. */
const DIED_FOR_GOOD: DispatchLedgerEntry[] = [
  { slice: "issue-d", sessionId: "s-dead", phase: "died", worktree: "/wt/d", at: "2026-08-22T07:00:00Z" },
  { slice: "issue-e", sessionId: "s-ok", phase: "completed", turns: 12, proofsOk: true, worktree: "/wt/e", at: "2026-08-22T07:30:00Z" },
] as unknown as DispatchLedgerEntry[];

const notes = (rows: DispatchLedgerEntry[]) => buildScorecard(REPO, rows, NO_MERGES).notes ?? [];

describe("a recovered session is not a death", () => {
  it("(0) HARNESS COLUMN: a session that stayed dead IS reported", () => {
    // Passes today and must survive. If a fix silences the note entirely, provider health stops being
    // visible — which is the reason #565 chose skip-and-note over skip-only.
    expect(
      notes(DIED_FOR_GOOD).some((n) => DEATH_NOTE.test(n)),
      "an unrecovered death is exactly what this note exists to surface",
    ).toBe(true);
  });

  it("(1) KNOWN-GOOD COLUMN: the resumed session is still scored as one dispatch", () => {
    // #565's landed behaviour. A fix to the note must not disturb the metric.
    expect(buildScorecard(REPO, DIED_THEN_RESUMED, NO_MERGES).totalDispatched).toBe(1);
  });

  it.fails("(2) RED: a session that died and later completed is not reported dead", () => {
    expect(
      notes(DIED_THEN_RESUMED).some((n) => DEATH_NOTE.test(n)),
      "s-same recovered and completed; the FIXED comment on #565 states it is not reported dead",
    ).toBe(false);
  });
});
