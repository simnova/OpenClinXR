import { execFileSync } from "node:child_process";

/**
 * **Is a returned worker's tree actually ready to integrate, or does it need a resume?**
 *
 * ## THE MEASURED AMBIGUITY, issue-620, 2026-08-24
 *
 * The ledger's authoritative final row for that slice reads:
 *
 *     phase: "completed"   turns: 150   stopReason: "cancelled"   proofsOk: true
 *
 * Every field is individually correct. `completed` means the child emitted an end event. `cancelled`
 * is a turn-BUDGET outcome, not a failed result. `proofsOk` means the post-exit checks passed — and
 * they passed against a DIRTY worktree with four uncommitted files and no commit.
 *
 * Two monitors read that row as a finished, passing dispatch:
 *
 *     factory-pulse.ts:94    counts phase === "completed" as a completion, proofsOk as a pass
 *     campaign-track.ts:48   selects the last phase === "completed" row as the slice's outcome
 *
 * A bare resume later committed the work as `0091fd0b` and wrote NO ledger row, so the ledger's last
 * word on the slice remained the intermediate state. Integration was never at risk — its own commit
 * and diff gates would have refused an uncommitted land — so this is a MONITORING and RECOVERY
 * ambiguity, not an unsafe-merge one.
 *
 * ## WHY A NEW FIELD RATHER THAN CHANGING `phase`
 *
 * `phase: "completed"` correctly means "the worker ran". Overloading it to mean "the handoff is
 * ready" would conflate two different facts and break the resumability guarantee that entry exists
 * for. So readiness gets its own machine-derived field, and the monitors consume THAT.
 *
 * claimScope: whether a worktree's contents are committed and ahead of base.
 * notEvidenceFor: whether the work is correct, or whether its proofs are meaningful.
 */

export type HandoffState = "ready_to_integrate" | "needs_resume" | "unknown";

export type HandoffAssessment = {
  handoff: HandoffState;
  dirtyFiles: number;
  aheadCommits: number;
  /** Why this state was chosen — a monitor should never have to re-derive it. */
  detail: string;
};

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });

/**
 * Derive readiness from the worktree itself.
 *
 * Fails to `unknown` rather than guessing: a missing or non-git path must not read as ready, and must
 * not read as needing a resume either — an unmeasured tree is unmeasured.
 */
export function deriveHandoffState(worktreePath: string, base = "main"): HandoffAssessment {
  let dirtyFiles = -1;
  let aheadCommits = -1;
  try {
    dirtyFiles = git(worktreePath, ["status", "--porcelain"]).split("\n").filter((l) => l.trim()).length;
  } catch {
    return { handoff: "unknown", dirtyFiles: -1, aheadCommits: -1, detail: `not a readable git worktree: ${worktreePath}` };
  }
  try {
    aheadCommits = git(worktreePath, ["rev-list", "--count", `${base}..HEAD`]).trim() === ""
      ? -1
      : Number(git(worktreePath, ["rev-list", "--count", `${base}..HEAD`]).trim());
  } catch {
    aheadCommits = -1;
  }

  if (dirtyFiles > 0) {
    return {
      handoff: "needs_resume", dirtyFiles, aheadCommits,
      detail:
        `${dirtyFiles} uncommitted file(s) in the worktree — the work exists on disk but nothing has committed it. `
        + `This is the issue-620 shape: completed + cancelled + proofsOk:true with four dirty files. `
        + `Resume the session in place; a re-dispatch would reset the worktree and destroy it.`,
    };
  }
  if (aheadCommits > 0) {
    return {
      handoff: "ready_to_integrate", dirtyFiles, aheadCommits,
      detail: `clean worktree, ${aheadCommits} commit(s) ahead of ${base}`,
    };
  }
  if (aheadCommits === 0) {
    return {
      handoff: "needs_resume", dirtyFiles, aheadCommits,
      detail: `clean worktree with ZERO commits ahead of ${base} — the worker returned having landed nothing`,
    };
  }
  return {
    handoff: "unknown", dirtyFiles, aheadCommits,
    detail: `could not count commits against ${base} — readiness is unmeasured, not assumed`,
  };
}
