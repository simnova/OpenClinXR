import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOM_CHAIN_RECIPES, runRoomChain } from "@openclinxr/factory-stations/room-chain";

// Observe the public runner's first filesystem boundary, before any compute.
// This preserves the cwd regression without publishing private CLI helpers.
const boundary = vi.hoisted(() => ({ mkdir: vi.fn(), stopped: new Error("output-boundary-observed") }));
vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(),
  mkdir: boundary.mkdir,
}));

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("repo root not found");
}

let originalCwd: string | null = null;
let tempCwd: string | null = null;
afterEach(() => {
  if (originalCwd) process.chdir(originalCwd);
  if (tempCwd) rmSync(tempCwd, { recursive: true, force: true });
  originalCwd = null;
  tempCwd = null;
  boundary.mkdir.mockReset();
});

async function outputDirectory(outDir?: string): Promise<string> {
  boundary.mkdir.mockRejectedValue(boundary.stopped);
  await expect(runRoomChain({
    environmentId: ROOM_CHAIN_RECIPES.inpatient_ward_room_v1.environmentId,
    ...(outDir === undefined ? {} : { outDir }),
  })).rejects.toBe(boundary.stopped);
  return boundary.mkdir.mock.lastCall?.[0] as string;
}

describe("the public room chain resolves outDir against repoRoot(), not process.cwd()", () => {
  it("resolves a relative output directory under the repo root from another cwd", async () => {
    const root = findRepoRoot();
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(path.join(tmpdir(), "outdir-cwd-probe-"));
    process.chdir(tempCwd);
    const relative = ".openclinxr/evidence/ward-finish-chain";
    expect(await outputDirectory(relative)).toBe(path.resolve(root, relative));
  });

  it("resolves the default output directory to the same base regardless of cwd", async () => {
    const root = findRepoRoot();
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(path.join(tmpdir(), "outdir-cwd-probe-"));
    process.chdir(tempCwd);
    const fromTmp = await outputDirectory();
    process.chdir(root);
    expect(await outputDirectory()).toBe(fromTmp);
    expect(fromTmp).toBe(path.join(root, ".openclinxr/evidence/ward-finish-chain"));
  });

  it("passes an absolute output directory through unchanged", async () => {
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(path.join(tmpdir(), "outdir-cwd-probe-"));
    process.chdir(tempCwd);
    const absolute = path.join(tempCwd, "output");
    expect(await outputDirectory(absolute)).toBe(absolute);
  });
});
