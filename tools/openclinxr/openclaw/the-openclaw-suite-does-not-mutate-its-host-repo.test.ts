/**
 * Running the openclaw test suite must not change the git state of the repository it runs in, and
 * the hook that runs it must REFUSE the commit if it does.
 *
 * OBSERVED TWICE, 2026-08-30, both with hard evidence, both during a pre-commit run of this suite:
 *
 *   - A worker on tsk_f16e8559e4423bae: the index took 4,184 files staged as deleted. The commit
 *     captured it. Repaired with `git reset --mixed`, then committed with OPENCLAW_SKIP_HOOKS=1.
 *   - Me, an hour later: `core.bare` was true on the main checkout, so every work-tree operation
 *     died with `fatal: this operation must be run in a work tree`. The commit could not proceed
 *     until `git config core.bare false`. It had already happened once earlier that day.
 *
 * WHY THIS IS LAND-PATH INTEGRITY. A pre-commit gate exists to protect main, and this one can
 * corrupt the tree it guards. The corruption is silent when it happens: the index changes, the
 * commit proceeds, and the damage surfaces later as an enormous unintended diff. It also
 * manufactures a legitimate-looking reason to bypass hooks — two commits that day used a bypass,
 * and a gate that damages the tree teaches everyone to skip it.
 *
 * THE CULPRIT IS UNPROVEN, AND SAYING SO IS THE POINT.
 *
 * I first blamed integrate-aborts-a-failed-merge-commit.test.ts on a worker's report. Measured: it
 * `git init`s a scratch repo and passes an explicit cwd to every call. Properly isolated. Three
 * successive static heuristics then produced only false positives — `git -C <dir>`,
 * `git init <dir>` (the directory is a positional argument, not the cwd) and `{ cwd, … }` shorthand
 * are all correct isolation that a naive grep reads as a violation. Every candidate inspected was
 * clean.
 *
 * WHY THIS IS A GUARD-ABSENCE CLAUSE AND NOT A REPRODUCTION.
 *
 * The first version of this file ran the suite three times and asserted the git state was
 * unchanged. Measuring it showed why that cannot work: a controlled run does NOT reproduce the
 * mutation, so the assertion passes, and `it.fails` around a passing assertion reports "expected to
 * fail but passed" — red for a bookkeeping reason rather than for the defect. An intermittent fault
 * cannot be bounded by a planted RED that tries to reproduce it, because the RED goes green on
 * every run where the race does not fire, which is most of them.
 *
 * So the contract is the GUARD, which is deterministic: the hook runner must snapshot the host
 * repo's git state around the suite step and refuse on a delta. That converts a silent intermittent
 * corruption into a loud immediate refusal without anyone having to identify the guilty file first.
 *
 * WHAT THE FIX MUST NOT BE: removing the suite step, or deleting the git calls from the tests that
 * legitimately drive git. Both satisfy "the tree is unchanged" perfectly and destroy the coverage.
 * Clauses (2) and (3) exist to make those shapes fail.
 *
 * Diagnosis header IMMUTABLE. Flip `it.fails` to `it` and append `## FIXED` below.
 *
 * claimScope: this repo's own working copy during a pre-commit suite run.
 * notEvidenceFor: worktree safety, integrate correctness, or any claim about which file is at fault.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("../../../", import.meta.url).pathname;
const RUNNER = "tools/openclinxr/openclaw/agentic-hook-runner.ts";

describe("the openclaw suite does not mutate its host repo", () => {
  it.fails("(1) RED: the hook runner guards the suite step against host-repo git mutation", () => {
    const src = readFileSync(join(REPO, RUNNER), "utf8");
    expect(
      /core\.bare|gitStateBefore|snapshotGitState|assertRepoUnchanged/.test(src),
      "the suite step runs with no before/after git snapshot, so a mutation is silent and the commit captures it",
    ).toBe(true);
  });

  // (2) COUNTERWEIGHT: a runner that stops running the openclaw suite trivially cannot corrupt
  //     anything, and loses the coverage the step exists to provide.
  it("(2) COUNTERWEIGHT: the pre-commit profile still runs the openclaw suite", () => {
    const src = readFileSync(join(REPO, RUNNER), "utf8");
    expect(src).toContain("tools/openclinxr/openclaw/");
  });

  // (3) COUNTERWEIGHT: isolation must not be achieved by deleting the git calls under test.
  it("(3) COUNTERWEIGHT: the tests that legitimately drive git still invoke it", () => {
    for (const f of ["integrate.test.ts", "merge-kill.test.ts", "product-lane-gate.test.ts"]) {
      const src = readFileSync(join(REPO, "tools/openclinxr/openclaw", f), "utf8");
      expect(
        /(execFileSync|spawnSync|execSync)\s*\(\s*"git"/.test(src),
        `${f} no longer invokes git — isolation must not delete the coverage`,
      ).toBe(true);
    }
  });
});

// NOT TESTED: which file causes the mutation; whether the guard catches it on the run it fires;
// worktree-local equivalents of the same race.
