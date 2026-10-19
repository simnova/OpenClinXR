import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import {
  ALLOWLIST_MAX_BYTES,
  ANY_SIZE_LIMIT,
  BINARY_SIZE_LIMIT,
  EMPTY_ALLOWLIST,
  checkFile,
  formatViolation,
  validateAllowlist,
} from "./large-file-guard.js";

// large-file-guard: all git-driving cases run on REAL fixture repos in os.tmpdir()
// (never the host checkout). Spawns use an env stripped of GIT_DIR / GIT_INDEX_FILE /
// GIT_WORK_TREE so a hook-time invocation cannot drive the host repo (measured
// 2026-09-23: that shape flipped core.bare on the shared checkout), and every case
// asserts the host repo's `git rev-parse --git-dir` is unchanged before and after.
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const GUARD = join(REPO_ROOT, "tools/openclinxr/openclaw/large-file-guard.ts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const ALLOWLIST_REL = "tools/openclinxr/openclaw/large-file-allowlist.json";

const CLEAN_ENV = gitEnvWithoutInheritedRepoVars();

function hostGitDir(): string {
  return execFileSync("git", ["rev-parse", "--git-dir"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: CLEAN_ENV,
  }).trim();
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: CLEAN_ENV }).trim();
}

/** Fixture repo with one seed commit; origin/main pinned to it via update-ref (no remote). */
function initFixture(allowlistJson: string = '{"entries":[]}'): string {
  const dir = mkdtempSync(join(tmpdir(), "large-file-guard-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "guard@test.com"]);
  git(dir, ["config", "user.name", "Guard Test"]);
  mkdirSync(dirname(join(dir, ALLOWLIST_REL)), { recursive: true });
  writeFileSync(join(dir, ALLOWLIST_REL), allowlistJson, "utf8");
  git(dir, ["add", ALLOWLIST_REL]);
  git(dir, ["commit", "-q", "-m", "seed with empty allowlist"]);
  git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return dir;
}

function writeFile(dir: string, rel: string, content: string | Buffer): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

function runGuard(
  dir: string,
  args: string[],
): { stdout: string; status: number | null } {
  const res = spawnSync(TSX, [GUARD, ...args], { cwd: dir, encoding: "utf8", env: CLEAN_ENV });
  return { stdout: typeof res.stdout === "string" ? res.stdout : "", status: res.status };
}

describe("large-file-guard rules", () => {
  it("refuses at the exact byte boundaries (1 MiB binary, 5 MiB any)", () => {
    const before = hostGitDir();
    expect(checkFile("model.glb", BINARY_SIZE_LIMIT, EMPTY_ALLOWLIST)).toBeNull();
    const overBinary = checkFile("model.glb", BINARY_SIZE_LIMIT + 1, EMPTY_ALLOWLIST);
    expect(overBinary?.rule).toBe("binary");
    if (overBinary) {
      expect(formatViolation(overBinary)).toBe(
        `model.glb | binary | ${BINARY_SIZE_LIMIT + 1} | ${overBinary.fix}`,
      );
      expect(overBinary.fix).toContain("manifest.json");
    }
    expect(checkFile("notes.txt", ANY_SIZE_LIMIT, EMPTY_ALLOWLIST)).toBeNull();
    const overAny = checkFile("notes.txt", ANY_SIZE_LIMIT + 1, EMPTY_ALLOWLIST);
    expect(overAny?.rule).toBe("any");
    expect(hostGitDir()).toBe(before);
  });

  it("refuses .env/.bak names and passes .example siblings and small binaries", () => {
    const before = hostGitDir();
    expect(checkFile(".env.local.bak-20261017-1505", 12, EMPTY_ALLOWLIST)).not.toBeNull();
    expect(checkFile(".env.local", 12, EMPTY_ALLOWLIST)?.rule).toBe("env");
    expect(checkFile("notes.bak", 12, EMPTY_ALLOWLIST)?.rule).toBe("bak");
    expect(checkFile(".env.local.example", 12, EMPTY_ALLOWLIST)).toBeNull();
    expect(checkFile("avatar.glb", 102400, EMPTY_ALLOWLIST)).toBeNull();
    expect(hostGitDir()).toBe(before);
  });

  it("allowlist exempts binary/any under maxBytes but never env", () => {
    const before = hostGitDir();
    const allow = validateAllowlist({
      entries: [{ glob: "vendor/**", reason: "reviewed fixture exemption", maxBytes: 2000000 }],
    });
    if (!("allowlist" in allow)) throw new Error("fixture allowlist must validate");
    expect(checkFile("vendor/big.glb", 1500000, allow.allowlist)).toBeNull();
    expect(checkFile("vendor/big.glb", 2000001, allow.allowlist)?.rule).toBe("binary");
    const envAllow = validateAllowlist({
      entries: [{ glob: ".env*", reason: "must not save env", maxBytes: ALLOWLIST_MAX_BYTES }],
    });
    if (!("allowlist" in envAllow)) throw new Error("fixture allowlist must validate");
    expect(checkFile(".env.x", 10, envAllow.allowlist)?.rule).toBe("env");
    expect(hostGitDir()).toBe(before);
  });

  it("rejects invalid allowlists (broad glob, missing reason, over-limit maxBytes)", () => {
    const before = hostGitDir();
    expect(
      "error" in
        validateAllowlist({ entries: [{ glob: "**", reason: "x", maxBytes: 100 }] }),
    ).toBe(true);
    expect(
      "error" in validateAllowlist({ entries: [{ glob: "a/**", maxBytes: 100 }] }),
    ).toBe(true);
    expect(
      "error" in
        validateAllowlist({ entries: [{ glob: "a/**", reason: "x", maxBytes: 200000000 }] }),
    ).toBe(true);
    const real = JSON.parse(readFileSync(join(REPO_ROOT, ALLOWLIST_REL), "utf8"));
    const valid = validateAllowlist(real);
    if (!("allowlist" in valid)) throw new Error(`shipped allowlist invalid: ${valid.error}`);
    expect(valid.allowlist.entries.length).toBeGreaterThan(0);
    expect(hostGitDir()).toBe(before);
  });

  it("--staged refuses a planted blob and .env, prints violation lines, passes when clean", () => {
    const before = hostGitDir();
    const dir = initFixture();
    writeFile(dir, "blobs/model.glb", Buffer.alloc(BINARY_SIZE_LIMIT + 1));
    writeFile(dir, ".env.local", "SECRET=x\n");
    git(dir, ["add", "blobs/model.glb", ".env.local"]);
    const refused = runGuard(dir, ["--staged"]);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("blobs/model.glb | binary |");
    expect(refused.stdout).toContain(".env.local | env |");
    expect(refused.stdout).toContain("manifest.json");
    console.log(`planted --staged violations:\n${refused.stdout}`);
    git(dir, ["reset", "-q"]);
    writeFile(dir, "notes.txt", "small\n");
    git(dir, ["add", "notes.txt"]);
    const clean = runGuard(dir, ["--staged"]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toBe("");
    expect(hostGitDir()).toBe(before);
  });

  it("--staged refuses a blob whose allowlist entry exists only in the commit under test", () => {
    const before = hostGitDir();
    const dir = initFixture();
    writeFile(dir, "vendor/big.npz", Buffer.alloc(2000000));
    writeFile(
      dir,
      ALLOWLIST_REL,
      JSON.stringify({ entries: [{ glob: "vendor/**", reason: "self-dealt", maxBytes: 5000000 }] }),
    );
    git(dir, ["add", "vendor/big.npz", ALLOWLIST_REL]);
    const res = runGuard(dir, ["--staged"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("vendor/big.npz | binary |");
    expect(hostGitDir()).toBe(before);
  });

  it("--staged fails closed on an invalid allowlist in the base ref", () => {
    const before = hostGitDir();
    const dir = initFixture('{"entries":[{"glob":"**","reason":"too broad","maxBytes":100}]}');
    writeFile(dir, "notes.txt", "small\n");
    git(dir, ["add", "notes.txt"]);
    const res = runGuard(dir, ["--staged"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("too broad");
    expect(hostGitDir()).toBe(before);
  });

  it("--push refuses a blob added then deleted inside the range; missing base fails; clean passes", () => {
    const before = hostGitDir();
    const dir = initFixture();
    writeFile(dir, "strands.npz", Buffer.alloc(2000000));
    git(dir, ["add", "strands.npz"]);
    git(dir, ["commit", "-q", "-m", "add big npz"]);
    git(dir, ["rm", "-q", "strands.npz"]);
    git(dir, ["commit", "-q", "-m", "remove big npz"]);
    const refused = runGuard(dir, ["--push"]);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("strands.npz | binary |");
    const missing = runGuard(dir, ["--push", "--base", "refs/remotes/does-not-exist"]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain("missing");
    const cleanDir = initFixture();
    writeFile(cleanDir, "notes.txt", "small\n");
    git(cleanDir, ["add", "notes.txt"]);
    git(cleanDir, ["commit", "-q", "-m", "small file"]);
    const clean = runGuard(cleanDir, ["--push"]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toBe("");
    expect(hostGitDir()).toBe(before);
  });
});
