import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
 * ## FIXED (#415) 2026-08-18 (superseded — see CI-PACKAGES-CONTINUE note below)
 * Clause (2) originally resolved "the main checkout" from the test file's own location
 * (`REPO_ROOT = pathResolve(HERE, "../../..")`), so when this contract ran inside a managed
 * worktree — which is exactly where the dispatch proof runs — it measured the worktree, not
 * main. Once the hook gained the `.grok/worktrees` toplevel guard, (2) and (4) failed by
 * construction. The follow-up fix of that era kept clause (2) measuring a real checkout;
 * that real-checkout dependence is now removed. Clauses (2)/(3) are fixture controls over a
 * non-managed checkout (fixture main) and assert nothing about the real operator/main checkout.
 */

/**
 * ## FIXED (CI-PACKAGES-CONTINUE) 2026-11-17
 * Clause (1) resolved the managed worktree from the HOST's worktree inventory, so on CI —
 * which has no managed worktree — it failed loudly with "expected undefined to be truthy"
 * and stopped the whole packages suite. The test now builds its OWN fixture: mkdtemp a
 * root under os.tmpdir, git-init a repo with one commit, and `git worktree add` a managed
 * worktree under `<root>/.grok/worktrees/`. Clauses (1) and (4) and the main side of
 * (2)/(3) measure only that fixture, never the host inventory, so the contract is green on
 * CI and locally. The hook JSON itself is still read from REPO_ROOT. Every fixture git
 * spawn drops all GIT_* keys from its env, sets GIT_CONFIG_NOSYSTEM=1 with
 * GIT_CONFIG_GLOBAL pointed at an empty file inside the fixture, and passes
 * `-c core.hooksPath=` pointed at an empty dir inside the fixture: a fixture-repo run
 * under a hook once wrote core.worktree into the host .git/config.
 *
 * Real-main integration is NOT TESTED by this file: no clause measures the actual
 * operator/main checkout anymore, because CI has no operator checkout with managed
 * worktrees to measure against — any real-main assertion here would either be vacuous
 * or fail loudly on CI by construction.
 */

const REPO_ROOT = repoRoot();
const HOOK = join(REPO_ROOT, ".grok/hooks/session-start-docs-hygiene.json");
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
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("GIT_")) delete clean[key];
  }
  const out = execFileSync("sh", ["-c", script], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...clean },
  });
  // Detect by the ABSENCE of the sentinel we appended, not by matching the hook's own message:
  // it echoes "DOC HYGIENE: skipped" in lower case, and a case-sensitive /SKIPPED/ match
  // silently reported every skip as a run. Caught by clauses (3) and (4) failing when the
  // treatment table said they pass — the harness, not the product.
  return /WOULD_RUN/.test(out) ? "WOULD_RUN" : "SKIPPED";
}

/**
 * Own fixture: a throwaway repo with its own managed worktree. Never reads the host
 * inventory, so CI (no managed worktree) and local runs measure the same thing.
 */
let fixtureRoot = "";
let fixtureMain = "";
let fixtureManaged = "";

/** Env scrubbed of every host git redirect, pinned to fixture-local config only. */
function fixtureEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_CONFIG_GLOBAL"] = join(fixtureRoot, "empty-gitconfig");
  return env;
}

function fixtureGit(args: string[], cwd: string): string {
  const hooksDir = join(fixtureRoot, "no-hooks");
  return execFileSync("git", ["-c", `core.hooksPath=${hooksDir}`, ...args], {
    cwd,
    encoding: "utf8",
    env: fixtureEnv(),
  });
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "docs-hygiene-fixture-"));
  mkdirSync(join(fixtureRoot, "no-hooks"), { recursive: true });
  writeFileSync(join(fixtureRoot, "empty-gitconfig"), "");
  fixtureGit(["init"], fixtureRoot);
  fixtureGit(
    [
      "-c",
      "user.email=docs-hygiene-fixture@example.com",
      "-c",
      "user.name=docs-hygiene-fixture",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "fixture init",
    ],
    fixtureRoot,
  );
  fixtureMain = fixtureRoot;
  fixtureManaged = join(fixtureRoot, ".grok", "worktrees", "fixture-wt");
  fixtureGit(["worktree", "add", fixtureManaged], fixtureRoot);
  expect(fixtureManaged, `fixture managed worktree must sit under ${WORKTREE_MARKER}`).toContain(
    WORKTREE_MARKER,
  );
  expect(fixtureMain, "fixture main must not sit under the managed marker").not.toContain(
    WORKTREE_MARKER,
  );
});

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = "";
  fixtureMain = "";
  fixtureManaged = "";
});

describe("doc hygiene skips worktree sessions without depending on an env var", () => {
  it("(1) RED: inside a managed worktree the guard skips even with NO env set", () => {
    // The §11p failure: a bare `grok -p --resume` inherits nothing, so the archiver ran in a
    // worktree. The worktree path is a deterministic fact; the env is a thing someone must remember.
    expect(guardVerdict(fixtureManaged, {}), "guard verdict inside a managed worktree, no env").toBe(
      "SKIPPED",
    );
  });

  it("(2) NET known-good: in a non-managed checkout (fixture main) with no env the hook still runs", () => {
    // Refuses (b). Doc hygiene is a real job in an operator session — today's ungated dry-run plans a
    // legitimate `checkpoint` (48 blocks > 20). Disabling it is not the same as scoping it.
    expect(guardVerdict(fixtureMain, {}), "guard verdict in a non-managed checkout (fixture main), no env").toBe(
      "WOULD_RUN",
    );
  });

  it("(3) NET known-good: the existing env guards still skip, in a non-managed checkout (fixture main)", () => {
    // Refuses (c). dispatch-worker.ts:47 sets these for every dispatched worker; adding a path check
    // must not remove the guard that already protects them.
    expect(guardVerdict(fixtureMain, { OPENCLINXR_WORKER: "1" }), "OPENCLINXR_WORKER=1").toBe("SKIPPED");
    expect(guardVerdict(fixtureMain, { GROK_SUBAGENT: "x" }), "GROK_SUBAGENT set").toBe("SKIPPED");
  });

  it("(4) VACUITY GUARD: the harness can tell the two verdicts apart", () => {
    // If guardVerdict always returned one value, clauses (1)-(3) would be unfalsifiable together.
    const a = guardVerdict(fixtureMain, {});
    const b = guardVerdict(fixtureMain, { OPENCLINXR_WORKER: "1" });
    expect(a).not.toBe(b);
  });
});
