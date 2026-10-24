import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalComputeServices } from "./local.js";
import { readComputeSlotsStatus } from "@openclinxr/compute-slots/slots";

let temp: string | null = null;
const priorLockRoot = process.env["OPENCLINXR_LOCK_ROOT"];
function tempRoot(): string {
  temp = mkdtempSync(path.join(tmpdir(), `proc-cancel-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = path.join(temp, "locks");
  return temp;
}
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = null;
  if (priorLockRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
  else process.env["OPENCLINXR_LOCK_ROOT"] = priorLockRoot;
});

const isUnix = process.platform !== "win32";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function writeScript(file: string, lines: string[]): void {
  writeFileSync(file, `${lines.join("\n")}\n`);
}
async function waitFile(file: string, msg: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(msg);
    await sleep(25);
  }
}
function readIds(file: string): { wrapper: number; grandchild: number } {
  return JSON.parse(readFileSync(file, "utf8")) as { wrapper: number; grandchild: number };
}
async function killOwn(file: string): Promise<void> {
  if (!existsSync(file)) return;
  for (const pid of Object.values(readIds(file))) {
    if (pidAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  }
}
function blenderCwd(root: string, signal?: AbortSignal): ReturnType<typeof createLocalComputeServices> {
  return createLocalComputeServices({ cwd: root, ...(signal === undefined ? {} : { signal }) });
}

describe("process-group cancellation", () => {
  it("early wrapper exit still waits for timeout kill of TERM-ignore grandchild", async () => {
    const root = tempRoot();
    const ctl = new AbortController();
    const grand = path.join(root, "g.mjs");
    const wrap = path.join(root, "w.mjs");
    const pids = path.join(root, "pids.json");
    let pending: Promise<unknown> | null = null;
    try {
      writeScript(grand, ['process.on("SIGTERM", () => {});', "setInterval(() => {}, 20);"]);
      writeScript(wrap, [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        `const g = spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: "ignore" });`,
        `writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ wrapper: process.pid, grandchild: g.pid }));`,
        "g.unref();",
        "setTimeout(() => process.exit(0), 50);",
      ]);
      let done = false;
      const run = blenderCwd(root, ctl.signal).blender.run({
        script: process.execPath, args: [wrap], label: "test:early-exit", timeoutMs: 200,
        ensurePythonExitCode: false, timeoutKillGraceMs: 50,
      });
      pending = run;
      void run.then(() => { done = true; }, () => { done = true; });
      await waitFile(pids, "wrapper never started");
      const ids = readIds(pids);
      const wDeadline = Date.now() + 10_000;
      while (pidAlive(ids.wrapper)) {
        if (Date.now() > wDeadline) throw new Error("wrapper never exited early");
        await sleep(10);
      }
      expect(done).toBe(false);
      const result = await run;
      expect(result.timedOut).toBe(true);
      if (isUnix) {
        expect(pidAlive(ids.wrapper)).toBe(false);
        expect(pidAlive(ids.grandchild)).toBe(false);
      } else expect(pidAlive(ids.wrapper)).toBe(false);
      await expect(blenderCwd(root).blender.run({
        script: process.execPath, args: ["-e", "process.exit(0)"], label: "test:after",
        timeoutMs: 5_000, ensurePythonExitCode: false,
      })).resolves.toMatchObject({ code: 0, timedOut: false });
    } finally {
      ctl.abort(new Error("test cleanup"));
      if (pending) await pending.catch(() => {});
      await killOwn(pids);
    }
  });

  it("abort kills a pipe-holding wrapper group and frees the slot", async () => {
    const root = tempRoot();
    const ctl = new AbortController();
    const grand = path.join(root, "g.mjs");
    const wrap = path.join(root, "w.mjs");
    const pids = path.join(root, "pids.json");
    let pending: Promise<unknown> | null = null;
    try {
      writeScript(grand, ['process.stdout.write("alive\\n");', "setInterval(() => {}, 20);"]);
      writeScript(wrap, [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        `const g = spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: "inherit" });`,
        `writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ wrapper: process.pid, grandchild: g.pid }));`,
        "setInterval(() => {}, 20);",
      ]);
      const run = blenderCwd(root, ctl.signal).blender.run({
        script: process.execPath, args: [wrap], label: "test:abort",
        timeoutMs: 10_000, ensurePythonExitCode: false,
      });
      pending = run;
      void run.catch(() => {});
      await waitFile(pids, "wrapper never started");
      ctl.abort(new Error("test abort"));
      await expect(run).rejects.toThrow("test abort");
      const ids = readIds(pids);
      if (isUnix) {
        expect(pidAlive(ids.wrapper)).toBe(false);
        expect(pidAlive(ids.grandchild)).toBe(false);
      } else expect(pidAlive(ids.wrapper)).toBe(false);
      await expect(blenderCwd(root).blender.run({
        script: process.execPath, args: ["-e", "process.exit(0)"], label: "test:after",
        timeoutMs: 5_000, ensurePythonExitCode: false,
      })).resolves.toMatchObject({ code: 0 });
    } finally {
      ctl.abort(new Error("test cleanup"));
      if (pending) await pending.catch(() => {});
      await killOwn(pids);
    }
  });

  it("queued abort spawns nothing while holders stay alive", async () => {
    const root = tempRoot();
    const h1 = new AbortController();
    const h2 = new AbortController();
    const q = new AbortController();
    const marker = path.join(root, "never-spawned");
    const hold = path.join(root, "hold.mjs");
    const pidA = path.join(root, "a.pid");
    const pidB = path.join(root, "b.pid");
    let r1: Promise<unknown> | null = null;
    let r2: Promise<unknown> | null = null;
    let rq: Promise<unknown> | null = null;
    try {
      writeScript(hold, [
        'import { writeFileSync } from "node:fs";',
        "writeFileSync(process.argv[2], String(process.pid));",
        "setInterval(() => {}, 20);",
      ]);
      const run1 = blenderCwd(root, h1.signal).blender.run({
        script: process.execPath, args: [hold, pidA], label: "test:holder-a",
        timeoutMs: 10_000, ensurePythonExitCode: false,
      });
      const run2 = blenderCwd(root, h2.signal).blender.run({
        script: process.execPath, args: [hold, pidB], label: "test:holder-b",
        timeoutMs: 10_000, ensurePythonExitCode: false,
      });
      r1 = run1; r2 = run2;
      void run1.catch(() => {}); void run2.catch(() => {});
      await waitFile(pidA, "holder-a never started");
      await waitFile(pidB, "holder-b never started");
      const queued = blenderCwd(root, q.signal).blender.run({
        script: process.execPath, args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
        label: "test:queued", timeoutMs: 10_000, ensurePythonExitCode: false,
      });
      rq = queued;
      void queued.catch(() => {});
      const deadline = Date.now() + 10_000;
      for (;;) {
        const waiters = readComputeSlotsStatus().pools.find((p) => p.pool === "blender")?.waiters ?? [];
        if (waiters.some((w) => w.label === "test:queued")) break;
        if (Date.now() > deadline) throw new Error("target never queued");
        await sleep(25);
      }
      q.abort(new Error("queued abort"));
      await expect(queued).rejects.toThrow("queued abort");
      expect(existsSync(marker)).toBe(false);
      expect(pidAlive(Number(readFileSync(pidA, "utf8")))).toBe(true);
      expect(pidAlive(Number(readFileSync(pidB, "utf8")))).toBe(true);
    } finally {
      h1.abort(new Error("test cleanup"));
      h2.abort(new Error("test cleanup"));
      q.abort(new Error("test cleanup"));
      if (rq) await rq.catch(() => {});
      if (r1) await r1.catch(() => {});
      if (r2) await r2.catch(() => {});
    }
  });

  it("pre-abort and spawn failure settle with no child or queue leak", async () => {
    const root = tempRoot();
    const marker = path.join(root, "never-spawned");
    const ctl = new AbortController();
    ctl.abort(new Error("pre-aborted"));
    await expect(blenderCwd(root, ctl.signal).blender.run({
      script: process.execPath, args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
      label: "test:preabort", timeoutMs: 5_000, ensurePythonExitCode: false,
    })).rejects.toThrow("pre-aborted");
    expect(existsSync(marker)).toBe(false);
    const bad = await blenderCwd(root).blender.run({
      script: path.join(root, "no-such-executable"), args: [], label: "test:spawn-fail",
      timeoutMs: 5_000, ensurePythonExitCode: false,
    });
    expect(bad.code).toBe(127);
    expect(readComputeSlotsStatus().pools.find((p) => p.pool === "blender")?.waiters ?? []).toEqual([]);
    await expect(blenderCwd(root).blender.run({
      script: process.execPath, args: ["-e", "process.exit(0)"], label: "test:after",
      timeoutMs: 5_000, ensurePythonExitCode: false,
    })).resolves.toMatchObject({ code: 0 });
  });
});
