import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFileSizeBudgets,
  type FileSizeBudgetConfig,
} from "../../../packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts";

/**
 * **The pre-commit size gate reads the WORKING TREE, so one agent's uncommitted edits block every
 * other agent's commits.** A commit gate must answer *"does THIS commit put a file over budget?"*.
 * `checkFileSizeBudgets` answers *"is any file in this working tree over budget?"*, and those differ
 * the moment two agents share a checkout.
 *
 * MEASURED 2026-08-13 03:53–04:58. A peer was mid-slice on the TRELLIS escape hatch with two files
 * dirty and uncommitted. `pnpm hooks:pre-commit` exited 1 for **1 h 52 m** and counting:
 *
 *   file                        HEAD    working tree   staged   mine?
 *   -------------------------   -----   ------------   ------   -----
 *   role-harness-policy.ts      949 ok  **972** over    no       no — peer's `imagine-trellis` role
 *   grok-repo-agent-spawn.ts    543 ok  **544** over    no       no — peer's multimodal routing
 *
 * Both clean at HEAD. Neither staged. **Nothing I could commit would change either number**, and the
 * spawn file was ONE line over. Four verified slices sat unlandable behind it.
 *
 * The control, same instant, same two files, two trees — worktrees carry HEAD content and are immune:
 *
 *   main checkout      policy 972 FAIL   spawn 543 (exactly at ceiling, zero headroom)
 *   issue-92 worktree  policy 949 ok     spawn 542 ok
 *
 * ## THE FIX IS TWO SCOPES, NOT ONE WEAKENED CHECK
 *
 * There are two assertions in `file-size-budgets.test.ts` and **only one of them should be scoped**:
 *
 *   check                                     scope     why
 *   ---------------------------------------   -------   ------------------------------------------
 *   every file within budget / freeze ceiling  STAGED    a commit is answerable for what it changes
 *   the freeze list is honest                  GLOBAL    it validates the list against the whole
 *                                                        tree; staged-scoping it would stop it
 *                                                        catching stale entries at all
 *
 * So the global honesty sweep is NOT weakened — it moves off the commit path to CI. Scoping *it* to
 * staged files is the cheap fix and clause (3) refuses it.
 *
 * The pre-commit hook's own header has asked for this and nobody built it:
 *   *"If that ever tempts you toward `--no-verify`, make the hook faster — scope it to staged files
 *   — do not bypass it."*
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                    | (1) scoped | (2) staged still caught | (3) global intact | result
 *   ---------------------------------------------|------------|-------------------------|-------------------|--------
 *   a) today — `stagedFiles` ignored             |  **FAIL**  |          pass           |       pass        | REFUSED
 *   b) return [] whenever `stagedFiles` is given |    pass    |        **FAIL**         |       pass        | REFUSED
 *   c) always scope, even with no staged set     |    pass    |          pass           |     **FAIL**      | REFUSED
 *   d) scope only when `stagedFiles` is supplied |    pass    |          pass           |       pass        | ALL PASS
 *
 * (b) is the one that matters. "Scope to staged" and "check nothing" are one refactor apart, and the
 * second one is green — it would silently retire the whole gate while looking like this fix.
 * (c) is the subtler one: a global sweep with no staged set is how CI and a manual run must behave,
 * and losing it means an over-ceiling file nobody is touching stops being reported anywhere.
 *
 * DESTRUCTIVE PROBE, run 2026-08-13 05:05 before planting (§3 — a rule with no proven failure mode
 * proves nothing). Both treatments were implemented as a stub swapped in for the real check:
 *
 *   (b) return [] whenever `stagedFiles` is supplied  -> clause (2) FAILED, as designed. Note that
 *       (b) also SATISFIES clause (1) — the RED went green under it — so the RED alone would have
 *       accepted a fix that retires the entire gate. Only the counterweight refuses it. That is the
 *       whole argument for pairing them.
 *   (c) always scope, even with no staged set         -> clause (3) FAILED, as designed.
 *
 * Restored afterwards: 2 passed | 1 expected fail. A separate fixture bug found by the same probe is
 * recorded at `makeTree` — worth reading, because the `it.fails` RED "passed" for the wrong reason
 * until a plain-`it` sibling exposed it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED — it fails today because `stagedFiles` is
 * not part of `FileSizeBudgetConfig` at all, so the argument is ignored and the unstaged file is
 * reported. (2) and (3) pass today and are counterweights that constrain the fix.
 *
 * NOT TESTED:
 *   - **Nothing here touches the pre-commit hook wiring.** This pins the CHECK's contract. Whoever
 *     fixes it must also pass the real staged set in, or the capability exists and nothing calls it
 *     (§6z — the incomplete-loop class this repo has paid for five times).
 *   - **`checkFreezeListHonesty` is not asserted here beyond staying global.** Its own false-positive
 *     mode — reporting `ceiling 950 is below actual 973 — impossible` when the growth is merely
 *     uncommitted — is real and is a separate fix (read HEAD, not the working tree).
 *   - **No claim that staged-scoping catches everything the global walk has caught historically.**
 *     The freeze list has ~20 entries and I did not replay them.
 *
 * ## FIXED (#361)
 *
 * `checkFileSizeBudgets` now scopes to `config.stagedFiles` when supplied (and only
 * then); `checkFreezeListHonesty` stays global and now reads HEAD instead of the
 * working tree, so uncommitted WIP cannot fabricate "impossible" ceiling violations
 * either. The pre-commit hook runner passes the real staged set via
 * `OPENCLINXR_HOOK_STAGED_FILES` (agentic-hook-runner.ts), which the package test
 * entry consumes — wiring, not just a check capability. Clause (1) is flipped from
 * `it.fails` to `it` below. NOT TESTED: a staged file with further unstaged edits
 * is still measured from the working tree, not the index.
 */

const OVER_BUDGET_LINES = 600; // packages/openclinxr/ zone budget is 500

const ZONE_BUDGETS = [{ prefix: "packages/openclinxr/", maxLines: 500 }] as const;

/** A synthetic workspace: one over-budget file that IS staged, one that is NOT. */
function makeTree(): { root: string; staged: string; unstaged: string } {
  const root = mkdtempSync(join(tmpdir(), "size-gate-scope-"));
  mkdirSync(join(root, "packages", "openclinxr"), { recursive: true });
  // The checker walks BOTH zone roots unconditionally and `readdirSync` throws on a missing one.
  // Omitting this made every clause die with ENOENT — including the `it.fails` RED, which then
  // "passed" for the wrong reason. That is the vacuity trap: an `it.fails` is satisfied by ANY
  // failure, so its greenness is meaningless without the plain-`it` siblings that caught this.
  mkdirSync(join(root, "apps"), { recursive: true });
  const body = "export const x = 1;\n".repeat(OVER_BUDGET_LINES);
  const staged = "packages/openclinxr/being-committed.ts";
  const unstaged = "packages/openclinxr/someone-elses-wip.ts";
  writeFileSync(join(root, staged), body);
  writeFileSync(join(root, unstaged), body);
  return { root, staged, unstaged };
}

const tree = makeTree();
const base: FileSizeBudgetConfig = {
  workspaceRoot: tree.root,
  zoneBudgets: ZONE_BUDGETS,
  sizeFreeze: {},
};

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireBothOffendersVisible(): void {
  const all = checkFileSizeBudgets(base);
  expect(all.length, `synthetic tree must contain 2 over-budget files, got:\n${all.join("\n")}`).toBe(2);
}

describe("the size gate judges only what is being committed", () => {
  it("(1) RED: a staged-scoped run ignores an over-ceiling file nobody is committing", () => {
    requireBothOffendersVisible();
    const violations = checkFileSizeBudgets({
      ...base,
      stagedFiles: [tree.staged],
    });
    expect(
      violations.filter((v) => v.includes("someone-elses-wip")),
      "another agent's uncommitted file reported against MY commit",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: an over-ceiling file that IS staged is still reported", () => {
    // Refuses "scope to staged" collapsing into "check nothing" — one refactor away, and green.
    requireBothOffendersVisible();
    const violations = checkFileSizeBudgets({
      ...base,
      stagedFiles: [tree.staged],
    });
    expect(
      violations.filter((v) => v.includes("being-committed")).length,
      "over-ceiling staged file went unreported",
    ).toBe(1);
  });

  it("(3) COUNTERWEIGHT: with no staged set the sweep stays global", () => {
    // Refuses scoping unconditionally. CI and manual runs must still see files nobody is touching,
    // or the freeze ratchet stops ratcheting.
    const violations = checkFileSizeBudgets(base);
    expect(
      violations.filter((v) => v.includes("someone-elses-wip")).length,
      "global sweep lost the unstaged offender",
    ).toBe(1);
  });
});
