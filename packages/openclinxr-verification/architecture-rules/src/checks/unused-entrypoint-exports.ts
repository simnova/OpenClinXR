import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exportedSymbols } from "./export-surface-budgets.js";

/**
 * Which of a package's published symbols nothing outside that package refers to.
 *
 * WHY. Measured 2026-09-08: the 42 packages under packages/openclinxr publish 2,931 symbols from
 * their root entrypoints, median 59 each, against a CellixJS median of 2. The export-surface budget
 * is 25 and 31 of the 42 exceed it. Shrinking that surface by hand means deciding, symbol by
 * symbol, whether anything consumes it — which is the search a worker would otherwise pay for in
 * grep, once per symbol, on a list of 220.
 *
 * WHAT THIS IS, PRECISELY. A MARKER CHECK, and it is named one so nobody reads it as proof. It
 * tokenises every .ts/.tsx file under packages/openclinxr, apps and tools, and asks whether a
 * symbol's identifier appears in any file outside its own package. That is a search over NAMES:
 * - A symbol reached only through a string key, a dynamic import, or a computed property is
 *   reported as unused when it is not.
 * - A symbol whose name collides with an unrelated local variable elsewhere is reported as used
 *   when it is not.
 *
 * THE PROOF IS THE COMPILER, NOT THIS FUNCTION. Remove the export, run
 * `pnpm packages:typecheck:agent`, and a real consumer fails the build. This list decides WHERE TO
 * LOOK; the typecheck decides what is true. Anything that survives both still needs the package's
 * own suite plus the ui-xr and api suites, which is where a runtime-only reference surfaces.
 */

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/gu;
const SCANNED_ROOTS = ["packages/openclinxr", "apps", "tools"] as const;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "public", ".git", "coverage"]);

export type UnusedExportReport = {
  readonly pkg: string;
  readonly published: number;
  /** Published symbols whose identifier appears in no file outside the package. */
  readonly unreferencedOutside: readonly string[];
};

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
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

function sourceFilesUnder(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFilesUnder(full, out);
      continue;
    }
    if (/\.tsx?$/u.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
}

/** identifier -> the repo-relative files it appears in, over every scanned root. */
export function identifierIndex(root: string): Map<string, Set<string>> {
  const files: string[] = [];
  for (const scanned of SCANNED_ROOTS) sourceFilesUnder(join(root, scanned), files);
  const index = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = relative(root, file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(IDENTIFIER)) {
      const name = match[0];
      const seen = index.get(name);
      if (seen === undefined) index.set(name, new Set([rel]));
      else seen.add(rel);
    }
  }
  return index;
}

/**
 * One report per package that publishes a src/index.ts, largest unreferenced surface first.
 * `index` is taken as an argument so a caller measuring several packages pays for the scan once.
 */
export function unusedEntrypointExports(
  root: string = findWorkspaceRoot(),
  index: Map<string, Set<string>> = identifierIndex(root),
): UnusedExportReport[] {
  const packagesRoot = join(root, "packages", "openclinxr");
  let entries: Dirent[];
  try {
    entries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const reports: UnusedExportReport[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entrypoint = join(packagesRoot, entry.name, "src", "index.ts");
    if (!existsSync(entrypoint)) continue;
    const prefix = `packages/openclinxr/${entry.name}/`;
    const published = [...exportedSymbols(entrypoint)].sort();
    const unreferencedOutside = published.filter((symbol) => {
      const seen = index.get(symbol);
      if (seen === undefined) return true;
      for (const file of seen) if (!file.startsWith(prefix)) return false;
      return true;
    });
    reports.push({ pkg: entry.name, published: published.length, unreferencedOutside });
  }
  return reports.sort((a, b) => b.unreferencedOutside.length - a.unreferencedOutside.length);
}
