import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integrate, integrationEvents } from "./integrate.js";

/**
 * PLANTED RED — a rejected merge must not remain staged in the shared checkout.
 *
 * A failed pre-commit hook currently reaches integrate.ts:634-636, which rethrows without running
 * `git merge --abort`. That leaves MERGE_HEAD plus the candidate tree in the shared main checkout.
 * Append ## FIXED when the cleanup is implemented; flip only the three `it.fails` clauses to `it`.
 */

const repos: string[] = [];
afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function repoWithBenignHead(): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "integrate-abort-red-"));
  repos.push(root);
  execFileSync("git", ["init", "-q", "-b", "main", root], { stdio: "ignore" });
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, "readme.md"), "base\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "-b", "wt/change"]);
  writeFileSync(join(root, "readme.md"), "base\ncandidate\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "candidate"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "main"]);
  return { root, base, head };
}

function installFailingCommitHook(root: string): void {
  const hook = join(root, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho planted-commit-hook-failure >&2\nexit 42\n");
  chmodSync(hook, 0o755);
}

const greenContract = {
  proofsOk: true,
  proofs: [{ rule: "run:true", passed: true, detail: "ok" }],
};

function failedLand(root: string, base: string, head: string): Error {
  installFailingCommitHook(root);
  try {
    integrate({ repoRoot: root, base, head, slice: "clean-slice", contract: greenContract });
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the planted commit hook to refuse integration");
}

describe("integrate unwinds a merge whose commit fails", () => {
  it.fails("(1) COMMIT-HOOK FAILURE ABORTS BEFORE RETHROW", () => {
    const { root, base, head } = repoWithBenignHead();
    const error = failedLand(root, base, head);
    expect(error.message).toContain("planted-commit-hook-failure");
    expect(existsSync(join(root, ".git", "MERGE_HEAD")), "failed integrate left MERGE_HEAD behind").toBe(false);
  });

  it.fails("(2) FAILED LAND RESTORES THE PRE-LAND CHECKOUT", () => {
    const { root, base, head } = repoWithBenignHead();
    const before = readFileSync(join(root, "readme.md"), "utf8");
    failedLand(root, base, head);
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(base);
    expect(git(root, ["diff", "--cached", "--name-only"]).trim(), "candidate files remain staged").toBe("");
    expect(readFileSync(join(root, "readme.md"), "utf8")).toBe(before);
  });

  it.fails("(3) ABORT FAILURE IS NOT HIDDEN", () => {
    const { root, base, head } = repoWithBenignHead();
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const shimDir = join(root, "git-shim");
    mkdirSync(shimDir);
    const shim = join(shimDir, "git");
    writeFileSync(
      shim,
      `#!/bin/sh\nif [ "$1" = merge ] && [ "$2" = --abort ]; then echo planted-abort-failure >&2; exit 77; fi\nexec "${realGit}" "$@"\n`,
    );
    chmodSync(shim, 0o755);
    installFailingCommitHook(root);
    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDir}:${previousPath ?? ""}`;
    try {
      expect(() => integrate({ repoRoot: root, base, head, slice: "clean-slice", contract: greenContract }))
        .toThrow(/planted-commit-hook-failure[\s\S]*planted-abort-failure|planted-abort-failure[\s\S]*planted-commit-hook-failure/);
    } finally {
      process.env.PATH = previousPath;
      if (existsSync(join(root, ".git", "MERGE_HEAD"))) git(root, ["merge", "--abort"]);
    }
  });

  it("(4) COUNTERWEIGHT: a successful integrate still lands and records one event", () => {
    const { root, base, head } = repoWithBenignHead();
    const result = integrate({ repoRoot: root, base, head, slice: "clean-slice", contract: greenContract });
    expect(result.landed).toBe(true);
    expect(git(root, ["rev-parse", "HEAD"]).trim()).not.toBe(base);
    expect(integrationEvents(root)).toHaveLength(1);
  });
});

// NOT TESTED: conflicts before commit; post-commit rebuild failure; cross-process signal termination.
