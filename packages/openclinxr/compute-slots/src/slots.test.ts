import { mkdtempSync, rmSync } from "node:fs";
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
