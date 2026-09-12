import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

/**
 * Directory every linked worktree agrees on: the MAIN checkout.
 *
 * `.openclinxr-local/provider-cache` is untracked machine-local storage. An untracked
 * directory is not present in a linked worktree, so a root derived from `import.meta.url`
 * made evidence tests pass in main and fail everywhere else.
 *
 * `git rev-parse --git-common-dir` returns the MAIN worktree's `.git` from any linked
 * worktree. Its parent is the one copy of the cache that exists.
 * Precedent: tools/openclinxr/openclaw/coordination-root.ts and
 * tools/openclinxr/evidence/humanoid-vetting/the-shipped-lower-is-fitted-asset-geometry-not-a-shell.test.ts
 */
export function mainWorktreeRoot(fromDir: string): string {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: fromDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return dirname(commonDir);
  } catch {
    return fromDir;
  }
}
