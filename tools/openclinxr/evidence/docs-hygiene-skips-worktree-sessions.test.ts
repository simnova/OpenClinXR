import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E4 slice 1 of the superagent portfolio, 2026-08-18 — MAKE THE DOC-HYGIENE SKIP DETERMINISTIC.
 *
 * ## THE DEFECT, MEASURED — do not re-derive the guard behaviour, it is exact
 *
 * `.grok/hooks/session-start-docs-hygiene.json` runs `pnpm docs:hygiene:session-start --auto-run` on
 * every session start, and skips only when an ENV VAR is set:
 *
 *     OPENCLINXR_WORKER=1  ->  SKIPPED
 *     GROK_SUBAGENT=x      ->  SKIPPED
 *     neither              ->  WOULD_RUN        <- measured 2026-08-18, control/treatment
 *
 * `dispatch-worker.ts:47` sets those for DISPATCHED workers, so dispatches are safe. **A bare
 * `grok -p --resume` is not a dispatch** and inherits nothing. Every resume launched without the env
 * ran the archiver inside a worktree. §11p diagnosed that after #99 and §9r had chased it for weeks
 * as "cause NOT DETERMINED".
 *
 * **The fix that followed was a HABIT, not a mechanism: "remember to prefix resumes with the env".**
 * That is precisely the LLM-authored step D9 exists to eliminate. One forgotten prefix re-arms it.
 *
 * ## SCALE, measured 2026-08-18 — larger than the issue-100–113 framing
 *
 *     managed worktrees            293
 *     carrying the churn signature  85
 *
 * Signature is identical in every one: `PROJECT_STATUS.md`, `docs/_archive/README.md`,
 * `docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json`, `docs/_archive/wiki/index.md` and the
 * wiki topic files. Deterministic output of a script, not a model deciding to tidy.
 *
 * ## THE DETERMINISTIC FACT THE HOOK IGNORES
 *
 * `git rev-parse --show-toplevel` inside a managed worktree returns
 * `/Users/patrick/.grok/worktrees/src-openclinxr/issue-N`; in the main checkout it returns
 * `/Volumes/files/src/openclinxr`. A session whose toplevel is under `.grok/worktrees/` is BY
 * CONSTRUCTION not an operator session, and no env var is needed to know it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                              | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — env guards only                             |FAIL | pass| pass| pass| REFUSED
 *   b) make the hook always skip                           |pass |**FAIL**| pass|**FAIL**| REFUSED
 *   c) drop the env guards and check only the path         |pass | pass|**FAIL**| pass| REFUSED
 *   d) add the worktree check ALONGSIDE the env guards     |pass | pass| pass| pass| ALL PASS
 *
 * **(b) is the tempting one-liner** — the archiver has caused nothing but churn, so disabling it
 * outright looks like a win. Clause (2) refuses it: doc hygiene is a real PMO job in an operator
 * session, and today's ungated dry-run plans a legitimate `checkpoint` action (48 blocks > 20).
 * Turning it off is not the same as running it in the right place.
 *
 * **(c)** would drop a guard that already works for dispatched workers. Add, never replace.
 *
 * **(b) MEASURED 2026-08-18 — I predicted clause (4) would pass under it and it does NOT.** I applied
 * the always-skip hook and ran it: (2) failed as expected AND (4) failed too, because when every
 * session skips, both verdicts are identical and the vacuity guard is doing double duty. Corrected
 * above rather than left as predicted. Third treatment table this session where the probe falsified
 * my own row; the probe is worth more than the prediction every time.
 *
 * ## HOW THIS IS TESTED WITHOUT ARCHIVING ANYTHING
 *
 * The hook's command is `<guard>; pnpm docs:hygiene:session-start -- --auto-run`. Executing the whole
 * thing in a test would archive docs for real. So the test extracts the GUARD PREFIX — everything up
 * to and including the final `fi;` — and runs only that, with a controlled cwd and env, appending
 * `echo WOULD_RUN`. Real shell logic, no destructive tail. This is deliberately NOT a text match on
 * the command (§7k: a name match tells you what something is called, not what it does).
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED** — the guard has no path check.
 * **(2), (3) and (4) pass today** and exist to stop (1) being satisfied by disabling the hook.
 *
 * NOT TESTED:
 *   - That the 85 dirty worktrees get cleaned. That is E4 slice 3; this slice stops the bleeding.
 *   - Non-managed worktrees. A worktree created outside `.grok/worktrees/` is not covered and is
 *     out of scope — `resolveWorkerWorktree` is the only thing that makes them here.
 *   - Whether doc hygiene's archiving is CORRECT when it does run. Different question entirely.
 */

/**
 * ## FIXED (#415) 2026-08-18
 * Clause (2) originally resolved "the main checkout" from the test file's own location
 * (`REPO_ROOT = pathResolve(HERE, "../../..")`), so when this contract ran inside a managed
 * worktree — which is exactly where the dispatch proof runs — it measured the worktree, not
 * main. Once the hook gained the `.grok/worktrees` toplevel guard, (2) and (4) failed by
 * construction. Main is now resolved from `git worktree list --porcelain` (the first entry
 * whose path does not contain `.grok/worktrees`); `aManagedWorktree()` and the clause (1)
 * path are unchanged, and the clause fails loudly if no non-managed entry exists.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const HOOK = join(REPO_ROOT, "cf/../.grok/hooks/session-start-docs-hygiene.json".replace("cf/../", ""));
const WORKTREE_MARKER = ".grok/worktrees";

/** The hook's command, minus its destructive tail: everything through the last `fi;`. */
function guardPrefix(): string {
  const raw = JSON.parse(readFileSync(HOOK, "utf8")) as {
    hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
  };
  const command = raw.hooks.SessionStart[0]!.hooks[0]!.command;
  const cut = command.lastIndexOf("fi;");
  expect(cut, "the hook command must contain a guard clause ending in `fi;`").toBeGreaterThan(0);
  return command.slice(0, cut + 3);
}

/** Run guard-only, in a chosen cwd, with a chosen env. Never runs the archiver. */
function guardVerdict(cwd: string, env: NodeJS.ProcessEnv): "SKIPPED" | "WOULD_RUN" {
  const script = `${guardPrefix()} echo WOULD_RUN`;
  const out = execFileSync("sh", ["-c", script], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  // Detect by the ABSENCE of the sentinel we appended, not by matching the hook's own message:
  // it echoes "DOC HYGIENE: skipped" in lower case, and a case-sensitive /SKIPPED/ match
  // silently reported every skip as a run. Caught by clauses (3) and (4) failing when the
  // treatment table said they pass — the harness, not the product.
  return /WOULD_RUN/.test(out) ? "WOULD_RUN" : "SKIPPED";
}

/** A managed worktree to test inside. Skips nothing — if none exists the clause must fail loudly. */
function aManagedWorktree(): string {
  const list = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const paths = [...list.matchAll(/^worktree (.+)$/gm)].map((m) => m[1]!);
  const managed = paths.find((p) => p.includes(WORKTREE_MARKER));
  expect(managed, `a managed worktree under ${WORKTREE_MARKER} must exist to test inside`).toBeTruthy();
  return managed!;
}

/**
 * The MAIN checkout, resolved from git rather than from this file's location.
 *
 * `git worktree list --porcelain` lists the main working tree FIRST, and every managed worktree
 * has `.grok/worktrees` in its path, so the first entry whose path does not contain the marker
 * IS the main checkout. Clause (2) previously used `REPO_ROOT` for "main", which is the test
 * file's own repo — inside a managed worktree that IS the worktree, so the clause measured the
 * wrong tree once the hook gained the path guard (see ## FIXED (#415) above).
 */
function mainCheckout(): string {
  const list = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const paths = [...list.matchAll(/^worktree (.+)$/gm)].map((m) => m[1]!);
  const main = paths.find((p) => !p.includes(WORKTREE_MARKER));
  expect(
    main,
    "a non-managed (main) checkout must exist in `git worktree list` — the clauses that mean "
    + "`main` measure the main checkout, never the worktree this test runs in; refusing to "
    + "default to REPO_ROOT",
  ).toBeTruthy();
  return main!;
}

describe("doc hygiene skips worktree sessions without depending on an env var", () => {
  it("(1) RED: inside a managed worktree the guard skips even with NO env set", () => {
    // The §11p failure: a bare `grok -p --resume` inherits nothing, so the archiver ran in a
    // worktree. The worktree path is a deterministic fact; the env is a thing someone must remember.
    expect(guardVerdict(aManagedWorktree(), {}), "guard verdict inside a managed worktree, no env").toBe(
      "SKIPPED",
    );
  });

  it("(2) NET known-good: in the MAIN checkout with no env the hook still runs", () => {
    // Refuses (b). Doc hygiene is a real job in an operator session — today's ungated dry-run plans a
    // legitimate `checkpoint` (48 blocks > 20). Disabling it is not the same as scoping it.
    expect(guardVerdict(mainCheckout(), {}), "guard verdict in the main checkout, no env").toBe("WOULD_RUN");
  });

  it("(3) NET known-good: the existing env guards still skip, in the main checkout", () => {
    // Refuses (c). dispatch-worker.ts:47 sets these for every dispatched worker; adding a path check
    // must not remove the guard that already protects them.
    expect(guardVerdict(mainCheckout(), { OPENCLINXR_WORKER: "1" }), "OPENCLINXR_WORKER=1").toBe("SKIPPED");
    expect(guardVerdict(mainCheckout(), { GROK_SUBAGENT: "x" }), "GROK_SUBAGENT set").toBe("SKIPPED");
  });

  it("(4) VACUITY GUARD: the harness can tell the two verdicts apart", () => {
    // If guardVerdict always returned one value, clauses (1)-(3) would be unfalsifiable together.
    const a = guardVerdict(mainCheckout(), {});
    const b = guardVerdict(mainCheckout(), { OPENCLINXR_WORKER: "1" });
    expect(a).not.toBe(b);
  });
});
