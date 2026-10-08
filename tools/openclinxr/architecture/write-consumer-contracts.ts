import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `pnpm arch:consumer-contracts` (write-consumer-contracts.ts) — reconcile each
 * consumer's `consumes.json` with its real imports, then hand-owned deltas stay.
 *
 * CONSUMER-DRIVEN CONTRACTS. Each consumer of a workspace package owns a
 * committed `consumes.json` at its root: [{ provider, entrypoint, names[] }].
 * This script re-derives the rows from the tree's actual static imports and
 * MERGES them over the committed file: derived names are added, committed
 * names never removed (a name the regex cannot see — e.g. a dynamic
 * `import()` type, or a deliberate pin — stays until a human trims it).
 * Adding an import without listing it fails the archunit gate; removing one
 * without trimming the file fails the same gate. A consumer dir with workspace
 * imports and no consumes.json fails the missing-contract gate.
 *
 * ALL CONSUMERS, DISCOVERED. A consumer is every workspace package or app dir
 * (packages/** and apps/** package.json dirs, @-scoped or not — the unscoped
 * apps/arena/physics-clinical-touch consumes but does not provide), plus
 * tools/openclinxr itself (loose files) and each tools/openclinxr/<area>,
 * plus tools/agent-factory (loose harness scripts that reach package src by
 * path), plus any dir that already owns a consumes.json (contracts are
 * sticky: tools/openclinxr/asset-pipeline/makeclothes nests inside the
 * asset-pipeline area and stays its own consumer). File ownership is longest
 * matching prefix, so nested consumers carve out of their parents. Classes:
 * apps/* → runtime-app, packages/* → package, tools/openclinxr/evidence →
 * evidence, other tools → tools.
 *
 * OWN-TEST AND PATH-REACH BINDINGS COUNT, RECORDED WITH via. Two real binding
 * kinds never use a package specifier, so the specifier scanner misses them:
 * (1) a package's OWN tests importing through its entrypoint via a relative
 * path (./index.js, ./public.js — psr-01d amendment 2026-09-11 counts these
 * as consumers; un-publishing a name they bind raises testInternalImports
 * and is refused), and (2) PATH-REACH imports, relative paths from
 * apps/tools/tests/packages files into another package's src/. Each name
 * carries via "own-test" | "path-reach" (absent means the package-specifier
 * import). A path-reach import that resolves to an INTERNAL module rather
 * than an entrypoint source file binds no published name: it is counted in
 * the run summary (internal path-reach) and recorded nowhere. The archunit
 * gate mirrors this file's resolution, so generator and gate agree.
 *
 * ALL WORKSPACE PROVIDERS. The provider set is discovered, not hardcoded: every
 * package.json name under packages/** and apps/** in the @openclinxr/ or
 * @cellix/ scope. On a name collision the shortest relative dir wins (so
 * apps/api beats apps/api/deploy).
 *
 * TYPE-ONLY IMPORTS COUNT — YES, LISTED WITH KIND. A type-only name still pins
 * the provider's interface: renaming or deleting it breaks the consumer's
 * compile. Each name carries kind "runtime" | "type". `import type {…}`,
 * `export type {…}`, and inline `type Foo` prefixes all record kind "type".
 * A value import of a type (no `type` keyword) records "runtime" even when the
 * provider classifies it as type — the gate compares names, the kind is
 * documentation for the split.
 *
 * STRING AND COMMENT IMPORTS DO NOT COUNT. An `import … from "…"` match whose
 * `import` keyword sits inside a string literal is skipped, and comments are
 * blanked before scanning (a `//` note inside an import's braces, or a
 * commented-out import, contributes no names). The archunit gate applies the
 * identical mask, so generator and gate agree.
 *
 * THE PROVIDER-BOUND NAME IS LEFT OF `as`. `import { A as B }` binds A (B is
 * the consumer's local alias); `export { A as B } from` likewise re-exports
 * the provider's A. Recording the alias instead lists a name the provider
 * never published and fails clause (b).
 */

export type ConsumerClass = "runtime-app" | "package" | "tools" | "evidence";

export type ContractVia = "own-test" | "path-reach";

export type ContractName = { name: string; kind: "runtime" | "type"; via?: ContractVia };

export type ConsumerContract = {
  provider: string;
  entrypoint: string;
  names: ContractName[];
};

export type ConsumerDef = { dir: string; class: ConsumerClass };

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".turbo", "public"]);

const IMPORT_FROM =
  /import\s+(type\s+)?(?:[^"'{]*?\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["']/gu;
const EXPORT_FROM = /export\s+(type\s+)?(?:\*|\{([^}]*)\})\s+from\s+["']([^"']+)["']/gu;

/** Every workspace provider: package.json name → repo-relative dir. */
export function discoverWorkspaceProviders(root: string): Map<string, string> {
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
  return out;
}

export function classForConsumerDir(dir: string): ConsumerClass {
  if (dir.startsWith("apps/")) return "runtime-app";
  if (dir.startsWith("packages/")) return "package";
  if (dir === "tools/openclinxr/evidence") return "evidence";
  return "tools";
}

/**
 * Every computed consumer dir: provider dirs (one per workspace package, the
 * shortest dir on name collision), unscoped package.json dirs that are not
 * under a provider dir (apps/arena/physics-clinical-touch), tools/openclinxr
 * itself, and each tools/openclinxr/<area>.
 */
export function discoverConsumers(root: string): ConsumerDef[] {
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
  return [...out.entries()]
    .map(([dir, cls]) => ({ dir, class: cls }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
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
 * [start, end) ranges of comments and string literals. Comments are found
 * first so an apostrophe in prose cannot open a phantom string; strings are
 * then found outside comments. A single-line quote never spans a newline.
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

function repoRoot(): string {
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

function sourceFilesUnder(dir: string, out: string[], skipPrefixes: string[]): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent<string>[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (skipPrefixes.some((p) => full === p || full.startsWith(`${p}/`))) continue;
    if (entry.isDirectory()) {
      sourceFilesUnder(full, out, skipPrefixes);
      continue;
    }
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (SOURCE_EXTENSIONS.has(ext)) out.push(full);
  }
}

function splitNames(raw: string, wholeIsType: boolean): ContractName[] {
  const out: ContractName[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const isInlineType = trimmed.startsWith("type ");
    const bare = (isInlineType ? trimmed.slice(5) : trimmed).trim();
    // The provider-bound name is LEFT of `as`: `import { A as B }` binds A
    // (B is the consumer's local alias), and `export { A as B } from` likewise
    // re-exports the provider's A. Recording the alias instead lists a name the
    // provider never published and fails clause (b).
    const name = bare.split(" as ")[0]?.trim() ?? "";
    if (name === "" || name === "*") continue;
    out.push({ name, kind: wholeIsType || isInlineType ? "type" : "runtime" });
  }
  return out;
}

function specifierToContract(
  longestFirst: string[],
  specifier: string,
): { provider: string; entrypoint: string } | undefined {
  for (const name of longestFirst) {
    if (specifier === name) return { provider: name, entrypoint: "." };
    if (specifier.startsWith(`${name}/`)) {
      return { provider: name, entrypoint: `./${specifier.slice(name.length + 1)}` };
    }
  }
  return undefined;
}

function collectConditionTargets(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) collectConditionTargets(nested, into);
  }
}

type DeclaredEntrypoint = { specifier: string; condition: string };

function declaredEntrypointsFor(root: string, packageDir: string): DeclaredEntrypoint[] {
  let parsed: { exports?: unknown };
  try {
    parsed = JSON.parse(readFileSync(join(root, packageDir, "package.json"), "utf8")) as { exports?: unknown };
  } catch {
    return [];
  }
  const raw = parsed.exports;
  if (typeof raw === "string") return [{ specifier: ".", condition: raw }];
  if (raw === null || typeof raw !== "object") return [{ specifier: ".", condition: "" }];
  const out: DeclaredEntrypoint[] = [];
  for (const [specifier, conditions] of Object.entries(raw as Record<string, unknown>)) {
    const targets: string[] = [];
    collectConditionTargets(conditions, targets);
    out.push({ specifier, condition: targets[0] ?? "" });
  }
  return out;
}

function candidateSources(root: string, packageDir: string, condition: string): string[] {
  // Mirror of resolve.ts candidateSources (tools cannot import the check
  // without a boundary-test edge, so the mapping is duplicated, not shared).
  const out: string[] = [];
  if (condition.startsWith("./src/")) {
    const bare = condition.replace(/^\.\//u, "").replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/u, "");
    for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
      const candidate = join(root, packageDir, `${bare}${extension}`);
      if (!out.includes(candidate)) out.push(candidate);
    }
    return out;
  }
  const direct = condition.replace(/^\.\//u, "").replace(/\.d\.ts$/u, ".ts").replace(/\.js$/u, ".ts");
  const base = direct === "" ? "src/index" : `src/${direct.replace(/^dist\//u, "")}`;
  const bare = base.replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/u, "");
  for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
    const candidate = join(root, packageDir, `${bare}${extension}`);
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/** Absolute entrypoint source file → entrypoint specifier, for one provider dir. */
export function entrypointSourcesByFile(root: string, packageDir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of declaredEntrypointsFor(root, packageDir)) {
    for (const candidate of candidateSources(root, packageDir, entry.condition)) {
      try {
        if (statSync(candidate).isFile()) {
          if (!out.has(candidate)) out.set(candidate, entry.specifier);
          break;
        }
      } catch {
        // not present: try the next extension
      }
    }
  }
  return out;
}

const entrypointSourcesCache = new Map<string, Map<string, string>>();

function entrypointSourcesCached(root: string, packageDir: string): Map<string, string> {
  const key = `${root}\t${packageDir}`;
  const cached = entrypointSourcesCache.get(key);
  if (cached !== undefined) return cached;
  const computed = entrypointSourcesByFile(root, packageDir);
  entrypointSourcesCache.set(key, computed);
  return computed;
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function isFile(path: string): boolean {
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
  if (isFile(abs)) return abs;
  const bare = abs.replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/u, "");
  for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
    if (isFile(`${bare}${ext}`)) return `${bare}${ext}`;
  }
  for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
    const indexed = join(bare, `index${ext}`);
    if (isFile(indexed)) return indexed;
  }
  return undefined;
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

const PUBLISHED_DECLARED_EXPORT =
  /^export (?:declare )?(?:async )?(?:function|const|class|type|interface|enum|let|var)\s+(\w+)/gmu;
const PUBLISHED_NAMED_EXPORT_BLOCK = /^export (?:type )?\{([^}]*)\}/gmu;
const PUBLISHED_STAR_EXPORT = /^export \* from "([^"]+)"/gmu;

/**
 * Names an entrypoint source publishes. Mirror of
 * checks/export-surface-budgets.ts exportedSymbols (tools cannot import the
 * check without a boundary-test edge, so the scanner is duplicated, not
 * shared): a path-reach import names a binding only for a name in this set.
 */
export function publishedSymbols(entry: string, seen: Set<string> = new Set()): Set<string> {
  const real = entry;
  try {
    const st = statSync(entry);
    if (!st.isFile()) return new Set();
  } catch {
    return new Set();
  }
  if (seen.has(real)) return new Set();
  seen.add(real);
  const text = readText(real);
  if (text === undefined) return new Set();
  const out = new Set<string>();
  for (const match of text.matchAll(PUBLISHED_DECLARED_EXPORT)) out.add(match[1] ?? "");
  for (const match of text.matchAll(PUBLISHED_NAMED_EXPORT_BLOCK)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().split(" as ").pop()?.replace(/^type\s+/u, "").trim();
      if (name !== undefined && name !== "") out.add(name);
    }
  }
  for (const match of text.matchAll(PUBLISHED_STAR_EXPORT)) {
    const target = match[1] ?? "";
    if (!target.startsWith(".")) continue;
    const resolved = join(dirname(real), target.replace(/\.js$/u, ".ts"));
    for (const symbol of publishedSymbols(resolved, seen)) out.add(symbol);
  }
  out.delete("");
  return out;
}

const publishedCache = new Map<string, Set<string>>();

function publishedSymbolsCached(entry: string): Set<string> {
  const cached = publishedCache.get(entry);
  if (cached !== undefined) return cached;
  const computed = publishedSymbols(entry);
  publishedCache.set(entry, computed);
  return computed;
}

/** provider/entrypoint → name → kind for one consumer directory. */
export function collectContracts(
  root: string,
  consumerDir: string,
  providers: Map<string, string>,
  allConsumerDirs: string[],
): ConsumerContract[] {
  const longestFirst = [...providers.keys()].sort((a, b) => b.length - a.length);
  // Nested consumers carve out: a parent never scans a nested owner's files.
  const nested = allConsumerDirs
    .filter((d) => d !== consumerDir && d.startsWith(`${consumerDir}/`))
    .map((d) => join(root, d));
  const files: string[] = [];
  sourceFilesUnder(join(root, consumerDir), files, nested);
  const byKey = new Map<string, Map<string, "runtime" | "type">>();
  const consider = (target: { provider: string; entrypoint: string } | undefined, raw: string, wholeIsType: boolean): void => {
    if (target === undefined) return;
    if (raw === "") return; // default import or `export *`: no named contract
    const key = `${target.provider}\t${target.entrypoint}`;
    const names = byKey.get(key) ?? new Map<string, "runtime" | "type">();
    for (const entry of splitNames(raw, wholeIsType)) {
      const prev = names.get(entry.name);
      // runtime use dominates: a name imported both ways is a runtime dependency.
      if (prev === undefined || entry.kind === "runtime") names.set(entry.name, entry.kind);
    }
    byKey.set(key, names);
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
      consider(specifierToContract(longestFirst, match[4] ?? ""), raw, (match[1] ?? "").trim() !== "");
    }
    for (const match of code.matchAll(EXPORT_FROM)) {
      if (isIgnoredAt(strings, match.index ?? 0)) continue;
      consider(specifierToContract(longestFirst, match[3] ?? ""), match[2] ?? "", (match[1] ?? "").trim() !== "");
    }
  }
  const out: ConsumerContract[] = [];
  for (const [key, names] of [...byKey.entries()].sort()) {
    const [provider, entrypoint] = key.split("\t") as [string, string];
    out.push({
      provider,
      entrypoint,
      names: [...names.entries()]
        .map(([name, kind]) => ({ name, kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return out;
}

/**
 * A provider's OWN tests importing through its entrypoint via a relative
 * path (./index.js, ./public.js). Only test files count, and only when the
 * resolved target is one of the provider's own entrypoint sources — a test
 * reaching an internal module is the testInternalImports world, not a
 * published-name binding. Recorded with via "own-test" in the provider's own
 * consumes.json (self-row: provider is the consumer's own package).
 */
export function collectOwnTestContracts(
  root: string,
  consumerDir: string,
  providers: Map<string, string>,
  allConsumerDirs: string[],
): ConsumerContract[] {
  let self: string | undefined;
  for (const [name, dir] of providers) {
    if (dir === consumerDir) {
      self = name;
      break;
    }
  }
  if (self === undefined) return [];
  const byFile = entrypointSourcesCached(root, consumerDir);
  if (byFile.size === 0) return [];
  const nested = allConsumerDirs
    .filter((d) => d !== consumerDir && d.startsWith(`${consumerDir}/`))
    .map((d) => join(root, d));
  const files: string[] = [];
  sourceFilesUnder(join(root, consumerDir), files, nested);
  const byKey = new Map<string, Map<string, "runtime" | "type">>();
  const consider = (specifier: string, raw: string, wholeIsType: boolean, file: string): void => {
    if (raw === "") return;
    const target = resolveRelativeTarget(file, specifier);
    if (target === undefined) return;
    const entrypoint = byFile.get(target);
    if (entrypoint === undefined) return;
    // Only a name the entrypoint publishes is a binding; anything else
    // reaches past the surface into implementation.
    const published = publishedSymbolsCached(target);
    const key = `${self}\t${entrypoint}`;
    const names = byKey.get(key) ?? new Map<string, "runtime" | "type">();
    let bound = 0;
    for (const entry of splitNames(raw, wholeIsType)) {
      if (!published.has(entry.name)) continue;
      bound += 1;
      const prev = names.get(entry.name);
      if (prev === undefined || entry.kind === "runtime") names.set(entry.name, entry.kind);
    }
    if (bound > 0) byKey.set(key, names);
  };
  for (const file of files) {
    if (!isTestFile(file)) continue;
    const text = readText(file);
    if (text === undefined) continue;
    const { comments, strings } = ignorableRanges(text);
    const code = blankComments(text, comments);
    for (const match of code.matchAll(IMPORT_FROM)) {
      if (isIgnoredAt(strings, match.index ?? 0)) continue;
      const raw = match[2] ?? "";
      if (raw === "" && match[3] !== undefined && match[3] !== "") continue;
      consider(match[4] ?? "", raw, (match[1] ?? "").trim() !== "", file);
    }
    for (const match of code.matchAll(EXPORT_FROM)) {
      if (isIgnoredAt(strings, match.index ?? 0)) continue;
      consider(match[3] ?? "", match[2] ?? "", (match[1] ?? "").trim() !== "", file);
    }
  }
  return toViaContracts(byKey, "own-test");
}

export type PathReachResult = { contracts: ConsumerContract[]; internal: number };

function toViaContracts(
  byKey: Map<string, Map<string, "runtime" | "type">>,
  via: ContractVia,
): ConsumerContract[] {
  const out: ConsumerContract[] = [];
  for (const [key, names] of [...byKey.entries()].sort()) {
    const [provider, entrypoint] = key.split("\t") as [string, string];
    out.push({
      provider,
      entrypoint,
      names: [...names.entries()]
        .map(([name, kind]) => ({ name, kind, via }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return out;
}

/**
 * PATH-REACH bindings: relative imports from this consumer's files into
 * ANOTHER provider's src/ that resolve to one of that provider's entrypoint
 * sources. Recorded with via "path-reach" in the importer's consumes.json.
 * A reach that lands on an internal module (inside the target's src/ but not
 * an entrypoint source) binds no published name: it is counted as internal
 * and recorded nowhere.
 */
export function collectPathReachContracts(
  root: string,
  consumerDir: string,
  providers: Map<string, string>,
  allConsumerDirs: string[],
): PathReachResult {
  const nested = allConsumerDirs
    .filter((d) => d !== consumerDir && d.startsWith(`${consumerDir}/`))
    .map((d) => join(root, d));
  const files: string[] = [];
  sourceFilesUnder(join(root, consumerDir), files, nested);
  const byDir = [...providers.entries()]
    .map(([name, dir]) => ({ name, abs: join(root, dir) }))
    .sort((a, b) => b.abs.length - a.abs.length);
  const byKey = new Map<string, Map<string, "runtime" | "type">>();
  let internal = 0;
  const consider = (specifier: string, raw: string, wholeIsType: boolean, file: string): void => {
    if (raw === "") return;
    if (!specifier.startsWith(".")) return;
    const target = resolveRelativeTarget(file, specifier);
    if (target === undefined) return;
    const hit = byDir.find((p) => target === p.abs || target.startsWith(`${p.abs}/`));
    if (hit === undefined) return;
    const rel = relative(hit.abs, target);
    if (!rel.split(sep).includes("src")) return;
    const consumerAbs = join(root, consumerDir);
    if (target === consumerAbs || target.startsWith(`${consumerAbs}/`)) {
      // In-package reach: the testInternalImports world, not a cross-package binding.
      return;
    }
    const entrypoint = entrypointSourcesCached(root, relative(root, hit.abs)).get(target);
    if (entrypoint === undefined) {
      internal += 1;
      return;
    }
    // Only a name the entrypoint publishes is a binding; anything else
    // reaches past the surface into implementation.
    const published = publishedSymbolsCached(target);
    const key = `${hit.name}\t${entrypoint}`;
    const names = byKey.get(key) ?? new Map<string, "runtime" | "type">();
    let bound = 0;
    for (const entry of splitNames(raw, wholeIsType)) {
      if (!published.has(entry.name)) continue;
      bound += 1;
      const prev = names.get(entry.name);
      if (prev === undefined || entry.kind === "runtime") names.set(entry.name, entry.kind);
    }
    if (bound > 0) {
      byKey.set(key, names);
    } else {
      internal += 1;
    }
  };
  for (const file of files) {
    const text = readText(file);
    if (text === undefined) continue;
    const { comments, strings } = ignorableRanges(text);
    const code = blankComments(text, comments);
    for (const match of code.matchAll(IMPORT_FROM)) {
      if (isIgnoredAt(strings, match.index ?? 0)) continue;
      const raw = match[2] ?? "";
      if (raw === "" && match[3] !== undefined && match[3] !== "") continue;
      consider(match[4] ?? "", raw, (match[1] ?? "").trim() !== "", file);
    }
    for (const match of code.matchAll(EXPORT_FROM)) {
      if (isIgnoredAt(strings, match.index ?? 0)) continue;
      consider(match[3] ?? "", match[2] ?? "", (match[1] ?? "").trim() !== "", file);
    }
  }
  return { contracts: toViaContracts(byKey, "path-reach"), internal };
}

function readCommitted(root: string, consumerDir: string): ConsumerContract[] {
  const full = join(root, consumerDir, "consumes.json");
  try {
    return JSON.parse(readFileSync(full, "utf8")) as ConsumerContract[];
  } catch {
    return [];
  }
}

const VIA_ORDER = ["specifier", "own-test", "path-reach"] as const;

function viaOf(entry: ContractName): string {
  return entry.via ?? "specifier";
}

/**
 * Merge derived rows over the committed file. Derived names are added;
 * committed specifier names are never removed (hand pins, e.g.
 * dynamic-import types, stay until a human trims them). Committed via rows
 * the tree no longer derives are stale generator output and drop.
 * Runtime kind dominates on conflict. A name
 * bound through several mechanisms keeps one entry per via, so the gate can
 * tell specifier, own-test, and path-reach bindings apart; a committed entry
 * with no via counts as a specifier binding.
 */
export function mergeContracts(committed: ConsumerContract[], derived: ConsumerContract[]): ConsumerContract[] {
  // via rows are writer-owned: a committed via row the tree no longer
  // derives is a stale derivation, not a hand pin, so it drops. Hand pins
  // carry no via (they count as specifier bindings) and are never removed.
  const derivedVia = new Set<string>();
  for (const row of derived) {
    for (const entry of row.names) {
      if (entry.via !== undefined) derivedVia.add(`${row.provider}\t${row.entrypoint}\t${entry.name}\t${entry.via}`);
    }
  }
  const live = committed.filter(
    (row) =>
      row.names.some((entry) => entry.via === undefined) ||
      row.names.some((entry) => derivedVia.has(`${row.provider}\t${row.entrypoint}\t${entry.name}\t${entry.via}`)),
  ).map((row) => ({
    ...row,
    names: row.names.filter(
      (entry) => entry.via === undefined || derivedVia.has(`${row.provider}\t${row.entrypoint}\t${entry.name}\t${entry.via}`),
    ),
  }));
  const byKey = new Map<string, Map<string, Map<string, "runtime" | "type">>>();
  for (const row of [...live, ...derived]) {
    const key = `${row.provider}\t${row.entrypoint}`;
    const names = byKey.get(key) ?? new Map<string, Map<string, "runtime" | "type">>();
    for (const entry of row.names) {
      const via = viaOf(entry);
      const kinds = names.get(entry.name) ?? new Map<string, "runtime" | "type">();
      const prev = kinds.get(via);
      if (prev === undefined || entry.kind === "runtime") kinds.set(via, entry.kind);
      names.set(entry.name, kinds);
    }
    byKey.set(key, names);
  }
  const out: ConsumerContract[] = [];
  for (const [key, names] of [...byKey.entries()].sort()) {
    const [provider, entrypoint] = key.split("\t") as [string, string];
    const flat: ContractName[] = [];
    for (const [name, kinds] of [...names.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const via of [...kinds.keys()].sort(
        (a, b) => VIA_ORDER.indexOf(a as (typeof VIA_ORDER)[number]) - VIA_ORDER.indexOf(b as (typeof VIA_ORDER)[number]),
      )) {
        const kind = kinds.get(via);
        if (kind === undefined) continue;
        flat.push(via === "specifier" ? { name, kind } : { name, kind, via: via as ContractVia });
      }
    }
    out.push({ provider, entrypoint, names: flat });
  }
  return out;
}

function main(): void {
  const root = repoRoot();
  const providers = discoverWorkspaceProviders(root);
  const consumers = consumersWithContracts(root);
  const allDirs = consumers.map((c) => c.dir);
  const only = process.argv[2];
  console.log(`providers: ${providers.size}, consumers: ${consumers.length}`);
  let internalPathReach = 0;
  for (const consumer of consumers) {
    if (only !== undefined && consumer.dir !== only) continue;
    const committed = readCommitted(root, consumer.dir);
    const specifier = collectContracts(root, consumer.dir, providers, allDirs);
    const ownTest = collectOwnTestContracts(root, consumer.dir, providers, allDirs);
    const pathReach = collectPathReachContracts(root, consumer.dir, providers, allDirs);
    internalPathReach += pathReach.internal;
    const derived = [...specifier, ...ownTest, ...pathReach.contracts];
    if (derived.length === 0 && committed.length === 0) {
      console.log(`${join(consumer.dir, "consumes.json")}: no workspace imports, no contract [${consumer.class}]`);
      continue;
    }
    const merged = mergeContracts(committed, derived);
    const rel = join(consumer.dir, "consumes.json");
    const full = join(root, rel);
    const isNew = !existsSync(full);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, `${JSON.stringify(merged, null, 2)}\n`);
    const names = merged.reduce((sum, c) => sum + c.names.length, 0);
    const ownNames = ownTest.reduce((sum, c) => sum + c.names.length, 0);
    const reachNames = pathReach.contracts.reduce((sum, c) => sum + c.names.length, 0);
    console.log(
      `${rel}: ${merged.length} entrypoints, ${names} names [${consumer.class}]`
      + ` (own-test ${ownNames}, path-reach ${reachNames})${isNew ? " NEW" : ""}`,
    );
  }
  console.log(`internal-path-reach: ${internalPathReach}`);
}

main();
