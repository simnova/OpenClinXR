import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a worker whose background job the dispatch reaped on exit is recorded identically to a
 * worker that finished its work.
 *
 * MEASURED 2026-08-26 from `.openclinxr/openclaw/worker-sessions.jsonl`:
 *
 *   issue-693  phase=completed  stopReason=end_turn  turns=29  handoff=needs_resume
 *              — its worker set up a correct five-configuration sweep, launched it, reported
 *                "~46 minutes remain", and the dispatch returned and killed it. Two configurations
 *                survived.
 *   issue-700  phase=completed  stopReason=end_turn  turns=77  handoff=ready_to_integrate
 *              — genuinely finished; landed and verified.
 *
 * Both read `completed` / `end_turn`. **The only field that separates them is `handoff`, which is the
 * WORKER'S OWN ACCOUNT** — precisely what the contract layer exists not to trust. A reaped job and a
 * finished one are mechanically indistinguishable in the ledger.
 *
 * WHY IT BLOCKS WORK RATHER THAN JUST MISREPORTING IT: #697's four-arm conditioning experiment and
 * #698's fleet re-creation are multi-hour by construction. Dispatching either walks into the same
 * reap, and the ledger would again record `completed`. Both are held behind this.
 *
 * KNOWN-GOOD COLUMN: issue-700's row is a worker that genuinely finished with no background job
 * outstanding. Clause (3) pins it, so the fix cannot be "call everything reaped".
 *
 * claimScope: whether the ledger carries a HARNESS-OBSERVED signal for a background job alive at
 *   worker exit.
 * notEvidenceFor: that detaching such a job is the right remedy. Detaching may break the
 *   worktree-scoped write deny that isolates a worker, which is this card's stated NOT TESTED and is
 *   not decided here. Recording the fact is separable from changing the behaviour.
 */

const LEDGER = join(process.cwd(), ".openclinxr/openclaw/worker-sessions.jsonl");

type Row = Record<string, unknown>;

function rows(): Row[] {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as Row; } catch { return null; } })
    .filter((r): r is Row => r !== null);
}
const terminal = (slice: string): Row | undefined =>
  rows().filter((r) => r.slice === slice && typeof r.phase === "string" && r.phase !== "spawned").at(-1);

/**
 * The harness-observed fields that CLASSIFY an outcome. `handoff` is deliberately absent: it is the
 * worker's own account. `turns` is deliberately absent too — a first draft included it and clause (2)
 * passed vacuously, because any two slices differ on turn count. An incidental difference is not a
 * discriminator; the clause has to compare the fields that say WHAT KIND of ending this was.
 */
const OUTCOME_CLASS = ["phase", "stopReason"] as const;

describe("a reaped background job is not a completed worker", () => {
  it.fails("(1) the ledger carries a harness-observed background-job field at worker exit", () => {
    const finished = terminal("issue-700");
    expect(finished, "issue-700 is the known-good finished worker and must be in the ledger").toBeDefined();
    const key = Object.keys(finished ?? {}).find((k) => /background|orphan|reap|childProcess/i.test(k));
    expect(
      key,
      "no field records whether a worker left a live background process at exit. issue-693's reaped "
        + "sweep and issue-700's finished slice both read phase=completed stopReason=end_turn, and "
        + "the only thing separating them is `handoff`, which the worker writes about itself",
    ).toBeDefined();
  });

  it.fails("(2) the reaped and the finished slice are distinguishable WITHOUT reading handoff", () => {
    const reaped = terminal("issue-693");
    const finished = terminal("issue-700");
    expect(reaped, "issue-693 must be in the ledger").toBeDefined();
    expect(finished, "issue-700 must be in the ledger").toBeDefined();
    const signature = (r: Row | undefined) =>
      JSON.stringify(Object.fromEntries(OUTCOME_CLASS.map((k) => [k, r?.[k]])));
    expect(
      signature(reaped),
      "both rows classify as completed/end_turn, so nothing mechanical can tell a killed background "
        + "job from finished work. Turn count is excluded on purpose: it differs between any two "
        + "slices and would make this clause pass without discriminating anything",
    ).not.toBe(signature(finished));
  });

  it("(3) COUNTERWEIGHT: the finished worker still reads completed", () => {
    const finished = terminal("issue-700");
    expect(finished?.phase, "calling everything reaped is the cheapest way to pass (2)").toBe("completed");
    expect(finished?.stopReason).toBe("end_turn");
  });

  it("(4) COUNTERWEIGHT: handoff is not the discriminator", () => {
    expect(
      OUTCOME_CLASS as readonly string[],
      "reading the worker's own handoff to classify the outcome reproduces the defect with extra "
        + "steps: a worker that does not know its job was killed reports whatever it believes",
    ).not.toContain("handoff");
    const reaped = terminal("issue-693");
    expect(
      reaped?.handoff,
      "issue-693 happens to self-report needs_resume, which is why this looks solvable by reading it",
    ).toBe("needs_resume");
  });

  it("(5) COUNTERWEIGHT: the existing terminal fields survive", () => {
    for (const slice of ["issue-693", "issue-700"]) {
      const r = terminal(slice);
      for (const k of [...OUTCOME_CLASS, "turns"] as const) {
        expect(r?.[k], `${slice}: ${k} must not be dropped while adding a new field`).toBeDefined();
      }
    }
  });
});

// NOT TESTED: whether detaching a worker's background job is the right remedy. Detaching may break
// the worktree-scoped write deny that isolates a worker. Recording the fact is separable from
// changing the behaviour, and this card does the first only.
