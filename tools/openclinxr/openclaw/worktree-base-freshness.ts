/**
 * Worktree base freshness (#148) — a reused managed worktree must start from main's tip, not the
 * previous run's commits or dirt.
 *
 * INCIDENT: re-dispatch of #139 after a main-side revert left the worker on the reverted commit,
 * without the newly planted contract, with leftover doc-archive dirt. `resolveWorkerWorktree`
 * skipped `git worktree add` when the directory existed; `prepareWorktreeForWorker` only
 * provisioned node_modules/assets.
 *
 * DESIGN (implementer decision, #148):
 *  - **Reset with a loud log**, not refuse. Re-dispatch after revert/kill is the common path;
 *    forcing the orchestrator to hand-clean every retry re-earns the incident. Recoverable
 *    in-progress work is announced so the orchestrator can choose resume-over-reset when needed
 *    (§7i); the announce is the safety valve, not silence.
 *  - **What "reset" means**: `git reset --hard <mainHead>` + `git clean -fd` (NOT `-fdx`).
 *    `-fd` clears untracked non-ignored dirt (doc-archive churn class); it leaves gitignored
 *    `node_modules` so #66 provisioning survives. Rejected: delete+recreate worktree (throws
 *    away node_modules); `clean -fdx` (same); silent reset (discards recoverable work without
 *    telling the orchestrator).
 *  - **Caller-supplied absolute path** (`worktree: string`) is NOT reset — unit tests pass
 *    synthetic paths that are not real checkouts; orchestrators that hand a deliberate path own
 *    its state.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveCoordinationRoot } from "./coordination-root.js";

/** Same default root as dispatch-worker WORKTREE_ROOT — kept local to avoid import cycles. */
export const MANAGED_WORKTREE_ROOT = join(homedir(), ".grok", "worktrees", "src-openclinxr");

export type WorktreeBaseFreshnessResult = {
  slice: string;
  headBefore: string;
  headAfter: string;
  mainHead: string;
  dirtyBefore: number;
  dirtyAfter: number;
  /** True when preparation emitted a caller-visible reuse signal. */
  reuseWasAnnounced: boolean;
  /** The exact announcement text (empty when nothing was announced). */
  announcement: string;
  nodeModulesPresentAfter: boolean;
  /** True when this call performed a reuse reset (directory already existed). */
  didReset: boolean;
};

export type EnsureWorktreeBaseFreshOptions = {
  worktreePath: string;
  mainRoot: string;
  /** Branch name for the managed worktree; defaults to current branch or `wt/<slice>`. */
  branch?: string;
  /** Slice / directory name for the announcement. */
  slice?: string;
  /**
   * Destination for the loud reuse log. Defaults to process.stderr.write.
   * Injected by tests so announcement is observable without capturing process streams.
   */
  announce?: (message: string) => void;
};

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function dirtyCount(cwd: string): number {
  const out = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\n").filter(Boolean).length;
}

/**
 * Reset a managed worktree's git state to main's tip and announce the reuse.
 *
 * Preserves gitignored provisioning (`node_modules`, dist) because clean uses `-fd` not `-fdx`.
 * Does not create the worktree — caller creates on first use via `git worktree add`.
 */
export function ensureWorktreeBaseFresh(
  options: EnsureWorktreeBaseFreshOptions,
): WorktreeBaseFreshnessResult {
  const { worktreePath, mainRoot } = options;
  if (!existsSync(worktreePath)) {
    throw new Error(`ensureWorktreeBaseFresh: path does not exist: ${worktreePath}`);
  }

  const mainHead = git(mainRoot, ["rev-parse", "HEAD"]);
  const headBefore = git(worktreePath, ["rev-parse", "HEAD"]);
  const dirtyBefore = dirtyCount(worktreePath);
  const slice =
    options.slice
    ?? worktreePath.split(/[/\\]/).filter(Boolean).pop()
    ?? "unknown";

  const announcement =
    `[openclaw:worktree-base] REUSING managed worktree for slice=${slice} at ${worktreePath}. `
    + `Resetting git state to main HEAD ${mainHead.slice(0, 12)} `
    + `(was ${headBefore.slice(0, 12)}, dirtyFiles=${dirtyBefore}). `
    + `Branch-local commits and untracked non-ignored dirt are discarded; `
    + `gitignored node_modules/dist are preserved (clean -fd, not -fdx). `
    + `If you needed the previous run's on-disk work, abort and resume that session instead of re-dispatching.`;

  const announce =
    options.announce
    ?? ((message: string) => {
      process.stderr.write(`${message}\n`);
    });
  announce(announcement);

  // Move the worktree branch + index + tracked files to main's tip.
  git(worktreePath, ["reset", "--hard", mainHead]);
  // Drop untracked non-ignored files (doc-archive churn, stray markers). Leaves node_modules.
  git(worktreePath, ["clean", "-fd"]);

  // Keep the managed branch name pointing at main's tip for the next worker.
  const branch =
    options.branch
    || (() => {
      try {
        const current = git(worktreePath, ["branch", "--show-current"]);
        return current || `wt/${slice}`;
      } catch {
        return `wt/${slice}`;
      }
    })();
  // -B recreates/resets the branch at mainHead and checks it out (idempotent after reset --hard).
  git(worktreePath, ["checkout", "-B", branch, mainHead]);

  const headAfter = git(worktreePath, ["rev-parse", "HEAD"]);
  const dirtyAfter = dirtyCount(worktreePath);
  const nodeModulesPresentAfter = existsSync(join(worktreePath, "node_modules"));

  return {
    slice,
    headBefore,
    headAfter,
    mainHead,
    dirtyBefore,
    dirtyAfter,
    reuseWasAnnounced: true,
    announcement,
    nodeModulesPresentAfter,
    didReset: true,
  };
}

export type ReuseOutcome = {
  slice: string;
  headBefore: string;
  headAfter: string;
  mainHead: string;
  dirtyBefore: number;
  dirtyAfter: number;
  reuseWasAnnounced: boolean;
  nodeModulesPresentAfter: boolean;
};

/**
 * Contract harness (#148): exercise reuse + fresh-create against REAL git worktrees.
 *
 * Must not mock the filesystem — the defect is git state that survives directory reuse.
 */
export async function inspectWorktreeBaseFreshness(): Promise<{
  reuse: ReuseOutcome;
  freshCreate: ReuseOutcome;
}> {
  const mainRoot = resolveCoordinationRoot();
  const stamp = `${Date.now()}-${process.pid}`;
  const reuseName = `issue-148-inspect-reuse-${stamp}`;
  const freshName = `issue-148-inspect-fresh-${stamp}`;
  const reusePath = join(MANAGED_WORKTREE_ROOT, reuseName);
  const freshPath = join(MANAGED_WORKTREE_ROOT, freshName);
  const reuseBranch = `wt/${reuseName}`;
  const freshBranch = `wt/${freshName}`;

  const cleanup = (path: string, branch: string) => {
    try {
      execFileSync("git", ["worktree", "remove", "--force", path], {
        cwd: mainRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // directory may already be gone
    }
    try {
      execFileSync("git", ["branch", "-D", branch], {
        cwd: mainRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // branch may already be gone
    }
  };

  cleanup(reusePath, reuseBranch);
  cleanup(freshPath, freshBranch);

  try {
    mkdirSync(MANAGED_WORKTREE_ROOT, { recursive: true });

    // --- REUSE path: create, commit stale work, dirt, fake node_modules, then ensure ---
    execFileSync("git", ["worktree", "add", "-b", reuseBranch, reusePath], {
      cwd: mainRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const mainHead = git(mainRoot, ["rev-parse", "HEAD"]);

    // Stale commit on the worktree branch (previous run).
    const markerRel = "tools/openclinxr/openclaw/.issue-148-inspect-stale.txt";
    writeFileSync(join(reusePath, markerRel), `stale-${stamp}\n`);
    git(reusePath, ["add", markerRel]);
    execFileSync(
      "git",
      ["-c", "user.email=issue-148@test", "-c", "user.name=issue-148", "commit", "--no-verify", "-m", "stale previous-run commit (#148 inspect)"],
      {
        cwd: reusePath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OPENCLAW_SKIP_HOOKS: "1" },
      },
    );
    const headBefore = git(reusePath, ["rev-parse", "HEAD"]);
    // Dirty file (doc-archive churn class) — tracked file modified in working tree
    appendFileSync(join(reusePath, "PROJECT_STATUS.md"), `\n# issue-148-inspect dirt ${stamp}\n`);
    const dirtyBefore = dirtyCount(reusePath);

    // Fake node_modules so counterweight can assert survival without a full pnpm install.
    mkdirSync(join(reusePath, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(reusePath, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
    mkdirSync(join(reusePath, "packages/openclinxr/shared-schemas/dist"), { recursive: true });
    writeFileSync(join(reusePath, "packages/openclinxr/shared-schemas/dist/index.js"), "export {};\n");

    let announced = false;
    const resetResult = ensureWorktreeBaseFresh({
      worktreePath: reusePath,
      mainRoot,
      branch: reuseBranch,
      slice: reuseName,
      announce: () => {
        announced = true;
      },
    });

    const reuse: ReuseOutcome = {
      slice: reuseName,
      headBefore,
      headAfter: resetResult.headAfter,
      mainHead,
      dirtyBefore,
      dirtyAfter: resetResult.dirtyAfter,
      reuseWasAnnounced: announced && resetResult.reuseWasAnnounced,
      nodeModulesPresentAfter: resetResult.nodeModulesPresentAfter,
    };

    // --- FRESH CREATE path: git worktree add only (first dispatch), then marker provision ---
    execFileSync("git", ["worktree", "add", "-b", freshBranch, freshPath], {
      cwd: mainRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const freshHeadAfter = git(freshPath, ["rev-parse", "HEAD"]);
    mkdirSync(join(freshPath, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(freshPath, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
    mkdirSync(join(freshPath, "packages/openclinxr/shared-schemas/dist"), { recursive: true });
    writeFileSync(join(freshPath, "packages/openclinxr/shared-schemas/dist/index.js"), "export {};\n");

    const freshCreate: ReuseOutcome = {
      slice: freshName,
      headBefore: mainHead,
      headAfter: freshHeadAfter,
      mainHead,
      dirtyBefore: 0,
      dirtyAfter: dirtyCount(freshPath),
      reuseWasAnnounced: false,
      nodeModulesPresentAfter: existsSync(join(freshPath, "node_modules")),
    };

    return { reuse, freshCreate };
  } finally {
    cleanup(reusePath, reuseBranch);
    cleanup(freshPath, freshBranch);
  }
}
