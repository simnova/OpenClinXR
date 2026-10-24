import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readComputeSlotsStatus, withComputeSlot } from "./slots.js";

const priorRoot = process.env["OPENCLINXR_LOCK_ROOT"];
const priorGpuSize = process.env["OPENCLINXR_SLOTS_GPU"];
const priorBlenderSize = process.env["OPENCLINXR_SLOTS_BLENDER"];
let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
  if (priorRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
  else process.env["OPENCLINXR_LOCK_ROOT"] = priorRoot;
  if (priorGpuSize === undefined) delete process.env["OPENCLINXR_SLOTS_GPU"];
  else process.env["OPENCLINXR_SLOTS_GPU"] = priorGpuSize;
  if (priorBlenderSize === undefined) delete process.env["OPENCLINXR_SLOTS_BLENDER"];
  else process.env["OPENCLINXR_SLOTS_BLENDER"] = priorBlenderSize;
});

it("reports the default machine pools when the lock root is empty", () => {
  root = mkdtempSync(path.join(tmpdir(), `openclinxr-slot-status-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  expect(readComputeSlotsStatus().pools.map(({ pool, size }) => ({ pool, size }))).toEqual([
    { pool: "blender", size: 2 },
    { pool: "browser-capture", size: 1 },
    { pool: "gpu", size: 1 },
  ]);
});

it("limits concurrent GPU workloads to the configured pool size", async () => {
  root = mkdtempSync(path.join(tmpdir(), `openclinxr-slot-gpu-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  process.env["OPENCLINXR_SLOTS_GPU"] = "1";
  let active = 0;
  let maxActive = 0;
  const run = (label: string) => withComputeSlot("gpu", { label }, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 300));
    active -= 1;
  });
  await Promise.all([run("gpu-one"), run("gpu-two")]);
  expect(maxActive).toBe(1);
});

it("re-enters the same pool in one async call chain without taking a second slot", async () => {
  root = mkdtempSync(path.join(tmpdir(), `openclinxr-slot-reentrant-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  process.env["OPENCLINXR_SLOTS_BLENDER"] = "1";
  const result = await withComputeSlot("blender", { label: "outer" }, ({ slot: outerSlot }) =>
    withComputeSlot("blender", { label: "inner" }, ({ slot: innerSlot }) => ({ outerSlot, innerSlot })),
  );
  expect(result).toEqual({ outerSlot: 0, innerSlot: 0 });
  expect(readComputeSlotsStatus().pools.find(({ pool }) => pool === "blender")?.holders).toEqual([]);
});

it("aborts a queued acquisition without launching and leaks no waiter or claim", async () => {
  root = mkdtempSync(path.join(tmpdir(), `openclinxr-slot-abort-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  process.env["OPENCLINXR_SLOTS_GPU"] = "1";
  let releaseHolder!: () => void;
  const holderGate = new Promise<void>((resolve) => { releaseHolder = resolve; });
  const holder = withComputeSlot("gpu", { label: "abort-holder" }, async () => {
    await holderGate;
  });
  const slotFile = path.join(root, "gpu", "slot-0.json");
  const acquireDeadline = Date.now() + 10_000;
  while (!existsSync(slotFile)) {
    if (Date.now() > acquireDeadline) throw new Error("holder never acquired the slot");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const controller = new AbortController();
  let launched = 0;
  const queued = withComputeSlot("gpu", { label: "abort-queued", signal: controller.signal }, async () => {
    launched += 1;
    return "launched";
  });
  const queueDeadline = Date.now() + 10_000;
  for (;;) {
    const waiters = readComputeSlotsStatus().pools.find((entry) => entry.pool === "gpu")?.waiters ?? [];
    if (waiters.some((waiter) => waiter.label === "abort-queued")) break;
    if (Date.now() > queueDeadline) throw new Error("waiter never queued");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  controller.abort(new Error("test abort"));
  await expect(queued).rejects.toThrow("test abort");
  expect(launched).toBe(0);
  releaseHolder();
  await holder;
  await expect(withComputeSlot("gpu", { label: "abort-after" }, async () => "after")).resolves.toBe("after");
  const gpu = readComputeSlotsStatus().pools.find((entry) => entry.pool === "gpu");
  expect(gpu?.holders).toEqual([]);
  expect(gpu?.waiters).toEqual([]);
});

it("rejects an already-aborted acquisition without queueing a waiter", async () => {
  root = mkdtempSync(path.join(tmpdir(), `openclinxr-slot-preaborted-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  process.env["OPENCLINXR_SLOTS_GPU"] = "1";
  const controller = new AbortController();
  controller.abort(new Error("pre-aborted"));
  let launched = 0;
  await expect(withComputeSlot("gpu", { label: "pre-aborted", signal: controller.signal }, async () => {
    launched += 1;
  })).rejects.toThrow("pre-aborted");
  expect(launched).toBe(0);
  expect(readComputeSlotsStatus().pools.find((entry) => entry.pool === "gpu")?.waiters).toEqual([]);
});
