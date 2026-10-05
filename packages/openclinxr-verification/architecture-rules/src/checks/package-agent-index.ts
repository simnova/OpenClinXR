import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  /**
   * Per-export one-liners: export name -> first sentence of that export's own TSDoc. An export
   * with no TSDoc has no key. Derived, never hand-written: the gate rebuilds it from the tree.
   */
  readonly exportSummaries: Readonly<Record<string, string>>;
  readonly workspaceDependencies: readonly string[];
  /** Test files inside the package, relative to the package directory. */
  readonly tests: readonly string[];
  /** Runnable verification commands, keyed by script name. */
  readonly commands: Readonly<Record<string, string>>;
  /** Whatever arch-ceiling.json holds for this package, verbatim. Absent when it has none. */
  readonly ceilings?: Readonly<Record<string, unknown>>;
};

export function findWorkspaceRoot(): string {
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
const ANY_TSDOC = /\/\*\*([\s\S]*?)\*\//gu;
/** A `from "./x.js"` target inside an export statement: the module half of a re-export. */
const REEXPORT_SOURCE = /from\s+["'](\.[^"']*)["']/gu;

/** Comment furniture stripped: `*` leaders, collapsed whitespace. */
function tsdocProse(block: string): string {
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/u, "").trim())
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * First sentence of a TSDoc prose string. A sentence-ending period is followed by space or end
 * of text. The periods inside "apps/ui-xr/src/main.ts" are followed by letters, so a path does
 * not end the sentence.
 */
export function firstSentence(prose: string): string {
  const end = /[.](?=\s|$)/u.exec(prose);
  return (end === null ? prose : prose.slice(0, end.index + 1)).trim();
}

/**
 * First sentence of the entrypoint's leading TSDoc, with the comment furniture stripped. Returns
 * undefined when there is no leading block, which is the honest answer for an entrypoint that
 * opens with `export {`.
 */
export function entrypointPurpose(source: string): string | undefined {
  const block = LEADING_TSDOC.exec(source);
  if (block === null) return undefined;
  const prose = tsdocProse(block[1] ?? "");
  if (prose === "") return undefined;
  const sentence = firstSentence(prose);
  return sentence === "" ? undefined : sentence;
}

/**
 * Names a statement publishes. Covers `export { a, b as c }` (and `export type {`) blocks,
 * where the exported name follows `as`, and plain declarations (`export const foo`,
 * `function foo`) so star-exported modules resolve through their defining file.
 */
function statementExportedNames(statement: string): string[] {
  const block = /^export\s+(?:type\s+)?\{([^}]*)\}/u.exec(statement.trim());
  if (block !== null) {
    return (block[1] ?? "")
      .split(",")
      .map((part) => part.trim().split(" as ").pop()?.replace(/^type\s+/u, "").trim() ?? "")
      .filter((name) => name !== "");
  }
  const declaration =
    /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/u.exec(
      statement.trim(),
    );
  return declaration?.[1] === undefined || declaration[1] === "" ? [] : [declaration[1]];
}

/**
 * Export name -> summary for one source file. A TSDoc block documents the names in the
 * statement that follows it (up to the first `;`, else the declaration head). Only statements
 * that declare or export names count, so an overview comment above an import maps nothing.
 */
function docAttachedSummaries(source: string, skipLeadingBlock: boolean): Map<string, string> {
  const out = new Map<string, string>();
  let seenLeading = false;
  for (const match of source.matchAll(ANY_TSDOC)) {
    const start = match.index ?? 0;
    if (skipLeadingBlock && !seenLeading) {
      seenLeading = true;
      // The entrypoint's leading block is the package purpose, already captured as `purpose`.
      // Crediting it to every export below would let keep-only barrels pass the per-export
      // gate on prose that describes no export.
      if (source.slice(0, start).trim() === "") continue;
    }
    const prose = tsdocProse(match[1] ?? "");
    if (prose === "") continue;
    const tail = source.slice(start + match[0].length).replace(/^\s+/u, "");
    const end = tail.indexOf(";");
    const head = end === -1 ? tail.slice(0, tail.indexOf("{")).trim() || tail.slice(0, 200) : tail.slice(0, end);
    const summary = firstSentence(prose);
    if (summary === "") continue;
    for (const name of statementExportedNames(head)) {
      if (!out.has(name)) out.set(name, summary);
    }
  }
  return out;
}

/**
 * Source files whose declarations can carry an export's summary: the entrypoint plus every
 * module it re-exports from, transitively. Entry first, the rest sorted, so attribution is
 * deterministic. Confined to the package directory.
 */
function summarySourceFiles(entry: string): string[] {
  const real = realpathSync(entry);
  const pkgDir = dirname(real);
  const seen = new Set<string>([real]);
  const tail = new Set<string>();
  const queue = [real];
  while (queue.length > 0) {
    const file = queue.pop() ?? "";
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(REEXPORT_SOURCE)) {
      const resolved = resolve(dirname(file), (match[1] ?? "").replace(/\.js$/u, ".ts"));
      if (!resolved.startsWith(pkgDir) || !resolved.endsWith(".ts")) continue;
      let canonical = "";
      try {
        canonical = realpathSync(resolved);
      } catch {
        continue;
      }
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      tail.add(canonical);
      queue.push(canonical);
    }
  }
  return [real, ...[...tail].sort()];
}

/**
 * Every export's own one-liner, derived from the tree. The entrypoint is read first so its
 * per-export docs win over the defining module's; only names in `exports` are kept by the
 * caller. An export with no TSDoc anywhere has no key — that absence is what the ratchet counts.
 */
export function exportSummaries(entry: string): Record<string, string> {
  const out = new Map<string, string>();
  const files = summarySourceFiles(entry);
  const entryReal = files[0] ?? "";
  for (const file of files) {
    const skipLeading = file === entryReal;
    for (const [name, summary] of docAttachedSummaries(readFileSync(file, "utf8"), skipLeading)) {
      if (!out.has(name)) out.set(name, summary);
    }
  }
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
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

/**
 * Candidate package directories: every directory under packages/openclinxr at depth 1 or 2.
 * Depth 2 covers nested packages such as arena/model-vetting, and a future stations/*
 * rollout lands indexed without a walker change here. Depth stops at 2 so a package's own
 * fixtures (e.g. src/__fixtures__ with a stray package.json) never index as packages.
 */
function candidatePackageDirs(root: string): string[] {
  const packagesRoot = join(root, "packages", "openclinxr");
  let entries: Dirent[];
  try {
    entries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    out.push(entry.name);
    let nested: Dirent[];
    try {
      nested = readdirSync(join(packagesRoot, entry.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of nested) {
      if (child.isDirectory()) out.push(`${entry.name}/${child.name}`);
    }
  }
  return out;
}

/** Package directory keys under packages/openclinxr that publish a src/index.ts. */
export function indexedPackages(root: string = findWorkspaceRoot()): string[] {
  const packagesRoot = join(root, "packages", "openclinxr");
  return candidatePackageDirs(root)
    .filter(
      (rel) =>
        existsSync(join(packagesRoot, rel, "package.json"))
        && existsSync(join(packagesRoot, rel, "src", "index.ts")),
    )
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
  const exported = [...exportedSymbols(entry)].sort();
  const summaries = exportSummaries(entry);
  const documented: Record<string, string> = {};
  for (const exportName of exported) {
    const summary = summaries[exportName];
    if (summary !== undefined) documented[exportName] = summary;
  }
  const index: PackageAgentIndex = {
    package: pkg,
    name,
    entrypoint: `packages/openclinxr/${pkg}/src/index.ts`,
    ...(purpose === undefined ? {} : { purpose }),
    exports: exported,
    exportSummaries: documented,
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
  return candidatePackageDirs(root)
    .filter((rel) => !indexed.has(rel))
    .filter((rel) => existsSync(join(packagesRoot, rel, INDEX_FILENAME)))
    .map(
      (rel) =>
        `packages/openclinxr/${rel}/${INDEX_FILENAME}: the package no longer publishes a `
        + `src/index.ts, so this index describes nothing. FIX: pnpm arch:index`,
    )
    .sort();
}
