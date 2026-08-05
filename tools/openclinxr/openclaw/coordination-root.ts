import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Resolve the ONE directory that every worktree agrees on for cross-agent coordination state.
 *
 * WHY THIS EXISTS: this repo runs many parallel sub-managers and workers, each in its own git
 * worktree, to maximise throughput. Coordination state resolved against `process.cwd()` therefore
 * lands in a DIFFERENT file per worktree — which silently defeats its own purpose:
 *
 *   - The automation lease exists to stop two agents editing the same slice at once. Resolved
 *     per-worktree, each agent acquired its own private lease and every acquisition succeeded.
 *     A mutual-exclusion primitive that never blocks is worse than none, because it is trusted.
 *   - The worker session ledger exists so a dead worker stays resumable. Resolved per-worktree,
 *     an orchestrator in worktree B cannot see (and so cannot resume) a worker dispatched from
 *     worktree A.
 *
 * `.openclinxr/` is gitignored, so this state is deliberately NOT shared via commits — it has to
 * be shared via a path all worktrees compute identically.
 *
 * `git rev-parse --git-common-dir` returns the MAIN worktree's `.git` from anywhere, including
 * inside a linked worktree (a linked worktree's own `.git` is a file pointing at the common dir).
 * Its parent is the main worktree, which is the natural shared root.
 */

let cachedRoot: string | undefined;

export function resolveCoordinationRoot(cwd: string = process.cwd()): string {
  // An explicit override lets CI, tests, or a deliberately isolated run opt out.
  const override = process.env["OPENCLINXR_COORDINATION_ROOT"];
  if (override) return override;
  if (cachedRoot) return cachedRoot;

  try {
    const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // <main-worktree>/.git -> <main-worktree>
    const root = dirname(commonDir);
    cachedRoot = root;
    return root;
  } catch {
    // Not a git repo (or git unavailable): fall back to cwd. Coordination is then worktree-local,
    // which is the old behaviour — degraded, but never a hard failure.
    return cwd;
  }
}

/**
 * Resolve a coordination-state path that is shared across every worktree of this repo.
 *
 * Absolute inputs are returned untouched so callers can still point somewhere specific.
 */
export function resolveSharedCoordinationPath(relativePath: string, cwd: string = process.cwd()): string {
  if (isAbsolute(relativePath)) return relativePath;
  return join(resolveCoordinationRoot(cwd), relativePath);
}

/** Test seam: forget the memoised root. */
export function resetCoordinationRootCache(): void {
  cachedRoot = undefined;
}
