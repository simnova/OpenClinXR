import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runRoomGenerate } from "../index.js";

/** Repo root without importing the station internals (keeps the test import ceiling flat). */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("repo root not found");
}

/**
 * Measured 2026-09-27: `pnpm --filter @openclinxr/factory-stations exec tsx
 * src/room_chain/cli.ts ...` (the real chain invocation) sets Node's
 * process.cwd() to the PACKAGE directory, not the repo root. Every Blender
 * subprocess spawnBlenderProcess launches is given `cwd: repoRoot()`
 * (absolute, correct) explicitly, but `simplifyRoomAfterBake(workGlb)` --
 * called directly inside runRoomGenerate, no spawn involved -- reads workGlb
 * via plain Node fs calls, which resolve a RELATIVE workGlb against
 * process.cwd(), not repoRoot(). A relative workGlb (exactly what the chain
 * CLI passes, e.g. ".openclinxr/evidence/ward-finish-chain/ward-chain.work.glb")
 * therefore points at two different absolute files depending on which half
 * of the pipeline resolves it: Blender writes the real one at repoRoot(),
 * Node's own simplify step reads a nonexistent one at process.cwd().
 *
 * 5-of-5 reproduction (informal driver, not committed): same relative
 * workGlb, same repo, only process.cwd() varied between repoRoot() and a
 * package subdirectory -- ENOENT every time process.cwd() != repoRoot(),
 * confirmed present every time via statSync against BOTH candidate paths.
 * This is a deterministic path-resolution defect, not a filesystem-timing
 * race (repoRoot() is on a local APFS volume, confirmed via `mount`).
 *
 * This test reproduces it directly: chdir to a directory that is NOT
 * repoRoot() (as `pnpm --filter ... exec` does), pass a RELATIVE workGlb,
 * and run the occlusion pass + simplify (bakeAlbedo skipped -- occlusion
 * alone is enough to exercise the same simplify-reads-workGlb code path,
 * and is far cheaper against the small fixture GLB).
 */

let originalCwd: string | null = null;
let tempCwd: string | null = null;
let repoRelativeDir: string | null = null;

afterEach(() => {
  if (originalCwd) process.chdir(originalCwd);
  if (tempCwd) rmSync(tempCwd, { recursive: true, force: true });
  if (repoRelativeDir) rmSync(repoRelativeDir, { recursive: true, force: true });
  originalCwd = null;
  tempCwd = null;
  repoRelativeDir = null;
});

describe("runRoomGenerate resolves workGlb against repoRoot(), not process.cwd()", () => {
  it("succeeds when process.cwd() is not repoRoot() and workGlb is relative", async () => {
    const root = findRepoRoot();
    originalCwd = process.cwd();
    // A directory that is NOT repoRoot(), mirroring `pnpm --filter <pkg>
    // exec` setting cwd to the package directory.
    tempCwd = mkdtempSync(path.join(tmpdir(), "workglb-cwd-probe-"));

    const relDirName = `.workglb-cwd-probe-${Date.now()}`;
    repoRelativeDir = path.join(root, relDirName);
    mkdirSync(repoRelativeDir, { recursive: true });
    const workGlbRel = path.join(relDirName, "work.glb");
    // Placed where Blender (cwd=repoRoot()) will actually look for --input.
    copyFileSync(path.join(root, "packages/openclinxr/factory-stations/src/room_generate/fixtures/extract.glb"), path.join(root, workGlbRel));

    process.chdir(tempCwd);
    expect(process.cwd()).not.toBe(root);

    const result = await runRoomGenerate(
      {
        environmentId: "ed_exam_bay_v1",
        infinigenPrompt: "unused (legacy call shape)",
        seed: 1,
        layoutVariant: "default",
      },
      {
        blender: "blender",
        workGlb: workGlbRel,
        bakeAlbedo: false,
        bakeOcclusion: true,
        simplifyAfterBake: true,
        timeoutMs: 300_000,
      },
    );
    expect(result["occlusionExit"]).toBe(0);
    expect(result["simplify"]).not.toBeNull();
  }, 300_000);
});
