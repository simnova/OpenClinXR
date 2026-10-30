import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readComputeSlotsStatus } from "@openclinxr/compute-slots/slots";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRoomGenerate } from "./run.js";

// Public-API abort-chain regression for runRoomGenerate through the public
// barrel (../index.js), never the private run module. Drives the ACTUAL runtime chain
// with a local executable stand-in BLENDER that logs its PID then sleeps:
// no real Blender, no provider, no generation. The work GLB is a job-tmp
// fixture; the Infinigen generate step is skipped (no footprintMeters), so
// only the albedo spawn path is exercised.
//
// NOTE: String.raw keeps the stand-in's "\n" escape intact through the TS
// template layer so the generated file holds a valid string escape.
const STANDIN_SOURCE = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const me = process.argv[1] ?? "";
const dir = me ? path.dirname(me) : process.cwd();
try {
  fs.writeFileSync(path.join(dir, "standin.pid"), String(process.pid), "utf8");
} catch {}
setTimeout(() => {}, 120_000);
`;

const JOB_TMP_ROOT = process.env["OPENCLINXR_JOB_TMP"] ?? os.tmpdir();

// Slot isolation (per-test): bake path takes the machine-wide `blender`
// slot (withComputeSlot), so a contended real pool queues CPU stand-ins
// past the 5000ms budget. Verified dynamic: slots.ts lockRoot() resolves
// OPENCLINXR_LOCK_ROOT per call, so each test gets a unique mkdtemp root.
let priorLockRootChain: string | undefined;
let fileLockRootChain: string | null = null;

beforeEach(async () => {
  priorLockRootChain = process.env["OPENCLINXR_LOCK_ROOT"];
  fileLockRootChain = await mkdtemp(path.join(JOB_TMP_ROOT, "room-gen-abort-locks-"));
  process.env["OPENCLINXR_LOCK_ROOT"] = fileLockRootChain;
});

afterEach(async () => {
  try {
    const status = readComputeSlotsStatus();
    expect(path.resolve(status.root)).toBe(path.resolve(fileLockRootChain as string));
    const alive = status.pools.flatMap((p) => [...p.holders, ...p.waiters]).filter((h) => h.alive);
    expect(alive).toEqual([]);
  } finally {
    if (priorLockRootChain === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
    else process.env["OPENCLINXR_LOCK_ROOT"] = priorLockRootChain;
    priorLockRootChain = undefined;
    if (fileLockRootChain !== null) {
      await rm(fileLockRootChain, { recursive: true, force: true });
      fileLockRootChain = null;
    }
  }
});

const PRE_ABORT_REASON = "pre-aborted probe";
const POST_ABORT_REASON = "post-spawn probe abort";

function validInput() {
  return {
    environmentId: "abort-chain-probe",
    infinigenPrompt: "abort chain probe",
    seed: 7,
    layoutVariant: "exam-bay",
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runRoomGenerate abort chain (public API, stand-in BLENDER)", () => {
  it("pre-aborted signal spawns no child and releases the slot", async () => {
    const jobTmp = await mkdtemp(path.join(JOB_TMP_ROOT, "room-gen-pre-"));
    try {
      const standin = path.join(jobTmp, "blender-standin");
      await writeFile(standin, STANDIN_SOURCE, "utf8");
      await chmod(standin, 0o755);
      const workGlb = path.join(jobTmp, "work.glb");
      await writeFile(workGlb, "glb-fixture", "utf8");
      const controller = new AbortController();
      controller.abort(new Error(PRE_ABORT_REASON));
      await expect(
        runRoomGenerate(validInput(), {
          blender: standin,
          workGlb,
          cwd: jobTmp,
          timeoutMs: 30_000,
          bakeAlbedo: true,
          bakeOcclusion: false,
          simplifyAfterBake: false,
          signal: controller.signal,
        }),
      ).rejects.toThrow(PRE_ABORT_REASON);
      expect(existsSync(path.join(jobTmp, "standin.pid"))).toBe(false);
    } finally {
      await rm(jobTmp, { recursive: true, force: true });
    }
    expect(existsSync(jobTmp)).toBe(false);
  });

  it("post-spawn abort kills the owned child and cleans temp", async () => {
    const jobTmp = await mkdtemp(path.join(JOB_TMP_ROOT, "room-gen-post-"));
    let childPid = 0;
    let pending: Promise<unknown> | null = null;
    try {
      const standin = path.join(jobTmp, "blender-standin");
      await writeFile(standin, STANDIN_SOURCE, "utf8");
      await chmod(standin, 0o755);
      const workGlb = path.join(jobTmp, "work.glb");
      await writeFile(workGlb, "glb-fixture", "utf8");
      const controller = new AbortController();
      pending = runRoomGenerate(validInput(), {
        blender: standin,
        workGlb,
        cwd: jobTmp,
        timeoutMs: 120_000,
        bakeAlbedo: true,
        bakeOcclusion: false,
        simplifyAfterBake: false,
        signal: controller.signal,
      });
      // Settle the pending promise immediately so a broken signal-wiring
      // path can never leave an unhandled rejection orphan.
      pending.catch(() => {});
      const pidFile = path.join(jobTmp, "standin.pid");
      await waitFor(() => existsSync(pidFile), 30_000, "stand-in spawn");
      childPid = Number(await readFile(pidFile, "utf8"));
      expect(Number.isFinite(childPid) && childPid > 0).toBe(true);
      controller.abort(new Error(POST_ABORT_REASON));
      // Bound post-abort settlement: the chain must forward the abort and
      // settle within 2s, never hang on a rejecting pending promise.
      await expect(
        Promise.race([
          pending,
          new Promise((_, reject) => setTimeout(() => reject(new Error("post-abort settlement exceeded 2s")), 2_000)),
        ]),
      ).rejects.toThrow(POST_ABORT_REASON);
      await waitFor(() => !isAlive(childPid), 15_000, "child reaped");
    } finally {
      if (childPid > 0 && isAlive(childPid)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {}
      }
      if (pending !== null) {
        await Promise.race([pending.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      }
      await rm(jobTmp, { recursive: true, force: true });
    }
    expect(existsSync(jobTmp)).toBe(false);
  });
});
