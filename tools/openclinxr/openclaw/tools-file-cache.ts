/**
 * Per-file result cache for run-tools-tests.ts.
 *
 * Before an area runs, every test file gets a content key; files whose key
 * has a recorded PASS are skipped, the rest run, and only files that passed
 * in THIS run are recorded. A failed file is never recorded and always
 * reruns. `--no-file-cache` disables read and write. One cache file per area
 * (turbo area tasks run concurrently, so a shared file would race).
 *
 * Key parts (each required; all must match for a skip):
 * K1: sha256 of every file in the test's import closure (importClosureOf
 *     from browser-boot-inventory.ts — the same closure that feeds turbo inputs).
 * K2: every repo path that appears as a string literal in any closure file
 *     and exists on disk. A file contributes its content hash; a directory
 *     contributes `git ls-files -s <dir>` plus mtimes of untracked files
 *     under it. (Tests read GLBs/JSON this way; a key over code alone would
 *     replay a pass after the asset it measured changed.)
 * K3: salt — the keying sources themselves (run-tools-tests.ts,
 *     tools-test-areas.ts, tools-file-cache.ts, vitest.config.ts, the root
 *     package.json), the node version, and the values of env vars matching
 *     ^(OPENCLINXR_|BLENDER).
 * K4 KNOWN GAP (not covered, by design): a path built at runtime — a
 *     template literal with substitutions, path.join of variables, or any
 *     other computed string — is not a static literal and is NOT in K2. A
 *     test that renames its data file AND updates only computed path code
 *     keeps a stale pass. Do not try to solve it here; expanding the key to
 *     dynamic values would require executing the test.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import { importClosureOf } from "../evidence/browser-boot-inventory.js";
import type { ToolsTestArea } from "./tools-test-areas.js";

export const FILE_CACHE_VERSION = 1;
export const FILE_CACHE_DIR_NAME = "openclinxr-tools-tests";

/** Salt sources, repo-relative. tools-file-cache.ts is included: it defines the key. */
export const SALT_FILES: readonly string[] = [
  "tools/openclinxr/openclaw/run-tools-tests.ts",
  "tools/openclinxr/openclaw/tools-test-areas.ts",
  "tools/openclinxr/openclaw/tools-file-cache.ts",
  "vitest.config.ts",
  "package.json",
];

export function cacheFileForArea(root: string, area: ToolsTestArea): string {
  return resolve(root, "node_modules", ".cache", FILE_CACHE_DIR_NAME, `file-cache-${area}.json`);
}

export interface FileCacheStore {
  version: number;
  entries: Record<string, string>;
}

export function loadFileCache(file: string): FileCacheStore {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<FileCacheStore>;
    if (parsed?.version === FILE_CACHE_VERSION && parsed.entries !== null && typeof parsed.entries === "object") {
      return { version: FILE_CACHE_VERSION, entries: { ...parsed.entries } };
    }
  } catch {
    // missing or corrupt: start empty, never fail the suite on cache I/O.
  }
  return { version: FILE_CACHE_VERSION, entries: {} };
}

/** Atomic write (tmp + rename) so a killed run never leaves half a cache. */
export function saveFileCache(file: string, store: FileCacheStore): void {
  try {
    mkdirSync(file.slice(0, file.lastIndexOf(sep)), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch {
    // Cache I/O never fails the suite.
  }
}

/** Salt over the keying sources, node version, and OPENCLINXR_/BLENDER env values. */
export function computeSalt(root: string, env: NodeJS.ProcessEnv = process.env, nodeVersion = process.version): string {
  const h = createHash("sha256");
  for (const rel of SALT_FILES) {
    try {
      h.update(readFileSync(resolve(root, rel)));
    } catch {
      h.update(`missing:${rel}`);
    }
    h.update("\0");
  }
  h.update(`node:${nodeVersion}\0`);
  for (const key of Object.keys(env).filter((k) => /^(OPENCLINXR_|BLENDER)/.test(k)).sort()) {
    h.update(`${key}=${env[key] ?? ""}\0`);
  }
  return h.digest("hex");
}

/** Static string literals only: plain "...", '...', and substitution-free `...`. */
export function extractStringLiterals(src: string, fileName = "key-scan.ts"): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Resolve a literal to a repo-absolute path, or null. Tried repo-relative
 * first, then relative to the containing file; results escaping the root
 * are rejected. (K4: computed paths never appear here.)
 */
export function resolveLiteralToRepoPath(literal: string, containingFile: string, root: string): string | null {
  const trimmed = literal.trim();
  if (trimmed === "") return null;
  const candidates = [resolve(root, trimmed), resolve(containingFile.slice(0, containingFile.lastIndexOf(sep)), trimmed)];
  for (const abs of candidates) {
    const rel = relative(root, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
    try {
      if (existsSync(abs)) return abs;
    } catch {
      // ignore
    }
  }
  return null;
}

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function gitOutput(args: readonly string[], root: string): string | null {
  try {
    return execFileSync("git", [...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

function fingerprintDirFallback(abs: string, root: string): string {
  const h = createHash("sha256");
  const walk = (dir: string): string[] => {
    let out: string[] = [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const full = `${dir}${sep}${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        out = out.concat(walk(full));
      } else if (e.isFile()) {
        out.push(full);
      }
    }
    return out;
  };
  for (const file of walk(abs).sort()) {
    try {
      const st = statSync(file);
      h.update(`${relative(root, file)}\0${st.size}\0${st.mtimeMs}\0`);
      h.update(readFileSync(file));
      h.update("\0");
    } catch {
      h.update(`unreadable:${relative(root, file)}\0`);
    }
  }
  return `fallback:${h.digest("hex")}`;
}

/** Fingerprint a data path: content hash for files, tracked-tree + untracked mtimes for dirs. */
export function fingerprintDataPath(abs: string, root: string): string {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return "missing";
  }
  if (st.isFile()) {
    try {
      return `file:${sha256File(abs)}`;
    } catch {
      return "missing";
    }
  }
  if (!st.isDirectory()) return "missing";
  const rel = relative(root, abs).split(sep).join("/");
  const tracked = gitOutput(["ls-files", "-s", "--", rel || "."], root);
  if (tracked === null) return fingerprintDirFallback(abs, root);
  const h = createHash("sha256");
  h.update(`tracked:${tracked}\0`);
  const untracked = gitOutput(["ls-files", "--others", "--exclude-standard", "--", rel || "."], root);
  if (untracked === null) return fingerprintDirFallback(abs, root);
  for (const line of untracked.split("\n").map((l) => l.trim()).filter((l) => l !== "")) {
    try {
      const mtime = statSync(resolve(root, line)).mtimeMs;
      h.update(`untracked:${line}\0${mtime}\0`);
    } catch {
      h.update(`untracked-unreadable:${line}\0`);
    }
  }
  return `dir:${h.digest("hex")}`;
}

export interface KeyContext {
  root: string;
  salt: string;
  fileHashes: Map<string, string>;
  dataPrints: Map<string, string>;
  literals: Map<string, string[]>;
  /** K2 kill switch for the destructive probe only; production always true. */
  includeDataPaths?: boolean;
}

export function createKeyContext(root: string, env: NodeJS.ProcessEnv = process.env): KeyContext {
  return {
    root,
    salt: computeSalt(root, env),
    fileHashes: new Map(),
    dataPrints: new Map(),
    literals: new Map(),
  };
}

function fileHash(abs: string, ctx: KeyContext): string {
  const hit = ctx.fileHashes.get(abs);
  if (hit !== undefined) return hit;
  let h: string;
  try {
    h = sha256File(abs);
  } catch {
    h = "unreadable";
  }
  ctx.fileHashes.set(abs, h);
  return h;
}

function fileLiterals(abs: string, ctx: KeyContext): string[] {
  const hit = ctx.literals.get(abs);
  if (hit !== undefined) return hit;
  let out: string[] = [];
  try {
    out = extractStringLiterals(readFileSync(abs, "utf8"), abs);
  } catch {
    out = [];
  }
  ctx.literals.set(abs, out);
  return out;
}

export interface FileKey {
  key: string;
  closureSize: number;
  dataPaths: number;
}

/** K1 + K2 + K3 content key for one test file. */
export function computeFileKey(absTestFile: string, ctx: KeyContext): FileKey {
  const h = createHash("sha256");
  h.update(`v:${FILE_CACHE_VERSION}\0salt:${ctx.salt}\0`);
  const closure = [...importClosureOf(absTestFile)].sort();
  h.update(`closure:${closure.length}\0`);
  for (const file of closure) {
    const rel = relative(ctx.root, file).split(sep).join("/");
    h.update(`${normalize(rel)}:${fileHash(file, ctx)}\0`);
  }
  let dataPaths = 0;
  if (ctx.includeDataPaths !== false) {
    const seen = new Set<string>();
    for (const file of closure) {
      for (const literal of fileLiterals(file, ctx)) {
        const resolved = resolveLiteralToRepoPath(literal, file, ctx.root);
        if (resolved === null || seen.has(resolved)) continue;
        seen.add(resolved);
        let print = ctx.dataPrints.get(resolved);
        if (print === undefined) {
          print = fingerprintDataPath(resolved, ctx.root);
          ctx.dataPrints.set(resolved, print);
        }
        if (print !== "missing") {
          dataPaths += 1;
          const rel = relative(ctx.root, resolved).split(sep).join("/");
          h.update(`data:${rel}:${print}\0`);
        }
      }
    }
  }
  return { key: h.digest("hex"), closureSize: closure.length, dataPaths };
}

export interface CachePlan {
  toRun: string[];
  skipped: string[];
}

/** Split area files into cached (recorded PASS under the same key) and to-run. */
export function partitionByCache(files: readonly string[], keys: Map<string, string>, store: FileCacheStore): CachePlan {
  const toRun: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (keys.get(f) !== undefined && store.entries[f] === keys.get(f)) skipped.push(f);
    else toRun.push(f);
  }
  return { toRun, skipped };
}

/**
 * Execution plan for one area. A null store is the `--no-file-cache` (or
 * filtered-write) path: everything runs, nothing is read or recorded.
 */
export function planExecution(
  files: readonly string[],
  keys: Map<string, string>,
  store: FileCacheStore | null,
): CachePlan {
  if (store === null) return { toRun: [...files], skipped: [] };
  return partitionByCache(files, keys, store);
}

export type VitestFileStatus = "passed" | "failed";

interface VitestJsonResult {
  name?: unknown;
  status?: unknown;
  assertionResults?: Array<{ status?: unknown }>;
}

/**
 * Per-file pass/fail from a vitest `--reporter=json --outputFile` report.
 * Files absent from the report (never ran) are omitted: no record.
 */
export function parseVitestJsonResults(jsonText: string, root: string): Map<string, VitestFileStatus> {
  const out = new Map<string, VitestFileStatus>();
  let parsed: { testResults?: VitestJsonResult[] };
  try {
    parsed = JSON.parse(jsonText) as { testResults?: VitestJsonResult[] };
  } catch {
    return out;
  }
  if (!Array.isArray(parsed.testResults)) return out;
  for (const r of parsed.testResults) {
    if (typeof r.name !== "string") continue;
    const rel = relative(root, r.name).split(sep).join("/");
    if (rel.startsWith("..")) continue;
    if (r.status === "passed" || r.status === "failed") {
      out.set(rel, r.status);
      continue;
    }
    if (Array.isArray(r.assertionResults) && r.assertionResults.length > 0) {
      out.set(rel, r.assertionResults.every((a) => a.status === "passed") ? "passed" : "failed");
    }
  }
  return out;
}
