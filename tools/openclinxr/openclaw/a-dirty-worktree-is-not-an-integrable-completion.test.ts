import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the hourly pulse must not report a completion whose worktree is dirty as if it were
 * ready to land.
 *
 * `0d3f437e` added a machine-derived readiness field to every terminal ledger row —
 * `handoff: "ready_to_integrate" | "needs_resume" | "unknown"`, with `handoffDirtyFiles` and
 * `handoffAheadCommits` beside it — because "completed + proofsOk:true" is not the same claim as
 * "this branch can be merged".
 *
 * MEASURED on issue-620, 2026-08-24. The ledger's authoritative final row read
 * `phase: "completed", proofsOk: true, turns: 150` while FOUR files sat dirty and uncommitted.
 * Every field was individually correct; the COMBINATION misleads, because the proofs genuinely
 * passed — against a tree nobody could merge. (That worktree has since been cleaned, so the
 * defect is no longer reproducible from the live tree; the row above is the record of it.)
 *
 * That fix landed the FIELD. This contract pins the CONSUMER, which is the half this repo
 * repeatedly fails to close: `PROTO_BOARD_LOOP.md` records the build-it-and-leave-it-unwired class
 * four times, and `0d3f437e`'s own commit message named factory-pulse as the outstanding follow-on
 * rather than papering over it. A field no monitor reads is documentation.
 *
 * WHY THIS IS A SEPARATE FILE. `the-pulse-counts-dispatches-not-rows.test.ts` declares
 * `claimScope: how the pulse aggregates ledger rows into completions, pass rate and rework` and
 * explicitly disclaims everything else. Adding a readiness clause there would widen a stated scope
 * from the outside, which is the thing that makes a claimScope worth writing.
 *
 * NOT A THRESHOLD. Nothing here asserts a target for how many completions are integrable. It
 * asserts only that the two states are counted apart, in both directions.
 *
 * claimScope: that summariseLedgerWindow reports handoff readiness separately from completion, and
 *   that a needs_resume row is never scored as ready to integrate.
 * notEvidenceFor: whether `deriveHandoffState` classifies any real worktree correctly (that is
 *   `worker-handoff-state.ts`'s own contract), the verdict thresholds, the pulse's board query, or
 *   whether any dispatch was correct.
 */

type Row = Record<string, unknown>;

/**
 * Shape MEASURED from the live ledger, 2026-08-24: the two issue-623 rows are verbatim in their
 * handoff fields (`ready_to_integrate`, dirty 0, ahead 1) and are the only two rows carrying the
 * field at the time of writing. The `needs_resume` session below is the issue-620 shape recorded
 * above, replayed with the field that did not exist when it ran.
 */
const WINDOW: Row[] = [
  // a dispatch that proofed green and left its branch clean and ahead — genuinely landable
  { slice: "issue-623", sessionId: "s-clean", phase: "spawned", at: "2026-08-24T13:00:00Z" },
  { slice: "issue-623", sessionId: "s-clean", phase: "completed", turns: 40, at: "2026-08-24T13:11:57Z",
    handoff: "ready_to_integrate", handoffDirtyFiles: 0, handoffAheadCommits: 1 },
  { slice: "issue-623", sessionId: "s-clean", phase: "completed", turns: 40, proofsOk: true, at: "2026-08-24T13:11:58Z",
    handoff: "ready_to_integrate", handoffDirtyFiles: 0, handoffAheadCommits: 1 },
  // the issue-620 shape: proofs pass, four files uncommitted, nothing to merge
  { slice: "issue-620", sessionId: "s-dirty", phase: "spawned", at: "2026-08-24T08:23:57Z" },
  { slice: "issue-620", sessionId: "s-dirty", phase: "completed", turns: 150, proofsOk: true, at: "2026-08-24T09:07:09Z",
    handoff: "needs_resume", handoffDirtyFiles: 4, handoffAheadCommits: 0 },
];

async function summarise(rows: Row[]): Promise<Record<string, number>> {
  const mod = await import("./factory-pulse.js") as Record<string, unknown>;
  const fn = mod["summariseLedgerWindow"];
  if (typeof fn !== "function") throw new Error("factory-pulse.ts does not export summariseLedgerWindow(rows)");
  return (fn as (r: Row[]) => Record<string, number>)(rows);
}

describe("a dirty worktree is not an integrable completion", () => {
  it("(1) a needs_resume completion is counted apart from a landable one", async () => {
    const s = await summarise(WINDOW);
    expect(s["completions"], "two dispatches reached a terminal row").toBe(2);
    expect(
      s["readyToIntegrate"],
      "only s-clean is landable; s-dirty proofed green against four uncommitted files",
    ).toBe(1);
    expect(s["needsResume"], "s-dirty needs a resume in place, not an integrate").toBe(1);
  });

  it("(2) COUNTERWEIGHT: a clean branch is not withheld from the landable count", async () => {
    // Refuses the over-correction of treating readiness as unknowable and reporting zero. If this
    // clause and (1) cannot both hold, the metric has been made useless rather than honest.
    const cleanOnly = WINDOW.filter((r) => r["sessionId"] !== "s-dirty");
    const s = await summarise(cleanOnly);
    expect(s["completions"]).toBe(1);
    expect(s["readyToIntegrate"], "nothing about s-clean is ambiguous").toBe(1);
    expect(s["needsResume"]).toBe(0);
  });

  it("(3) COUNTERWEIGHT: rows predating the field are unknown, not silently landable", async () => {
    // Every row written before 0d3f437e carries no `handoff` key. Defaulting those to
    // ready_to_integrate would reintroduce exactly the claim this fix removed, and would do it
    // invisibly. MEASURED: the first live pulse row after wiring read
    // ready_to_integrate=1, handoff_unknown=2 over three completions — the two unknowns being
    // pre-field rows.
    const legacy: Row[] = [
      { slice: "issue-x", sessionId: "s-old", phase: "spawned", at: "2026-08-24T06:00:00Z" },
      { slice: "issue-x", sessionId: "s-old", phase: "completed", turns: 30, proofsOk: true, at: "2026-08-24T06:30:00Z" },
    ];
    const s = await summarise(legacy);
    expect(s["completions"]).toBe(1);
    expect(s["readyToIntegrate"], "absence of the field is not evidence of readiness").toBe(0);
    expect(s["needsResume"]).toBe(0);
    expect(s["handoffUnknown"], "counted, so a monitor can see how much it cannot see").toBe(1);
  });

  it("(4) the pass rate is unchanged by readiness — a dirty tree still proofed green", async () => {
    // Readiness and correctness are different claims and must not be conflated in the repair, which
    // would be the same error in the opposite direction: scoring a passing worker as a failure
    // because its tree was dirty.
    const s = await summarise(WINDOW);
    expect(s["passed"], "both dispatches passed their proofs").toBe(2);
    expect(s["failed"]).toBe(0);
    expect(s["passRate"]).toBe(1);
  });
});
