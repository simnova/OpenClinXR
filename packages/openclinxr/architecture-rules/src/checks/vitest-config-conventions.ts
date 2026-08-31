import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CellixJS: every package with a Vitest test script has a local vitest.config.ts
 * that mergeConfig's `@cellix/config-vitest` (nodeConfig / archConfig).
 * Bare `vitest run --root .` walking up to the repo root is how worktrees
 * and sibling packages leak into a package run.
 */

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root not found");
}

const SKIP = new Set(["packages/cellix/config-vitest"]);

export function checkVitestConfigsUseCellixShared(workspaceRoot?: string): string[] {
  const root = workspaceRoot ?? findWorkspaceRoot();
  const violations: string[] = [];
  const stack = [join(root, "apps"), join(root, "packages")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        stack.push(full);
        continue;
      }
      if (entry.name !== "package.json") continue;
      const relDir = relative(root, dir);
      if (SKIP.has(relDir)) continue;
      let manifest: { scripts?: Record<string, string> };
      try {
        manifest = JSON.parse(readFileSync(full, "utf8"));
      } catch {
        continue;
      }
      const usesVitest = Object.values(manifest.scripts ?? {}).some((s) => s.includes("vitest"));
      if (!usesVitest) continue;
      const cfg = join(dir, "vitest.config.ts");
      if (!existsSync(cfg)) {
        violations.push(`${relDir}: has a vitest test script but no vitest.config.ts (CellixJS: mergeConfig(nodeConfig, …) from @cellix/config-vitest)`);
        continue;
      }
      const source = readFileSync(cfg, "utf8");
      if (!source.includes("@cellix/config-vitest")) {
        violations.push(`${relDir}/vitest.config.ts: must import from @cellix/config-vitest (CellixJS shared node/arch config)`);
      }
      const archCfg = join(dir, "vitest.arch.config.ts");
      if (existsSync(archCfg)) {
        const archSource = readFileSync(archCfg, "utf8");
        if (!archSource.includes("@cellix/config-vitest")) {
          violations.push(`${relDir}/vitest.arch.config.ts: must import from @cellix/config-vitest (CellixJS archConfig)`);
        }
      }
    }
  }
  return violations;
}
