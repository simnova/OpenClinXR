import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureWorktreeBaseFresh, gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import { resolveWorkerWorktree } from "./dispatch-worker.js";

/**
 * HX-PATHS — managed worktrees must be based on origin/main, never a stale local main.
 *
 * Three lanes lost work to a dispatcher base on stale local main: a fresh `git worktree add`
 * with no base defaults to the main checkout's local HEAD, and the reuse reset derives from
 * `rev-parse HEAD` in the main checkout too. When the main checkout lags origin/main, the
 * worker starts behind.
 *
 * Fixture isolation: every git call passes an explicit cwd with an env stripped of inherited
 * GIT_* repo vars; the host repo's `git rev-parse --git-dir` is asserted unchanged after each
 * test. Tmp fixture repos only; no worker worktree path is hard-coded.
 *
 * True-RED run @4b108ef17 (unchanged source): 6/6 fail — assertion lines in RESULT.md
 * ## RED. S3 flips it.fails to it: green against the origin/main base.
 */

const HOST_PROBE_CWD = import.meta.dirname;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: gitEnvWithoutInheritedRepoVars(),
  }).trim();
}

function gitBareInit(dir: string): void {
  execFileSync("git", ["init", "-q", "--bare", dir], {
    cwd: tmpdir(),
    stdio: "ignore",
    env: gitEnvWithoutInheritedRepoVars(),
  });
}

function configureIdentity(cwd: string): void {
  git(cwd, ["config", "user.email", "hx-paths@example.com"]);
  git(cwd, ["config", "user.name", "hx-paths"]);
}

/** Readiness markers so prepareWorktreeForWorker no-ops instead of running pnpm install. */
function writeReadinessMarkers(root: string): void {
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
  mkdirSync(join(root, "packages", "openclinxr", "shared-schemas", "dist"), { recursive: true });
  writeFileSync(join(root, "packages", "openclinxr", "shared-schemas", "dist", "index.js"), "export {};\n");
}

function commitAll(cwd: string, message: string): string {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

const repos: string[] = [];
const managed: { repo: string; path: string }[] = [];
let savedWtRoot: string | undefined;
let hostGitDirBefore = "";

function trackRepo(dir: string): string {
  repos.push(dir);
  return dir;
}

function makeOriginWithA(): { origin: string; seed: string; A: string } {
  const origin = trackRepo(mkdtempSync(join(tmpdir(), "hx-origin-")));
  rmSync(origin, { recursive: true, force: true });
  gitBareInit(origin);
  const seed = trackRepo(mkdtempSync(join(tmpdir(), "hx-seed-")));
  git(seed, ["init", "-q", "-b", "main"]);
  configureIdentity(seed);
  writeFileSync(join(seed, "a.txt"), "A\n");
  writeReadinessMarkers(seed);
  const A = commitAll(seed, "A");
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "-q", "-u", "origin", "main"]);
  execFileSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"], {
    cwd: tmpdir(),
    stdio: "ignore",
    env: gitEnvWithoutInheritedRepoVars(),
  });
  return { origin, seed, A };
}

function pushB(seed: string): string {
  writeFileSync(join(seed, "b.txt"), "B\n");
  const B = commitAll(seed, "B");
  git(seed, ["push", "-q", "origin", "main"]);
  return B;
}

function makeOriginWithAB(): { origin: string; seed: string; A: string; B: string } {
  const { origin, seed, A } = makeOriginWithA();
  const B = pushB(seed);
  return { origin, seed, A, B };
}

function cloneMain(origin: string, tag: string): string {
  const parent = trackRepo(mkdtempSync(join(tmpdir(), `hx-clone-${tag}-`)));
  const dir = join(parent, "c");
  execFileSync("git", ["clone", "-q", "-b", "main", origin, dir], {
    cwd: tmpdir(),
    stdio: ["ignore", "pipe", "pipe"],
    env: gitEnvWithoutInheritedRepoVars(),
  });
  configureIdentity(dir);
  return dir;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const orig = process.stderr.write;
  let buf = "";
  process.stderr.write = ((chunk: unknown): boolean => {
    buf += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  return {
    text: () => buf,
    restore: () => {
      process.stderr.write = orig;
    },
  };
}

beforeEach(() => {
  savedWtRoot = process.env["OPENCLINXR_WT_ROOT"];
  hostGitDirBefore = git(HOST_PROBE_CWD, ["rev-parse", "--git-dir"]);
});

afterEach(() => {
  if (savedWtRoot === undefined) delete process.env["OPENCLINXR_WT_ROOT"];
  else process.env["OPENCLINXR_WT_ROOT"] = savedWtRoot;
  for (const { repo, path } of managed.splice(0)) {
    try {
      git(repo, ["worktree", "remove", "--force", path]);
    } catch {
      // already gone
    }
    rmSync(path, { recursive: true, force: true });
  }
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
  expect(git(HOST_PROBE_CWD, ["rev-parse", "--git-dir"])).toBe(hostGitDirBefore);
});

describe("managed worktrees are based on origin/main, never stale local main", () => {
  it("(a-U) first use without a fetch still lands on origin/main", () => {
    const { origin, seed, A } = makeOriginWithA();
    // Clone BEFORE B exists on the remote: local main = A and no knowledge of B.
    const parent = trackRepo(mkdtempSync(join(tmpdir(), "hx-clone-u-")));
    const C = join(parent, "c");
    execFileSync("git", ["clone", "-q", origin, C], {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: gitEnvWithoutInheritedRepoVars(),
    });
    configureIdentity(C);
    const B = pushB(seed);
    expect(git(C, ["rev-parse", "main"])).toBe(A);
    const wtRoot = trackRepo(mkdtempSync(join(tmpdir(), "hx-wtroot-au-")));
    process.env["OPENCLINXR_WT_ROOT"] = wtRoot;
    const name = `hx-a-u-${process.pid}`;
    const target = resolveWorkerWorktree(C, true, name);
    managed.push({ repo: C, path: target });
    expect(git(target, ["rev-parse", "HEAD"])).toBe(B);
  }, 120_000);

  it("(a-F) first use with a fetched-but-unmerged origin/main lands on origin/main", () => {
    const { origin, A, B } = makeOriginWithAB();
    const C = cloneMain(origin, `f-${process.pid}`);
    git(C, ["reset", "-q", "--hard", A]);
    expect(git(C, ["rev-parse", "main"])).toBe(A);
    expect(git(C, ["rev-parse", "origin/main"])).toBe(B);
    const wtRoot = trackRepo(mkdtempSync(join(tmpdir(), "hx-wtroot-af-")));
    process.env["OPENCLINXR_WT_ROOT"] = wtRoot;
    const name = `hx-a-f-${process.pid}`;
    const target = resolveWorkerWorktree(C, true, name);
    managed.push({ repo: C, path: target });
    expect(git(target, ["rev-parse", "HEAD"])).toBe(B);
  }, 120_000);

  it("(b) reuse resets a worktree sitting at A to origin/main B, announced", () => {
    const { origin, A, B } = makeOriginWithAB();
    const C = cloneMain(origin, `b-${process.pid}`);
    git(C, ["reset", "-q", "--hard", A]);
    expect(git(C, ["rev-parse", "main"])).toBe(A);
    expect(git(C, ["rev-parse", "origin/main"])).toBe(B);
    const wtRoot = trackRepo(mkdtempSync(join(tmpdir(), "hx-wtroot-b-")));
    const target = join(wtRoot, `hx-b-${process.pid}`);
    git(C, ["worktree", "add", "-b", `wt/hx-b-${process.pid}`, target, A]);
    managed.push({ repo: C, path: target });
    expect(git(target, ["rev-parse", "HEAD"])).toBe(A);
    let announced = "";
    const result = ensureWorktreeBaseFresh({
      worktreePath: target,
      mainRoot: C,
      branch: `wt/hx-b-${process.pid}`,
      slice: `hx-b-${process.pid}`,
      announce: (message) => {
        announced = message;
      },
    });
    expect(result.headAfter).toBe(B);
    expect(announced).toMatch(/origin\/main/);
  }, 120_000);

  it("(c) unreachable origin warns and uses the existing origin/main ref, not local main", () => {
    const { origin, A, B } = makeOriginWithAB();
    const C = cloneMain(origin, `c-${process.pid}`);
    expect(git(C, ["rev-parse", "origin/main"])).toBe(B);
    git(C, ["reset", "-q", "--hard", A]);
    git(C, ["remote", "set-url", "origin", join(tmpdir(), `hx-missing-${process.pid}`)]);
    const wtRoot = trackRepo(mkdtempSync(join(tmpdir(), "hx-wtroot-c-")));
    process.env["OPENCLINXR_WT_ROOT"] = wtRoot;
    const cap = captureStderr();
    let target = "";
    try {
      target = resolveWorkerWorktree(C, true, `hx-c-${process.pid}`);
      managed.push({ repo: C, path: target });
    } finally {
      cap.restore();
    }
    expect(git(target, ["rev-parse", "HEAD"])).toBe(B);
    expect(cap.text()).toMatch(/origin/i);
  }, 120_000);

  it("(d) a repo with NO origin remote falls back to local HEAD, announced", () => {
    const N = trackRepo(mkdtempSync(join(tmpdir(), "hx-noorigin-")));
    git(N, ["init", "-q", "-b", "main"]);
    configureIdentity(N);
    writeFileSync(join(N, "a.txt"), "A\n");
    writeReadinessMarkers(N);
    const A = commitAll(N, "A");
    const wtRoot = trackRepo(mkdtempSync(join(tmpdir(), "hx-wtroot-d-")));
    process.env["OPENCLINXR_WT_ROOT"] = wtRoot;
    const cap = captureStderr();
    let target = "";
    try {
      target = resolveWorkerWorktree(N, true, `hx-d-${process.pid}`);
      managed.push({ repo: N, path: target });
    } finally {
      cap.restore();
    }
    expect(git(target, ["rev-parse", "HEAD"])).toBe(A);
    expect(cap.text()).toMatch(/fallback|no origin/i);
  }, 120_000);

  it("(e) OPENCLINXR_WT_ROOT selects the managed root at call time", () => {
    const { origin, B } = makeOriginWithAB();
    const C = cloneMain(origin, `e-${process.pid}`);
    expect(git(C, ["rev-parse", "main"])).toBe(B);
    const wtRoot = trackRepo(mkdtempSync(join(tmpdir(), "hx-wtroot-e-")));
    process.env["OPENCLINXR_WT_ROOT"] = wtRoot;
    const name = `hx-e-${process.pid}`;
    const target = resolveWorkerWorktree(C, true, name);
    managed.push({ repo: C, path: target });
    expect(target.startsWith(`${wtRoot}/`)).toBe(true);
    delete process.env["OPENCLINXR_WT_ROOT"];
    const expectedDefault = join(homedir(), ".grok", "worktrees", "src-openclinxr", `${name}-default`);
    const defTarget = resolveWorkerWorktree(C, true, `${name}-default`);
    managed.push({ repo: C, path: defTarget });
    expect(defTarget).toBe(expectedDefault);
  }, 120_000);

  it("(f) a main checkout sitting on another branch still bases on origin/main", () => {
    const { origin, A, B } = makeOriginWithAB();
    const C = cloneMain(origin, `f-side-${process.pid}`);
    git(C, ["reset", "-q", "--hard", A]);
    git(C, ["checkout", "-q", "-b", "side"]);
    expect(git(C, ["rev-parse", "main"])).toBe(A);
    expect(git(C, ["rev-parse", "origin/main"])).toBe(B);
    expect(git(C, ["branch", "--show-current"])).toBe("side");
    const wtRoot = trackRepo(mkdtempSync(join(tmpdir(), "hx-wtroot-f-")));
    process.env["OPENCLINXR_WT_ROOT"] = wtRoot;
    const name = `hx-f-${process.pid}`;
    const target = resolveWorkerWorktree(C, true, name);
    managed.push({ repo: C, path: target });
    expect(git(target, ["rev-parse", "HEAD"])).toBe(B);
  }, 120_000);
});
