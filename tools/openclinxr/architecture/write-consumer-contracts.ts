import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
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
 * plus any dir that already owns a consumes.json (contracts are sticky:
 * tools/openclinxr/asset-pipeline/makeclothes nests inside the asset-pipeline
 * area and stays its own consumer). File ownership is longest matching
 * prefix, so nested consumers carve out of their parents. Classes: apps/* →
 * runtime-app, packages/* → package, tools/openclinxr/evidence → evidence,
 * other tools → tools.
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

export type ContractName = { name: string; kind: "runtime" | "type" };

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

function readCommitted(root: string, consumerDir: string): ConsumerContract[] {
  const full = join(root, consumerDir, "consumes.json");
  try {
    return JSON.parse(readFileSync(full, "utf8")) as ConsumerContract[];
  } catch {
    return [];
  }
}

/**
 * Merge derived rows over the committed file. Derived names are added;
 * committed names are never removed (hand pins, e.g. dynamic-import types,
 * stay until a human trims them). Runtime kind dominates on conflict.
 */
export function mergeContracts(committed: ConsumerContract[], derived: ConsumerContract[]): ConsumerContract[] {
  const byKey = new Map<string, Map<string, "runtime" | "type">>();
  for (const row of [...committed, ...derived]) {
    const key = `${row.provider}\t${row.entrypoint}`;
    const names = byKey.get(key) ?? new Map<string, "runtime" | "type">();
    for (const entry of row.names) {
      const prev = names.get(entry.name);
      if (prev === undefined || entry.kind === "runtime") names.set(entry.name, entry.kind);
    }
    byKey.set(key, names);
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

function main(): void {
  const root = repoRoot();
  const providers = discoverWorkspaceProviders(root);
  const consumers = consumersWithContracts(root);
  const allDirs = consumers.map((c) => c.dir);
  const only = process.argv[2];
  console.log(`providers: ${providers.size}, consumers: ${consumers.length}`);
  for (const consumer of consumers) {
    if (only !== undefined && consumer.dir !== only) continue;
    const committed = readCommitted(root, consumer.dir);
    const derived = collectContracts(root, consumer.dir, providers, allDirs);
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
    console.log(`${rel}: ${merged.length} entrypoints, ${names} names [${consumer.class}]${isNew ? " NEW" : ""}`);
  }
}

main();
