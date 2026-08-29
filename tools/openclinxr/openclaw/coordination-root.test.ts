import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoordinationRootCache, resolveCoordinationRoot, resolveSharedCoordinationPath } from "./coordination-root.js";

afterEach(() => {
  resetCoordinationRootCache();
  delete process.env["OPENCLINXR_COORDINATION_ROOT"];
});

describe("coordination root", () => {
  it("resolves to the SAME directory from a linked worktree as from the main worktree", () => {
    // This is the whole point: parallel agents live in different worktrees and must agree on one
    // lease file. If this ever regresses, every agent silently gets a private lease and mutual
    // exclusion becomes imaginary.
    const base = mkdtempSync(join(tmpdir(), "coord-root-"));
    const main = join(base, "main");
    const linked = join(base, "linked");
    // MEASURED 2026-08-29: git exports GIT_INDEX_FILE (and often GIT_DIR / GIT_WORK_TREE) to HOOKS,
    // pointing at the in-progress commit's temp index. A child `git` inheriting them dies with
    // `fatal: .git/index: index file open failed: Not a directory`, so this file passed standalone
    // and failed only inside pre-commit. Strip them; every call below passes an explicit cwd, so
    // repo resolution never depended on the inherited values.
    const cleanEnv = (): NodeJS.ProcessEnv => {
      const env = { ...process.env };
      for (const key of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"]) {
        delete env[key];
      }
      return env;
    };
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: cleanEnv() });

    try {
      execFileSync("git", ["init", "-q", "-b", "main", main], { stdio: "ignore", env: cleanEnv() });
      git(["config", "user.email", "t@example.com"], main);
      git(["config", "user.name", "t"], main);
      git(["commit", "-q", "--allow-empty", "-m", "init"], main);
      git(["worktree", "add", "-q", "-b", "side", linked], main);

      resetCoordinationRootCache();
      const fromMain = resolveCoordinationRoot(main);
      resetCoordinationRootCache();
      const fromLinked = resolveCoordinationRoot(linked);

      expect(fromLinked).toBe(fromMain);
      expect(fromLinked).not.toBe(linked); // would be the bug: worktree-local
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honours an explicit override so a run can opt out of sharing", () => {
    process.env["OPENCLINXR_COORDINATION_ROOT"] = "/tmp/isolated-run";
    expect(resolveCoordinationRoot("/anywhere")).toBe("/tmp/isolated-run");
    expect(resolveSharedCoordinationPath("a/b.json", "/anywhere")).toBe("/tmp/isolated-run/a/b.json");
  });

  it("leaves absolute paths untouched", () => {
    expect(resolveSharedCoordinationPath("/already/absolute.json")).toBe("/already/absolute.json");
  });

  it("degrades to cwd outside a git repo rather than throwing", () => {
    const outside = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    try {
      resetCoordinationRootCache();
      expect(resolveCoordinationRoot(outside)).toBe(outside);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
