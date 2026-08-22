import { describe, expect, it } from "vitest";
import { buildScorecard, isProbeSlice } from "./delegation-scorecard.js";
import type { DispatchLedgerEntry } from "./dispatch-worker.js";

/**
 * OBSERVABLE: the delegation scorecard counts dispatches that RAN A WORKER.
 *
 * `delegation-scorecard.ts:118` skips only `"spawned"`:
 *
 *     if (!entry.slice || entry.phase === "spawned") continue;
 *
 * #563 introduced `phase: "died"` for a child that exited without an end event — a provider 402, a
 * 401, an arg-parse abort, a kill. Those rows now fall through, become outcomes, and are scored for
 * whether their slice landed. A provider outage depresses the land rate as if a delegate had failed.
 *
 * MEASURED on the injected fixture below, against main today: `totalDispatched` is **4** where two of
 * the four sessions never started a worker. Honest value: 2.
 *
 * The file already argues the other side of this, twelve lines above the same loop:
 *
 *     // Infrastructure probes (isolation proofs, ceiling sweeps) never produce a merge, by design.
 *     // Counting them as "did not land" made the live figure read 4/14 = 29% when the real answer
 *     // for work that COULD land was 4/6. A metric that punishes measurement discourages measuring.
 *
 * `isProbeSlice` exists for exactly this shape. A dispatch that never issued an inference request is
 * not work that COULD land, and scoring it against the delegate is the same error with a different
 * cause.
 *
 * LATENT, and said plainly: the live ledger contains **zero** `died` rows. #563 landed the phase and
 * nothing has died-without-end-event since, so this fires the first time a provider fails again — and
 * DeepSeek is still returning 402 on a direct API probe, so that is a matter of when. The fixtures are
 * therefore synthetic; their shape mirrors the real issue-560 ledger (two provider deaths then a real
 * run) rather than being invented.
 *
 * claimScope: which ledger sessions the scorecard counts as dispatched slices.
 * notEvidenceFor: whether the land rate is otherwise correct, `byModel`, ratchet debt, or anything
 *   about why a dispatch died.
 */

/**
 * ## FIXED (#565)
 *
 * `delegation-scorecard.ts` now collects `phase === "died"` session ids during the same
 * de-duplication loop instead of letting them fall into `bySession`, and surfaces the count as a
 * scorecard note. Chosen over a dedicated column because probes and pre-worktree dispatches use
 * exactly this skip-and-note shape; a new field would change the Scorecard contract every consumer
 * reads. A died id whose session later resumed and completed stays scoreable through its
 * completed line (last-line-wins de-duplication) and is NOT reported dead.
 */

const REPO = "/Volumes/files/src/openclinxr";
const NO_MERGES = { events: [], mergeSubjects: [] };

/** Mirrors issue-560: two provider deaths, then a run that landed. */
const DIED_THEN_RAN: DispatchLedgerEntry[] = [
  { slice: "issue-a", sessionId: "s-402", phase: "died", worktree: "/wt/a", at: "2026-08-22T07:10:05Z" },
  { slice: "issue-a", sessionId: "s-401", phase: "died", worktree: "/wt/a", at: "2026-08-22T07:12:07Z" },
  { slice: "issue-a", sessionId: "s-ran", phase: "completed", turns: 21, proofsOk: true, worktree: "/wt/a", at: "2026-08-22T07:41:00Z" },
  { slice: "issue-b", sessionId: "s-b", phase: "completed", turns: 32, proofsOk: true, worktree: "/wt/b", at: "2026-08-22T08:10:00Z" },
] as unknown as DispatchLedgerEntry[];

/** The same window with the deaths removed — what the scorecard should already agree with. */
const RAN_ONLY = DIED_THEN_RAN.filter((r) => (r as { phase?: string }).phase !== "died");

describe("a provider death is not a delegate failure", () => {
  it("(0) HARNESS COLUMN: two sessions that ran count as two dispatches", () => {
    // Passes today. Proves the injection seam works, so the RED below means "died rows are counted",
    // not "the fixture never reached the scorecard".
    expect(buildScorecard(REPO, RAN_ONLY, NO_MERGES).totalDispatched).toBe(2);
  });

  it("(1) a session that never started a worker is not a dispatched slice", () => {
    expect(
      buildScorecard(REPO, DIED_THEN_RAN, NO_MERGES).totalDispatched,
      "s-402 and s-401 exited before any turn; counting them makes a provider outage read as two "
        + "delegate attempts that failed to land",
    ).toBe(2);
  });

  it("(2) COUNTERWEIGHT: a worker that RAN and did not land is still counted", () => {
    // Refuses the over-correction of counting only successes. The land rate exists to see real
    // failures; excluding them would make it unfalsifiable.
    const ranAndFailed = [
      { slice: "issue-c", sessionId: "s-c", phase: "completed", turns: 200, proofsOk: false, worktree: "/wt/c", at: "2026-08-22T08:40:00Z" },
    ] as unknown as DispatchLedgerEntry[];
    expect(
      buildScorecard(REPO, ranAndFailed, NO_MERGES).totalDispatched,
      "a worker that exhausted its turns and failed its proofs is a real attempt",
    ).toBe(1);
  });

  it("(3) COUNTERWEIGHT: the probe-slice exclusion still holds", () => {
    // The precedent this fix follows must survive it. `isProbeSlice` matches /^(ceil|proof|probe)-/,
    // a PREFIX — my first draft used "issue-probe-isolation", which does not match, so the clause
    // asserted equality and proved nothing. No conditional here now: a hedge in a contract is where
    // vacuity hides.
    const withProbe = [
      { slice: "probe-isolation", sessionId: "s-probe", phase: "completed", turns: 4, worktree: "/wt/p", at: "2026-08-22T06:00:00Z" },
      ...RAN_ONLY,
    ] as unknown as DispatchLedgerEntry[];
    expect(isProbeSlice("probe-isolation"), "fixture id must actually be a probe id").toBe(true);
    expect(
      buildScorecard(REPO, withProbe, NO_MERGES).totalDispatched,
      "a probe slice never produces a merge by design and must stay out of the scoreable set",
    ).toBe(buildScorecard(REPO, RAN_ONLY, NO_MERGES).totalDispatched);
  });
});
