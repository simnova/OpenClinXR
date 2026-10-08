import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportedSymbols } from "../checks/export-surface-budgets.js";
import {
  declaredEntrypoints,
  measureSurface,
  resolveEntrypointSource,
  type DeclaredEntrypoint,
} from "../checks/public-surface/resolve.js";

/**
 * Consumer-driven contracts: a consumer imports only what its consumes.json
 * lists, and one entrypoint serves one consumer class.
 *
 * WHY. The public surface separates exports by use — runtime apps, packages,
 * tools, and evidence each bind a different slice of a provider. Without a
 * committed contract per consumer, a shrink campaign cannot tell which
 * entrypoint a symbol can move to: every move risks a consumer nobody named.
 * consumes.json (reconciled by
 * tools/openclinxr/architecture/write-consumer-contracts.ts from real static
 * imports, then owned by hand — derived names are added, committed names never
 * removed) names the slice each consumer binds.
 *
 * TYPE-ONLY IMPORTS COUNT, LISTED WITH KIND. A type-only name still pins the
 * provider interface. Clauses compare by name; kind ("runtime" | "type") is
 * documentation for the split. `import type`, `export type`, and inline
 * `type Foo` all record kind "type"; runtime use dominates when both appear.
 *
 * STRING AND COMMENT IMPORTS DO NOT COUNT. Comments are blanked before
 * scanning (a `//` note inside an import's braces contributes no names) and a
 * match whose `import` keyword sits inside a string literal is skipped, in the
 * generator and in every clause below alike. Mirror logic lives in
 * write-consumer-contracts.ts (tools cannot be imported here without a
 * boundary-test edge, so the mask is duplicated, not shared; the live-tree
 * clause-(a) test fails if they drift).
 *
 * SCANNERS REUSED, NOT REWRITTEN. Provider publication is
 * declaredEntrypoints + resolveEntrypointSource (checks/public-surface/resolve.ts)
 * with exportedSymbols (checks/export-surface-budgets.ts) reading the source.
 * The named-import pattern mirrors checks/entrypoint-imports-resolve.ts
 * NAMED_IMPORT, extended to `import type`, inline `type` prefixes, subpath
 * specifiers, and re-exports — that check scans only *.test.ts under packages,
 * while this gate scans every source file under each contracted consumer.
 *
 * OWN-TEST AND PATH-REACH BINDINGS COUNT, WITH via. A package's own tests
 * importing through its entrypoint by relative path (./index.js) and a
 * relative import from any consumer into another provider's entrypoint
 * source both bind the published name exactly like a package-specifier
 * import, so the generator records them with via "own-test" | "path-reach"
 * (absent means specifier) and clause (c) treats any via as consumed.
 * Clause (d) serves them under the distinct classes "own-test" and
 * "path-reach", so a specifier seam and a test/path seam never lump
 * together. A path reach into an INTERNAL module binds no published name:
 * counted only, never recorded.
 *
 * SCOPE. All workspace providers: every package.json name under packages/**
 * and apps/** in the @openclinxr/ or @cellix/ scope (discovered per root, so
 * fixture roots and future packages need no hardcoded list). All consumers:
 * every workspace package/app dir, tools/openclinxr itself, each
 * tools/openclinxr/<area>, tools/agent-factory, and sticky owners of
 * existing contracts (nested makeclothes carves out of the asset-pipeline
 * area by longest prefix).
 * Clauses (a) unlisted-import and (e) missing-contract are hard, as is (b)
 * listed-not-published, for every provider and consumer. Clauses (c) and (d)
 * are REPORT-ONLY ratchets: consumer-contracts-ceilings.json pins today's
 * counts per provider and the gate fails on growth above the ceiling — or
 * below it, demanding the ceiling be lowered to the measured value (same
 * semantics as agent-index-quality.ceiling.json). To regenerate the ceiling,
 * shrink a surface, run this file's live-tree test, and copy the measured
 * counts it prints into the ceiling file.
 */

export type ConsumerClass = "runtime-app" | "package" | "tools" | "evidence" | "own-test" | "path-reach";

export type ConsumerDef = { dir: string; class: ConsumerClass };

export const CONSUMER_CONTRACTS_CEILING_FILENAME = "consumer-contracts-ceilings.json";

export type ContractCeilings = {
  unconsumed: { total: number; byProvider: Record<string, number> };
  mixed: { total: number; byProvider: Record<string, number> };
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".turbo", "public"]);

const IMPORT_FROM =
  /import\s+(type\s+)?(?:[^"'{]*?\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["']/gu;
const EXPORT_FROM = /export\s+(type\s+)?(?:\*|\{([^}]*)\})\s+from\s+["']([^"']+)["']/gu;

export type ContractName = { name: string; kind: string; via?: "own-test" | "path-reach" };
export type ContractRow = { provider: string; entrypoint: string; names: ContractName[] };
export type AllowlistRow = {
  provider: string;
  entrypoint: string;
  classes: ConsumerClass[];
  reason: string;
};

function findRoot(): string {
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

/** Every workspace provider under root: package.json name → repo-relative dir. */
export function discoverWorkspaceProviders(root: string): Map<string, string> {
  const cached = providerCache.get(root);
  if (cached !== undefined) return cached;
  const out = new Map<string, string>();
  const walk = (relativeDir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(join(root, relativeDir), { withFileTypes: true }) as Dirent<string>[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
      const child = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      const manifest = join(root, child, "package.json");
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
        if (
          typeof parsed.name === "string" &&
          (parsed.name.startsWith("@openclinxr/") || parsed.name.startsWith("@cellix/"))
        ) {
          const prev = out.get(parsed.name);
          if (prev === undefined || child.length < prev.length) out.set(parsed.name, child);
        }
      } catch {
        // no (or unreadable) manifest: not a provider, keep walking
      }
      walk(child);
    }
  };
  for (const base of ["packages", "apps"]) walk(base);
  providerCache.set(root, out);
  return out;
}

// Pure filesystem reads, memoized per root so the live-tree gate (72
// consumers x 67 providers) fits the arch config's timeout budget.
const providerCache = new Map<string, Map<string, string>>();
const consumerCache = new Map<string, ConsumerDef[]>();
const entrypointCache = new Map<string, DeclaredEntrypoint[]>();
const publishedCache = new Map<string, Set<string>>();
const symbolCache = new Map<string, Set<string>>();

export function classForConsumerDir(dir: string): ConsumerClass {
  if (dir.startsWith("apps/")) return "runtime-app";
  if (dir.startsWith("packages/")) return "package";
  if (dir === "tools/openclinxr/evidence") return "evidence";
  return "tools";
}

/**
 * Every computed consumer dir: provider dirs (one per workspace package),
 * unscoped package.json dirs not under a provider dir, tools/openclinxr
 * itself, and each tools/openclinxr/<area>.
 */
export function discoverConsumers(root: string): ConsumerDef[] {
  const cached = consumerCache.get(root);
  if (cached !== undefined) return cached;
  const providers = discoverWorkspaceProviders(root);
  const out = new Map<string, ConsumerClass>();
  for (const dir of providers.values()) out.set(dir, classForConsumerDir(dir));
  const coveredBy = (dir: string): boolean => {
    for (const owned of out.keys()) {
      if (dir === owned || dir.startsWith(`${owned}/`)) return true;
    }
    return false;
  };
  const walk = (relativeDir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(join(root, relativeDir), { withFileTypes: true }) as Dirent<string>[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
      const child = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      try {
        JSON.parse(readFileSync(join(root, child, "package.json"), "utf8")) as { name?: unknown };
        if (!coveredBy(child)) out.set(child, classForConsumerDir(child));
      } catch {
        // no manifest: not a package consumer
      }
      walk(child);
    }
  };
  for (const base of ["packages", "apps"]) walk(base);
  out.set("tools/openclinxr", "tools");
  out.set("tools/agent-factory", "tools");
  let areas: Dirent<string>[];
  try {
    areas = readdirSync(join(root, "tools/openclinxr"), { withFileTypes: true }) as Dirent<string>[];
  } catch {
    areas = [];
  }
  for (const entry of areas) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const dir = `tools/openclinxr/${entry.name}`;
    if (!out.has(dir)) out.set(dir, classForConsumerDir(dir));
  }
  const list = [...out.entries()]
    .map(([dir, cls]) => ({ dir, class: cls }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
  consumerCache.set(root, list);
  return list;
}

/** Dirs that already own a consumes.json anywhere under the consumer roots. */
export function existingContractOwners(root: string): string[] {
  const out: string[] = [];
  const walk = (relativeDir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(join(root, relativeDir), { withFileTypes: true }) as Dirent<string>[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(child);
        continue;
      }
      if (entry.name === "consumes.json") out.push(relativeDir);
    }
  };
  for (const base of ["packages", "apps", "tools/openclinxr"]) walk(base);
  return out.sort();
}

/** Computed consumers plus sticky contract owners (e.g. nested makeclothes). */
export function consumersWithContracts(root: string): ConsumerDef[] {
  const out = new Map<string, ConsumerClass>();
  for (const c of discoverConsumers(root)) out.set(c.dir, c.class);
  for (const dir of existingContractOwners(root)) {
    if (!out.has(dir)) out.set(dir, classForConsumerDir(dir));
  }
  return [...out.entries()]
    .map(([dir, cls]) => ({ dir, class: cls }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * [start, end) ranges of comments and string literals. Comments first so an
 * apostrophe in prose cannot open a phantom string. Mirror of the generator.
 */
export function ignorableRanges(text: string): { comments: [number, number][]; strings: [number, number][] } {
  const comments: [number, number][] = [];
  const strings: [number, number][] = [];
  const n = text.length;
  let i = 0;
  let inStr: string | null = null;
  while (i < n) {
    const c = text[i];
    if (inStr !== null) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const s = i;
      while (i < n && text[i] !== "\n") i += 1;
      comments.push([s, i]);
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const s = i;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i = Math.min(n, i + 2);
      comments.push([s, i]);
      continue;
    }
    i += 1;
  }
  const inComment = (pos: number): boolean => {
    for (const [s, e] of comments) {
      if (pos < s) break;
      if (pos < e) return true;
    }
    return false;
  };
  i = 0;
  while (i < n) {
    if (inComment(i)) {
      i += 1;
      continue;
    }
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const s = i;
      const q = c;
      i += 1;
      while (i < n) {
        if (inComment(i)) break;
        const d = text[i];
        if (d === "\\") {
          i += 2;
          continue;
        }
        if (d === "\n" && q !== "`") break;
        if (d === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      if (i > s + 1 || (i <= n && text[i - 1] === q)) strings.push([s, i]);
      continue;
    }
    i += 1;
  }
  return { comments, strings };
}

export function isIgnoredAt(ranges: [number, number][], pos: number): boolean {
  for (const [s, e] of ranges) {
    if (pos < s) break;
    if (pos < e) return true;
  }
  return false;
}

/** Blank comment spans with spaces (newlines kept), so offsets are preserved. */
export function blankComments(text: string, comments: [number, number][]): string {
  const chars = text.split("");
  for (const [s, e] of comments) {
    for (let k = s; k < e; k += 1) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}

function sourceFilesUnder(dir: string, out: string[], skipPrefixes: string[] = []): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent<string>[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (skipPrefixes.some((p) => full === p || full.startsWith(`${p}/`))) continue;
    if (entry.isDirectory()) {
      sourceFilesUnder(full, out, skipPrefixes);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    if (dot >= 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) out.push(full);
  }
}

function splitNames(raw: string, wholeIsType: boolean): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const inlineType = trimmed.startsWith("type ");
    const bare = (inlineType ? trimmed.slice(5) : trimmed).trim();
    // Provider-bound name is LEFT of `as` (same rule as the generator: an
    // import alias is consumer-local; a re-export alias re-publishes the
    // provider's left-hand name).
    const published = bare.split(" as ")[0]?.trim() ?? "";
    if (published === "" || published === "*") continue;
    out.push({ name: published, kind: wholeIsType || inlineType ? "type" : "runtime" });
  }
  return out;
}

function specifierToProvider(
  longestFirst: string[],
  specifier: string,
): { provider: string; entrypoint: string } | undefined {
  for (const provider of longestFirst) {
    if (specifier === provider) return { provider, entrypoint: "." };
    if (specifier.startsWith(`${provider}/`)) {
      return { provider, entrypoint: `./${specifier.slice(provider.length + 1)}` };
    }
  }
  return undefined;
}

export type ImportedName = { name: string; kind: string; file: string };

export type ConsumerBindings = {
  /** Package-specifier imports, served under the consumer's own class. */
  specifier: Map<string, ImportedName[]>;
  /** The provider's own tests importing its entrypoint by relative path. */
  ownTest: Map<string, ImportedName[]>;
  /** Relative imports from this consumer into another provider's entrypoint source. */
  pathReach: Map<string, ImportedName[]>;
  /** Relative reaches into another provider's src/ that land on an internal
   * module, not an entrypoint source: real code, but no published-name
   * binding, so no contract row. Reported as a count only. */
  internalPathReach: number;
};

function isTestFileName(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function isFilePath(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** A relative specifier resolved to an absolute source file, or undefined. */
export function resolveRelativeTarget(importerFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const abs = join(dirname(importerFile), spec);
  if (isFilePath(abs)) return abs;
  const bare = abs.replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/u, "");
  for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
    if (isFilePath(`${bare}${ext}`)) return `${bare}${ext}`;
  }
  for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
    const indexed = join(bare, `index${ext}`);
    if (isFilePath(indexed)) return indexed;
  }
  return undefined;
}

const gateEntrypointSourcesCache = new Map<string, Map<string, string>>();

/** Absolute entrypoint source file → entrypoint specifier, for one provider dir. */
function gateEntrypointSourcesByFile(root: string, packageDir: string, provider: string): Map<string, string> {
  const key = `${root}\t${packageDir}`;
  const cached = gateEntrypointSourcesCache.get(key);
  if (cached !== undefined) return cached;
  const out = new Map<string, string>();
  for (const entry of declaredEntrypointsCached(root, packageDir, provider)) {
    const source = resolveEntrypointSource(root, entry);
    if (source !== undefined && !out.has(source)) out.set(source, entry.specifier);
  }
  gateEntrypointSourcesCache.set(key, out);
  return out;
}

/**
 * Every workspace-provider named import under one consumer dir (nested
 * consumers carve out), split by binding mechanism. Mirror of
 * write-consumer-contracts.ts: the same relative import must derive the same
 * row in both, or clause (a) fails on generator/gate drift.
 */
export function derivedBindings(
  root: string,
  consumerDir: string,
  allConsumerDirs?: string[],
): ConsumerBindings {
  const providers = discoverWorkspaceProviders(root);
  const longestFirst = [...providers.keys()].sort((a, b) => b.length - a.length);
  const nested = (allConsumerDirs ?? consumersWithContracts(root).map((c) => c.dir))
    .filter((d) => d !== consumerDir && d.startsWith(`${consumerDir}/`))
    .map((d) => join(root, d));
  const files: string[] = [];
  sourceFilesUnder(join(root, consumerDir), files, nested);
  let self: string | undefined;
  for (const [name, dir] of providers) {
    if (dir === consumerDir) {
      self = name;
      break;
    }
  }
  const ownByFile = self === undefined
    ? new Map<string, string>()
    : gateEntrypointSourcesByFile(root, providers.get(self) ?? "", self);
  const byDir = [...providers.entries()]
    .map(([name, dir]) => ({ name, abs: join(root, dir) }))
    .sort((a, b) => b.abs.length - a.abs.length);
  const consumerAbs = join(root, consumerDir);
  const specifier = new Map<string, ImportedName[]>();
  const ownTest = new Map<string, ImportedName[]>();
  const pathReach = new Map<string, ImportedName[]>();
  let internalPathReach = 0;
  const push = (into: Map<string, ImportedName[]>, provider: string, entrypoint: string, entry: ImportedName): void => {
    const key = `${provider}\t${entrypoint}`;
    const list = into.get(key) ?? [];
    list.push(entry);
    into.set(key, list);
  };
  const considerRelative = (spec: string, raw: string, wholeIsType: boolean, file: string): void => {
    if (raw === "" || !spec.startsWith(".")) return;
    const target = resolveRelativeTarget(file, spec);
    if (target === undefined) return;
    if (self !== undefined && ownByFile.size > 0 && isTestFileName(file)) {
      const entrypoint = ownByFile.get(target);
      if (entrypoint !== undefined) {
        const published = exportedSymbolsCached(target);
        for (const entry of splitNames(raw, wholeIsType)) {
          if (!published.has(entry.name)) continue;
          push(ownTest, self, entrypoint, { ...entry, file });
        }
        return;
      }
    }
    const hit = byDir.find((p) => target === p.abs || target.startsWith(`${p.abs}/`));
    if (hit === undefined) return;
    if (target === consumerAbs || target.startsWith(`${consumerAbs}/`)) return; // in-package
    if (!relative(hit.abs, target).split(/[/\\]/).includes("src")) return;
    const entrypoint = gateEntrypointSourcesByFile(root, relative(root, hit.abs), hit.name).get(target);
    if (entrypoint === undefined) {
      internalPathReach += 1;
      return;
    }
    // Only a name the entrypoint publishes is a binding; anything else
    // reaches past the surface into implementation.
    const published = exportedSymbolsCached(target);
    let bound = false;
    for (const entry of splitNames(raw, wholeIsType)) {
      if (!published.has(entry.name)) continue;
      bound = true;
      push(pathReach, hit.name, entrypoint, { ...entry, file });
    }
    if (!bound) internalPathReach += 1;
  };
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { comments, strings } = ignorableRanges(text);
    const code = blankComments(text, comments);
    for (const match of code.matchAll(IMPORT_FROM)) {
      if (isIgnoredAt(strings, match.index ?? 0)) continue;
      const raw = match[2] ?? "";
      if (raw === "" && match[3] !== undefined && match[3] !== "") continue; // default import
      const wholeIsType = (match[1] ?? "").trim() !== "";
      const target = specifierToProvider(longestFirst, match[4] ?? "");
      if (target !== undefined) {
        for (const entry of splitNames(raw, wholeIsType)) {
          push(specifier, target.provider, target.entrypoint, { ...entry, file });
        }
      } else {
        considerRelative(match[4] ?? "", raw, wholeIsType, file);
      }
    }
    for (const match of code.matchAll(EXPORT_FROM)) {
      if (isIgnoredAt(strings, match.index ?? 0)) continue;
      const raw = match[2] ?? "";
      if (raw === "") continue; // `export *`: no named contract
      const wholeIsType = (match[1] ?? "").trim() !== "";
      const target = specifierToProvider(longestFirst, match[3] ?? "");
      if (target !== undefined) {
        for (const entry of splitNames(raw, wholeIsType)) {
          push(specifier, target.provider, target.entrypoint, { ...entry, file });
        }
      } else {
        considerRelative(match[3] ?? "", raw, wholeIsType, file);
      }
    }
  }
  return { specifier, ownTest, pathReach, internalPathReach };
}

/** Every workspace-provider named import under one consumer dir (nested consumers carve out). */
export function derivedImports(
  root: string,
  consumerDir: string,
  allConsumerDirs?: string[],
): Map<string, ImportedName[]> {
  return derivedBindings(root, consumerDir, allConsumerDirs).specifier;
}

/** The provider's own tests importing its entrypoint by relative path. */
export function derivedOwnTestImports(
  root: string,
  consumerDir: string,
  allConsumerDirs?: string[],
): Map<string, ImportedName[]> {
  return derivedBindings(root, consumerDir, allConsumerDirs).ownTest;
}

/** Relative imports from one consumer dir into another provider's entrypoint source. */
export function derivedPathReachImports(
  root: string,
  consumerDir: string,
  allConsumerDirs?: string[],
): Map<string, ImportedName[]> {
  return derivedBindings(root, consumerDir, allConsumerDirs).pathReach;
}

export function readContracts(root: string, consumerDir: string): ContractRow[] {
  const full = join(root, consumerDir, "consumes.json");
  if (!existsSync(full)) return [];
  return JSON.parse(readFileSync(full, "utf8")) as ContractRow[];
}

export function providerDirFor(root: string, provider: string): string | undefined {
  return discoverWorkspaceProviders(root).get(provider);
}

/** Published names for one provider entrypoint, via the reused resolve + export scanners. */
export function publishedNames(root: string, provider: string, entrypoint: string): Set<string> {
  const key = `${root}\t${provider}\t${entrypoint}`;
  const cached = publishedCache.get(key);
  if (cached !== undefined) return cached;
  const computed = publishedNamesUncached(root, provider, entrypoint);
  publishedCache.set(key, computed);
  return computed;
}

function declaredEntrypointsCached(root: string, packageDir: string, name: string): DeclaredEntrypoint[] {
  const key = `${root}\t${packageDir}`;
  const cached = entrypointCache.get(key);
  if (cached !== undefined) return cached;
  const entries = declaredEntrypoints(root, packageDir, name);
  entrypointCache.set(key, entries);
  return entries;
}

function exportedSymbolsCached(source: string): Set<string> {
  const cached = symbolCache.get(source);
  if (cached !== undefined) return cached;
  const symbols = exportedSymbols(source);
  symbolCache.set(source, symbols);
  return symbols;
}

function publishedNamesUncached(root: string, provider: string, entrypoint: string): Set<string> {
  const packageDir = providerDirFor(root, provider);
  if (packageDir === undefined) return new Set();
  const entries = declaredEntrypointsCached(root, packageDir, provider);
  const wanted = entries.find((e) => e.specifier === entrypoint);
  if (wanted === undefined) return new Set();
  const source = resolveEntrypointSource(root, wanted);
  if (source === undefined) return new Set();
  return exportedSymbolsCached(source);
}

export function readAllowlist(root: string): AllowlistRow[] {
  const full = join(
    root,
    "packages/openclinxr-verification/architecture-rules/src/archunit-tests/consumer-contracts-allowlist.json",
  );
  if (!existsSync(full)) return [];
  return JSON.parse(readFileSync(full, "utf8")) as AllowlistRow[];
}

/** (a) consumer imports a name its consumes.json does not list. */
export function checkUnlistedImports(
  root: string,
  consumers?: ConsumerDef[],
): string[] {
  consumers ??= consumersWithContracts(root);
  const violations: string[] = [];
  for (const consumer of consumers) {
    const contracts = readContracts(root, consumer.dir);
    if (contracts.length === 0) continue;
    const listed = new Map<string, Set<string>>();
    for (const row of contracts) {
      listed.set(
        `${row.provider}\t${row.entrypoint}`,
        new Set(row.names.map((n) => n.name)),
      );
    }
    const bindings = derivedBindings(root, consumer.dir);
    const check = (imports: Map<string, ImportedName[]>, via: string): void => {
      for (const [key, names] of imports) {
        const listedNames = listed.get(key);
        if (listedNames === undefined) {
          const [provider, entrypoint] = key.split("\t") as [string, string];
          violations.push(
            `${consumer.dir} imports ${provider}${entrypoint} via ${via} with no contract row for it: ${names[0]?.name ?? ""}`,
          );
          continue;
        }
        for (const imp of names) {
          if (!listedNames.has(imp.name)) {
            const [provider, entrypoint] = key.split("\t") as [string, string];
            violations.push(
              `${consumer.dir} imports ${imp.name} from ${provider}${entrypoint} via ${via} but consumes.json does not list it (${imp.file})`,
            );
          }
        }
      }
    };
    check(bindings.specifier, "specifier");
    check(bindings.ownTest, "own-test");
    check(bindings.pathReach, "path-reach");
  }
  return violations.sort();
}

/** (e) a consumer dir with workspace imports owns no consumes.json. */
export function checkMissingContracts(
  root: string,
  consumers?: ConsumerDef[],
): string[] {
  consumers ??= consumersWithContracts(root);
  const dirs = new Set(consumers.map((c) => c.dir));
  const violations: string[] = [];
  for (const consumer of consumers) {
    const full = join(root, consumer.dir, "consumes.json");
    if (existsSync(full)) continue;
    const bindings = derivedBindings(root, consumer.dir, [...dirs]);
    const imports = bindings.specifier.size > 0 ? bindings.specifier : bindings.ownTest.size > 0 ? bindings.ownTest : bindings.pathReach;
    if (imports.size === 0) continue;
    const [key] = [...imports.keys()].sort();
    const [provider, entrypoint] = (key ?? "").split("\t") as [string, string];
    violations.push(
      `${consumer.dir} imports ${provider ?? ""}${entrypoint ?? ""} but owns no consumes.json: run pnpm arch:consumer-contracts and commit the file`,
    );
  }
  return violations.sort();
}

/** (b) consumes.json lists a name the provider entrypoint does not publish. */
export function checkListedNotPublished(
  root: string,
  consumers?: ConsumerDef[],
): string[] {
  consumers ??= consumersWithContracts(root);
  const providers = discoverWorkspaceProviders(root);
  const violations: string[] = [];
  for (const consumer of consumers) {
    for (const row of readContracts(root, consumer.dir)) {
      if (!providers.has(row.provider)) {
        violations.push(
          `${consumer.dir} contracts unknown provider ${row.provider} (no workspace package with that name)`,
        );
        continue;
      }
      const published = publishedNames(root, row.provider, row.entrypoint);
      if (published.size === 0) {
        violations.push(
          `${consumer.dir} contracts ${row.provider}${row.entrypoint} which resolves to no entrypoint source`,
        );
        continue;
      }
      for (const name of row.names) {
        if (!published.has(name.name)) {
          violations.push(
            `${consumer.dir} lists ${name.name} in ${row.provider}${row.entrypoint} but the entrypoint does not publish it`,
          );
        }
      }
    }
  }
  return violations.sort();
}

/** (c) provider publishes a name no consumes.json lists. Scoped to entrypoints with contracts. */
export function checkUnconsumedPublished(
  root: string,
  consumers?: ConsumerDef[],
): string[] {
  const violations: string[] = [];
  for (const [provider, rows] of measureUnconsumedByProvider(root, consumers)) {
    for (const row of rows) {
      for (const symbol of row.names) {
        violations.push(`${provider}${row.specifier} publishes ${symbol} which no consumes.json lists`);
      }
    }
  }
  return violations.sort();
}

function servedByClasses(
  root: string,
  consumers?: ConsumerDef[],
): Map<string, Set<ConsumerClass>> {
  consumers ??= consumersWithContracts(root);
  const servedBy = new Map<string, Set<ConsumerClass>>();
  const add = (key: string, cls: ConsumerClass): void => {
    const set = servedBy.get(key) ?? new Set<ConsumerClass>();
    set.add(cls);
    servedBy.set(key, set);
  };
  for (const consumer of consumers) {
    const bindings = derivedBindings(root, consumer.dir);
    for (const [key] of bindings.specifier) add(key, consumer.class);
    for (const [key] of bindings.ownTest) add(key, "own-test");
    for (const [key] of bindings.pathReach) add(key, "path-reach");
  }
  return servedBy;
}

/** (d) one entrypoint serves consumers of different classes without an allowlist reason. */
export function checkMixedClassEntrypoints(
  root: string,
  consumers?: ConsumerDef[],
  allowlist: AllowlistRow[] = readAllowlist(root),
): string[] {
  const servedBy = servedByClasses(root, consumers);
  const excused = new Map<string, AllowlistRow>();
  for (const row of allowlist) excused.set(`${row.provider}\t${row.entrypoint}`, row);
  const violations: string[] = [];
  for (const [key, classes] of [...servedBy.entries()].sort()) {
    if (classes.size < 2) continue;
    const row = excused.get(key);
    const [provider, entrypoint] = key.split("\t") as [string, string];
    if (row === undefined || row.reason.trim() === "") {
      violations.push(
        `${provider}${entrypoint} serves ${[...classes].sort().join(", ")} with no allowlist reason`,
      );
      continue;
    }
    const covered = new Set(row.classes);
    for (const cls of classes) {
      if (!covered.has(cls)) {
        violations.push(
          `${provider}${entrypoint} serves ${cls} outside its allowlist classes ${[...covered].sort().join(", ")}`,
        );
      }
    }
  }
  return violations.sort();
}

export type UnconsumedMeasure = { specifier: string; names: string[] };
export type MixedMeasure = { specifier: string; classes: ConsumerClass[] };

/** Clause-(c) regrouped per provider: entrypoints with contracts and the published names none lists. */
export function measureUnconsumedByProvider(
  root: string,
  consumers?: ConsumerDef[],
): Map<string, UnconsumedMeasure[]> {
  consumers ??= consumersWithContracts(root);
  const providers = discoverWorkspaceProviders(root);
  const listed = new Map<string, Set<string>>();
  for (const consumer of consumers) {
    for (const row of readContracts(root, consumer.dir)) {
      if (!providers.has(row.provider)) continue;
      const key = `${row.provider}\t${row.entrypoint}`;
      const set = listed.get(key) ?? new Set<string>();
      for (const name of row.names) set.add(name.name);
      listed.set(key, set);
    }
  }
  const out = new Map<string, UnconsumedMeasure[]>();
  for (const [provider, packageDir] of [...providers.entries()].sort()) {
    for (const entry of declaredEntrypointsCached(root, packageDir, provider)) {
      const key = `${provider}\t${entry.specifier}`;
      if (!listed.has(key)) continue; // an entrypoint with no contracts is out of scope
      const source = resolveEntrypointSource(root, entry);
      if (source === undefined) continue;
      const names = [...exportedSymbolsCached(source)].filter((s) => !(listed.get(key) ?? new Set()).has(s)).sort();
      if (names.length > 0) {
        const rows = out.get(provider) ?? [];
        rows.push({ specifier: entry.specifier, names });
        out.set(provider, rows);
      }
    }
  }
  return out;
}

/** Clause-(d) unexcused rows regrouped per provider. Shares servedByClasses with the check below. */
export function measureMixedByProvider(
  root: string,
  consumers?: ConsumerDef[],
  allowlist: AllowlistRow[] = readAllowlist(root),
): Map<string, MixedMeasure[]> {
  consumers ??= consumersWithContracts(root);
  const servedBy = servedByClasses(root, consumers);
  const excused = new Map<string, AllowlistRow>();
  for (const row of allowlist) excused.set(`${row.provider}\t${row.entrypoint}`, row);
  const out = new Map<string, MixedMeasure[]>();
  for (const [key, classes] of [...servedBy.entries()].sort()) {
    if (classes.size < 2) continue;
    const [provider, entrypoint] = key.split("\t") as [string, string];
    const row = excused.get(key);
    if (row !== undefined && row.reason.trim() !== "" && [...classes].every((c) => (row.classes as string[]).includes(c))) {
      continue; // excused seam: still counted down by the ceiling when newly excused
    }
    const rows = out.get(provider) ?? [];
    rows.push({ specifier: entrypoint, classes: [...classes].sort() as ConsumerClass[] });
    out.set(provider, rows);
  }
  return new Map([...out.entries()].sort());
}

export function readContractCeilings(): ContractCeilings | null {
  const full = join(dirname(fileURLToPath(import.meta.url)), CONSUMER_CONTRACTS_CEILING_FILENAME);
  try {
    return JSON.parse(readFileSync(full, "utf8")) as ContractCeilings;
  } catch {
    return null;
  }
}

/**
 * Shrink-only in both directions per section: above the ceiling fails (the
 * tree regressed), below the ceiling fails (the tree improved and the ceiling
 * must be lowered to the measured value). Same semantics as
 * agent-index-quality.ceiling.json. Counts exclude allowlist-excused (d) rows:
 * excusing a seam with a reason still lowers the measured count, so gaming the
 * ceiling through the allowlist shows up as a lower-the-ceiling diff in review.
 */
export function checkContractCeilings(
  unconsumed: Map<string, UnconsumedMeasure[]>,
  mixed: Map<string, MixedMeasure[]>,
  ceiling: ContractCeilings | null = readContractCeilings(),
): string[] {
  const violations: string[] = [];
  if (ceiling === null) {
    violations.push(
      `${CONSUMER_CONTRACTS_CEILING_FILENAME}: missing. Clauses (c) and (d) have no `
      + `committed ceiling, so any regression passes silently. FIX: restore the file.`,
    );
    return violations;
  }
  const sections = [
    { key: "unconsumed" as const, measured: unconsumed, allowed: ceiling.unconsumed, what: "published-but-unconsumed names" },
    { key: "mixed" as const, measured: mixed, allowed: ceiling.mixed, what: "mixed-class entrypoints" },
  ] as const;
  for (const section of sections) {
    const measuredTotal = [...section.measured.values()].reduce(
      (sum, rows) => sum + (section.key === "unconsumed"
        ? (rows as UnconsumedMeasure[]).reduce((s, r) => s + r.names.length, 0)
        : (rows as MixedMeasure[]).length),
      0,
    );
    if (measuredTotal > section.allowed.total) {
      violations.push(
        `consumer-contracts ${section.key}: measured ${measuredTotal} ${section.what} > ceiling `
        + `${section.allowed.total}. The contracted surface regressed. Split an entrypoint by `
        + `consumer class or list the names a consumer binds; do NOT raise the ceiling.`,
      );
    } else if (measuredTotal < section.allowed.total) {
      violations.push(
        `consumer-contracts ${section.key}: ceiling total ${section.allowed.total} is above the `
        + `measured ${measuredTotal} — the surface shrank but the ceiling was not lowered. Lower `
        + `${CONSUMER_CONTRACTS_CEILING_FILENAME} ${section.key}.total to ${measuredTotal} (and each `
        + `changed byProvider row to its measured count).`,
      );
    }
    const measuredCounts = new Map<string, number>();
    for (const [provider, rows] of section.measured) {
      measuredCounts.set(provider, section.key === "unconsumed"
        ? (rows as UnconsumedMeasure[]).reduce((s, r) => s + r.names.length, 0)
        : (rows as MixedMeasure[]).length);
    }
    for (const [provider, count] of [...measuredCounts.entries()].sort()) {
      const allowed = section.allowed.byProvider[provider] ?? 0;
      if (count > allowed) {
        violations.push(
          `consumer-contracts ${section.key} ${provider}: measured ${count} > ceiling ${allowed}. `
          + `Do NOT raise the ceiling; shrink the surface instead.`,
        );
      } else if (count < allowed) {
        violations.push(
          `consumer-contracts ${section.key} ${provider}: ceiling ${allowed} is above the measured `
          + `${count}. Lower ${CONSUMER_CONTRACTS_CEILING_FILENAME} ${section.key}.byProvider[${provider}] `
          + `to ${count}${count === 0 ? " (remove the row)" : ""}.`,
        );
      }
    }
    for (const provider of Object.keys(section.allowed.byProvider).sort()) {
      if (!measuredCounts.has(provider)) {
        violations.push(
          `consumer-contracts ${section.key} ${provider}: ceiling ${section.allowed.byProvider[provider]} `
          + `is above the measured 0. Remove ${CONSUMER_CONTRACTS_CEILING_FILENAME} `
          + `${section.key}.byProvider[${provider}].`,
        );
      }
    }
  }
  return violations.sort();
}

/** Reported, not gated: published symbols tree-wide that no consumes.json lists. */
export function globalUnconsumedCount(root: string, consumers?: ConsumerDef[]): number {
  consumers ??= consumersWithContracts(root);
  const report = measureSurface(root);
  const listed = new Set<string>();
  for (const consumer of consumers) {
    for (const row of readContracts(root, consumer.dir)) {
      for (const name of row.names) listed.add(`${row.provider}\t${row.entrypoint}\t${name.name}`);
    }
  }
  let count = 0;
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        if (!listed.has(`${pkg.name}\t${entry.specifier}\t${symbol.name}`)) count += 1;
      }
    }
  }
  return count;
}

function withFixture(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "consumer-contracts-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const manifest = (name: string, extraExports?: Record<string, unknown>): string =>
  JSON.stringify({
    name,
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" }, ...(extraExports ?? {}) },
  });

const consumersFile = (dir: string, rows: ContractRow[]): [string, string] => [
  `${dir}/consumes.json`,
  JSON.stringify(rows, null, 2),
];

describe("consumer contracts match imports", () => {
  it("(1) PLANT (a): an import its consumes.json does not list fails", () => {
    withFixture(
      {
        "packages/openclinxr/fixture-provider/package.json": manifest("@openclinxr/fixture-provider"),
        "packages/openclinxr/fixture-provider/src/index.ts": "export const listed = 1;\nexport const sneaky = 2;\n",
        [consumersFile("apps/fixture-app", [
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [] },
        ])[0]]: consumersFile("apps/fixture-app", [])[1],
      },
      (root) => {
        // Plant in the contracted provider's shape: rewrite the fixture to
        // use the real provider name so specifierToProvider sees it.
        writeFileSync(
          join(root, "packages/openclinxr/fixture-provider/package.json"),
          manifest("@openclinxr/xr-dialogue"),
        );
        mkdirSync(join(root, "packages/openclinxr/xr-dialogue/src"), { recursive: true });
        writeFileSync(join(root, "packages/openclinxr/xr-dialogue/src/index.ts"), "export const listed = 1;\nexport const sneaky = 2;\n");
        writeFileSync(
          join(root, "apps/fixture-app/consumes.json"),
          JSON.stringify([{ provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "listed", kind: "runtime" }] }]),
        );
        mkdirSync(join(root, "apps/fixture-app/src"), { recursive: true });
        writeFileSync(
          join(root, "apps/fixture-app/src/main.ts"),
          'import { listed, sneaky } from "@openclinxr/xr-dialogue";\nconsole.log(listed, sneaky);\n',
        );
        const violations = checkUnlistedImports(root, [{ dir: "apps/fixture-app", class: "runtime-app" }]);
        expect(violations.join("\n")).toContain("sneaky");
        expect(violations.join("\n")).not.toContain("listed but consumes");
      },
    );
  });

  it("(2) PLANT (b): a consumes.json name the provider does not publish fails", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const real = 1;\n",
        "apps/fixture-app/src/main.ts": 'import { real } from "@openclinxr/xr-dialogue";\nconsole.log(real);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          {
            provider: "@openclinxr/xr-dialogue",
            entrypoint: ".",
            names: [
              { name: "real", kind: "runtime" },
              { name: "ghost", kind: "runtime" },
            ],
          },
        ]),
      },
      (root) => {
        const violations = checkListedNotPublished(root, [{ dir: "apps/fixture-app", class: "runtime-app" }]);
        expect(violations.join("\n")).toContain("ghost");
      },
    );
  });

  it("(3) PLANT (c): a published name no consumes.json lists fails", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const covered = 1;\nexport const orphan = 2;\n",
        "apps/fixture-app/src/main.ts": 'import { covered } from "@openclinxr/xr-dialogue";\nconsole.log(covered);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "covered", kind: "runtime" }] },
        ]),
      },
      (root) => {
        const violations = checkUnconsumedPublished(root, [{ dir: "apps/fixture-app", class: "runtime-app" }]);
        expect(violations.join("\n")).toContain("orphan");
        expect(violations.join("\n")).not.toContain("covered which");
      },
    );
  });

  it("(4) PLANT (d): one entrypoint serving two classes fails without an allowlist reason", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const shared = 1;\n",
        "apps/fixture-app/src/main.ts": 'import { shared } from "@openclinxr/xr-dialogue";\nconsole.log(shared);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "shared", kind: "runtime" }] },
        ]),
        "tools/openclinxr/fixture-tool/run.ts": 'import { shared } from "@openclinxr/xr-dialogue";\nconsole.log(shared);\n',
        "tools/openclinxr/fixture-tool/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "shared", kind: "runtime" }] },
        ]),
      },
      (root) => {
        const consumers: ConsumerDef[] = [
          { dir: "apps/fixture-app", class: "runtime-app" },
          { dir: "tools/openclinxr/fixture-tool", class: "tools" },
        ];
        expect(checkMixedClassEntrypoints(root, consumers, []).join("\n")).toContain("serves runtime-app, tools");
        const excused = checkMixedClassEntrypoints(root, consumers, [
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", classes: ["runtime-app", "tools"], reason: "fixture reason" },
        ]);
        expect(excused).toEqual([]);
      },
    );
  });

  // Live-tree tests carry the arch config's 30 s budget explicitly: they scan
  // the whole tree (67 providers, 78 consumers) and exceed the default
  // 5 s timeout on a loaded machine. test:touched runs this file under the
  // default config; pnpm architecture runs it under vitest.arch.config.ts.
  it("(5) live tree: clauses (a), (b) and (e) pass hard; clauses (c) and (d) hold at their ceilings", { timeout: 30_000 }, () => {
    const root = findRoot();
    const consumers = consumersWithContracts(root);
    expect(consumers.length).toBeGreaterThan(70);
    expect(checkUnlistedImports(root, consumers).join("\n")).toBe("");
    expect(checkListedNotPublished(root, consumers).join("\n")).toBe("");
    expect(checkMissingContracts(root, consumers).join("\n")).toBe("");
    const unconsumed = measureUnconsumedByProvider(root);
    const mixed = measureMixedByProvider(root);
    const ceiling = readContractCeilings();
    expect(ceiling === null ? "missing ceiling file" : "").toBe("");
    expect(checkContractCeilings(unconsumed, mixed, ceiling).join("\n")).toBe("");
    // The ceiling is load-bearing beyond xr-dialogue: most mixed-class
    // entrypoints and most unconsumed names sit on other providers.
    const mixedTotal = [...mixed.values()].reduce((s, r) => s + r.length, 0);
    expect(mixedTotal).toBeGreaterThan(1);
    expect(mixed.has("@openclinxr/xr-dialogue")).toBe(false);
    // The shared-seam excuse is load-bearing: without the allowlist the
    // actor-audio-runtime seam fires.
    const allowlist = readAllowlist(root);
    expect(allowlist.map((r) => `${r.provider}${r.entrypoint}`).sort()).toEqual([
      "@openclinxr/xr-dialogue.",
      "@openclinxr/xr-dialogue./actor-audio-runtime",
      "@openclinxr/xr-dialogue./package-viseme",
      "@openclinxr/xr-dialogue./viseme-timeline",
    ]);
    for (const row of allowlist) expect(row.reason.trim() !== "").toBe(true);
    const allConsumers = consumersWithContracts(root);
    expect(checkMixedClassEntrypoints(root, allConsumers, []).join("\n")).toContain(
      "./actor-audio-runtime",
    );
  });

  it("(6) live tree reports the global unconsumed count", { timeout: 30_000 }, () => {
    // Report-only: the tree's surface beyond the contracted slices. The count
    // fell 1494 -> 994 (27 providers under contract) -> 318 (all 78 consumer
    // dirs under contract) -> 101 (own-test and path-reach bindings counted
    // as consumed); the floor below proves the reporter still sees the tree,
    // not a number to chase.
    const count = globalUnconsumedCount(findRoot());
    expect(count).toBeGreaterThan(50);
  });

  it("(7) string-literal and comment imports derive no contract", () => {
    withFixture(
      {
        "packages/openclinxr/fixture-provider/package.json": manifest("@openclinxr/fixture-provider"),
        "packages/openclinxr/fixture-provider/src/index.ts": "export const real = 1;\n",
        "apps/fixture-app/consumes.json": JSON.stringify([
          { provider: "@openclinxr/fixture-provider", entrypoint: ".", names: [{ name: "real", kind: "runtime" }] },
        ]),
        "apps/fixture-app/src/quoted.ts":
          'const line = "import { phantom } from \'@openclinxr/fixture-provider\';";\n'
          + "export const line2 = `import { backtick } from \"@openclinxr/fixture-provider\";`;\n"
          + "export const line3 = line + line2;\n"
          + "// import { commented } from \"@openclinxr/fixture-provider\";\n"
          + "/* import { blocked } from \"@openclinxr/fixture-provider\"; */\n"
          + 'import { real } from "@openclinxr/fixture-provider";\n'
          + 'import { real as realAlias } from "@openclinxr/fixture-provider";\n'
          + 'export { real as reExported } from "@openclinxr/fixture-provider";\n'
          + "console.log(line3, real, realAlias, reExported);\n",
      },
      (root) => {
        const imports = derivedImports(root, "apps/fixture-app");
        const names = [...imports.values()].flat().map((i) => i.name).sort();
        // Aliases bind the provider's left-hand name: real x3, never the alias.
        expect(names).toEqual(["real", "real", "real"]);
        expect(checkUnlistedImports(root, [{ dir: "apps/fixture-app", class: "runtime-app" }])).toEqual([]);
      },
    );
  });

  it("(8) COUNTERWEIGHT: a ceiling above the measured value fails, demanding it be lowered", () => {
    const unconsumed = new Map<string, UnconsumedMeasure[]>([
      ["@openclinxr/fixture", [{ specifier: ".", names: ["solo"] }]],
    ]);
    const high: ContractCeilings = {
      unconsumed: { total: 2, byProvider: { "@openclinxr/fixture": 2 } },
      mixed: { total: 0, byProvider: {} },
    };
    const violations = checkContractCeilings(unconsumed, new Map(), high);
    expect(violations.join("\n")).toContain("Lower");
    expect(violations.join("\n")).toContain("@openclinxr/fixture");
  });

  it("(9) COUNTERWEIGHT: growth above the ceiling fails without raising it", () => {
    const unconsumed = new Map<string, UnconsumedMeasure[]>([
      ["@openclinxr/fixture", [{ specifier: ".", names: ["one", "two"] }]],
    ]);
    const low: ContractCeilings = {
      unconsumed: { total: 1, byProvider: { "@openclinxr/fixture": 1 } },
      mixed: { total: 0, byProvider: {} },
    };
    const violations = checkContractCeilings(unconsumed, new Map(), low);
    expect(violations.join("\n")).toContain("do NOT raise the ceiling");
  });

  it("(10) COUNTERWEIGHT: a missing ceiling file fails closed", () => {
    expect(checkContractCeilings(new Map(), new Map(), null).join("\n")).toContain("missing");
  });

  it("(11) PLANT (e): a consumer dir with imports and no consumes.json fails", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const real = 1;\n",
        "apps/fixture-app/src/main.ts": 'import { real } from "@openclinxr/xr-dialogue";\nconsole.log(real);\n',
      },
      (root) => {
        const consumers: ConsumerDef[] = [{ dir: "apps/fixture-app", class: "runtime-app" }];
        expect(checkMissingContracts(root, consumers).join("\n")).toContain("owns no consumes.json");
        writeFileSync(
          join(root, "apps/fixture-app/consumes.json"),
          JSON.stringify([{ provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "real", kind: "runtime" }] }]),
        );
        expect(checkMissingContracts(root, consumers)).toEqual([]);
      },
    );
  });

  it("(12) PLANT own-test: a provider's own test binding its entrypoint counts as consumed", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const covered = 1;\nexport const orphan = 2;\n",
        // Relative specifiers are concatenated so this file's own text never
        // matches the nothing-reaches freeze scanner; the written fixture
        // still contains the full import.
        "packages/openclinxr/xr-dialogue/src/dialogue.test.ts":
          'import { covered } from "./' + 'index.js";\nconsole.log(covered);\n',
      },
      (root) => {
        const consumers: ConsumerDef[] = [{ dir: "packages/openclinxr/xr-dialogue", class: "package" }];
        const own = derivedOwnTestImports(root, "packages/openclinxr/xr-dialogue");
        expect([...own.keys()]).toEqual(["@openclinxr/xr-dialogue\t."]);
        // Unlisted own-test binding fails clause (a) until the contract lists it.
        writeFileSync(
          join(root, "packages/openclinxr/xr-dialogue/consumes.json"),
          JSON.stringify([{ provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [] }]),
        );
        expect(checkUnlistedImports(root, consumers).join("\n")).toContain("via own-test");
        writeFileSync(
          join(root, "packages/openclinxr/xr-dialogue/consumes.json"),
          JSON.stringify([
            { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "covered", kind: "runtime", via: "own-test" }] },
          ]),
        );
        expect(checkUnlistedImports(root, consumers)).toEqual([]);
        const unconsumed = measureUnconsumedByProvider(root, [
          ...consumers,
          { dir: "apps/fixture-app", class: "runtime-app" },
        ]);
        expect(unconsumed.get("@openclinxr/xr-dialogue")?.flatMap((r) => r.names)).toEqual(["orphan"]);
      },
    );
  });

  it("(13) PLANT path-reach: a relative import into another provider's entrypoint counts as consumed", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const covered = 1;\nexport const orphan = 2;\n",
        "tools/openclinxr/fixture-tool/run.ts":
          'import { covered } from "../../../packages/' + 'openclinxr/xr-dialogue/src/index.js";\nconsole.log(covered);\n',
        "apps/fixture-app/src/main.ts": 'import { covered } from "@openclinxr/xr-dialogue";\nconsole.log(covered);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "covered", kind: "runtime" }] },
        ]),
      },
      (root) => {
        const consumers: ConsumerDef[] = [
          { dir: "packages/openclinxr/xr-dialogue", class: "package" },
          { dir: "tools/openclinxr/fixture-tool", class: "tools" },
          { dir: "apps/fixture-app", class: "runtime-app" },
        ];
        const reach = derivedPathReachImports(root, "tools/openclinxr/fixture-tool");
        expect([...reach.keys()]).toEqual(["@openclinxr/xr-dialogue\t."]);
        writeFileSync(
          join(root, "tools/openclinxr/fixture-tool/consumes.json"),
          JSON.stringify([
            { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "covered", kind: "runtime", via: "path-reach" }] },
          ]),
        );
        writeFileSync(
          join(root, "packages/openclinxr/xr-dialogue/consumes.json"),
          JSON.stringify([]),
        );
        expect(checkUnlistedImports(root, consumers)).toEqual([]);
        const unconsumed = measureUnconsumedByProvider(root, consumers);
        expect(unconsumed.get("@openclinxr/xr-dialogue")?.flatMap((r) => r.names)).toEqual(["orphan"]);
        // Clause (d) tells the seams apart: specifier runtime-app vs path-reach.
        const mixed = measureMixedByProvider(root, consumers, []);
        expect(mixed.get("@openclinxr/xr-dialogue")?.map((r) => r.classes)).toEqual([["path-reach", "runtime-app"]]);
      },
    );
  });

  it("(14) COUNTERWEIGHT: a throwaway export no code imports raises unconsumed by exactly 1; internal reaches bind nothing", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const covered = 1;\nexport const throwaway = 2;\n",
        "packages/openclinxr/xr-dialogue/src/internal.ts": "export const helper = 3;\n",
        "apps/fixture-app/src/main.ts": 'import { covered } from "@openclinxr/xr-dialogue";\nconsole.log(covered);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "covered", kind: "runtime" }] },
        ]),
        "tools/openclinxr/fixture-tool/run.ts":
          'import { helper } from "../../../packages/' + 'openclinxr/xr-dialogue/src/internal.js";\nconsole.log(helper);\n',
      },
      (root) => {
        const consumers: ConsumerDef[] = [
          { dir: "apps/fixture-app", class: "runtime-app" },
          { dir: "tools/openclinxr/fixture-tool", class: "tools" },
        ];
        const unconsumed = measureUnconsumedByProvider(root, consumers);
        expect(unconsumed.get("@openclinxr/xr-dialogue")?.flatMap((r) => r.names)).toEqual(["throwaway"]);
        const bindings = derivedBindings(root, "tools/openclinxr/fixture-tool");
        expect(bindings.pathReach.size).toBe(0);
        expect(bindings.internalPathReach).toBe(1);
      },
    );
  });
});
