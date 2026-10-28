import { readFileSync } from "node:fs";
import path, { matchesGlob } from "node:path";
import * as ts from "typescript";

export const RUNNER_REL = "tools/openclinxr/openclaw/run-tools-tests.ts";
export const SCOPE_SUFFIX = "project-test-scope.ts";
export const MANUAL_NAME = "MANUAL_EXCLUDES";
export const ROOT_CONFIG_NAME = "ROOT_CONFIG_EXCLUDES";
export const ARCHIVE_NAME = "PROJECT_ARCHIVE_EXCLUDES";
export const SHARED_MODULE_NAME = "SHARED_EXCLUDES_MODULE";
export const SHARED_PATTERNS_NAME = "worktreeExcludePatterns";

export type InjectedSources = { packageJsonText?: string; runnerText?: string; sharedText?: string; scopeText?: string };

// Unwrap `[...] as const`, `<...>[...]`, `([...])` safely before literal check.
function unwrapLiteral(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isSatisfiesExpression(cur as ts.Expression)) { cur = (cur as ts.SatisfiesExpression).expression; continue; }
    return cur;
  }
}

// Top-level VariableStatements only; reject diagnostics/missing/duplicate/non-literal.
function exportedDecl(sf: ts.SourceFile, name: string, fileLabel: string): ts.VariableDeclaration {
  const diags = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  if (Array.isArray(diags) && diags.length > 0) throw new Error(`[exclusions] ${fileLabel}: parse error`);
  const found: ts.VariableDeclaration[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name) found.push(d);
    }
  }
  if (found.length === 0) throw new Error(`[exclusions] ${fileLabel}: exported ${name} not found`);
  if (found.length > 1) throw new Error(`[exclusions] ${fileLabel}: ambiguous ${name}`);
  const decl = found[0] as ts.VariableDeclaration;
  if (decl.initializer === undefined) throw new Error(`[exclusions] ${fileLabel}: ${name} missing initializer`);
  return decl;
}

/** AST-read an exported string-array literal. Throws fail-closed on missing/non-literal/ambiguous. */
export function readStringArrayLiteral(sourceText: string, constName: string, fileLabel: string): string[] {
  const sf = ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const raw = exportedDecl(sf, constName, fileLabel).initializer as ts.Expression;
  const init = unwrapLiteral(raw);
  if (!ts.isArrayLiteralExpression(init)) throw new Error(`[exclusions] ${fileLabel}: ${constName} is not an array literal`);
  const values: string[] = [];
  for (const el of init.elements) {
    const u = unwrapLiteral(el as ts.Expression);
    if (!ts.isStringLiteralLike(u)) throw new Error(`[exclusions] ${fileLabel}: ${constName} non-literal element`);
    values.push(u.text);
  }
  return [...new Set(values)].sort();
}

/** AST-read the SHARED_EXCLUDES_MODULE single-path string literal. */
export function readSharedModuleLiteral(runnerText: string): string {
  const sf = ts.createSourceFile(RUNNER_REL, runnerText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const raw = exportedDecl(sf, SHARED_MODULE_NAME, RUNNER_REL).initializer as ts.Expression;
  const init = unwrapLiteral(raw);
  if (!ts.isStringLiteralLike(init) || init.text.length === 0) {
    throw new Error(`[exclusions] ${RUNNER_REL}: ${SHARED_MODULE_NAME} must be a single path literal`);
  }
  return init.text;
}

/** Resolve a root-relative path, refusing escapes. */
export function resolveRootConfined(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const check = path.relative(root, abs);
  if (check.startsWith("..") || path.isAbsolute(check)) throw new Error(`[exclusions] path escapes root: ${rel}`);
  return abs;
}

/** True when a repo-relative file is covered by any pattern (glob via matchesGlob). */
export function isExcludedRepoRel(repoRel: string, patterns: readonly string[]): boolean {
  const rel = repoRel.split(path.sep).join("/");
  return patterns.some((p) => matchesGlob(rel, p));
}

// Derive actual project-scope module from a real TS ImportDeclaration AST binding.
function scopeImportPath(runnerText: string): string {
  const sf = ts.createSourceFile(RUNNER_REL, runnerText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteralLike(spec)) continue;
    const named = stmt.importClause?.namedBindings;
    if (named !== undefined && ts.isNamedImports(named)) {
      const binds = named.elements.some((e) => e.name.text === ARCHIVE_NAME || (e.propertyName?.text === ARCHIVE_NAME));
      if (!binds) continue;
      const raw = spec.text;
      if (!raw.startsWith(".")) throw new Error(`[exclusions] ${RUNNER_REL}: project scope import not relative`);
      const withTs = raw.replace(/\.js$/, ".ts");
      const scopeRel = path.posix.join(path.posix.dirname(RUNNER_REL), withTs);
      if (!scopeRel.endsWith(SCOPE_SUFFIX)) throw new Error(`[exclusions] unexpected scope path: ${scopeRel}`);
      return scopeRel;
    }
  }
  throw new Error(`[exclusions] ${RUNNER_REL}: project scope import not found`);
}

/** Tokenize a package.json script on whitespace (quote-aware) for canonical recognition. */
export function tokenizeScript(script: string): string[] {
  const raw = script.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return raw.map((t) => {
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
    return t;
  });
}

/**
 * EPOCH NOTE (2026-10-28): wrapper recognition is canonical command/token path,
 * never substring includes. An echo/comment mentioning the runner path must not
 * count as the runner; an unknown launcher must throw even with --exclude flags.
 */
function isCanonicalRunnerTokens(tokens: readonly string[]): boolean {
  let rest = [...tokens];
  if (rest[0] === "pnpm" || rest[0] === "npm" || rest[0] === "yarn") rest = rest.slice(1);
  if (rest[0] === "exec" || rest[0] === "x") rest = rest.slice(1);
  if (rest.length !== 2) return false;
  if (rest[0] !== "tsx") return false;
  const target = rest[1] as string;
  return target === RUNNER_REL || target === `./${RUNNER_REL}`;
}

/** Recognized direct Vitest forms: bare vitest or via pnpm/npm/npx/yarn exec (never pnpm run alias). */
function isDirectVitestTokens(tokens: readonly string[]): boolean {
  let rest = [...tokens];
  if (rest[0] === "pnpm" || rest[0] === "npm" || rest[0] === "npx" || rest[0] === "yarn") rest = rest.slice(1);
  if (rest[0] === "exec" || rest[0] === "x") rest = rest.slice(1);
  return rest[0] === "vitest";
}

/** Derive every exclusion pattern from actual wrapper sources. No execution/import. */
export function deriveExclusionPatterns(root: string, injected: InjectedSources = {}): string[] {
  const pkgText = injected.packageJsonText ?? readFileSync(path.join(root, "package.json"), "utf8");
  const script = (JSON.parse(pkgText) as { scripts?: Record<string, string> }).scripts?.["//#test:tools"] ?? "";
  const tokens = tokenizeScript(script);
  const legacy: string[] = [...script.matchAll(/--exclude\s+(\S+)/g)].map((m) => m[1]).filter((v): v is string => v !== undefined);
  const isRunner = isCanonicalRunnerTokens(tokens);
  const isVitest = isDirectVitestTokens(tokens);
  if (isRunner && legacy.length > 0) throw new Error("[exclusions] wrapper script must not carry --exclude flags");
  if (isVitest) return [...new Set(legacy)].sort();
  if (isRunner) {
  const runnerText = injected.runnerText ?? readFileSync(path.join(root, RUNNER_REL), "utf8");
  const manual = readStringArrayLiteral(runnerText, MANUAL_NAME, RUNNER_REL);
  const rootConfig = readStringArrayLiteral(runnerText, ROOT_CONFIG_NAME, RUNNER_REL);
  const sharedRel = readSharedModuleLiteral(runnerText);
  const sharedAbs = resolveRootConfined(root, sharedRel);
  const sharedText = injected.sharedText ?? readFileSync(sharedAbs, "utf8");
  const shared = readStringArrayLiteral(sharedText, SHARED_PATTERNS_NAME, sharedRel);
  const scopeRel = scopeImportPath(runnerText);
  resolveRootConfined(root, scopeRel);
  const scopeText = injected.scopeText ?? readFileSync(path.join(root, scopeRel), "utf8");
  const archives = readStringArrayLiteral(scopeText, ARCHIVE_NAME, scopeRel);
  return [...new Set([...manual, ...rootConfig, ...shared, ...archives])].sort();
  }
  throw new Error("[exclusions] unsupported //#test:tools script: neither --exclude flags nor wrapper");
}
