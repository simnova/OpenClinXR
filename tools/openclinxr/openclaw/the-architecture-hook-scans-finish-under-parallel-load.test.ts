/**
 * Diagnosis (IMMUTABLE): the path-scoped pre-commit architecture step fans vitest out
 * across every core (`maxWorkers` unset) and overlaps those full-repo scanners when
 * several worktrees commit at once. Under that load an `it()` that is green in the
 * full turbo `pnpm architecture` run (213/213, `testTimeout: 30_000` in
 * packages/cellix/config-vitest/src/configs/arch.config.ts) exceeds the same 30 s
 * budget, the hook goes red, and workers learn to reach for the emergency hook bypass.
 *
 * Known-good: the same four global suites pass in `pnpm architecture` on the same
 * trees. The defect is the hook invocation under parallel load, not an architecture
 * assertion, budget, or ratchet.
 *
 * Counterweight: do not omit the step, drop a global suite, or switch ordinary
 * product commits onto full turbo `pnpm architecture`. Do not "fix" it by raising
 * an architecture-rules timeout or ceiling.
 *
 * ## FIXED (#0)
 * Path-scoped spawn caps vitest at one worker (`--maxWorkers=1 --no-file-parallelism`
 * plus VITEST_MAX_FORKS/THREADS=1) and serializes scans on a mkdir lock under
 * `git rev-parse --git-common-dir`, so parallel worktrees wait rather than
 * oversubscribe. Full-turbo / pre-push command is unchanged.
 *
 * claimScope: this repo's path-scoped pre-commit architecture spawn under parallel
 * local worktrees.
 * notEvidenceFor: hook behaviour on machines with different core counts; architecture
 * assertion contents.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARCHITECTURE_GLOBAL_SUITE_FILES,
  architectureHookLockPath,
  architectureScanSpawnCommand,
  buildArchitectureStep,
  PATH_SCOPED_ARCHITECTURE_LOAD_FLAGS,
  PATH_SCOPED_ARCHITECTURE_LOCK_NAME,
  withArchitectureScanLoadEnv,
} from "./agentic-hook-runner.js";

const REPO = new URL("../../../", import.meta.url).pathname;
const RUNNER = "tools/openclinxr/openclaw/agentic-hook-runner.ts";
const PRODUCT = ["packages/openclinxr/domain/src/claim-language.ts"];

function pathScopedStep() {
  const step = buildArchitectureStep("pre-commit", PRODUCT);
  if (step === null) {
    throw new Error("expected a path-scoped architecture step for a product package path");
  }
  return step;
}

describe("the architecture hook scans finish under parallel load", () => {
  it("(1) RED: path-scoped spawn caps vitest at one worker", () => {
    const spawned = architectureScanSpawnCommand(pathScopedStep());
    expect(spawned).toContain("--maxWorkers=1");
    expect(spawned).toContain("--no-file-parallelism");
    expect(PATH_SCOPED_ARCHITECTURE_LOAD_FLAGS).toEqual(["--maxWorkers=1", "--no-file-parallelism"]);
  });

  it("(2) COUNTERWEIGHT: still runs all four global suites, never omit or full-turbo", () => {
    const step = pathScopedStep();
    const spawned = architectureScanSpawnCommand(step);
    for (const suite of ARCHITECTURE_GLOBAL_SUITE_FILES) {
      expect(spawned).toContain(suite);
    }
    expect(spawned).not.toEqual(["pnpm", "architecture"]);
    expect(step.label).toContain("path-scoped");
  });

  it("(3) COUNTERWEIGHT: full-turbo pre-push/strict spawn is unchanged", () => {
    const prePush = buildArchitectureStep("pre-push", PRODUCT);
    expect(prePush).not.toBeNull();
    expect(architectureScanSpawnCommand(prePush!)).toEqual(["pnpm", "architecture"]);
    expect(architectureScanSpawnCommand(buildArchitectureStep("pre-commit", ["package.json"])!)).toEqual([
      "pnpm",
      "architecture",
    ]);
  });

  it("(4) RED: hook env caps vitest forks/threads at 1 for architecture steps", () => {
    const env = withArchitectureScanLoadEnv(pathScopedStep(), {});
    expect(env["VITEST_MAX_FORKS"]).toBe("1");
    expect(env["VITEST_MAX_THREADS"]).toBe("1");
    expect(withArchitectureScanLoadEnv(buildArchitectureStep("pre-push", PRODUCT)!, {})["VITEST_MAX_FORKS"]).toBe(
      undefined,
    );
  });

  it("(5) RED: scans serialize on a lock in the shared git common dir", () => {
    const lockPath = architectureHookLockPath();
    expect(PATH_SCOPED_ARCHITECTURE_LOCK_NAME).toBe("openclinxr-path-scoped-architecture.lock");
    expect(lockPath.endsWith(PATH_SCOPED_ARCHITECTURE_LOCK_NAME)).toBe(true);
    expect(lockPath.includes(".git")).toBe(true);
  });

  it("(6) VACUITY GUARD: runStep actually applies spawn caps, env, and the lock", () => {
    const src = readFileSync(join(REPO, RUNNER), "utf8");
    expect(src).toContain("architectureScanSpawnCommand(step)");
    expect(src).toContain("withArchitectureScanLoadEnv(");
    expect(src).toContain("withPathScopedArchitectureLock(");
  });
});
