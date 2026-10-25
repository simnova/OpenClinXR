import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * HX-PATHS — one place that answers "where do managed worktrees live" and "what commit are
 * they based on".
 *
 * Two defects lived here as duplication: every caller hard-coded
 * `join(homedir(), ".grok", "worktrees", "src-openclinxr")` (so OPENCLINXR_WT_ROOT-style
 * overrides were silently ignored), and every base derived from the main checkout's LOCAL
 * HEAD (`git rev-parse HEAD`) instead of origin/main — so a main checkout lagging the remote
 * dispatched workers onto a stale base and three lanes lost work.
 *
 * Call-time env: managedWorktreeRoot reads env on every call (never import time) so tests
 * can set/restore OPENCLINXR_WT_ROOT per case.
 */

/**
 * The ambient environment with git's per-invocation repo variables STRIPPED.
 *
 * (Moved here from worktree-base-freshness.ts so this leaf module owns it; that module
 * re-exports it, so every existing importer keeps working. One copy — two copies drift.)
 *
 * MEASURED 2026-08-29. `git worktree add` dies as
 * `fatal: .git/index: index file open failed: Not a directory` when it inherits GIT_INDEX_FILE from
 * a git HOOK: git exports that (and often GIT_DIR / GIT_WORK_TREE) pointing at the in-progress
 * commit's temp index, and a child git tries to use it as its own. It reproduces ONLY inside a
 * commit, so this suite passed standalone at 71 files / 645 tests and reddened in pre-commit. That
 * asymmetry cost several cycles misdiagnosed first as flake, then as peer worktree contention —
 * the worktree count was unchanged at 551, so that second hypothesis was measurably wrong.
 *
 * NOT test-only: a dispatch launched from any hook context hits it identically.
 *
 * Stripping is safe because every git call here passes an explicit `cwd`, so repo resolution never
 * depended on the inherited values.
 */
export function gitEnvWithoutInheritedRepoVars(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"]) {
    delete env[key];
  }
  return env;
}

/**
 * Root under which managed (dispatcher-created) worktrees live.
 *
 * Default keeps the existing layout: join(os.homedir(), ".grok", "worktrees",
 * "src-openclinxr") — existing worktrees live there and this card does not move them.
 * OPENCLINXR_WT_ROOT overrides it (tests, isolated runs). Read at call time, not import time.
 */
export function managedWorktreeRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = env["OPENCLINXR_WT_ROOT"];
  if (override && override.trim()) return override;
  return join(home, ".grok", "worktrees", "src-openclinxr");
}

/**
 * Best-effort fetch cap: 30 s. Source (brief X4): a hook-step timeout is 10 s+, while a fetch
 * of one branch from a local or ssh remote is seconds — 30 s bounds a hung remote without
 * stalling dispatch. GIT_TERMINAL_PROMPT=0 so a credential-prompting remote fails fast
 * instead of hanging to the cap.
 */
export const ORIGIN_FETCH_TIMEOUT_MS = 30_000;

export type FetchOutcome = { ok: boolean; detail: string };

function git(mainRoot: string, args: readonly string[], timeoutMs: number = ORIGIN_FETCH_TIMEOUT_MS): string {
  return execFileSync("git", [...args], {
    cwd: mainRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    env: { ...gitEnvWithoutInheritedRepoVars(), GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

/** Best-effort `git fetch origin <branch>`; never throws — degradation is the caller's branch. */
export function fetchOriginBranch(
  mainRoot: string,
  branch: string,
  timeoutMs: number = ORIGIN_FETCH_TIMEOUT_MS,
): FetchOutcome {
  try {
    git(mainRoot, ["fetch", "origin", branch], timeoutMs);
    return { ok: true, detail: "fetched" };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? String(error) : String(error);
    return { ok: false, detail };
  }
}

export type BaseRef = {
  /** The ref the base was read from: origin/<branch>, or HEAD on local fallback. */
  ref: string;
  /** Full sha the managed worktree must be based on. */
  sha: string;
  /** Human-readable provenance for logs and announcements. */
  note: string;
};

export type ResolveBaseRefOptions = {
  /** Destination for degraded-base warnings. Defaults to process.stderr.write. */
  announce?: (message: string) => void;
  /** Fetch cap override (tests). */
  fetchTimeoutMs?: number;
  /**
   * Base branch name. Always "main" per card (the base is origin/main, never the main
   * checkout's current branch — that checkout may sit on any branch). Override is for
   * tests only.
   */
  branch?: string;
};

/**
 * Resolve the commit a managed worktree must be based on: origin/main after a
 * best-effort fetch — never the main checkout's possibly-stale local HEAD, and never the
 * checkout's current branch (the shared checkout may sit on any branch).
 *
 * Degradation ladder (every rung announced, never silent):
 *  1. fetch ok → origin/main.
 *  2. fetch failed but an origin/main ref exists → that ref (warn: fetch failed).
 *  3. no origin/main ref → local HEAD (warn: fallback; names whether an origin remote exists).
 */
export function resolveBaseRef(mainRoot: string, options?: ResolveBaseRefOptions): BaseRef {
  const announce =
    options?.announce
    ?? ((message: string) => {
      process.stderr.write(`${message}\n`);
    });
  const timeoutMs = options?.fetchTimeoutMs ?? ORIGIN_FETCH_TIMEOUT_MS;
  const branch = options?.branch ?? "main";
  const remoteRef = `origin/${branch}`;

  const fetch = fetchOriginBranch(mainRoot, branch, timeoutMs);

  try {
    const sha = git(mainRoot, ["rev-parse", "--verify", remoteRef], timeoutMs);
    if (!fetch.ok) {
      announce(
        `[openclaw:worktree-base] origin fetch failed (${fetch.detail}); basing on the existing `
        + `${remoteRef} ref ${sha.slice(0, 12)}, NOT local main. Push the main checkout or repair `
        + `the origin remote if this ref is older than you expect.`,
      );
    }
    return {
      ref: remoteRef,
      sha,
      note: fetch.ok
        ? `based on ${remoteRef} ${sha.slice(0, 12)} (fetched)`
        : `fetch failed (${fetch.detail}); based on existing ${remoteRef} ${sha.slice(0, 12)}, not local main`,
    };
  } catch {
    // No origin/<branch> ref — fall through to local HEAD.
  }

  let hasOrigin = false;
  try {
    git(mainRoot, ["remote", "get-url", "origin"], timeoutMs);
    hasOrigin = true;
  } catch {
    hasOrigin = false;
  }

  const sha = git(mainRoot, ["rev-parse", "HEAD"], timeoutMs);
  if (hasOrigin) {
    announce(
      `[openclaw:worktree-base] ${remoteRef} is unavailable after fetch (${fetch.detail}); `
      + `falling back to local HEAD ${sha.slice(0, 12)}. The worker base may lag origin — fetch `
      + `the main checkout before re-dispatching if that matters.`,
    );
    return {
      ref: "HEAD",
      sha,
      note: `${remoteRef} unavailable (${fetch.detail}); fallback to local HEAD ${sha.slice(0, 12)}`,
    };
  }
  announce(
    `[openclaw:worktree-base] no origin remote on ${mainRoot}; falling back to local HEAD `
    + `${sha.slice(0, 12)} as the worker base.`,
  );
  return {
    ref: "HEAD",
    sha,
    note: `no origin remote; fallback to local HEAD ${sha.slice(0, 12)}`,
  };
}
