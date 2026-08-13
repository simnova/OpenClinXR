import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The pre-commit hook feeds the staged file list to the size gate via
 * `OPENCLINXR_HOOK_STAGED_FILES`, but the full-turbo architecture path strips it before the
 * package tests run.** Issue #361 scoped the size gate to staged files; the env var that carries
 * them (`agentic-hook-runner.ts:366-371`) never reaches the `architecture` task under turbo's
 * `envMode: strict`, because `turbo.json` declares no `globalPassThroughEnv` and the `architecture`
 * task declares no `env`/`passThroughEnv`.
 *
 * MEASURED 2026-08-13 10:16–10:26, turbo 2.9.14, `turbo run architecture --dry=json` (43
 * architecture tasks, zero with a non-empty resolved env):
 *
 *   top-level envMode                                       strict
 *   per-task envMode (43/43)                                strict
 *   per-task resolvedTaskDefinition.passThroughEnv          null (before) / [VAR] (after)
 *   per-task environmentVariables.specified.passThroughEnv  null (before) / [VAR] (after)
 *   per-task environmentVariables.passthrough               null (before) / [VAR=<hash>] only
 *                                                           when the var is present in the
 *                                                           ambient env (after)
 *
 * So a commit touching `architecture-rules/**`, `package.json`, `pnpm-lock.yaml`,
 * `pnpm-workspace.yaml`, `turbo.json` or `tsconfig*.json` forces the full-turbo path, the staged
 * set is discarded at the turbo boundary, and the size check falls back to a global working-tree
 * sweep — the exact deadlock mode #361 fixed, resurrected by the boundary.
 *
 * ## THE FIX
 *
 * One line on the `architecture` task in `turbo.json`:
 *
 *     "passThroughEnv": ["OPENCLINXR_HOOK_STAGED_FILES"]
 *
 * `passThroughEnv` makes the variable available to the task without contributing to the cache key —
 * correct, because the staged set must not invalidate the architecture cache. `turbo.json` is
 * itself in `ARCHITECTURE_FORCE_FULL_PATH_PATTERNS`, so this commit takes the very path it fixes
 * (the same bootstrap property #361 had; with the operator-authorised ceiling raise `0be925b6` in
 * place that is no longer blocking).
 *
 * ## WHY THE TEST SETS THE VARIABLE ITSELF
 *
 * turbo reports `environmentVariables.passthrough` — the resolved passthrough ENTRIES — only for
 * variables actually present in the environment of the `--dry` invocation. A bare run sees `[]`
 * and proves nothing about the boundary. The hook's real condition has the variable set
 * (`agentic-hook-runner.ts:369`), so this test mirrors it: the child turbo process receives a
 * synthetic staged set and the assertions check turbo's OWN resolution with the variable present.
 *
 * ## WHAT THIS REFUSES
 *
 *   treatment                                        | (1) passthrough | (2) strict | (3) non-empty | result
 *   --------------------------------------------------|-----------------|------------|----------------|--------
 *   a) today — no passthrough declared                |     **FAIL**    |    pass    |     pass      | REFUSED
 *   b) `envMode: loose` repo-wide                     |       pass      |  **FAIL**  |     pass      | REFUSED
 *   c) a passthrough key in the wrong scope (e.g. a   |                 |            |                |
 *      string match on turbo.json that ignores turbo's |                 |            |                |
 *      own resolution)                                 |      mixed      |    pass    |     pass      | REFUSED by shape
 *   d) per-task `passThroughEnv` on `architecture`     |       pass      |    pass    |     pass      | ALL PASS
 *
 * (b) is the one that matters. Flipping the repo to `envMode: loose` passes everything through and
 * silently destroys hermetic caching across every task in the monorepo — the cheap fix that looks
 * green. (c) is why clause (1) asserts against turbo's OWN resolution (`--dry=json`), never a
 * string match on `turbo.json`: a text assertion passes on a key placed in the wrong scope, which
 * is the likeliest wrong fix.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED — it fails today against
 * `passthrough: null`. (2) and (3) pass today and are counterweights that constrain the fix.
 * Clause (3) is the vacuity guard from the #361 plant: an `it.fails` is satisfied by ANY failure,
 * so if the `--dry` command dies or the shape changes and zero `#architecture` tasks resolve, the
 * RED would "pass" on an empty parse — a wrong-reason green. The plain-`it` sibling exposes it.
 *
 * NOT TESTED:
 *   - **The hook runner is not exercised here.** This pins turbo's RESOLVED configuration. The
 *     runner already sets the var on the full-turbo path (`agentic-hook-runner.ts:366-371`); the
 *     issue's own measurement confirmed the plumbing is right and only the turbo boundary is wrong.
 *   - **No assertion that the var reaches the running test process end-to-end.** `--dry=json`
 *     reports the resolved passthrough; the execution-time handoff is turbo's own behaviour.
 *   - **Packages that override the `architecture` task in their own `package.json` `turbo` block
 *     are not covered** — measured today, none do (43/43 resolve the root task config).
 *   - **The `VAR=<hash>` suffix in `environmentVariables.passthrough`** — asserted by prefix only;
 *     the hash is an internal turbo representation and is not part of the contract.
 *
 * ## FIXED (#363)
 *
 * `turbo.json` now declares `passThroughEnv: ["OPENCLINXR_HOOK_STAGED_FILES"]` on the
 * `architecture` task. Clause (1) is flipped from `it.fails` to `it` below. NOT TESTED: an
 * `envMode` flip at the package level (a package.json `turbo` block with `envMode: loose`) — the
 * repo-level counterweight in clause (2) would not see it.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const HOOK_ENV_VAR = "OPENCLINXR_HOOK_STAGED_FILES";

/** Synthetic staged set, mirroring agentic-hook-runner.ts:369 — the hook's real condition. */
const SYNTHETIC_STAGED = "packages/openclinxr/architecture-rules/src/being-committed.ts";

interface TurboDryTask {
  taskId: string;
  envMode?: string;
  resolvedTaskDefinition?: {
    passThroughEnv?: string[] | null;
  };
  environmentVariables?: {
    specified?: {
      passThroughEnv?: string[] | null;
    };
    passthrough?: string[] | null;
  };
}

interface TurboDryReport {
  envMode?: string;
  tasks?: TurboDryTask[];
}

/** Shell out to turbo's own resolution: `turbo run architecture --dry=json`, with the var set. */
function turboArchitectureDry(): TurboDryReport {
  const stdout = execFileSync("pnpm", ["exec", "turbo", "run", "architecture", "--dry=json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, [HOOK_ENV_VAR]: SYNTHETIC_STAGED },
  });
  const report = JSON.parse(stdout) as unknown;
  expect(typeof report, "turbo --dry=json must parse to an object").toBe("object");
  expect(
    Array.isArray((report as TurboDryReport).tasks),
    "turbo --dry=json must contain a tasks array",
  ).toBe(true);
  return report as TurboDryReport;
}

function architectureTasks(report: TurboDryReport): TurboDryTask[] {
  return (report.tasks ?? []).filter((task) => task.taskId.endsWith("#architecture"));
}

describe("the staged-files env reaches the architecture task", () => {
  it("(3) VACUITY: the dry run resolves at least one architecture task", () => {
    // Plain `it` sibling to the RED: an `it.fails` is satisfied by ANY failure, so a dead
    // command or an empty parse would green the RED for the wrong reason. This fails loudly.
    const report = turboArchitectureDry();
    const tasks = architectureTasks(report);
    expect(
      tasks.length,
      `zero #architecture tasks resolved — the RED below would 'pass' on an empty parse:\n${JSON.stringify(
        report,
      ).slice(0, 500)}`,
    ).toBeGreaterThan(0);
  });

  it("(2) COUNTERWEIGHT: envMode stays strict", () => {
    // Refuses the cheap fix: flipping the repo to `envMode: loose` passes every variable through
    // and destroys hermetic caching across every task in the monorepo.
    const report = turboArchitectureDry();
    expect(report.envMode, "repo envMode must remain strict, not loose").toBe("strict");
    for (const task of architectureTasks(report)) {
      expect(task.envMode, `${task.taskId} must stay strict`).toBe("strict");
    }
  });

  it("(1) RED: the architecture task's resolved passthrough contains OPENCLINXR_HOOK_STAGED_FILES", () => {
    // Assert against turbo's own resolution (--dry=json), never a string match on turbo.json —
    // a text assertion passes on a key placed in the wrong scope.
    const report = turboArchitectureDry();
    const tasks = architectureTasks(report);
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      // The resolved task definition: turbo's merged per-package view of the turbo.json config.
      const allowlist = task.resolvedTaskDefinition?.passThroughEnv ?? [];
      expect(
        allowlist,
        `${task.taskId} resolved passThroughEnv (resolvedTaskDefinition)`,
      ).toContain(HOOK_ENV_VAR);
      // The specified-env view of the same config.
      const specified = task.environmentVariables?.specified?.passThroughEnv ?? [];
      expect(
        specified,
        `${task.taskId} specified passThroughEnv (environmentVariables.specified)`,
      ).toContain(HOOK_ENV_VAR);
      // The resolved passthrough entries — populated only when the var is present in the
      // environment of the --dry run (this test sets it, mirroring the hook). Entries look like
      // `OPENCLINXR_HOOK_STAGED_FILES=<hash>`; assert by prefix, the suffix is internal.
      const entries = task.environmentVariables?.passthrough ?? [];
      expect(
        entries.some((entry) => entry === HOOK_ENV_VAR || entry.startsWith(`${HOOK_ENV_VAR}=`)),
        `${task.taskId} resolved passthrough entries (environmentVariables.passthrough)`,
      ).toBe(true);
    }
  });
});
