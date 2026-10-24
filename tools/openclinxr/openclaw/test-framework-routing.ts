/**
 * test-framework-routing — send each related test file to its declared runner.
 *
 * RED (ph194): the pre-commit `test:touched` gate ran every related file under
 * `vitest related`. The related set for ordinary source edits can include
 * `tests/openclinxr/assembled-exam-learner-faculty.spec.ts`, a Playwright spec
 * that value-imports `test`/`expect`/`chromium` from the owned facade
 * `tools/openclinxr/evidence/lib/slotted-playwright-test.js` (which re-exports
 * `@playwright/test`). Vitest executes the spec body, so Playwright's
 * `test.describe.configure()` fires outside a Playwright run and the gate fails
 * with "Playwright Test did not expect test.describe.configure() to be called
 * here" — a framework mismatch, not a product failure.
 *
 * Verified CLI facts (installed 2026-10-24, do not guess flags):
 * - `vitest related --help` offers `--run`, `--passWithNoTests`, `--exclude`
 *   and NO `--filesOnly`/`--list` mode: `related` ALWAYS executes. Routing
 *   must therefore exclude non-Vitest files from the `related` invocation.
 * - `vitest list --help` offers `--filesOnly` (+ `--exclude`): glob-only
 *   discovery that never executes test bodies. Candidates are enumerated here.
 * - `playwright test --help` (1.59.1) takes positional `[test-filter...]`,
 *   offers `--list` (collect without running) and `--pass-with-no-tests`.
 *   The repo has no root `playwright.config.*`; the assembled spec
 *   self-bootstraps a local API + file sink, so `playwright test <paths>`
 *   from the repo root relies on defaults (no `-c` flag: config edits are
 *   out of scope) plus the spec's own bootstrap.
 * - `node --test` group keeps the run-tools-tests budgets exactly:
 *   `--import tsx --test --test-concurrency=2`, no `--test-force-exit`.
 *
 * Design (coverage-preserving, fail closed):
 * - Framework is decided per FILE by actual VALUE imports via the TypeScript
 *   AST (`typescript` is an existing root dep, same visitor discipline as
 *   run-tools-tests): bare `@playwright/test` (exact; subpaths such as
 *   `@playwright/test/reporter` are node-usable reporter utilities, not the
 *   test runner, so exact-match avoids misrouting) plus the canonical owned
 *   facade by PRECISE repo-relative path AND verified origin (the facade file
 *   itself must value-import `@playwright/test`; any other basename match is
 *   not the facade). `import type` / `export type` / inline `type` specifiers,
 *   comments, and string literals can never classify. Zero recognized imports
 *   defaults to `vitest` (the historical collector). Mixed frameworks
 *   (node+vitest, node+playwright, vitest+playwright), unreadable files, and
 *   an unverifiable facade import are ambiguous and THROW — never silently
 *   skipped or guessed.
 * - Vitest stays the authority for Vitest-group relatedness (aliases in
 *   `vitest.config.ts` resolve inside vitest only): the `related` run keeps
 *   its exact flags and simply gains `--exclude` entries for the non-Vitest
 *   candidates plus the unchanged known-red excludes. Node/Playwright
 *   relatedness is a transitive static reverse-import closure from the touched
 *   sources over the listed candidates; unresolvable bare specifiers (which
 *   include config aliases, invisible to static resolution) select
 *   conservatively so coverage can only over-approximate, never drop.
 *   Over-selected files are real committed tests; extra runs are safe.
 * - Every runner still runs when another fails; the group exit is the first
 *   nonzero code. Known-red paths are filtered out of node/playwright
 *   selection too (same JSON, no additions or removals) and still excluded
 *   from every vitest invocation exactly as before.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { builtinModules } from "node:module";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import * as ts from "typescript";

export type TestFramework = "vitest" | "node" | "playwright";

/** Exact bare specifier of the Playwright test runner. Subpaths excluded. */
export const PLAYWRIGHT_BARE_SPECIFIER = "@playwright/test";

/**
 * Canonical owned Playwright facade, extensionless repo-relative. The `.js`
 * suffix in source imports is the TS ESM-dual of the same `.ts` file.
 */
export const PLAYWRIGHT_FACADE_CANONICAL = "tools/openclinxr/evidence/lib/slotted-playwright-test";

const VITEST_BARE_SPECIFIER = "vitest";
const NODE_TEST_PREFIX = "node:test";

export class FrameworkRoutingError extends Error {
  readonly file: string;
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "FrameworkRoutingError";
    this.file = file;
  }
}

/** Per-file environment for pure source classification. */
export interface ClassifyEnv {
  /** Repo-relative dir of the importing file ("" for repo root). */
  importerDir: string;
  /**
   * True iff the extensionless repo-relative path is the canonical facade
   * with a verified `@playwright/test` origin. Anything else (basename
   * lookalikes, missing origin) must answer false so the caller can fail
   * closed on the ambiguous import.
   */
  isPlaywrightFacade: (resolvedRelNoExt: string) => boolean;
}

function specifierFramework(spec: string): TestFramework | null {
  if (spec === VITEST_BARE_SPECIFIER) return "vitest";
  if (spec === NODE_TEST_PREFIX || spec.startsWith(`${NODE_TEST_PREFIX}/`)) return "node";
  if (spec === PLAYWRIGHT_BARE_SPECIFIER) return "playwright";
  return null;
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?jsx?$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function stringLiteralOf(expr: ts.Expression | undefined): string | null {
  return expr !== undefined && ts.isStringLiteralLike(expr) ? expr.text : null;
}

/** True when an import/export declaration carries only type meanings. */
function isTypeOnlyImport(
  clause: ts.ImportClause | undefined,
  named: ts.NamedImportBindings | undefined,
): boolean {
  if (clause?.isTypeOnly === true) return true;
  if (named !== undefined && ts.isNamedImports(named)) {
    if (named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)) return true;
  }
  return false;
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const named = node.exportClause;
  if (named !== undefined && ts.isNamedExports(named)) {
    if (named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)) return true;
  }
  return false;
}

/**
 * Classify a test file's framework from its actual VALUE imports.
 * Type-only imports, comments, and string literals never classify. Mixed
 * frameworks throw (fail closed); no recognized framework defaults to vitest.
 */
export function classifyTestSource(sourceText: string, fileName: string, env: ClassifyEnv): TestFramework {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  let hasNode = false;
  let hasVitest = false;
  let hasPlaywright = false;
  const note = (f: TestFramework | null): void => {
    if (f === "node") hasNode = true;
    else if (f === "vitest") hasVitest = true;
    else if (f === "playwright") hasPlaywright = true;
  };
  const noteSpecifier = (spec: string): void => {
    const direct = specifierFramework(spec);
    if (direct !== null) {
      note(direct);
      return;
    }
    if (spec.startsWith(".")) {
      const resolved = resolveRelativeTarget(spec, env.importerDir);
      if (resolved !== null && env.isPlaywrightFacade(resolved)) note("playwright");
      else if (resolved !== null && resolved === PLAYWRIGHT_FACADE_CANONICAL) {
        throw new FrameworkRoutingError(
          fileName,
          `imports the canonical facade path without a verified ${PLAYWRIGHT_BARE_SPECIFIER} origin; refusing to guess`,
        );
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node.importClause, node.importClause?.namedBindings)) {
        const spec = stringLiteralOf(node.moduleSpecifier);
        if (spec !== null) noteSpecifier(spec);
      }
    } else if (ts.isExportDeclaration(node)) {
      if (!isTypeOnlyExport(node) && node.moduleSpecifier !== undefined) {
        const spec = stringLiteralOf(node.moduleSpecifier);
        if (spec !== null) noteSpecifier(spec);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ref.expression !== undefined) {
        const spec = stringLiteralOf(ref.expression);
        if (spec !== null) noteSpecifier(spec);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = stringLiteralOf(node.arguments[0]);
        if (spec !== null) noteSpecifier(spec);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const spec = stringLiteralOf(node.arguments[0]);
        if (spec !== null) noteSpecifier(spec);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const count = (hasNode ? 1 : 0) + (hasVitest ? 1 : 0) + (hasPlaywright ? 1 : 0);
  if (count > 1) {
    throw new FrameworkRoutingError(fileName, "imports multiple test frameworks; refusing to route silently");
  }
  if (hasNode) return "node";
  if (hasPlaywright) return "playwright";
  return "vitest";
}

/** Extensionless repo-relative normalization for path comparison. */
export function noExt(rel: string): string {
  return rel.replace(/\.(d\.ts|tsx|ts|mts|cts|jsx|js|mjs|cjs)$/, "");
}

/** Resolve a relative specifier against the importer dir (repo-relative). */
function resolveRelativeTarget(spec: string, importerDir: string): string | null {
  if (!spec.startsWith(".")) return null;
  const joined = normalize(join(importerDir, spec)).split(sep).join("/");
  const cleaned = joined.replace(/\/$/, "");
  if (cleaned.startsWith("..") || cleaned === "..") return null;
  return noExt(cleaned);
}

export interface FileCache {
  textOf: (absPath: string) => string;
  facadeVerified: boolean | null;
}

/** Read-through cache shared across one routing pass. */
export function createFileCache(): FileCache {
  const texts = new Map<string, string>();
  return {
    textOf: (absPath: string) => {
      const hit = texts.get(absPath);
      if (hit !== undefined) return hit;
      const text = readFileSync(absPath, "utf8");
      texts.set(absPath, text);
      return text;
    },
    facadeVerified: null,
  };
}

/**
 * Verify the canonical facade's ORIGIN: the facade source itself must carry a
 * value import (or value re-export) from the exact bare `@playwright/test`
 * specifier. A basename lookalike with no such origin is not the facade.
 */
export function facadeOriginReexportsPlaywright(root: string, cache?: FileCache): boolean {
  if (cache?.facadeVerified !== null && cache?.facadeVerified !== undefined) {
    return cache.facadeVerified;
  }
  let text: string;
  try {
    const abs = resolve(root, `${PLAYWRIGHT_FACADE_CANONICAL}.ts`);
    text = cache !== undefined ? cache.textOf(abs) : readFileSync(abs, "utf8");
  } catch {
    if (cache !== undefined) cache.facadeVerified = false;
    return false;
  }
  const sf = ts.createSourceFile("facade.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let ok = false;
  const visit = (node: ts.Node): void => {
    if (ok) return;
    if (ts.isImportDeclaration(node)) {
      if (
        !isTypeOnlyImport(node.importClause, node.importClause?.namedBindings) &&
        stringLiteralOf(node.moduleSpecifier) === PLAYWRIGHT_BARE_SPECIFIER
      ) {
        ok = true;
      }
    } else if (
      ts.isExportDeclaration(node) &&
      !isTypeOnlyExport(node) &&
      node.moduleSpecifier !== undefined &&
      stringLiteralOf(node.moduleSpecifier) === PLAYWRIGHT_BARE_SPECIFIER
    ) {
      ok = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (cache !== undefined) cache.facadeVerified = ok;
  return ok;
}

/**
 * Classify one file on disk. THROWS on unreadable files (fail closed: an
 * unclassifiable file must block the gate, never silently skip or guess).
 */
export function classifyTestFile(absPath: string, root: string, cache?: FileCache): TestFramework {
  let text: string;
  try {
    text = cache !== undefined ? cache.textOf(absPath) : readFileSync(absPath, "utf8");
  } catch (error) {
    throw new FrameworkRoutingError(
      relative(root, absPath),
      `cannot read test file for routing: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const rel = relative(root, absPath).split(sep).join("/");
  const env: ClassifyEnv = {
    importerDir: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
    isPlaywrightFacade: (resolved) =>
      resolved === PLAYWRIGHT_FACADE_CANONICAL && facadeOriginReexportsPlaywright(root, cache),
  };
  return classifyTestSource(text, absPath, env);
}

export interface FrameworkPartition {
  vitest: string[];
  node: string[];
  playwright: string[];
}

/**
 * Partition repo-relative files by framework. Disjoint and exhaustive over the
 * input; mixed/unreadable entries throw (no silent drops).
 */
export function partitionByFramework(filesRel: readonly string[], root: string, cache?: FileCache): FrameworkPartition {
  const out: FrameworkPartition = { vitest: [], node: [], playwright: [] };
  const seen = new Set<string>();
  const owned = cache ?? createFileCache();
  for (const rel of filesRel) {
    const key = normalize(rel).split(sep).join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = isAbsolute(rel) ? rel : resolve(root, rel);
    out[classifyTestFile(abs, root, owned)].push(key);
  }
  return out;
}

/** Raw value-import specifiers of a source file (type-only excluded). */
export function listValueImportSpecifiers(sourceText: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node.importClause, node.importClause?.namedBindings)) {
        const spec = stringLiteralOf(node.moduleSpecifier);
        if (spec !== null) specs.push(spec);
      }
    } else if (ts.isExportDeclaration(node)) {
      if (!isTypeOnlyExport(node) && node.moduleSpecifier !== undefined) {
        const spec = stringLiteralOf(node.moduleSpecifier);
        if (spec !== null) specs.push(spec);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ref.expression !== undefined) {
        const spec = stringLiteralOf(ref.expression);
        if (spec !== null) specs.push(spec);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = stringLiteralOf(node.arguments[0]);
        if (spec !== null) specs.push(spec);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const spec = stringLiteralOf(node.arguments[0]);
        if (spec !== null) specs.push(spec);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

function isNodeBuiltinSpecifier(spec: string): boolean {
  if (spec === "node:test" || spec.startsWith("node:")) return true;
  return (builtinModules as string[]).includes(spec);
}

/**
 * Default external-vs-internal probe for bare specifiers. Resolvable via the
 * repo's own node_modules (or a node builtin) means external: no graph edge.
 * Unresolvable bare specifiers include bundler aliases invisible to static
 * resolution and are treated as possibly-internal by the caller.
 */
export function defaultBareIsExternal(spec: string, root: string): boolean {
  if (isNodeBuiltinSpecifier(spec)) return true;
  try {
    const req = createRequire(join(root, "package.json"));
    req.resolve(spec);
    return true;
  } catch {
    return false;
  }
}

/** Probe a relative specifier against the repo-relative importer dir. */
export function resolveRelativeInternal(spec: string, importerDirRel: string): string | null {
  return resolveRelativeTarget(spec, importerDirRel);
}

export interface SelectEnv {
  root: string;
  cache?: FileCache;
  bareIsExternal?: (spec: string) => boolean;
  /**
   * Resolve a bare specifier from an importer dir to an absolute path, or
   * null when unresolvable. Defaults to node resolution from the repo root
   * (workspace links included). A resolved path inside the repo is a real
   * graph edge — including edges INTO touched files via workspace names.
   */
  resolveBare?: (spec: string, importerDirRel: string) => string | null;
}

function defaultResolveBare(spec: string, importerDirRel: string, root: string): string | null {
  try {
    const req = createRequire(join(root, importerDirRel, "package.json"));
    return req.resolve(spec);
  } catch {
    try {
      return createRequire(join(root, "package.json")).resolve(spec);
    } catch {
      return null;
    }
  }
}

function readCached(absPath: string, env: SelectEnv): string | null {
  try {
    return env.cache !== undefined ? env.cache.textOf(absPath) : readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Transitive static relatedness: true when `candidateRel` IS a touched file
 * or can reach one through relative imports (extension probes: exact,
 * `.ts`/`.tsx`, `.js`-dual→`.ts`, `/index.ts`). Bare specifiers that resolve
 * externally (node builtins, installed packages, `@playwright/test` itself)
 * are graph leaves; unresolvable bare specifiers (config aliases) select
 * conservatively — coverage over-approximates, never drops.
 */
export function reachesTouched(candidateRel: string, touchedNoExt: Set<string>, env: SelectEnv): boolean {
  const visiting = new Set<string>();
  const memo = new Map<string, boolean>();
  const isExternal = env.bareIsExternal ?? ((spec: string) => defaultBareIsExternal(spec, env.root));
  const resolveBare =
    env.resolveBare ?? ((spec: string, importerDir: string) => defaultResolveBare(spec, importerDir, env.root));

  const probeTargets = (spec: string, importerDir: string): string[] | "conservative" | null => {
    if (spec.startsWith(".")) {
      const base = resolveRelativeTarget(spec, importerDir);
      if (base === null) return null;
      const cands = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
      if (base.endsWith(".js")) cands.push(`${base.slice(0, -3)}.ts`);
      return cands;
    }
    if (spec === PLAYWRIGHT_BARE_SPECIFIER) return null;
    if (isExternal(spec)) {
      // Resolvable does not mean unrelated: a workspace bare specifier can
      // point at a touched file. Check the resolved repo-relative path.
      const abs = resolveBare(spec, importerDir);
      if (abs === null) return "conservative";
      const rel = relative(env.root, abs).split(sep).join("/");
      if (rel.startsWith("..") || isAbsolute(rel)) return null;
      return [rel];
    }
    return "conservative";
  };

  const visit = (rel: string): boolean => {
    const key = noExt(rel);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    if (touchedNoExt.has(key)) {
      memo.set(key, true);
      return true;
    }
    if (visiting.has(key)) {
      memo.set(key, false);
      return false;
    }
    visiting.add(key);
    let result = false;
    const text = readCached(resolve(env.root, rel), env);
    if (text === null) {
      result = true;
    } else {
      const importerDir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
      const specs = listValueImportSpecifiers(text, rel);
      const targets: string[] = [];
      for (const spec of specs) {
        const probed = probeTargets(spec, importerDir);
        if (probed === "conservative") {
          result = true;
          break;
        }
        if (probed !== null) targets.push(...probed);
      }
      if (!result) {
        for (const target of targets) {
          if (touchedNoExt.has(noExt(target))) {
            result = true;
            break;
          }
        }
      }
      if (!result) {
        for (const target of targets) {
          if (!existsSync(resolve(env.root, target))) continue;
          if (visit(target)) {
            result = true;
            break;
          }
        }
      }
    }
    visiting.delete(key);
    memo.set(key, result);
    return result;
  };

  return visit(candidateRel);
}

/**
 * Select the related subset of already-partitioned single-framework
 * candidates. Vitest-group relatedness stays with `vitest related`; this
 * feeds only the node/playwright runners that vitest must not execute.
 */
export function selectRelatedFiles(
  candidatesRel: readonly string[],
  touchedRel: readonly string[],
  env: SelectEnv,
): string[] {
  const touchedNoExt = new Set(touchedRel.map((t) => noExt(normalize(t).split(sep).join("/"))));
  const owned = env.cache ?? createFileCache();
  return candidatesRel.filter((c) =>
    reachesTouched(normalize(c).split(sep).join("/"), touchedNoExt, { ...env, cache: owned }),
  );
}

/** Parse `vitest list --filesOnly` stdout to repo-relative test paths. */
export function parseVitestFilesOnly(stdout: string, root: string): string[] {
  const ESC = String.fromCharCode(27);
  const TEST_FILE_RE = /(^|[./])(test|spec)\.[cm]?[jt]sx?$/;
  const out: string[] = [];
  for (const raw of stdout.split("\n")) {
    let line = raw;
    let idx = line.indexOf(ESC);
    while (idx !== -1) {
      const end = line.indexOf("m", idx);
      line = line.slice(0, idx) + (end === -1 ? "" : line.slice(end + 1));
      idx = line.indexOf(ESC);
    }
    const trimmed = line.trim();
    if (trimmed.length === 0 || !TEST_FILE_RE.test(trimmed)) continue;
    const abs = isAbsolute(trimmed) ? trimmed : resolve(root, trimmed);
    if (!existsSync(abs)) continue;
    out.push(relative(root, abs).split(sep).join("/"));
  }
  return out;
}

/**
 * `vitest list --filesOnly` discovery args. Flags verified against the
 * installed `vitest list --help` (4.1.5): `--filesOnly`, `--exclude`.
 */
export function buildVitestListArgs(excludesRel: readonly string[] = []): string[] {
  const args = ["list", "--filesOnly"];
  for (const e of excludesRel) args.push("--exclude", e);
  return args;
}

/**
 * `vitest related` execution args. Flags verified against the installed
 * `vitest related --help` (4.1.5): `--run`, `--passWithNoTests`, `--exclude`.
 * No list-only mode exists, so non-Vitest files must be excluded here.
 */
export function buildVitestRelatedArgs(sourcesRel: readonly string[], excludesRel: readonly string[]): string[] {
  const args = ["related", "--run", "--passWithNoTests"];
  for (const e of excludesRel) args.push("--exclude", e);
  args.push(...sourcesRel);
  return args;
}

/**
 * Playwright execution args. Verified against `playwright test --help`
 * (1.59.1): positional `[test-filter...]` selects files; no `-c` flag is
 * passed (the repo carries no root playwright config and config edits are
 * out of scope — the assembled spec self-bootstraps).
 */
export function buildPlaywrightTestArgs(filesRel: readonly string[]): string[] {
  return ["test", ...filesRel];
}

/**
 * Node:test execution args. Budgets mirror run-tools-tests exactly:
 * `--import tsx --test --test-concurrency=2`, no `--test-force-exit`.
 */
export function buildNodeTestArgs(filesAbs: readonly string[]): string[] {
  return ["--import", "tsx", "--test", "--test-concurrency=2", ...filesAbs];
}

/** First nonzero exit wins; every group still runs. */
export function combineGroupCodes(codes: readonly number[]): number {
  for (const code of codes) {
    if (code !== 0) return code;
  }
  return 0;
}

export interface KnownRedEntry {
  path: string;
  reason: string;
  card: string;
}

/**
 * Remove known-red paths from a node/playwright selection (repo-relative in,
 * same relativity out). The JSON list itself is never modified here.
 */
export function filterKnownRed(
  selectedRel: readonly string[],
  red: readonly KnownRedEntry[],
): { kept: string[]; excluded: string[] } {
  const redPaths = new Set(red.map((t) => t.path));
  const kept: string[] = [];
  const excluded: string[] = [];
  for (const f of selectedRel) {
    if (redPaths.has(f)) excluded.push(f);
    else kept.push(f);
  }
  return { kept, excluded };
}

export interface GroupExec {
  /** Discovery; THROW on failure (fail closed: never execute unrouted). */
  listFiles: (cmd: string[], cwd: string) => string;
  /** Execution; return exit code. */
  runGroup: (cmd: string[], cwd: string, opts?: { timeoutMs?: number }) => number;
}

export interface RouteRequest {
  root: string;
  /** Spawn cwd (repo root; `pnpm --filter` handles package chdir). */
  cwd: string;
  /** Human label for logs (e.g. "root", "@scope/pkg", "@scope/pkg[arch]"). */
  label: string;
  /** Vitest prefix, e.g. ["pnpm","exec","vitest"] or ["pnpm","--filter",pkg,"exec","vitest",...configArgs]. */
  vitestPrefix: string[];
  /** Owner-relative source filters for `related`. */
  sources: string[];
  /** Owner-relative red excludes for the vitest invocation. */
  redExcludes: string[];
  /** All known-red entries (repo-relative) for selection filtering. */
  redEntries: readonly KnownRedEntry[];
  /** Owner-relative candidates: when set, skips `list` discovery (tests). */
  candidatesOverride?: string[];
  /** Repo-relative touched sources for static node/playwright selection. */
  touchedRel: string[];
  /** Repo-relative candidate allowlist note: null = whole group. */
  ownerDir: string | null;
}

export interface RouteOutcome {
  code: number;
  vitestCode: number;
  nodeCode: number;
  playwrightCode: number;
  candidates: FrameworkPartition;
  selectedNode: string[];
  selectedPlaywright: string[];
  redExcludedFromRouted: string[];
  ranVitest: boolean;
  ranNode: boolean;
  ranPlaywright: boolean;
}

/** Serial-mode Playwright ceiling: the assembled spec sets 600s per test. */
export const PLAYWRIGHT_GROUP_TIMEOUT_MS = 900_000;

function toOwnerRel(repoRel: string, ownerDir: string | null): string {
  if (ownerDir === null) return repoRel;
  const prefix = `${ownerDir}/`;
  if (repoRel === ownerDir) return ".";
  if (repoRel.startsWith(prefix)) return repoRel.slice(prefix.length);
  return repoRel;
}

function toRepoRel(ownerRel: string, ownerDir: string | null): string {
  if (ownerDir === null) return ownerRel;
  if (ownerRel === ".") return ownerDir;
  return `${ownerDir}/${ownerRel}`;
}

/**
 * Route one execution group (root, package unit, or package arch):
 * list (no execution) → classify → vitest `related` with non-Vitest excludes
 * → node:test for selected node files → `playwright test` for selected
 * Playwright files. All groups run; first nonzero exit wins.
 */
export function routeRelatedGroup(req: RouteRequest, exec: GroupExec): RouteOutcome {
  const empty: RouteOutcome = {
    code: 0,
    vitestCode: 0,
    nodeCode: 0,
    playwrightCode: 0,
    candidates: { vitest: [], node: [], playwright: [] },
    selectedNode: [],
    selectedPlaywright: [],
    redExcludedFromRouted: [],
    ranVitest: false,
    ranNode: false,
    ranPlaywright: false,
  };
  if (req.sources.length === 0) return empty;
  const cache = createFileCache();
  let candidatesOwnerRel: string[];
  if (req.candidatesOverride !== undefined) {
    candidatesOwnerRel = [...req.candidatesOverride];
  } else {
    const stdout = exec.listFiles([...req.vitestPrefix, ...buildVitestListArgs()], req.cwd);
    candidatesOwnerRel = parseVitestFilesOnly(stdout, req.ownerDir === null ? req.root : resolve(req.root, req.ownerDir));
  }
  const candidatesRepoRel = candidatesOwnerRel.map((f) => toRepoRel(f, req.ownerDir));
  const candidates = partitionByFramework(candidatesRepoRel, req.root, cache);

  const selectEnv: SelectEnv = { root: req.root, cache };
  const selectedNodeRepo = selectRelatedFiles(candidates.node, req.touchedRel, selectEnv);
  const selectedPlaywrightRepo = selectRelatedFiles(candidates.playwright, req.touchedRel, selectEnv);
  const nodeFiltered = filterKnownRed(selectedNodeRepo, req.redEntries);
  const pwFiltered = filterKnownRed(selectedPlaywrightRepo, req.redEntries);
  const redExcludedFromRouted = [...nodeFiltered.excluded, ...pwFiltered.excluded];

  const nonVitestExcludes = [...nodeFiltered.kept, ...pwFiltered.kept].map((f) => toOwnerRel(f, req.ownerDir));
  const vitestArgs = [...req.vitestPrefix, ...buildVitestRelatedArgs(req.sources, [...req.redExcludes, ...nonVitestExcludes])];
  const vitestCode = exec.runGroup(vitestArgs, req.cwd);
  let nodeCode = 0;
  let playwrightCode = 0;
  let ranNode = false;
  let ranPlaywright = false;

  if (nodeFiltered.kept.length > 0) {
    ranNode = true;
    const abs = nodeFiltered.kept.map((f) => resolve(req.root, f));
    nodeCode = exec.runGroup([process.execPath, ...buildNodeTestArgs(abs)], req.cwd);
  }
  if (pwFiltered.kept.length > 0) {
    ranPlaywright = true;
    playwrightCode = exec.runGroup(["pnpm", "exec", "playwright", ...buildPlaywrightTestArgs(pwFiltered.kept)], req.root, {
      timeoutMs: PLAYWRIGHT_GROUP_TIMEOUT_MS,
    });
  }

  return {
    code: combineGroupCodes([vitestCode, nodeCode, playwrightCode]),
    vitestCode,
    nodeCode,
    playwrightCode,
    candidates,
    selectedNode: nodeFiltered.kept,
    selectedPlaywright: pwFiltered.kept,
    redExcludedFromRouted,
    ranVitest: true,
    ranNode,
    ranPlaywright,
  };
}

/** Real executor for test-touched (sync; discovery throws fail-closed). */
export function realGroupExec(env: NodeJS.ProcessEnv): GroupExec {
  return {
    listFiles: (cmd, cwd) => {
      try {
        return execFileSync(cmd[0] as string, cmd.slice(1), { cwd, encoding: "utf8", env });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new FrameworkRoutingError("<discovery>", `test discovery failed (${cmd.join(" ")}): ${detail}`);
      }
    },
    runGroup: (cmd, cwd, opts) => {
      try {
        const r = spawnSync(cmd[0] as string, cmd.slice(1), {
          cwd,
          stdio: "inherit",
          shell: false,
          env,
          timeout: opts?.timeoutMs,
          killSignal: "SIGTERM",
        });
        return r.status ?? 1;
      } catch {
        return 1;
      }
    },
  };
}
