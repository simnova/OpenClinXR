import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["contract-verify-issue-181-merge.json", ".openclinxr/openclaw/contract-verify-issue-181-merge.json"],
  ["supervisor-audit-latest.json", ".openclinxr/openclaw/supervisor-audit-latest.json"],
  ["superagent-loop-prompt.md", ".openclinxr/openclaw/superagent-loop-prompt.md"],
];

/**
 * Fresh-worktree overlay for gitignored local state. Writes each tracked
 * fixture to its live path only when that path is absent, and never deletes.
 * No cleanup: suite files run in parallel workers, so one file's teardown
 * could remove a file another file still needs. Live files always win, so
 * complete checkouts keep asserting against live state. Ignored paths are
 * invisible to `git status --porcelain`, so the no-mutation guard is unaffected.
 * Mirrors the api suite's withRollupFixture pattern.
 */
export function ensureGitignoredState(root: string): void {
  for (const [fixture, rel] of PAIRS) {
    const target = join(root, rel);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(join(HERE, fixture), "utf8"));
    }
  }
}
