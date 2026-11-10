import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Fixture: a local bare origin + a clone + a pre-push hook in the clone that counts invocations and,
// on its first call, advances origin/main from a second clone. No network, no GitHub, never the real
// push lock: the lock path and load wait are env overrides pointed at mkdtemp.
const here = dirname(fileURLToPath(import.meta.url));
// OPENCLINXR_PUSH_SCRIPT_UNDER_TEST lets the RED run target a lock-redirected copy of an older script.
const script = process.env.OPENCLINXR_PUSH_SCRIPT_UNDER_TEST ?? resolve(here, "push-main-restamp.sh");

// Under a git hook these vars override cwd and would drive the HOST repo (memory: fixture-repo test
// under a hook corrupted the host repo).
const STRIPPED = ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"];
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STRIPPED) delete env[key];
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = "t";
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = "t@example.invalid";
  return { ...env, ...extra };
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

type Fixture = { root: string; origin: string; lane: string; other: string; lock: string; counter: string; log: string };

/** hook: "advance" = first call advances origin/main then lets the push proceed (rejected), "red" = always exit 1. */
function makeFixture(hook: "advance" | "red", advanceFile: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "push-main-restamp-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  const lane = join(root, "lane");
  const other = join(root, "other");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, lane);
  git(lane, "checkout", "-q", "-b", "main");
  mkdirSync(join(lane, "tools/openclinxr/evidence"), { recursive: true });
  mkdirSync(join(lane, "apps/ui-xr/src"), { recursive: true });
  writeFileSync(join(lane, "apps/ui-xr/src/main.ts"), "// main\n");
  git(lane, "add", ".");
  git(lane, "commit", "-q", "-m", "main.ts");
  const stamp = git(lane, "log", "-1", "--format=%h", "--", "apps/ui-xr/src/main.ts");
  writeFileSync(
    join(lane, "tools/openclinxr/evidence/station-luminance-sweep.json"),
    JSON.stringify({ measuredAgainstCommit: stamp }),
  );
  git(lane, "add", ".");
  git(lane, "commit", "-q", "-m", "base");
  git(lane, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, other);
  git(other, "checkout", "-q", "main");

  const counter = join(root, "hook-count");
  writeFileSync(counter, "0");
  const hookPath = join(lane, ".git/hooks/pre-push");
  const advance =
    hook === "advance"
      ? `if [ "$n" = 1 ]; then
  mkdir -p "$(dirname "${join(other, advanceFile)}")"
  echo advance > "${join(other, advanceFile)}"
  git -C "${other}" add -A && git -C "${other}" commit -q -m advance && git -C "${other}" push -q origin main
fi
exit 0`
      : 'echo "UnhandledPromiseRejection: rejected non-fast-forward (fetch first)" >&2\nexit 1';
  writeFileSync(
    hookPath,
    `#!/bin/sh
n=$(( $(cat "${counter}") + 1 ))
echo $n > "${counter}"
${advance}
`,
  );
  chmodSync(hookPath, 0o755);

  // lane commit
  writeFileSync(join(lane, "lane-work.txt"), "lane\n");
  git(lane, "add", ".");
  git(lane, "commit", "-q", "-m", "lane commit");
  return { root, origin, lane, other, lock: join(root, "push.lock"), counter, log: join(root, "push.log") };
}

function run(f: Fixture, extra: Record<string, string> = {}) {
  const env = cleanEnv({
    OPENCLINXR_PUSH_LOCK: f.lock,
    OPENCLINXR_PUSH_LOAD_MAX: "100000",
    ...extra,
  });
  const r = spawnSync("zsh", [script, f.lane, f.log], { env, encoding: "utf8", timeout: 60_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, hooks: Number(readFileSync(f.counter, "utf8")), env };
}

const originHas = (f: Fixture, file: string) => git(f.origin, "ls-tree", "-r", "--name-only", "main").split("\n").includes(file);

describe("push-main-restamp.sh retry on a non-fast-forward reject", () => {
  it("pushes, is rejected once because main moved, rebases and succeeds through the hook again", () => {
    const f = makeFixture("advance", "docs-note.txt");
    const r = run(f);
    expect(r.out).toContain("rebased onto");
    expect(r.status).toBe(0);
    expect(r.hooks).toBe(2);
    expect(originHas(f, "lane-work.txt")).toBe(true);
    expect(originHas(f, "docs-note.txt")).toBe(true);
    expect(existsSync(f.lock)).toBe(false);
  });

  it("exits 6 main moved twice when the second push is also rejected", () => {
    const f = makeFixture("advance", "docs-note.txt");
    // hook advances on every call: both pushes are rejected
    const hookPath = join(f.lane, ".git/hooks/pre-push");
    writeFileSync(
      hookPath,
      `#!/bin/sh
n=$(( $(cat "${f.counter}") + 1 ))
echo $n > "${f.counter}"
echo "$n" > "${join(f.other, "docs-note.txt")}"
git -C "${f.other}" pull -q --rebase origin main
git -C "${f.other}" add -A && git -C "${f.other}" commit -q -m "advance $n" && git -C "${f.other}" push -q origin main
exit 0
`,
    );
    const r = run(f);
    expect(r.status).toBe(6);
    expect(r.out).toContain("main moved twice");
    expect(r.hooks).toBe(2);
    expect(originHas(f, "lane-work.txt")).toBe(false);
  });

  it("does not retry a red pre-push hook: exit 1, one hook run", () => {
    const f = makeFixture("red", "unused.txt");
    const r = run(f);
    expect(r.status).toBe(1);
    expect(r.hooks).toBe(1);
    expect(originHas(f, "lane-work.txt")).toBe(false);
    expect(existsSync(f.lock)).toBe(false);
  });

  it("exits 3 without a second push when the advancing commit touches a lane path", () => {
    const f = makeFixture("advance", "packages/openclinxr/xr-sync-server/touch.txt");
    const r = run(f);
    expect(r.status).toBe(3);
    expect(r.out).toContain("main moved on lane paths");
    expect(r.hooks).toBe(1);
    expect(originHas(f, "lane-work.txt")).toBe(false);
  });

  it("spawns with no inherited repo variables", () => {
    const f = makeFixture("advance", "docs-note.txt");
    const r = run(f);
    for (const key of STRIPPED) expect(r.env[key]).toBeUndefined();
    expect(r.env.GIT_DIR).toBeUndefined();
  });

  it("re-runs the sweep when the stamp differs from the main.ts head after the rebase", () => {
    const f = makeFixture("advance", "apps/ui-xr/src/main.ts");
    const sweepMarker = join(f.root, "sweep-ran");
    const sweep = join(f.root, "sweep.sh");
    writeFileSync(
      sweep,
      `#!/bin/sh
touch "${sweepMarker}"
sha=$(git log -1 --format=%h -- apps/ui-xr/src/main.ts)
echo "{\\"measuredAgainstCommit\\":\\"$sha\\"}" > tools/openclinxr/evidence/station-luminance-sweep.json
`,
    );
    chmodSync(sweep, 0o755);
    const r = run(f, { OPENCLINXR_SWEEP_CMD: sweep });
    expect(r.out).toContain("re-running the sweep");
    expect(existsSync(sweepMarker)).toBe(true);
    expect(r.status).toBe(0);
    expect(git(f.origin, "log", "-1", "--format=%s", "main")).toContain("Re-run the luminance sweep");
  });
});
