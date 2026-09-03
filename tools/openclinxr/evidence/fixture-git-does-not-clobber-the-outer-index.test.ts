/**
 * A fixture repo built inside a git HOOK writes to the SURROUNDING worktree's index.
 *
 * MEASURED 2026-09-03. Card tsk_43e63558368957ef was marked blocked for five hours with
 * "worktree index corruption (4,382 staged deletions), far outside the task write root". It was
 * not corruption and nothing was lost: the worktree's index held 3 entries against a HEAD tree of
 * 4,379, every "deleted" file was present on disk, and a bare `git reset` restored all 4,379 and
 * revealed the worker's three intended files intact.
 *
 * The three surviving index entries name their own sources:
 *
 *   seed.txt                            a-cancelled-dirty-worker-is-not-ready-to-integrate.test.ts:28
 *   apps/ui-xr/scene.ts                 another openclaw fixture repo in the same run
 *   tools/openclinxr/evidence/probe.json           "
 *
 * MECHANISM, reproduced in a scratch repo before this file was written: git exports GIT_DIR and
 * GIT_INDEX_FILE to hooks, and those OVERRIDE a child's `cwd`. So
 * `execFileSync("git", ["add", "-A"], { cwd: mkdtempSync(...) })` — the shape every fixture helper
 * in this directory uses — resolves to the OUTER repo. An outer repo of 5 files went to 1 entry
 * (`seed.txt`) with 5 staged deletions: the same signature at 1/878th the scale. `git init` in the
 * fixture dir also printed `warning: re-init: ignored --initial-branch=main`, because it was
 * re-initialising the outer git dir rather than making a new one.
 *
 * THE FIX ALREADY EXISTS AND IS UNCONSUMED HERE. `gitEnvWithoutInheritedRepoVars()`
 * (worktree-base-freshness.ts) strips the five variables and is dated 2026-08-29 — the same hazard,
 * found through a different symptom. dispatch-worker.ts and resume-command.ts call it;
 * coordination-root.test.ts scrubs inline. The nine fixture-repo tests in this directory do not,
 * so the hazard survived in the place that runs most often.
 *
 * claimScope: whether openclaw fixture-repo tests can corrupt the surrounding index under a hook.
 * notEvidenceFor: any other test directory, or fixture tests that never invoke git.
 *
 * ## FIXED (tsk_e3f63cdac00a38f7) — 2026-09-03
 *
 * Both halves wired to gitEnvWithoutInheritedRepoVars() (worktree-base-freshness.ts:48):
 * the 8 unscrubbed fixture-repo tests and the 21 unscrubbed production modules each import the
 * helper and pass `env:` on every git invocation; integrate.ts's commit call merges it with
 * OPENCLINXR_INTEGRATING. Clauses (1) and (4) flipped from it.fails to it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const OPENCLAW = join(process.cwd(), "tools", "openclinxr", "openclaw");

/** Every git invocation in a file, scrubbed or not. */
const gitCallSites = (src: string): number =>
  (src.match(/execFileSync\(\s*"git"|spawnSync\(\s*"git"/g) ?? []).length;

/** A file is scrubbed when it names the helper or the vars it strips. */
const isScrubbed = (src: string): boolean =>
  /gitEnvWithoutInheritedRepoVars/.test(src) || /GIT_INDEX_FILE/.test(src);

/** Test files here that stand up a real git repo as a fixture. */
const fixtureRepoTests = (): string[] =>
  readdirSync(OPENCLAW)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => /execFileSync\(\s*"git"|spawnSync\(\s*"git"/.test(readFileSync(join(OPENCLAW, f), "utf8")))
    .filter((f) => /"init"/.test(readFileSync(join(OPENCLAW, f), "utf8")))
    .sort();

/** A file is safe when every one of its git invocations passes an explicit env. */
const unscrubbed = (file: string): boolean => !isScrubbed(readFileSync(join(OPENCLAW, file), "utf8"));

/** Production modules here that shell out to git. */
const gitProductionModules = (): string[] =>
  readdirSync(OPENCLAW)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => gitCallSites(readFileSync(join(OPENCLAW, f), "utf8")) > 0)
    .sort();

describe("fixture git does not clobber the outer index", () => {
  it("(1) every openclaw fixture-repo test scrubs git's inherited repo vars", () => {
    const offenders = fixtureRepoTests().filter(unscrubbed);
    // Fix: import gitEnvWithoutInheritedRepoVars from "./worktree-base-freshness.js" and pass
    // `env: gitEnvWithoutInheritedRepoVars()` in the fixture helper's execFileSync options.
    expect(offenders, `fixture-repo tests that inherit GIT_DIR/GIT_INDEX_FILE: ${offenders.join(", ")}`).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the hazard is real, so clause (1) is not a style rule", () => {
    const outer = mkdtempSync(join(tmpdir(), "outer-"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: outer, encoding: "utf8" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@t");
    g("config", "user.name", "t");
    for (const n of ["a", "b", "c", "d", "e"]) writeFileSync(join(outer, `${n}.txt`), "x\n");
    g("add", "-A");
    g("commit", "-qm", "seed");
    expect(g("ls-files").trim().split("\n")).toHaveLength(5);

    // Exactly what a hook hands a child process.
    const hookEnv = { ...process.env, GIT_DIR: join(outer, ".git"), GIT_INDEX_FILE: join(outer, ".git", "index") };
    const fixture = mkdtempSync(join(tmpdir(), "fixture-"));
    writeFileSync(join(fixture, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: fixture, env: hookEnv, encoding: "utf8" });

    // The outer index now holds the FIXTURE's file and nothing else.
    expect(g("ls-files").trim()).toBe("seed.txt");
    expect(g("diff", "--cached", "--name-status").split("\n").filter((l) => l.startsWith("D"))).toHaveLength(5);

    // And a bare reset restores it, which is why the blocked card lost no work.
    g("reset", "-q");
    expect(g("ls-files").trim().split("\n")).toHaveLength(5);
  });

  it("(3) the scrub helper this file points at is exported and strips all five vars", async () => {
    const { gitEnvWithoutInheritedRepoVars } = await import("../openclaw/worktree-base-freshness.js");
    const env = gitEnvWithoutInheritedRepoVars();
    for (const key of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"]) {
      expect(env[key]).toBeUndefined();
    }
  });

  it("(4) every openclaw PRODUCTION module that shells to git scrubs the inherited vars", () => {
    // MEASURED 2026-09-03: 20 modules / 33 call sites unscrubbed, 2 scrubbed
    // (dispatch-worker.ts, worktree-base-freshness.ts). This is the half that keeps the suite
    // red under a hook after the fixtures are fixed: the module under test reads the OUTER repo,
    // so deriveHandoffState reports needs_resume for a clean fixture. NOT test-only — a dispatch
    // launched from any hook context hits it identically (worktree-base-freshness.ts:41).
    const offenders = gitProductionModules().filter((f) => !isScrubbed(readFileSync(join(OPENCLAW, f), "utf8")));
    expect(offenders, `production modules inheriting GIT_DIR/GIT_INDEX_FILE: ${offenders.join(", ")}`).toEqual([]);
  });
});
