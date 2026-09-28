import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseWardChainArgs, resolveChainOutDir } from "./run.js";

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
 * Third fix in the 44824ba98 -> 9962c6f52 sequence. 44824ba98 made
 * runRoomGenerate resolve its relative workGlb against repoRoot()
 * (options.cwd ?? repoRoot()); 9962c6f52 absolutized room_chain's outDir
 * but against process.cwd(), which is the PACKAGE directory under
 * `pnpm --filter @openclinxr/factory-stations exec tsx src/room_chain/cli.ts`
 * (the real chain invocation shape). A relative --out-dir therefore landed
 * evidence under packages/openclinxr/factory-stations/.openclinxr/evidence/...
 * while runRoomGenerate resolved the same relative workGlb under the repo
 * root -- two modules, one relative string, two different absolute files.
 *
 * This test reproduces it directly: chdir to a directory that is NOT
 * repoRoot() (as `pnpm --filter ... exec` does), run the CLI's own
 * arg-parsing + resolution path (parseWardChainArgs + resolveChainOutDir,
 * the exact expressions runWardFinishChain uses before deriving workGlb),
 * and assert the resolved outDir is under the repo root -- the same base
 * room_generate uses -- not under process.cwd().
 *
 * room_chain/run.ts is not reachable from the package entrypoint, so this
 * direct import pins nothing public and the test-import ceiling is flat.
 */

let originalCwd: string | null = null;
let tempCwd: string | null = null;

afterEach(() => {
  if (originalCwd) process.chdir(originalCwd);
  if (tempCwd) rmSync(tempCwd, { recursive: true, force: true });
  originalCwd = null;
  tempCwd = null;
});

describe("runWardFinishChain resolves outDir against repoRoot(), not process.cwd()", () => {
  it("resolves a relative --out-dir under the repo root when cwd is elsewhere", () => {
    const root = findRepoRoot();
    originalCwd = process.cwd();
    // A directory that is NOT repoRoot(), mirroring `pnpm --filter <pkg>
    // exec` setting cwd to the package directory.
    tempCwd = mkdtempSync(path.join(tmpdir(), "outdir-cwd-probe-"));
    process.chdir(tempCwd);
    expect(process.cwd()).not.toBe(root);

    const rel = ".openclinxr/evidence/ward-finish-chain";
    const { outDir: outDirArg } = parseWardChainArgs(["--out-dir", rel]);
    const outDir = resolveChainOutDir(outDirArg);

    expect(outDir).toBe(path.resolve(root, rel));
    expect(path.relative(root, outDir).startsWith("..")).toBe(false);
    expect(path.relative(tempCwd, outDir).startsWith("..")).toBe(true);
  });

  it("resolves the default outDir to the same base regardless of cwd", () => {
    const root = findRepoRoot();
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(path.join(tmpdir(), "outdir-cwd-probe-"));

    const { outDir: defaultArg } = parseWardChainArgs([]);
    process.chdir(tempCwd);
    const fromTmp = resolveChainOutDir(defaultArg);
    process.chdir(root);
    const fromRoot = resolveChainOutDir(defaultArg);

    expect(fromTmp).toBe(fromRoot);
    expect(fromTmp).toBe(path.resolve(root, defaultArg));
  });

  it("passes an absolute --out-dir through unchanged", () => {
    const root = findRepoRoot();
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(path.join(tmpdir(), "outdir-cwd-probe-"));
    process.chdir(tempCwd);

    const abs = path.join(root, ".openclinxr/evidence/ward-finish-chain");
    const { outDir: outDirArg } = parseWardChainArgs(["--out-dir", abs]);
    expect(resolveChainOutDir(outDirArg)).toBe(abs);
  });
});
