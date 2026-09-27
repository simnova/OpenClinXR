/**
 * Ward finish chain CLI (thin shell, ward-finish-chain slice).
 *
 * The chain itself lives INSIDE `@openclinxr/factory-stations` at
 * `packages/openclinxr/factory-stations/src/room_chain/` (package-internal
 * module, not on the reviewed public surface). This file holds NO compile-time
 * import of factory-stations internals: it forwards argv across a process
 * boundary to the package-internal entrypoint and passes through
 * stdout/stderr/exit code.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/environment/ward-finish-chain-cli.ts \
 *     [--seed 205] [--out-dir .openclinxr/evidence/ward-finish-chain]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHAIN_CLI_REL = "packages/openclinxr/factory-stations/src/room_chain/cli.ts";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function findTsx(repoRoot: string): string {
  const local = path.join(repoRoot, "node_modules", ".bin", "tsx");
  return existsSync(local) ? local : "tsx";
}

/** Spawn the package-internal chain entrypoint; returns its exit code. */
export function runWardFinishChainShell(args: readonly string[] = process.argv.slice(2)): number {
  const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const result = spawnSync(findTsx(repoRoot), [CHAIN_CLI_REL, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`[ward-chain] spawn failed: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runWardFinishChainShell());
}
