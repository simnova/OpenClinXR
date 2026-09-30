import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readComputeSlotsStatus } from "./index.js";

const priorRoot = process.env["OPENCLINXR_LOCK_ROOT"];
let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
  if (priorRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
  else process.env["OPENCLINXR_LOCK_ROOT"] = priorRoot;
});

it("reports the default machine pools when the lock root is empty", () => {
  root = mkdtempSync(path.join(tmpdir(), `openclinxr-slot-status-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  expect(readComputeSlotsStatus().pools.map(({ pool, size }) => ({ pool, size }))).toEqual([
    { pool: "blender", size: 2 },
    { pool: "browser-capture", size: 1 },
  ]);
});
