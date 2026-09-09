import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exportedSymbols } from "./export-surface-budgets.js";

/**
 * Which test files import a symbol from their OWN package entrypoint that the entrypoint does not
 * export.
 *
 * WHY. Measured twice on 2026-09-09, both times only when the suite actually ran, and both times
 * the failure read as something else:
 *
 * - `getScheduledEventsDue` is defined at `packages/openclinxr/domain/src/station-state.ts:104-111`
 *   and absent from `packages/openclinxr/domain/src/index.ts:15-19`, which re-exports only
 *   `createStationRun`, `evaluateRequiredTraceTags` and `transitionStation`.
 * - `advanceExamFormRunBreak` is defined at
 *   `packages/openclinxr/exam-assembly/src/exam-run.ts:179` and was absent from that package's own
 *   index export block. BothyBoard card `tsk_298d0ead7dc551e4` sat at status=review for five days
 *   with three tests failing on it, holding one of the project's two in-flight slots, and the
 *   symptom was `TypeError: advanceExamFormRunBreak is not a function`.
 *
 * Through a barrel re-export a missing name does not throw at load; it yields `undefined`, so the
 * failure surfaces deep inside a test as a call on undefined rather than as a resolution error.
 * Typecheck does not catch it when the test casts the module to a loose record, which planted REDs
 * routinely do on purpose.
 *
 * This is the mirror of `unused-entrypoint-exports`. That one finds published symbols nothing
 * consumes; this one finds consumed symbols the entrypoint never published. Both are
 * entrypoint-hygiene defects and only the first had a check.
 *
 * WHAT THIS IS, PRECISELY. A parse of static named imports whose specifier resolves to ANY
 * workspace package entrypoint in this repo — its own (`./index.js`, `../index.js`) or another
 * package's (`@openclinxr/domain`). Scoping it to self-imports first found ZERO, because the
 * dispatcher incident crossed a package boundary: a scenario-runtime test importing from
 * `@openclinxr/domain`. Both directions are the same defect. It does
 * not follow dynamic imports, and it deliberately ignores `import type`, because a type-only name
 * can be re-exported through a separate `export type` block that this check would have to model.
 * A name it reports is genuinely absent from the entrypoint's export set as
 * `exportedSymbols` computes it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const PACKAGE_ROOTS = ["packages/openclinxr", "packages/openclinxr-verification", "packages/cellix"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);
const NAMED_IMPORT = /import\s+\{([^}]*)\}\s+from\s+"([^"]+)"/gmu;

export type UnresolvedEntrypointImport = {
  file: string;
  packageName: string;
  symbol: string;
};

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.test\.(?:ts|tsx|mts)$/u.test(entry.name)) out.push(full);
  }
}

/** Every package directory that has both a package.json and a src/index.ts. */
function packageDirs(repoRoot: string): Map<string, string> {
  const byDir = new Map<string, string>();
  for (const root of PACKAGE_ROOTS) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const dir = join(abs, entry.name);
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest) || !existsSync(join(dir, "src", "index.ts"))) continue;
      try {
        const name = JSON.parse(readFileSync(manifest, "utf8")).name as string | undefined;
        if (typeof name === "string" && name !== "") byDir.set(dir, name);
      } catch {
        // a package.json this check cannot parse is not this check's business
      }
    }
  }
  return byDir;
}

export function unresolvedEntrypointImports(repoRoot: string = REPO_ROOT): UnresolvedEntrypointImport[] {
  const found: UnresolvedEntrypointImport[] = [];
  const dirs = packageDirs(repoRoot);
  // Every workspace entrypoint, so a cross-package import is checked against the package it names.
  const entrypointByPackageName = new Map<string, Set<string>>();
  for (const [dir, name] of dirs) entrypointByPackageName.set(name, exportedSymbols(join(dir, "src", "index.ts")));
  for (const [dir, packageName] of dirs) {
    const entry = join(dir, "src", "index.ts");
    const published = exportedSymbols(entry);
    if (published.size === 0) continue; // an entrypoint this check cannot read teaches nothing
    const tests: string[] = [];
    walk(join(dir, "src"), tests);
    for (const file of tests) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(NAMED_IMPORT)) {
        const specifier = match[2] ?? "";
        let targetName = "";
        let targetExports: Set<string> | undefined;
        if (specifier === packageName || /^(?:\.{1,2}\/)+index\.js$/u.test(specifier)) {
          targetName = packageName;
          targetExports = published;
        } else if (entrypointByPackageName.has(specifier)) {
          targetName = specifier;
          targetExports = entrypointByPackageName.get(specifier);
        }
        if (targetExports === undefined || targetExports.size === 0) continue;
        for (const part of (match[1] ?? "").split(",")) {
          const raw = part.trim();
          if (raw === "" || raw.startsWith("type ")) continue; // type-only names: see the header
          const symbol = raw.split(" as ")[0]?.trim() ?? "";
          if (symbol === "" || targetExports.has(symbol)) continue;
          found.push({ file: relative(repoRoot, file), packageName: targetName, symbol });
        }
      }
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol));
}
