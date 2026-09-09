import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CEILING_FILENAME, exportedSymbols } from "./export-surface-budgets.js";

/**
 * A per-package index an AGENT reads instead of grepping for the same facts.
 *
 * WHY THIS EXISTS, and the evidence it was built against. Measured 2026-09-08 across seven Grok
 * worker transcripts in this repo: the tools a delegated worker actually calls are
 * run_terminal_command, read_file, grep, search_replace, list_dir and write, and the LSP tool
 * count is ZERO. `.grok/config.toml` sets `lsp_tools = true`, so the capability is configured and
 * unused; the only mention of LSP in those transcripts is a worker reasoning about diagnostics
 * pushed to it after an edit. arXiv 2608.13568 ("Does a Language Server Save Tokens for Coding
 * Agents?", June 2026) measures the same preference and puts LSP at +6% to +118% tokens against
 * grep for symbol localization. So the localization cost is paid in grep and read, and the way to
 * lower it is to hand the worker the answer rather than a better search tool.
 *
 * EVERY FIELD IS DERIVED. Nothing here is hand-written, because a hand-written index is a second
 * description of the code that drifts from it, which is the failure this repo has already paid for
 * in prose. The archunit gate rebuilds each index from the tree and fails when a committed file
 * differs, so the index cannot say something the code does not.
 *
 * ONE FILE PER PACKAGE, on the same reasoning as arch-ceiling.json beside it: a shared table is
 * the most-contended source file in the repo, because every extraction slice must edit it. Two
 * parallel workers in different packages never touch the same index.
 *
 * NOT AN AUTHORITY on what a package SHOULD be. It reports what the package IS. Intent lives in
 * the entrypoint's TSDoc, which is why `purpose` is read from there and is absent when the
 * entrypoint carries no doc comment: an absent purpose is a finding, not a field to invent.
 */

export const INDEX_FILENAME = "arch-index.json";

export type PackageAgentIndex = {
  /** Directory name under packages/openclinxr, which is also the ceiling/index file's home. */
  readonly package: string;
  /** Workspace package name, i.e. what a consumer writes in an import specifier. */
  readonly name: string;
  readonly entrypoint: string;
  /** First sentence of the entrypoint's leading TSDoc block. Absent when it has none. */
  readonly purpose?: string;
  /** Every symbol reachable from the entrypoint, star-export chains followed. */
  readonly exports: readonly string[];
  readonly workspaceDependencies: readonly string[];
  /** Test files inside the package, relative to the package directory. */
  readonly tests: readonly string[];
  /** Runnable verification commands, keyed by script name. */
  readonly commands: Readonly<Record<string, string>>;
  /** Whatever arch-ceiling.json holds for this package, verbatim. Absent when it has none. */
  readonly ceilings?: Readonly<Record<string, unknown>>;
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

/** Scripts worth telling a worker about. A brief that names the wrong command costs a turn. */
const REPORTED_SCRIPTS = ["test", "typecheck", "build", "lint", "architecture"] as const;

const LEADING_TSDOC = /^\s*\/\*\*([\s\S]*?)\*\//u;

/**
 * First sentence of the entrypoint's leading TSDoc, with the comment furniture stripped. Returns
 * undefined when there is no leading block, which is the honest answer for an entrypoint that
 * opens with `export {`.
 */
export function entrypointPurpose(source: string): string | undefined {
  const block = LEADING_TSDOC.exec(source);
  if (block === null) return undefined;
  const prose = (block[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/u, "").trim())
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (prose === "") return undefined;
  // A sentence-ending period is followed by space or end of text. The periods inside
  // "apps/ui-xr/src/main.ts" are followed by letters, so a path does not end the sentence.
  const end = /[.](?=\s|$)/u.exec(prose);
  const sentence = end === null ? prose : prose.slice(0, end.index + 1);
  return sentence.trim() === "" ? undefined : sentence.trim();
}

function testFilesUnder(dir: string, base: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      testFilesUnder(full, base, out);
      continue;
    }
    if (/\.test\.tsx?$/u.test(entry.name)) out.push(full.slice(base.length + 1));
  }
}

/** Directory names under packages/openclinxr that publish a src/index.ts. */
export function indexedPackages(root: string = findWorkspaceRoot()): string[] {
  const packagesRoot = join(root, "packages", "openclinxr");
  let entries: Dirent[];
  try {
    entries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((pkg) => existsSync(join(packagesRoot, pkg, "src", "index.ts")))
    .sort();
}

/** Rebuilds one package's index from the tree. Deterministic: every list is sorted. */
export function buildPackageAgentIndex(
  pkg: string,
  root: string = findWorkspaceRoot(),
): PackageAgentIndex | null {
  const dir = join(root, "packages", "openclinxr", pkg);
  const entry = join(dir, "src", "index.ts");
  if (!existsSync(entry)) return null;
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const tests: string[] = [];
  testFilesUnder(join(dir, "src"), dir, tests);
  const name = manifest.name ?? `packages/openclinxr/${pkg}`;
  const commands: Record<string, string> = {};
  for (const script of REPORTED_SCRIPTS) {
    if (manifest.scripts?.[script] !== undefined) {
      commands[script] = `pnpm --filter ${name} ${script}`;
    }
  }
  const ceilingPath = join(dir, CEILING_FILENAME);
  const purpose = entrypointPurpose(readFileSync(entry, "utf8"));
  const index: PackageAgentIndex = {
    package: pkg,
    name,
    entrypoint: `packages/openclinxr/${pkg}/src/index.ts`,
    ...(purpose === undefined ? {} : { purpose }),
    exports: [...exportedSymbols(entry)].sort(),
    workspaceDependencies: Object.entries(manifest.dependencies ?? {})
      .filter(([, range]) => range.startsWith("workspace:"))
      .map(([dependency]) => dependency)
      .sort(),
    tests: tests.sort(),
    commands,
    ...(existsSync(ceilingPath)
      ? { ceilings: JSON.parse(readFileSync(ceilingPath, "utf8")) as Record<string, unknown> }
      : {}),
  };
  return index;
}

/** The exact bytes the generator writes, so the gate compares text and not object identity. */
export function serializePackageAgentIndex(index: PackageAgentIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Reads a committed index. Returns null when the package has none. */
export function readPackageAgentIndex(
  pkg: string,
  root: string = findWorkspaceRoot(),
): PackageAgentIndex | null {
  const file = join(root, "packages", "openclinxr", pkg, INDEX_FILENAME);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageAgentIndex;
  } catch {
    return null;
  }
}

/**
 * Every package with an entrypoint has a CURRENT index. Two failure modes, and the second is the
 * one that matters: a missing index is visible, a stale index is worse than none because a worker
 * acts on it.
 */
export function checkPackageAgentIndexesAreCurrent(root: string = findWorkspaceRoot()): string[] {
  const violations: string[] = [];
  for (const pkg of indexedPackages(root)) {
    const file = join(root, "packages", "openclinxr", pkg, INDEX_FILENAME);
    const built = buildPackageAgentIndex(pkg, root);
    if (built === null) continue;
    if (!existsSync(file)) {
      violations.push(
        `packages/openclinxr/${pkg}/${INDEX_FILENAME}: missing. Every package with a src/index.ts `
        + `carries one, because the brief injects it and a worker cannot ask for what is absent. `
        + `FIX: pnpm arch:index`,
      );
      continue;
    }
    const committed = readFileSync(file, "utf8");
    const current = serializePackageAgentIndex(built);
    if (committed !== current) {
      violations.push(
        `packages/openclinxr/${pkg}/${INDEX_FILENAME}: stale — it no longer matches the tree it `
        + `describes. A stale index is worse than none: a worker reads it, acts on it, and the `
        + `error surfaces as a wrong edit rather than a missing file. FIX: pnpm arch:index`,
      );
    }
  }
  return violations;
}

/** An index file for a directory that is not a package with an entrypoint is orphaned. */
export function checkNoOrphanedPackageAgentIndexes(root: string = findWorkspaceRoot()): string[] {
  const packagesRoot = join(root, "packages", "openclinxr");
  const indexed = new Set(indexedPackages(root));
  let entries: Dirent[];
  try {
    entries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !indexed.has(entry.name))
    .filter((entry) => existsSync(join(packagesRoot, entry.name, INDEX_FILENAME)))
    .map(
      (entry) =>
        `packages/openclinxr/${entry.name}/${INDEX_FILENAME}: the package no longer publishes a `
        + `src/index.ts, so this index describes nothing. FIX: pnpm arch:index`,
    )
    .sort();
}
