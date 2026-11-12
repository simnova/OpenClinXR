import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readComputeSlotsStatus } from "@openclinxr/compute-slots/slots";
import { childEnv, HELD_ENV, PUSH_LOCK_DIR_ENV, PUSH_LOCK_HELD_ENV, PUSH_LOCK_LEGACY_ENV, PUSH_LOCK_POLL_MS, pushLockDir } from "./heavy-slot.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "heavy-slot.ts");
const tsx = path.resolve(here, "../../../node_modules/.bin/tsx");
const hookPath = path.resolve(here, "../../../.githooks/pre-push");

const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
  while (children.length > 0) {
    const child = children.pop();
    try {
      child?.kill("SIGKILL");
    } catch {
      /* already exited */
    }
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function spawnJob(env: NodeJS.ProcessEnv, label: string, shell: string): { child: ChildProcess; stdout: () => string; output: () => string; exit: Promise<number> } {
  const child = spawn(tsx, [script, label, "--", "sh", "-c", shell], { env, stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("exit", (code) => resolve(code ?? -1));
  });
  return { child, stdout: () => out, output: () => `${out}${err}`, exit };
}

async function waitForStdout(job: { stdout: () => string }, needle: string, timeoutMs: number): Promise<string> {
  const start = Date.now();
  for (;;) {
    const text = job.stdout();
    if (text.includes(needle)) return text;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for stdout ${needle}; got:\n${text}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForPath(target: string, present: boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (existsSync(target) === present) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function cleanEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env[HELD_ENV];
  delete env[PUSH_LOCK_HELD_ENV];
  return env;
}

describe("push-lock constants", () => {
  it("names the push-lock env vars and a numeric poll interval", () => {
    expect(PUSH_LOCK_DIR_ENV).toBe("OPENCLINXR_PUSH_LOCK_DIR");
    expect(PUSH_LOCK_HELD_ENV).toBe("OPENCLINXR_PUSH_LOCK_HELD");
    expect(typeof PUSH_LOCK_POLL_MS).toBe("number");
    expect(PUSH_LOCK_POLL_MS).toBeGreaterThan(0);
  });

  it("watches the restamp script's OPENCLINXR_PUSH_LOCK when OPENCLINXR_PUSH_LOCK_DIR is unset, and the default when both are", () => {
    // push-main-restamp.sh:7 honours OPENCLINXR_PUSH_LOCK; heavy-slot must watch the same path (cap20 2026-11-11).
    expect(PUSH_LOCK_LEGACY_ENV).toBe("OPENCLINXR_PUSH_LOCK");
    expect(pushLockDir({ [PUSH_LOCK_LEGACY_ENV]: "/tmp/x-legacy" })).toBe("/tmp/x-legacy");
    expect(pushLockDir({ [PUSH_LOCK_DIR_ENV]: "/tmp/x-dir", [PUSH_LOCK_LEGACY_ENV]: "/tmp/x-legacy" })).toBe("/tmp/x-dir");
    expect(pushLockDir({})).toBe("/private/tmp/openclinxr-push.lock");
  });

  it("passes the push-lock exemption to children only when the parent held it", () => {
    const held = childEnvForTest({ [PUSH_LOCK_HELD_ENV]: "1" });
    expect(held[PUSH_LOCK_HELD_ENV]).toBe("1");
    const free = childEnvForTest({});
    expect(PUSH_LOCK_HELD_ENV in free).toBe(false);
  });
});

function childEnvForTest(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return childEnv(base, { turboConcurrency: 1, vitestMaxWorkers: 1 });
}

describe("push-lock wait", () => {
  it("R1: waits while the push lock dir exists, runs after it is gone", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hs-pushlock-r1-"));
    dirs.push(root);
    const lockDir = path.join(root, "push.lock");
    mkdirSync(lockDir);
    const marker = path.join(root, "marker");
    const env = cleanEnv({ OPENCLINXR_LOCK_ROOT: root, OPENCLINXR_SLOTS_HEAVY: "1", [PUSH_LOCK_DIR_ENV]: lockDir });
    const job = spawnJob(env, "r1", `touch "${marker}"`);
    // Startup sync: the WAIT line proves the process is up and waiting (removes tsx
    // start-up from the timing). If the marker wins the race instead, the gate is gone.
    let seen = "";
    {
      const start = Date.now();
      for (;;) {
        seen = job.stdout();
        if (seen.includes("WAIT_PUSH_LOCK")) break;
        if (existsSync(marker)) throw new Error("marker present under a held lock: no WAIT_PUSH_LOCK line, gate missing?");
        if (Date.now() - start > 60_000) throw new Error(`timed out waiting for stdout WAIT_PUSH_LOCK; got:\n${seen}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(seen).toContain(`[heavy-slot] WAIT_PUSH_LOCK r1 ${lockDir}`);
    // One full poll interval to notice + one slack: the marker must still be absent.
    await new Promise((resolve) => setTimeout(resolve, 2 * PUSH_LOCK_POLL_MS));
    expect(existsSync(marker)).toBe(false);
    rmdirSync(lockDir);
    expect(await waitForPath(marker, true, 2 * PUSH_LOCK_POLL_MS + 500)).toBe(true);
    expect(await job.exit).toBe(0);
    expect(job.stdout().match(/WAIT_PUSH_LOCK/gu)?.length).toBe(1);
  }, 120_000);

  it("CW1: the lock holder's exemption runs without waiting", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hs-pushlock-cw1-"));
    dirs.push(root);
    const lockDir = path.join(root, "push.lock");
    mkdirSync(lockDir);
    const marker = path.join(root, "marker");
    const env = cleanEnv({ OPENCLINXR_LOCK_ROOT: root, OPENCLINXR_SLOTS_HEAVY: "1", [PUSH_LOCK_DIR_ENV]: lockDir });
    env[PUSH_LOCK_HELD_ENV] = "1";
    const job = spawnJob(env, "cw1", `touch "${marker}"`);
    expect(await job.exit).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(job.output()).not.toContain("WAIT_PUSH_LOCK");
  }, 120_000);

  it("CW2: no lock dir means no wait and no wait line", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hs-pushlock-cw2-"));
    dirs.push(root);
    const lockDir = path.join(root, "push.lock");
    const marker = path.join(root, "marker");
    const env = cleanEnv({ OPENCLINXR_LOCK_ROOT: root, OPENCLINXR_SLOTS_HEAVY: "1", [PUSH_LOCK_DIR_ENV]: lockDir });
    const job = spawnJob(env, "cw2", `touch "${marker}"`);
    expect(await job.exit).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(job.output()).not.toContain("WAIT_PUSH_LOCK");
  }, 120_000);

  it("CW3: a waiter holds no compute slot while waiting", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hs-pushlock-cw3-"));
    dirs.push(root);
    const lockDir = path.join(root, "push.lock");
    mkdirSync(lockDir);
    const marker1 = path.join(root, "marker1");
    const marker2 = path.join(root, "marker2");
    const env = cleanEnv({ OPENCLINXR_LOCK_ROOT: root, OPENCLINXR_SLOTS_HEAVY: "1", [PUSH_LOCK_DIR_ENV]: lockDir });
    const first = spawnJob(env, "cw3wait", `touch "${marker1}"`);
    await waitForStdout(first, "WAIT_PUSH_LOCK", 60_000);
    const priorRoot = process.env["OPENCLINXR_LOCK_ROOT"];
    process.env["OPENCLINXR_LOCK_ROOT"] = root;
    let holders = -1;
    let waiters = -1;
    try {
      const heavy = readComputeSlotsStatus().pools.find((pool) => pool.pool === "heavy");
      holders = heavy?.holders.length ?? -1;
      waiters = heavy?.waiters.length ?? -1;
    } finally {
      if (priorRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
      else process.env["OPENCLINXR_LOCK_ROOT"] = priorRoot;
    }
    expect(holders).toBe(0);
    expect(waiters).toBe(0);
    // An exempt job runs to completion while the first still waits: the waiter holds no slot.
    const env2 = { ...env, [PUSH_LOCK_HELD_ENV]: "1" };
    const second = spawnJob(env2, "cw3exempt", `touch "${marker2}"`);
    expect(await second.exit).toBe(0);
    expect(existsSync(marker2)).toBe(true);
    expect(existsSync(marker1)).toBe(false);
    rmdirSync(lockDir);
    expect(await first.exit).toBe(0);
    expect(existsSync(marker1)).toBe(true);
  }, 120_000);

  it("CW4: pre-push exports the held marker before running the hook", () => {
    const text = readFileSync(hookPath, "utf8");
    const exportIdx = text.indexOf("export OPENCLINXR_PUSH_LOCK_HELD=1");
    const pnpmIdx = text.indexOf("pnpm hooks:pre-push");
    expect(exportIdx).toBeGreaterThanOrEqual(0);
    expect(pnpmIdx).toBeGreaterThanOrEqual(0);
    expect(exportIdx).toBeLessThan(pnpmIdx);
  });
});
