/**
 * Tools cruft ratchet (card CRUFT-GATE).
 *
 * knip.json lists `tools/**` as an ENTRY, so knip can never report a tools
 * file as unused, and tools `.py` files have no reachability check at all.
 * This gate computes TS/MJS + PY reachability over the tracked tree and
 * freezes the unreferenced sets in tools-cruft-baseline.json:
 *
 * - Rule A: the current unreferenced set must be a SUBSET of the HEAD
 *   baseline; any extra path fails naming it.
 * - Rule B (shrinks only): the HEAD baseline must be a subset of the BASE
 *   baseline (BASE = OPENCLINXR_CRUFT_BASE, else merge-base(HEAD,
 *   origin/main), else HEAD^1). A missing BASE baseline passes ONLY when the
 *   gate file is also absent at BASE (the bootstrap commit).
 *
 * Reachability (never runs or reads knip):
 * - TS/MJS: entry = package.json script paths + test files + manifest paths +
 *   files named by literal path or quoted basename in an EXECUTING REFERRER,
 *   closed over static import/export-from/dynamic import("literal") edges
 *   resolved like tsx (relative specifiers, .js->.ts mapping, index files).
 * - PY: entry = .py named by literal repo path or quoted basename in an
 *   executing referrer + manifest paths + test_*.py/*_test.py, closed over
 *   `import x`, `from x import`, `from .x import`, `from pkg.x import`,
 *   `importlib.import_module("x")`, and `python -m pkg.x` literals. An
 *   unresolvable module falls back to EVERY tracked tools .py with that
 *   basename (ambiguity makes files reachable, never unreachable).
 *
 * CLI: `tsx tools-cruft-gate.ts check` (default) |
 *      `tsx tools-cruft-gate.ts write-baseline`
 * Env: OPENCLINXR_CRUFT_ROOT (repo root, default cwd),
 *      OPENCLINXR_CRUFT_BASE (BASE ref override).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-roots.js";

export const GATE_RELPATH = "tools/openclinxr/openclaw/tools-cruft-gate.ts";
export const MANIFEST_RELPATH = "tools/openclinxr/openclaw/tools-entrypoints.json";
export const BASELINE_RELPATH = "tools/openclinxr/openclaw/tools-cruft-baseline.json";
export const GATE_TEST_RELPATH = "tools/openclinxr/openclaw/tools-cruft-gate.test.ts";
export const VULTURE_ABSENT_MESSAGE = "vulture not installed: run mise install";

/** Failure with a process exit code. 1 = rule failure, 2 = environment failure. */
export class CruftExit extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.name = "CruftExit";
    this.exitCode = exitCode;
  }
}

export function repoRootFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["OPENCLINXR_CRUFT_ROOT"];
  if (override !== undefined && override.trim() !== "") {
    return override;
  }
  return process.cwd();
}

function baseGitEnv(): NodeJS.ProcessEnv {
  return gitEnvWithoutInheritedRepoVars();
}

/** Run git, converting ANY failure into exit 2 naming the exact command. */
function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      env: baseGitEnv(),
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const firstLine = error instanceof Error ? error.message.split("\n")[0] : undefined;
    const detail = firstLine === undefined ? "unknown error" : firstLine;
    throw new CruftExit(2, `cruft-gate: git ${args.join(" ")} failed: ${detail}`);
  }
}

export function listTrackedFiles(root: string): string[] {
  const out = git(root, ["ls-files", "-z"]);
  return out.split("\0").map((s) => s.trim()).filter((s) => s.length > 0);
}

// ── File classification ────────────────────────────────────────────────────

const TOOLS_TS_RE = /\.(?:ts|tsx|mjs|mts|cts)$/;
const TEST_TS_RE = /\.(?:test|spec)\.(?:ts|tsx|mjs|mts|cts|js|jsx)$/;

export function isToolsTs(path: string): boolean {
  if (!path.startsWith("tools/")) {
    return false;
  }
  if (!TOOLS_TS_RE.test(path)) {
    return false;
  }
  if (path.endsWith(".d.ts")) {
    return false;
  }
  if (TEST_TS_RE.test(path)) {
    return false;
  }
  return true;
}

export function isToolsPy(path: string): boolean {
  if (!path.startsWith("tools/")) {
    return false;
  }
  if (!path.endsWith(".py")) {
    return false;
  }
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  if (base.startsWith("test_") || base.endsWith("_test.py")) {
    return false;
  }
  return true;
}

export function isTestTs(path: string): boolean {
  return TEST_TS_RE.test(path);
}

export function isTestPy(path: string): boolean {
  if (!path.endsWith(".py")) {
    return false;
  }
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  return base.startsWith("test_") || base.endsWith("_test.py");
}

const RUNBOOK_RE = /^docs\/openclinxr\/[^/]*runbook[^/]*\.md$/;

/**
 * EXECUTING REFERRER per the card: the only text that can make a tools file
 * reachable or validate a manifest entry. NOTE: `**` + `*.ts` is read
 * literally, so `.tsx` files are NOT referrers (flagged in RESULT; there are
 * currently zero `.tsx` files under tools/).
 */
export function isExecutingReferrer(path: string): boolean {
  if (path === "package.json") {
    return true;
  }
  if (path.startsWith(".github/workflows/")) {
    return true;
  }
  if (path.startsWith(".githooks/")) {
    return true;
  }
  if (path.endsWith(".sh")) {
    return true;
  }
  if (path.endsWith(".ts") || path.endsWith(".mjs")) {
    return true;
  }
  if (path.endsWith(".py")) {
    return true;
  }
  if (RUNBOOK_RE.test(path)) {
    return true;
  }
  return false;
}

const ALWAYS_EXCLUDED_REFERRERS = new Set<string>([
  MANIFEST_RELPATH,
  BASELINE_RELPATH,
  GATE_RELPATH,
  GATE_TEST_RELPATH,
]);

/** Referrers excluded even when they match: manifest, baseline, gate, gate test, .openclinxr/**, *-registry*.json. */
export function isReferrerExcluded(path: string): boolean {
  if (ALWAYS_EXCLUDED_REFERRERS.has(path)) {
    return true;
  }
  if (path.startsWith(".openclinxr/")) {
    return true;
  }
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  if (base.endsWith(".json") && base.includes("-registry")) {
    return true;
  }
  return false;
}

// ── Content cache ──────────────────────────────────────────────────────────

export type FileReader = (path: string) => string | undefined;

export function makeContentCache(root: string): FileReader {
  const cache = new Map<string, string>();
  return (path: string): string | undefined => {
    const hit = cache.get(path);
    if (hit !== undefined) {
      return hit;
    }
    try {
      const text = readFileSync(join(root, path), "utf8");
      cache.set(path, text);
      return text;
    } catch {
      return undefined;
    }
  };
}

// ── Strict (entry) mention scan ─────────────────────────────────────────────
// Entry naming uses path tokens (`tools/a/b.py` anywhere in the text,
// covering `path.join(HERE, "x.py")` callers) and QUOTED basenames
// (`"x.py"`). Unquoted bare words never count, so prose like STAGE_ID =
// "motion_bind_stage" (no extension) cannot entry a file. Manifest validation
// below is deliberately looser (plain substring containment).

const PATH_TOKEN_RE = /tools\/[A-Za-z0-9_@][A-Za-z0-9_@./-]*\.(?:ts|tsx|mjs|mts|cts|py)/g;
const QUOTED_BASENAME_RE = /["'`](?:\.\.?\/)*([A-Za-z0-9_@][A-Za-z0-9_@.-]*\.(?:ts|tsx|mjs|mts|cts|py))["'`]/g;

export function strictEntryMentions(text: string): { paths: string[]; basenames: string[] } {
  const paths: string[] = [];
  for (const m of text.matchAll(PATH_TOKEN_RE)) {
    paths.push(m[0]);
  }
  const basenames: string[] = [];
  for (const m of text.matchAll(QUOTED_BASENAME_RE)) {
    const name = m[1];
    if (name !== undefined) {
      basenames.push(name);
    }
  }
  return { paths, basenames };
}

/** Entry set from executing referrers (self-mentions excluded). */
/** Collect `const/let/var NAME = RHS` lines for dir-expression evaluation. */
export function collectTsDirVars(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);?\s*$/.exec(line);
    const name = m?.[1];
    const rhs = m?.[2];
    if (name === undefined || rhs === undefined) {
      continue;
    }
    if (!vars.has(name)) {
      vars.set(name, rhs);
    }
  }
  return vars;
}

/**
 * Evaluate a TS dir expression to a repo-relative dir: `__dirname`,
 * `import.meta.dirname`, `process.cwd()` (root), `path.dirname(...)` /
 * `fileURLToPath(...)` / `new URL(".", import.meta.url)` forms, string
 * literals (`tools/...` as-is, `./x` relative to the referrer), nested
 * `path.join()`, and plain variables from collectTsDirVars. Else undefined.
 */
export function evaluateTsDirExpr(
  expr: string,
  referrer: string,
  vars: Map<string, string>,
  depth: number,
): string | undefined {
  if (depth > 5) {
    return undefined;
  }
  const refDir = posix.dirname(referrer);
  const s = expr.trim();
  if (s === "__dirname" || s === "import.meta.dirname") {
    return refDir;
  }
  if (s === "process.cwd()") {
    return "";
  }
  const lit = stripQuotes(s);
  if (lit !== undefined) {
    if (lit.startsWith("tools/")) {
      return posix.normalize(lit.replace(/\/+$/g, ""));
    }
    if (lit.startsWith("./") || lit.startsWith("../")) {
      return posix.normalize(posix.join(refDir, lit));
    }
    return undefined;
  }
  if (/^path\.dirname\(\s*__filename\s*\)$/.test(s)) {
    return refDir;
  }
  if (/^fileURLToPath\(\s*import\.meta\.url\s*\)$/.test(s)) {
    return referrer;
  }
  if (/^path\.dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)$/.test(s)) {
    return refDir;
  }
  if (/^fileURLToPath\(\s*new\s+URL\(\s*["']\.\/?["']\s*,\s*import\.meta\.url\s*\)\s*\)$/.test(s)) {
    return refDir;
  }
  if (/^new\s+URL\(\s*["']\.\/?["']\s*,\s*import\.meta\.url\s*\)$/.test(s)) {
    return refDir;
  }
  const joinInner = /^(?:path\.)?join\((.*)\)$/su.exec(s)?.[1];
  if (joinInner !== undefined) {
    const parts = splitTopLevel(joinInner);
    const first = parts[0];
    if (first === undefined) {
      return undefined;
    }
    let base = evaluateTsDirExpr(first, referrer, vars, depth + 1);
    if (base === undefined) {
      return undefined;
    }
    for (const part of parts.slice(1)) {
      const seg = stripQuotes(part);
      if (seg === undefined) {
        return undefined;
      }
      base = posix.join(base, seg);
    }
    return posix.normalize(base);
  }
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(s)?.[0];
  if (ident !== undefined) {
    const assigned = vars.get(ident);
    if (assigned === undefined) {
      return undefined;
    }
    return evaluateTsDirExpr(assigned, referrer, vars, depth + 1);
  }
  return undefined;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * F2 qualifier: a NON-UNIQUE quoted basename admits a same-named tools file
 * only when the referrer qualifies it — same directory, or a
 * path.join/path.resolve/new-URL call whose evaluated dir resolves to it.
 * (A path literal ending in the file is already an entry via path tokens.)
 */
export function qualifiesTsBasename(
  text: string,
  referrer: string,
  vars: Map<string, string>,
  basename: string,
  candidate: string,
): boolean {
  if (posix.dirname(referrer) === posix.dirname(candidate)) {
    return true;
  }
  const esc = escapeRegExp(basename);
  const joinRe = /(?:path\s*\.\s*)?(join|resolve)\s*\(\s*([^,()]+?)\s*((?:,\s*["'][^"']*["']\s*)+)\)/g;
  for (const m of text.matchAll(joinRe)) {
    const dirExpr = m[2] ?? "";
    const lits = [...(m[3] ?? "").matchAll(/["']([^"']*)["']/g)].map((x) => x[1] ?? "");
    const last = lits[lits.length - 1];
    if (last !== basename) {
      continue;
    }
    const dirEval = evaluateTsDirExpr(dirExpr, referrer, vars, 0);
    if (dirEval === undefined) {
      continue;
    }
    let full = dirEval;
    for (const mid of lits.slice(0, -1)) {
      full = posix.join(full, mid);
    }
    if (posix.normalize(posix.join(full, basename)) === candidate) {
      return true;
    }
  }
  const urlRe = new RegExp(`new\\s+URL\\s*\\(\\s*["'](?:\\.\\/)?${esc}["']\\s*,`, "g");
  if (urlRe.test(text) && posix.join(posix.dirname(referrer), basename) === candidate) {
    return true;
  }
  return false;
}

/**
 * Entry set from executing referrers (self-mentions excluded). F2 rule: a
 * quoted basename admits a tools file ONLY when that basename is unique
 * among tracked tools .ts/.mjs/.py files, or the referrer qualifies it
 * (same directory, or a join/resolve/URL call resolving to it). Common
 * basenames (index.ts, cli.ts, ...) no longer admit families.
 */
export function entrySetFromReferrers(
  tracked: ReadonlySet<string>,
  referrers: readonly string[],
  read: FileReader,
): Set<string> {
  const byBasename = new Map<string, string[]>();
  for (const t of tracked) {
    if (!t.startsWith("tools/")) {
      continue;
    }
    if (!isToolsTs(t) && !isToolsPy(t)) {
      continue;
    }
    const slash = t.lastIndexOf("/");
    const base = slash === -1 ? t : t.slice(slash + 1);
    const arr = byBasename.get(base);
    if (arr === undefined) {
      byBasename.set(base, [t]);
    } else {
      arr.push(t);
    }
  }
  const entries = new Set<string>();
  for (const ref of referrers) {
    const text = read(ref);
    if (text === undefined) {
      continue;
    }
    const { paths, basenames } = strictEntryMentions(text);
    for (const p of paths) {
      if (p !== ref && tracked.has(p) && (isToolsTs(p) || isToolsPy(p))) {
        entries.add(p);
      }
    }
    const dirVars = collectTsDirVars(text);
    for (const b of new Set(basenames)) {
      // Uniqueness is computed over the FULL tracked family (referrer
      // included): a self-mention never admits a sibling. Filtering the
      // referrer out first would turn every 2-file family into a false
      // "unique" admission.
      const family = byBasename.get(b) ?? [];
      if (family.length === 0) {
        continue;
      }
      if (family.length === 1) {
        const only = family[0];
        if (only !== undefined && only !== ref) {
          entries.add(only);
        }
        continue;
      }
      for (const c of family) {
        if (c === ref) {
          continue;
        }
        if (qualifiesTsBasename(text, ref, dirVars, b, c)) {
          entries.add(c);
        }
      }
    }
  }
  return entries;
}

// ── TS/MJS import graph ────────────────────────────────────────────────────

const TS_FROM_RE = /\bfrom\s*["']([^"']+)["']/g;
const TS_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;
const TS_DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export function tsImportSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const re of [TS_FROM_RE, TS_IMPORT_RE, TS_DYNAMIC_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const spec = m[1];
      if (spec !== undefined) {
        out.push(spec);
      }
    }
  }
  return out;
}

/**
 * Resolve a TS specifier tsx-style. Returns the tracked path or undefined.
 * Supports only relative specifiers; bare/aliased imports resolve outside the
 * tracked tree and are ignored (named in FLAG in RESULT).
 */
export function resolveTsSpecifier(
  tracked: ReadonlySet<string>,
  importer: string,
  spec: string,
): string | undefined {
  if (!spec.startsWith(".")) {
    return undefined;
  }
  const dir = posix.dirname(importer);
  const rel = posix.normalize(posix.join(dir, spec));
  const cands: string[] = [];
  if (rel.endsWith(".jsx")) {
    cands.push(`${rel.slice(0, -4)}.tsx`);
  } else if (rel.endsWith(".js")) {
    const stem = rel.slice(0, -3);
    cands.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
  } else if (/\.(?:ts|tsx|mjs|mts|cts)$/.test(rel)) {
    cands.push(rel);
  } else {
    cands.push(`${rel}.ts`, `${rel}.tsx`, `${rel}.mjs`, `${rel}.mts`);
    cands.push(`${rel}/index.ts`, `${rel}/index.tsx`, `${rel}/index.mjs`);
  }
  for (const c of cands) {
    if (tracked.has(c)) {
      return c;
    }
  }
  return undefined;
}

// ── PY import graph ────────────────────────────────────────────────────────

const PY_IMPORT_RE = /^\s*import\s+([A-Za-z0-9_.]+(?:\s*,\s*[A-Za-z0-9_.]+)*)/gm;
const PY_FROM_RE = /^\s*from\s*(\.*)([A-Za-z0-9_.]*)\s+import\s+([^\n#;]+)/gm;
const PY_IMPORTLIB_RE = /(?:import_module|__import__)\s*\(\s*["']([^"']+)["']\s*\)/g;
const PY_MOD_FLAG_RE = /python3?\s+-m\s+([A-Za-z0-9_.]+)/g;

export interface PyImport {
  level: number;
  module: string;
  names: string[];
  raw: string;
}

/** How one py import resolved: exact search-dir hit, basename fallback, or nothing. */
export type PyResolutionMode = "direct" | "ambiguous-fallback" | "unresolved";

export interface PyImportResolution {
  raw: string;
  module: string;
  files: string[];
  mode: PyResolutionMode;
}

function cleanImportedName(token: string): string | undefined {
  const t = token.trim().replace(/^[()\\s]+|[()\\s,]+$/g, "");
  const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(t);
  return m?.[1];
}

/** All imports in one .py file (import/from/importlib/python -m in referrer text). */
export function pyImportsInFile(text: string): PyImport[] {
  const out: PyImport[] = [];
  for (const m of text.matchAll(PY_IMPORT_RE)) {
    const group = m[1];
    if (group === undefined) {
      continue;
    }
    for (const part of group.split(",")) {
      const name = part.trim().split(/\s+/)[0];
      if (name !== undefined && name.length > 0) {
        out.push({ level: 0, module: name, names: [], raw: m[0] });
      }
    }
  }
  for (const m of text.matchAll(PY_FROM_RE)) {
    const dots = m[1] ?? "";
    const mod = m[2] ?? "";
    const nameGroup = m[3] ?? "";
    const names: string[] = [];
    for (const part of nameGroup.split(",")) {
      const cleaned = cleanImportedName(part);
      if (cleaned !== undefined) {
        names.push(cleaned);
      }
    }
    out.push({ level: dots.length, module: mod, names, raw: m[0] });
  }
  for (const m of text.matchAll(PY_IMPORTLIB_RE)) {
    const mod = m[1];
    if (mod !== undefined) {
      out.push({ level: 0, module: mod, names: [], raw: m[0] });
    }
  }
  return out;
}

export function pyModuleFlagsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PY_MOD_FLAG_RE)) {
    const mod = m[1];
    if (mod !== undefined) {
      out.push(mod);
    }
  }
  return out;
}

const TOOLS_LITERAL_RE = /tools\/[A-Za-z0-9_@./-]+/g;

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";
  for (const ch of s) {
    if (quote !== undefined) {
      current += ch;
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
    }
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function stripQuotes(s: string): string | undefined {
  return /^["']([^"']*)["']$/.exec(s.trim())?.[1];
}

/**
 * Evaluate a sys.path argument to a repo-relative dir, honouring
 * `Path(__file__)`-relative and `os.path`-relative forms:
 *   sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
 *   sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "x"))
 *   sys.path.append(os.path.join(os.path.dirname(__file__), "x"))
 * plus str() unwrapping, `os.path.join()` nesting, and plain variables
 * assigned once elsewhere in the file (`X = <evaluable>`). Anything else
 * (bare literals, absolute paths, unknown calls like _repo_root()) returns
 * undefined and is left to the literal-superset scan below.
 */
export function evaluateSysPathExpr(
  expr: string,
  importerRel: string,
  vars: Map<string, string>,
  depth: number,
): string | undefined {
  if (depth > 6) {
    return undefined;
  }
  const s = expr.trim();
  const strInner = /^str\((.*)\)$/su.exec(s)?.[1];
  if (strInner !== undefined) {
    return evaluateSysPathExpr(strInner, importerRel, vars, depth + 1);
  }
  const lit = stripQuotes(s);
  if (lit !== undefined) {
    if (lit.startsWith("tools/")) {
      return posix.normalize(lit.replace(/\/+$/g, ""));
    }
    return undefined;
  }
  if (s === "__file__") {
    return importerRel;
  }
  const joinInner = /^os\.path\.join\((.*)\)$/su.exec(s)?.[1];
  if (joinInner !== undefined) {
    const parts = splitTopLevel(joinInner);
    const first = parts[0];
    if (first === undefined) {
      return undefined;
    }
    let base = evaluateSysPathExpr(first, importerRel, vars, depth + 1);
    if (base === undefined) {
      return undefined;
    }
    for (const part of parts.slice(1)) {
      const seg = stripQuotes(part);
      if (seg === undefined) {
        return undefined;
      }
      base = posix.join(base, seg);
    }
    return posix.normalize(base);
  }
  const dirnameInner = /^os\.path\.dirname\((.*)\)$/su.exec(s)?.[1];
  if (dirnameInner !== undefined) {
    const inner = evaluateSysPathExpr(dirnameInner, importerRel, vars, depth + 1);
    if (inner === undefined) {
      return undefined;
    }
    return posix.dirname(inner);
  }
  const pathChain = /^Path\s*\(\s*__file__\s*\)(.*)$/su.exec(s)?.[1];
  if (pathChain !== undefined) {
    const rest = pathChain.replace(/\.resolve\(\s*\)/g, "");
    let cur: string | undefined = importerRel;
    let tail = rest;
    const parentRe = /^\s*\.parent(?![A-Za-z0-9_])/;
    let parents = 0;
    for (;;) {
      const pm = parentRe.exec(tail);
      if (pm === null) {
        break;
      }
      if (cur === undefined) {
        return undefined;
      }
      cur = posix.dirname(cur);
      parents += 1;
      tail = tail.slice(pm[0].length);
    }
    const segs: string[] = [];
    const tailTrimmed = tail.trim();
    if (!/^(\/\s*["'][^"']*["']\s*)*$/.test(tailTrimmed)) {
      return undefined;
    }
    for (const sm of tailTrimmed.matchAll(/\/\s*["']([^"']*)["']/g)) {
      const seg = sm[1];
      if (seg !== undefined) {
        segs.push(seg);
      }
    }
    if (parents === 0 && segs.length === 0) {
      return undefined;
    }
    if (cur === undefined) {
      return undefined;
    }
    let out = cur;
    for (const seg of segs) {
      out = posix.join(out, seg);
    }
    return posix.normalize(out);
  }
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(s)?.[0];
  if (ident !== undefined) {
    const assigned = vars.get(ident);
    if (assigned === undefined) {
      return undefined;
    }
    return evaluateSysPathExpr(assigned, importerRel, vars, depth + 1);
  }
  return undefined;
}

function collectPyAssignments(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
    const name = m?.[1];
    const rhs = m?.[2];
    if (name === undefined || rhs === undefined) {
      continue;
    }
    if (name === "if" || name === "for" || name === "while" || name === "return" || name === "import") {
      continue;
    }
    vars.set(name, rhs);
  }
  return vars;
}

/** Repo-relative dirs from sys.path.insert/append/slice calls with evaluable args. */
export function evaluatedSysPathDirs(importerRel: string, text: string): string[] {
  const vars = collectPyAssignments(text);
  const dirs: string[] = [];
  const calls: string[] = [];
  const callRe = /sys\.path\s*\.\s*(insert|append)\s*\(/g;
  for (const cm of text.matchAll(callRe)) {
    const matchIndex = cm.index ?? 0;
    let depth = 0;
    let quote: string | undefined;
    let idx = matchIndex + cm[0].length;
    const start = idx;
    for (; idx < text.length; idx += 1) {
      const ch = text[idx] as string;
      if (quote !== undefined) {
        if (ch === quote) {
          quote = undefined;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      }
    }
    calls.push(text.slice(start, idx));
  }
  const sliceRe = /sys\.path\s*\[\s*:0?\s*\]\s*=\s*\[/g;
  for (const sm of text.matchAll(sliceRe)) {
    const matchIndex = sm.index ?? 0;
    let depth = 0;
    let quote: string | undefined;
    let idx = matchIndex + sm[0].length;
    const start = idx;
    for (; idx < text.length; idx += 1) {
      const ch = text[idx] as string;
      if (quote !== undefined) {
        if (ch === quote) {
          quote = undefined;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "[") {
        depth += 1;
      } else if (ch === "]") {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      }
    }
    calls.push(text.slice(start, idx));
  }
  for (const args of calls) {
    const parts = splitTopLevel(args);
    const exprs = parts.length >= 2 ? parts.slice(1) : parts;
    for (const expr of exprs) {
      const dir = evaluateSysPathExpr(expr, importerRel, vars, 0);
      if (dir !== undefined && dir !== "") {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

/**
 * Module search dirs for one importing file: its own dir, its package
 * ancestors, the repo root, every `tools/...` dir literal in its text, PLUS
 * dirs evaluated from `Path(__file__)`-relative / `os.path`-relative
 * sys.path inserts (F1). The literal superset stays as a conservative
 * backstop; the evaluated dirs are what make `importlib.import_module`
 * after a computed insert resolve DIRECT.
 */
export function pySearchDirs(importer: string, text: string): string[] {
  const dirs = new Set<string>();
  const own = posix.dirname(importer);
  dirs.add(own === "." ? "" : own);
  let cursor = own;
  while (cursor !== "." && cursor.includes("/")) {
    cursor = posix.dirname(cursor);
    dirs.add(cursor);
  }
  dirs.add("");
  for (const m of text.matchAll(TOOLS_LITERAL_RE)) {
    let lit = m[0].replace(/\/+$/g, "");
    if (lit.endsWith(".py")) {
      lit = posix.dirname(lit);
    }
    if (lit.length > 0) {
      dirs.add(lit);
    }
  }
  for (const dir of evaluatedSysPathDirs(importer, text)) {
    dirs.add(dir);
  }
  return [...dirs];
}

function addTrackedPy(found: Set<string>, trackedPy: ReadonlySet<string>, candidate: string): void {
  if (trackedPy.has(candidate)) {
    found.add(candidate);
  }
}

/**
 * Resolve one py import. Returns matched tracked tools .py files, HOW the
 * import resolved (exact search-dir hit vs basename fallback), and whether
 * the resolution was ambiguous (>1 file).
 */
export function resolvePyImport(
  trackedPy: ReadonlySet<string>,
  byBasename: ReadonlyMap<string, string[]>,
  searchDirs: readonly string[],
  importer: string,
  imp: PyImport,
): { files: string[]; mode: PyResolutionMode; ambiguous: boolean } {
  const found = new Set<string>();
  const joinDir = (dir: string, rest: string): string => (dir === "" ? rest : `${dir}/${rest}`);
  if (imp.level > 0) {
    let base = posix.dirname(importer);
    for (let i = 1; i < imp.level; i += 1) {
      base = posix.dirname(base);
    }
    if (imp.module !== "") {
      const rel = imp.module.split(".").join("/");
      addTrackedPy(found, trackedPy, joinDir(base, `${rel}.py`));
      addTrackedPy(found, trackedPy, joinDir(base, `${rel}/__init__.py`));
    } else {
      for (const n of imp.names) {
        addTrackedPy(found, trackedPy, joinDir(base, `${n}.py`));
        addTrackedPy(found, trackedPy, joinDir(base, `${n}/__init__.py`));
      }
    }
  } else if (imp.module !== "") {
    const rel = imp.module.split(".").join("/");
    for (const dir of searchDirs) {
      addTrackedPy(found, trackedPy, joinDir(dir, `${rel}.py`));
      addTrackedPy(found, trackedPy, joinDir(dir, `${rel}/__init__.py`));
    }
    for (const n of imp.names) {
      for (const dir of searchDirs) {
        addTrackedPy(found, trackedPy, joinDir(dir, `${rel}/${n}.py`));
        addTrackedPy(found, trackedPy, joinDir(dir, `${rel}/${n}/__init__.py`));
      }
    }
  }
  if (found.size >= 1) {
    return { files: [...found], mode: "direct", ambiguous: found.size > 1 };
  }
  // Basename fallback: EVERY tracked tools .py with the module basename.
  const keys = new Set<string>();
  if (imp.module !== "") {
    const parts = imp.module.split(".");
    const last = parts[parts.length - 1];
    if (last !== undefined && last !== "") {
      keys.add(`${last}.py`);
    }
  }
  for (const n of imp.names) {
    keys.add(`${n}.py`);
  }
  for (const key of keys) {
    const cands = byBasename.get(key);
    if (cands !== undefined) {
      for (const c of cands) {
        if (c !== importer) {
          found.add(c);
        }
      }
    }
  }
  if (found.size === 0) {
    return { files: [], mode: "unresolved", ambiguous: false };
  }
  return { files: [...found], mode: "ambiguous-fallback", ambiguous: found.size > 1 };
}

/**
 * Per-import resolution report for one .py file (used by T6 to assert HOW
 * an import resolved, not just the reachable set).
 */
export function analyzePyFileImports(root: string, importerRel: string): PyImportResolution[] {
  const trackedList = listTrackedFiles(root);
  const toolsPy = new Set(trackedList.filter((t) => t.startsWith("tools/") && t.endsWith(".py")));
  const byBasename = new Map<string, string[]>();
  for (const t of toolsPy) {
    const base = basenameOf(t);
    const arr = byBasename.get(base);
    if (arr === undefined) {
      byBasename.set(base, [t]);
    } else {
      arr.push(t);
    }
  }
  const text = readFileSync(join(root, importerRel), "utf8");
  const dirs = pySearchDirs(importerRel, text);
  return pyImportsInFile(text).map((imp) => {
    const resolved = resolvePyImport(toolsPy, byBasename, dirs, importerRel, imp);
    return { raw: imp.raw, module: imp.module, files: resolved.files, mode: resolved.mode };
  });
}

// ── Manifest ───────────────────────────────────────────────────────────────

export interface ManifestEntry {
  path: string;
  reason: string;
  referencedBy: string;
}

export function loadManifest(root: string): ManifestEntry[] {
  let text: string;
  try {
    text = readFileSync(join(root, MANIFEST_RELPATH), "utf8");
  } catch {
    return [];
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new CruftExit(1, `cruft-gate: ${MANIFEST_RELPATH} must be a JSON array`);
  }
  const out: ManifestEntry[] = [];
  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { path?: unknown }).path !== "string" ||
      typeof (item as { referencedBy?: unknown }).referencedBy !== "string" ||
      typeof (item as { reason?: unknown }).reason !== "string"
    ) {
      throw new CruftExit(1, `cruft-gate: ${MANIFEST_RELPATH} entry must be {path, reason, referencedBy} strings`);
    }
    const typed = item as { path: string; reason: string; referencedBy: string };
    out.push({ path: typed.path, reason: typed.reason, referencedBy: typed.referencedBy });
  }
  return out;
}

function basenameOf(p: string): string {
  const slash = p.lastIndexOf("/");
  return slash === -1 ? p : p.slice(slash + 1);
}

function referencedByClass(ref: string): string {
  if (ref === "package.json") {
    return "package.json";
  }
  if (ref.startsWith(".github/workflows/")) {
    return "workflow";
  }
  if (ref.startsWith(".githooks/")) {
    return "hook";
  }
  if (ref.endsWith(".sh")) {
    return "sh";
  }
  if (ref.endsWith(".mjs")) {
    return "mjs";
  }
  if (ref.endsWith(".py")) {
    return "py";
  }
  if (ref.endsWith(".ts")) {
    return "ts";
  }
  if (ref.endsWith(".md")) {
    return "runbook";
  }
  return "other";
}

/**
 * Validate manifest entries. A referencedBy must be a tracked EXECUTING
 * REFERRER (not excluded) whose text contains the entry path or, for .py,
 * its basename. Returns error strings (each naming the entry path).
 */
export function validateManifestEntries(
  manifest: readonly ManifestEntry[],
  tracked: ReadonlySet<string>,
  read: FileReader,
): string[] {
  const errors: string[] = [];
  for (const entry of manifest) {
    if (!tracked.has(entry.path) || (!isToolsTs(entry.path) && !isToolsPy(entry.path))) {
      errors.push(`manifest entry for ${entry.path} rejected: not a tracked tools .ts/.mjs/.py file`);
      continue;
    }
    if (entry.reason.trim().length === 0 || entry.reason.includes("\n")) {
      errors.push(`manifest entry for ${entry.path} rejected: reason must be a non-empty one-line string`);
      continue;
    }
    const ref = entry.referencedBy;
    if (!tracked.has(ref) || !isExecutingReferrer(ref) || isReferrerExcluded(ref) || ref === entry.path) {
      errors.push(`manifest entry for ${entry.path} rejected: referencedBy ${ref} is not an eligible executing referrer`);
      continue;
    }
    const text = read(ref);
    if (text === undefined) {
      errors.push(`manifest entry for ${entry.path} rejected: referencedBy ${ref} is unreadable`);
      continue;
    }
    const ok = text.includes(entry.path) || (entry.path.endsWith(".py") && text.includes(basenameOf(entry.path)));
    if (!ok) {
      errors.push(`manifest entry for ${entry.path} rejected: referencedBy ${ref} does not contain its path or basename`);
    }
  }
  return errors;
}

// ── Baseline ───────────────────────────────────────────────────────────────

export interface CruftBaseline {
  baseSha: string;
  unreferencedTs: string[];
  unreferencedPy: string[];
  vultureFindings: number;
}

export function parseBaseline(text: string, source: string): CruftBaseline {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new CruftExit(1, `cruft-gate: ${source} must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj["baseSha"] !== "string" ||
    !Array.isArray(obj["unreferencedTs"]) ||
    !Array.isArray(obj["unreferencedPy"]) ||
    typeof obj["vultureFindings"] !== "number"
  ) {
    throw new CruftExit(1, `cruft-gate: ${source} must be {baseSha, unreferencedTs, unreferencedPy, vultureFindings}`);
  }
  return {
    baseSha: obj["baseSha"] as string,
    unreferencedTs: obj["unreferencedTs"] as string[],
    unreferencedPy: obj["unreferencedPy"] as string[],
    vultureFindings: obj["vultureFindings"] as number,
  };
}

// ── Reachability ───────────────────────────────────────────────────────────

export interface Reachability {
  entries: string[];
  reachableTs: string[];
  reachablePy: string[];
  unreferencedTs: string[];
  unreferencedPy: string[];
  ambiguousPyResolutions: number;
  manifestTotal: number;
  manifestAlreadyReachable: number;
  referrerCount: number;
}

export function computeReachability(root: string, manifest: readonly ManifestEntry[]): Reachability {
  const trackedList = listTrackedFiles(root);
  const tracked = new Set<string>(trackedList);
  const read = makeContentCache(root);

  const referrers = trackedList.filter((t) => isExecutingReferrer(t) && !isReferrerExcluded(t));

  const entries = entrySetFromReferrers(tracked, referrers, read);
  for (const t of trackedList) {
    if ((isTestTs(t) || isTestPy(t)) && !isReferrerExcluded(t)) {
      entries.add(t);
    }
  }
  for (const entry of manifest) {
    if (tracked.has(entry.path) && (isToolsTs(entry.path) || isToolsPy(entry.path))) {
      entries.add(entry.path);
    }
  }

  // TS closure over every tracked ts-ish file.
  const tsUniverse = trackedList.filter((t) => TOOLS_TS_RE.test(t) && !t.endsWith(".d.ts"));
  const tsSet = new Set<string>(tsUniverse);
  const reachableTs = new Set<string>();
  const tsQueue: string[] = [];
  for (const e of entries) {
    if (tsSet.has(e) && !reachableTs.has(e)) {
      reachableTs.add(e);
      tsQueue.push(e);
    }
  }
  let tsCursor = 0;
  while (tsCursor < tsQueue.length) {
    const current = tsQueue[tsCursor];
    tsCursor += 1;
    if (current === undefined) {
      continue;
    }
    const text = read(current);
    if (text === undefined) {
      continue;
    }
    for (const spec of tsImportSpecifiers(text)) {
      const resolved = resolveTsSpecifier(tracked, current, spec);
      if (resolved !== undefined && tsSet.has(resolved) && !reachableTs.has(resolved)) {
        reachableTs.add(resolved);
        tsQueue.push(resolved);
      }
    }
  }

  // PY closure over every tracked .py file.
  const pyUniverse = trackedList.filter((t) => t.endsWith(".py"));
  const trackedPyTools = new Set<string>(pyUniverse.filter((t) => t.startsWith("tools/")));
  const pySet = new Set<string>(pyUniverse);
  const pyByBasename = new Map<string, string[]>();
  for (const t of trackedPyTools) {
    const base = basenameOf(t);
    const arr = pyByBasename.get(base);
    if (arr === undefined) {
      pyByBasename.set(base, [t]);
    } else {
      arr.push(t);
    }
  }
  const reachablePy = new Set<string>();
  const pyQueue: string[] = [];
  for (const e of entries) {
    if (pySet.has(e) && !reachablePy.has(e)) {
      reachablePy.add(e);
      pyQueue.push(e);
    }
  }
  // `python -m pkg.x` literals anywhere in referrer text resolve from the root.
  for (const ref of referrers) {
    const text = read(ref);
    if (text === undefined) {
      continue;
    }
    for (const mod of pyModuleFlagsInText(text)) {
      const rel = `${mod.split(".").join("/")}.py`;
      if (pySet.has(rel) && !reachablePy.has(rel)) {
        reachablePy.add(rel);
        pyQueue.push(rel);
      } else {
        const parts = mod.split(".");
        const last = parts[parts.length - 1];
        const cands = last === undefined ? undefined : pyByBasename.get(`${last}.py`);
        if (cands !== undefined) {
          for (const c of cands) {
            if (!reachablePy.has(c)) {
              reachablePy.add(c);
              pyQueue.push(c);
            }
          }
        }
      }
    }
  }
  let ambiguousPyResolutions = 0;
  let pyCursor = 0;
  while (pyCursor < pyQueue.length) {
    const current = pyQueue[pyCursor];
    pyCursor += 1;
    if (current === undefined) {
      continue;
    }
    const text = read(current);
    if (text === undefined) {
      continue;
    }
    const searchDirs = pySearchDirs(current, text);
    for (const imp of pyImportsInFile(text)) {
      const { files, ambiguous } = resolvePyImport(trackedPyTools, pyByBasename, searchDirs, current, imp);
      if (ambiguous) {
        ambiguousPyResolutions += 1;
      }
      for (const f of files) {
        if (pySet.has(f) && !reachablePy.has(f)) {
          reachablePy.add(f);
          pyQueue.push(f);
        }
      }
    }
  }
  // __init__.py of a reachable module's package is reachable.
  for (const f of [...reachablePy]) {
    let dir = posix.dirname(f);
    while (dir !== "." && dir !== "") {
      const init = `${dir}/__init__.py`;
      if (trackedPyTools.has(init) && !reachablePy.has(init)) {
        reachablePy.add(init);
      }
      if (!dir.includes("/")) {
        break;
      }
      dir = posix.dirname(dir);
    }
  }

  const unreferencedTs = trackedList
    .filter((t) => isToolsTs(t) && !reachableTs.has(t))
    .sort();
  const unreferencedPy = trackedList
    .filter((t) => isToolsPy(t) && !reachablePy.has(t))
    .sort();

  // Manifest entries already reached without the manifest (informational; P2):
  // recompute the entry set WITHOUT manifest paths: an entry counts as
  // already-reachable when the referrer/test scan alone names it.
  const refOnly = entrySetFromReferrers(tracked, referrers, read);

  for (const t of trackedList) {
    if ((isTestTs(t) || isTestPy(t)) && !isReferrerExcluded(t)) {
      refOnly.add(t);
    }
  }
  let alreadyReachable = 0;
  for (const m of manifest) {
    if (refOnly.has(m.path)) {
      alreadyReachable += 1;
    }
  }
  return {
    entries: [...entries].sort(),
    reachableTs: [...reachableTs].filter((t) => t.startsWith("tools/")).sort(),
    reachablePy: [...reachablePy].filter((t) => t.startsWith("tools/")).sort(),
    unreferencedTs,
    unreferencedPy,
    ambiguousPyResolutions,
    manifestTotal: manifest.length,
    manifestAlreadyReachable: alreadyReachable,
    referrerCount: referrers.length,
  };
}

// ── Vulture ────────────────────────────────────────────────────────────────

/**
 * Resolve the vulture command: the mise-resolved path first, else the
 * `mise exec pipx:vulture@2.14 -- vulture` form (probed with --version).
 * Neither resolving exits 2 with the install message.
 */
export function resolveVultureCommand(root: string): string[] {
  try {
    const out = execFileSync("mise", ["which", "vulture"], {
      cwd: root,
      encoding: "utf8",
      env: baseGitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const first = out
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (first?.startsWith("/")) {
      return [first];
    }
  } catch {
    // fall through to the exec form
  }
  const probe = spawnSync("mise", ["exec", "pipx:vulture@2.14", "--", "vulture", "--version"], {
    cwd: root,
    encoding: "utf8",
    env: baseGitEnv(),
  });
  if (probe.error !== undefined || probe.status !== 0) {
    throw new CruftExit(2, VULTURE_ABSENT_MESSAGE);
  }
  return ["mise", "exec", "pipx:vulture@2.14", "--", "vulture"];
}

export function runVultureOnce(root: string, pyFiles: readonly string[]): number {
  if (pyFiles.length === 0) {
    console.log("tools-cruft: vulture findings: 0 (no reachable py files)");
    return 0;
  }
  const cmd = resolveVultureCommand(root);
  const bin = cmd[0];
  if (bin === undefined) {
    throw new CruftExit(2, VULTURE_ABSENT_MESSAGE);
  }
  const proc = spawnSync(bin, [...cmd.slice(1), ...pyFiles], {
    cwd: root,
    encoding: "utf8",
    env: baseGitEnv(),
    maxBuffer: 256 * 1024 * 1024,
  });
  const spawnError = proc.error;
  if (spawnError !== undefined) {
    const code =
      "code" in spawnError && typeof (spawnError as { code?: unknown }).code === "string"
        ? String((spawnError as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") {
      throw new CruftExit(2, VULTURE_ABSENT_MESSAGE);
    }
    throw new CruftExit(2, `cruft-gate: vulture failed to start (${code}): ${spawnError.message}`);
  }
  const out = typeof proc.stdout === "string" ? proc.stdout : "";
  const count = out.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  console.log(`tools-cruft: vulture findings: ${count}`);
  return count;
}

// ── BASE resolution + ref reads ────────────────────────────────────────────

export function resolveBaseRef(root: string, override?: string): string {
  if (override !== undefined && override.trim() !== "") {
    const ref = override.trim();
    // NOTE: `git rev-parse --verify <40-hex>` echoes raw hex WITHOUT
    // checking existence, so verify with cat-file first (names the command
    // in the exit-2 error either way).
    git(root, ["cat-file", "-e", `${ref}^{commit}`]);
    return git(root, ["rev-parse", "--verify", ref]);
  }
  const merged = git(root, ["merge-base", "HEAD", "origin/main"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  if (merged === head) {
    return git(root, ["rev-parse", "HEAD^1"]);
  }
  return merged;
}

/** Read a path at a ref: file content, or undefined when absent at that ref. */
export function readAtRef(root: string, ref: string, relPath: string): string | undefined {
  const listing = git(root, ["ls-tree", ref, "--", relPath]);
  if (listing.trim() === "") {
    return undefined;
  }
  return git(root, ["show", `${ref}:${relPath}`]);
}

// ── Product share ──────────────────────────────────────────────────────────

const SHARE_EXT_RE = /\.(?:ts|tsx|mjs|py)$/;
const SHARE_TEST_RE = /\.(?:test|spec)\.[a-z]+$/;

function isShareFile(path: string): boolean {
  if (!SHARE_EXT_RE.test(path)) {
    return false;
  }
  if (SHARE_TEST_RE.test(path)) {
    return false;
  }
  if (path.endsWith(".d.ts")) {
    return false;
  }
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  if (base.startsWith("test_") || base.endsWith("_test.py")) {
    return false;
  }
  return true;
}

export function computeProductShare(
  trackedList: readonly string[],
  read: FileReader,
): { numerator: number; denominator: number } {
  let numerator = 0;
  let denominator = 0;
  for (const t of trackedList) {
    if (!isShareFile(t)) {
      continue;
    }
    const text = read(t);
    if (text === undefined) {
      continue;
    }
    const lines = text.split("\n").length;
    denominator += lines;
    if (t.startsWith("packages/") || t.startsWith("apps/")) {
      numerator += lines;
    }
  }
  return { numerator, denominator };
}

// ── Check ──────────────────────────────────────────────────────────────────

export interface CheckStats {
  exitCode: number;
  unreferencedTs: string[];
  unreferencedPy: string[];
  vultureFindings: number;
  ambiguousPyResolutions: number;
}

export function runCheck(root: string, baseOverride?: string): CheckStats {
  const trackedList = listTrackedFiles(root);
  const tracked = new Set<string>(trackedList);
  const read = makeContentCache(root);
  const manifest = loadManifest(root);

  const manifestErrors = validateManifestEntries(manifest, tracked, read);
  if (manifestErrors.length > 0) {
    for (const e of manifestErrors) {
      console.log(`tools-cruft: ${e}`);
    }
    throw new CruftExit(1, `cruft-gate: ${manifestErrors.length} manifest entr${manifestErrors.length === 1 ? "y" : "ies"} invalid`);
  }

  const reach = computeReachability(root, manifest);
  console.log(`tools-cruft: referrers scanned: ${reach.referrerCount}`);
  console.log(`tools-cruft: entries: ${reach.entries.length}`);
  console.log(`tools-cruft: unreferenced ts=${reach.unreferencedTs.length} py=${reach.unreferencedPy.length}`);
  console.log(`tools-cruft: ambiguousPyResolutions=${reach.ambiguousPyResolutions}`);
  const byClass = new Map<string, number>();
  for (const m of manifest) {
    const cls = referencedByClass(m.referencedBy);
    byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
  }
  const classPairs = [...byClass.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(
    `tools-cruft: manifest total=${manifest.length} alreadyReachable=${reach.manifestAlreadyReachable}${classPairs.length > 0 ? ` byClass: ${classPairs}` : ""}`,
  );

  const vultureFindings = runVultureOnce(root, reach.reachablePy);

  const share = computeProductShare(trackedList, read);
  const ratio = share.denominator === 0 ? 0 : share.numerator / share.denominator;
  console.log(`tools-cruft: productShare ${ratio.toFixed(3)} (${share.numerator}/${share.denominator} lines)`);

  let baselineText: string;
  try {
    baselineText = readFileSync(join(root, BASELINE_RELPATH), "utf8");
  } catch {
    throw new CruftExit(1, `cruft-gate: ${BASELINE_RELPATH} missing: run write-baseline first`);
  }
  const headBaseline = parseBaseline(baselineText, BASELINE_RELPATH);

  // Rule A: current must be a SUBSET of the HEAD baseline.
  const headTs = new Set<string>(headBaseline.unreferencedTs);
  const headPy = new Set<string>(headBaseline.unreferencedPy);
  const extras: string[] = [];
  for (const p of reach.unreferencedTs) {
    if (!headTs.has(p)) {
      extras.push(p);
    }
  }
  for (const p of reach.unreferencedPy) {
    if (!headPy.has(p)) {
      extras.push(p);
    }
  }
  if (extras.length > 0) {
    for (const p of extras.sort()) {
      console.log(`tools-cruft: new unreferenced tools file: ${p}`);
    }
    throw new CruftExit(1, `cruft-gate: ${extras.length} new unreferenced tools file(s)`);
  }

  // Rule B: HEAD baseline must be a subset of the BASE baseline (shrinks only).
  const baseRef = resolveBaseRef(root, baseOverride);
  console.log(`tools-cruft: base ${baseRef}`);
  const baseBaselineText = readAtRef(root, baseRef, BASELINE_RELPATH);
  if (baseBaselineText === undefined) {
    const baseGate = readAtRef(root, baseRef, GATE_RELPATH);
    if (baseGate === undefined) {
      console.log("tools-cruft: bootstrap: no baseline or gate at BASE; Rule B passes");
    } else {
      throw new CruftExit(
        1,
        `cruft-gate: ${BASELINE_RELPATH} absent at ${baseRef} while the gate exists at ${baseRef}`,
      );
    }
  } else {
    const baseBaseline = parseBaseline(baseBaselineText, `${baseRef}:${BASELINE_RELPATH}`);
    const baseSet = new Set<string>([...baseBaseline.unreferencedTs, ...baseBaseline.unreferencedPy]);
    const added: string[] = [];
    for (const p of [...headBaseline.unreferencedTs, ...headBaseline.unreferencedPy]) {
      if (!baseSet.has(p)) {
        added.push(p);
      }
    }
    if (added.length > 0) {
      for (const p of added.sort()) {
        console.log(`tools-cruft: HEAD baseline path absent at BASE: ${p}`);
      }
      throw new CruftExit(1, `cruft-gate: ${added.length} HEAD baseline path(s) absent at BASE ${baseRef}`);
    }
  }

  console.log("tools-cruft: check PASS");
  return {
    exitCode: 0,
    unreferencedTs: reach.unreferencedTs,
    unreferencedPy: reach.unreferencedPy,
    vultureFindings,
    ambiguousPyResolutions: reach.ambiguousPyResolutions,
  };
}

export function runWriteBaseline(root: string): CruftBaseline {
  const manifest = loadManifest(root);
  const reach = computeReachability(root, manifest);
  const vultureFindings = runVultureOnce(root, reach.reachablePy);
  const head = git(root, ["rev-parse", "HEAD"]);
  const baseline: CruftBaseline = {
    baseSha: head,
    unreferencedTs: reach.unreferencedTs,
    unreferencedPy: reach.unreferencedPy,
    vultureFindings,
  };
  writeFileSync(join(root, BASELINE_RELPATH), `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`tools-cruft: baseline written at ${head}: ts=${reach.unreferencedTs.length} py=${reach.unreferencedPy.length} vulture=${vultureFindings}`);
  return baseline;
}

async function main(): Promise<void> {
  const root = repoRootFromEnv();
  const cmd = process.argv[2] ?? "check";
  const baseOverride = process.env["OPENCLINXR_CRUFT_BASE"];
  try {
    if (cmd === "check") {
      runCheck(root, baseOverride);
    } else if (cmd === "write-baseline") {
      runWriteBaseline(root);
    } else {
      console.error(`cruft-gate: unknown command '${cmd}' (expected check|write-baseline)`);
      process.exitCode = 2;
    }
  } catch (error) {
    if (error instanceof CruftExit) {
      console.error(error.message);
      process.exitCode = error.exitCode;
    } else {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
