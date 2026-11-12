import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PUSH_LOCK_DIR_ENV, PUSH_LOCK_HELD_ENV, PUSH_LOCK_POLL_MS } from "./heavy-slot.ts";

// Round 2 (tsk_ae4e2d3aec191124): round 1 self-deadlocked because every worktree's
// core.hooksPath points at the SHARED checkout's hooks (old commit, no
// OPENCLINXR_PUSH_LOCK_HELD export) while the NEW heavy-slot.ts waited on the
// lock the push itself held. So the holder's ENVIRONMENT must carry the export
// into `git push` (git passes caller env to hooks); the hook-file export is
// belt-and-braces only. This test drives the REAL git hook path: a temp repo
// whose core.hooksPath points at a temp hooks dir whose pre-push is a copy of
// this worktree's .githooks/pre-push with the export line REMOVED.
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "heavy-slot.ts");
const tsx = path.resolve(here, "../../../node_modules/.bin/tsx");
const hookPath = path.resolve(here, "../../../.githooks/pre-push");
const hostRoot = path.resolve(here, "../../..");

// Memory: a fixture-repo test under a hook corrupted the host repo. Strip every
// repo-redirecting var on every git spawn and always run with cwd = temp repo.
const STRIPPED = ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_PREFIX"];
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STRIPPED) delete env[key];
  // The suite itself runs inside a held slot (pre-commit/pre-push go through heavy-slot), so the
  // inherited held markers would make every spawned heavy-slot pass through: strip both, each case sets its own.
  delete env["OPENCLINXR_HEAVY_SLOT_HELD"];
  delete env[PUSH_LOCK_HELD_ENV];
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = "t";
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = "t@example.invalid";
  return { ...env, ...extra };
}

function gitSync(cwd: string, args: string[], env: NodeJS.ProcessEnv): string {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function hostState(): { head: string; status: string } {
  const env = cleanEnv();
  return { head: gitSync(hostRoot, ["rev-parse", "HEAD"], env), status: gitSync(hostRoot, ["status", "--porcelain"], env) };
}

let hostBefore: { head: string; status: string };
beforeAll(() => {
  hostBefore = hostState();
});
afterAll(() => {
  expect(hostState()).toEqual(hostBefore);
});

const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
  while (children.length > 0) {
    const child = children.pop();
    try {
      if (child?.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child?.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    }
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  expect(hostState()).toEqual(hostBefore);
});

type Fixture = { root: string; lockRoot: string; lockDir: string; marker: string; lane: string; origin: string };

function makeFixture(tag: string): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), `hs-pushlock-r2-${tag}-`));
  dirs.push(root);
  const lockRoot = path.join(root, "lockroot");
  mkdirSync(lockRoot);
  const lockDir = path.join(root, "push.lock");
  const marker = path.join(root, "marker");
  const lane = path.join(root, "lane");
  const origin = path.join(root, "origin.git");
  const hooksDir = path.join(root, "hooks");
  mkdirSync(hooksDir);

  // Fixture hook: copy of this worktree's real pre-push with the export line
  // REMOVED; body calls this worktree's heavy-slot.ts (tsx, same harness as
  // heavy-slot.test.ts) instead of `pnpm hooks:pre-push`. Never the real lock.
  const real = readFileSync(hookPath, "utf8");
  expect(real).toContain("export OPENCLINXR_PUSH_LOCK_HELD=1");
  const hookText = real
    .replace("export OPENCLINXR_PUSH_LOCK_HELD=1\n", "")
    .replace("pnpm hooks:pre-push", `${tsx} ${script} pre-push -- sh -c "touch ${marker}"`);
  expect(hookText).not.toContain("OPENCLINXR_PUSH_LOCK_HELD");
  console.log(`[fixture-pre-push]\n${hookText}`);
  const fixtureHook = path.join(hooksDir, "pre-push");
  writeFileSync(fixtureHook, hookText);
  chmodSync(fixtureHook, 0o755);

  gitSync(root, ["init", "-q", "--bare", "-b", "main", origin], cleanEnv());
  gitSync(root, ["init", "-q", "-b", "main", lane], cleanEnv());
  const laneEnv = cleanEnv();
  gitSync(lane, ["config", "user.email", "t@example.invalid"], laneEnv);
  gitSync(lane, ["config", "user.name", "t"], laneEnv);
  gitSync(lane, ["config", "core.hooksPath", hooksDir], laneEnv);
  writeFileSync(path.join(lane, "file.txt"), "hi\n");
  gitSync(lane, ["add", "."], laneEnv);
  gitSync(lane, ["commit", "-q", "-m", "base"], laneEnv);
  return { root, lockRoot, lockDir, marker, lane, origin };
}

function spawnPush(f: Fixture, extraEnv: Record<string, string>): { child: ChildProcess; output: () => string; exit: Promise<number> } {
  expect(f.lockDir).not.toBe("/private/tmp/openclinxr-push.lock");
  const env = cleanEnv({
    OPENCLINXR_LOCK_ROOT: f.lockRoot,
    OPENCLINXR_SLOTS_HEAVY: "1",
    [PUSH_LOCK_DIR_ENV]: f.lockDir,
    ...extraEnv,
  });
  for (const key of STRIPPED) expect(env[key]).toBeUndefined();
  const child = spawn("git", ["push", f.origin, "HEAD:main"], {
    cwd: f.lane,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk) => {
    out += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    err += String(chunk);
  });
  const exit = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : -1)));
  });
  return { child, output: () => `${out}${err}`, exit };
}

async function waitForOutput(job: { output: () => string }, needle: string, timeoutMs: number): Promise<string> {
  const start = Date.now();
  for (;;) {
    const text = job.output();
    if (text.includes(needle)) return text;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${needle}; got:\n${text}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("push-lock exemption through the real git hook path", () => {
  it("CASE R: lock holder's caller-env export passes through git push into the hook", async () => {
    const f = makeFixture("r");
    mkdirSync(f.lockDir);
    const job = spawnPush(f, { [PUSH_LOCK_HELD_ENV]: "1" });
    expect(await job.exit).toBe(0);
    expect(existsSync(f.marker)).toBe(true);
    expect(job.output()).not.toContain("WAIT_PUSH_LOCK");
  }, 120_000);

  it("CW: without the caller export the hook waits on the holder lock", async () => {
    const f = makeFixture("cw");
    mkdirSync(f.lockDir);
    const job = spawnPush(f, {});
    const t0 = Date.now();
    // Hook startup (git fork + tsx boot) is excluded: the interval below starts
    // at the WAIT line, i.e. once the hook is provably up and waiting.
    await waitForOutput(job, "WAIT_PUSH_LOCK", 60_000);
    const waitLine = job.output();
    expect(waitLine).toContain(`[heavy-slot] WAIT_PUSH_LOCK pre-push ${f.lockDir}`);
    // Two full poll intervals: the marker must still be absent while held.
    await new Promise((resolve) => setTimeout(resolve, 2 * PUSH_LOCK_POLL_MS));
    expect(existsSync(f.marker)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(60_000);
    // Tear down the push process TREE first (hook + tsx are grandchildren via
    // detached pgid), then release the lock dir.
    try {
      if (job.child.pid !== undefined) process.kill(-job.child.pid, "SIGKILL");
    } catch {
      job.child.kill("SIGKILL");
    }
    await job.exit;
    rmSync(f.lockDir, { recursive: true, force: true });
  }, 120_000);
});
