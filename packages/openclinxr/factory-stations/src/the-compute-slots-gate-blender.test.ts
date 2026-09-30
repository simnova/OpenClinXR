import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readComputeSlotsStatus, withComputeSlot } from "@openclinxr/compute-slots";
import { runRoomGenerate } from "./index.js";

let root: string | null = null;
const priorRoot = process.env["OPENCLINXR_LOCK_ROOT"];
const priorSize = process.env["OPENCLINXR_SLOTS_BLENDER"];

function useTempLocks(size = 2): string {
  root = mkdtempSync(path.join(tmpdir(), `openclinxr-slots-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  process.env["OPENCLINXR_SLOTS_BLENDER"] = String(size);
  return root;
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
  if (priorRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
  else process.env["OPENCLINXR_LOCK_ROOT"] = priorRoot;
  if (priorSize === undefined) delete process.env["OPENCLINXR_SLOTS_BLENDER"];
  else process.env["OPENCLINXR_SLOTS_BLENDER"] = priorSize;
});

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("machine-wide compute slots", () => {
  it("limits three concurrent Blender callers to two holders and makes the third wait", async () => {
    useTempLocks(2);
    let active = 0;
    let maxActive = 0;
    const waited: number[] = [];
    const run = (label: string) =>
      withComputeSlot("blender", { label }, async ({ waitedMs }) => {
        waited.push(waitedMs);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await pause(350);
        active -= 1;
        return label;
      });

    const first = run("one");
    const second = run("two");
    for (let attempt = 0; attempt < 20 && active < 2; attempt += 1) await pause(25);
    const third = run("three");
    await expect(Promise.all([first, second, third])).resolves.toEqual(["one", "two", "three"]);
    expect(maxActive).toBe(2);
    expect(waited[2]).toBeGreaterThan(0);
  });

  it("reclaims a dead pid but does not reclaim a live holder", async () => {
    const lockRoot = useTempLocks(1);
    const poolDir = path.join(lockRoot, "blender");
    mkdirSync(poolDir, { recursive: true });
    const dead = spawn(process.execPath, ["-e", "process.exit(0)"]);
    const deadPid = dead.pid;
    if (!deadPid) throw new Error("dead-pid child did not start");
    await new Promise<void>((resolve) => dead.once("close", () => resolve()));
    writeFileSync(path.join(poolDir, "slot-0.json"), JSON.stringify({
      pid: deadPid, hostname: "test", startedAt: new Date().toISOString(), cwd: process.cwd(), label: "dead",
    }));
    const deadStarted = Date.now();
    await withComputeSlot("blender", { label: "reclaims-dead" }, () => undefined);
    expect(Date.now() - deadStarted).toBeLessThan(1_000);

    const live = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    const livePid = live.pid;
    if (!livePid) throw new Error("live-pid child did not start");
    writeFileSync(path.join(poolDir, "slot-0.json"), JSON.stringify({
      pid: livePid, hostname: "test", startedAt: new Date().toISOString(), cwd: process.cwd(), label: "live",
    }));
    let acquired = false;
    const waiting = withComputeSlot("blender", { label: "waits-for-live" }, () => { acquired = true; });
    await pause(350);
    expect(acquired).toBe(false);
    live.kill("SIGTERM");
    await new Promise<void>((resolve) => live.once("close", () => resolve()));
    await waiting;
    expect(acquired).toBe(true);
  });

  it("releases the slot when the protected function throws", async () => {
    const lockRoot = useTempLocks(1);
    await expect(withComputeSlot("blender", { label: "throws" }, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(readComputeSlotsStatus().pools.find((pool) => pool.pool === "blender")?.holders).toEqual([]);
    expect(() => mkdirSync(path.join(lockRoot, "still-usable"))).not.toThrow();
  });

  it("spawnBlenderProcess holds a Blender slot for the child lifetime", async () => {
    const lockRoot = useTempLocks(1);
    const stub = path.join(lockRoot, "stub-blender.mjs");
    writeFileSync(stub, "#!/usr/bin/env node\nsetTimeout(() => process.exit(0), 500);\n");
    chmodSync(stub, 0o755);
    const workGlb = path.join(lockRoot, "work.glb");
    writeFileSync(workGlb, "stub");
    const running = runRoomGenerate(
      { environmentId: "ed_exam_bay_v1", infinigenPrompt: "unused", seed: 1, layoutVariant: "default" },
      {
        blender: stub,
        workGlb,
        bakeAlbedo: true,
        bakeOcclusion: false,
        simplifyAfterBake: false,
        cwd: process.cwd(),
        timeoutMs: 5_000,
      },
    );

    let holderSeen = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      holderSeen = (readComputeSlotsStatus().pools.find((pool) => pool.pool === "blender")?.holders.length ?? 0) === 1;
      if (holderSeen) break;
      await pause(25);
    }
    expect(holderSeen).toBe(true);
    await running.catch(() => undefined);
    expect(readComputeSlotsStatus().pools.find((pool) => pool.pool === "blender")?.holders).toEqual([]);
  });
});
