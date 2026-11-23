import * as ts from "typescript";
import { assignSources, declOf, type FileTables, type FnLike, findAssign, type Graph, identCallee, isFnNode, isFsReadCall, LIVE, STORED, type State } from "./decls.js";
import { constString, findProp, pathTaintOf, T } from "./taint.js";

/** Post-export-stage accessor-digest reader trace (G1).
 * A row is MISLABELLED iff a comparison pairs a LIVE whole-GLB value
 * (bytes read via readFileSync/readFile, hashed whole or compared whole)
 * with a STORED pin (literal, constant, imported constant, JSON sidecar field).
 * Live-vs-live comparisons of the same run are exempt by origin.
 * Higher-order/callback flows (array.map(fn), function values) are NOT traced. */
export interface ReaderTraceFS {
  readText: (path: string) => string | undefined;
  resolveRelative: (from: string, spec: string) => string | undefined;
}
export const stripTxt = (p: string): string => (p.endsWith(".txt") ? p.slice(0, -4) : p);
function parseOK(text: string, name: string): boolean {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  return (((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics) ?? []).length === 0;
}
/** MISLABELLED verdict for one accessor-digest row against one reader file. */
export interface ReaderVerdict { mislabelled: boolean; reason: string; detail: string; parsed: boolean }
/** Whole live-GLB value compared to a stored pin. */
export const REASON_PIN = "whole-live-GLB value compared to a stored pin";
/** Whole live bytes compared to a stored buffer. */
export const REASON_BYTES = "whole live bytes compared to a stored buffer";
/** Live GLB hash compared to a sidecar pin. */
export const REASON_SIDECAR = "live GLB hash compared to a sidecar pin";
/** Reader is not TypeScript. */
export const REASON_LANGUAGE = "unsupported reader language";
/** Data row maps to no readers. */
export const REASON_EMPTY_MAP = "data row maps to no readers";
const REASON_UNMAPPED = "unmapped accessor-digest data row";
const REASON_UNREADABLE = "unreadable reader";
const MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);
const EQS = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
interface ScanHit { file: string; line: number; code: string; reason: string }
/* ---- import graph over the reader plus its relative imports ---- */
function recordTables(prog: string, text: string): FileTables {
  const t: FileTables = { named: new Map(), ns: new Map(), req: new Map(), topFuncs: new Map(), topVars: new Map() };
  for (const stmt of ts.createSourceFile(prog, text, ts.ScriptTarget.Latest, true).statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause !== undefined && ts.isStringLiteralLike(stmt.moduleSpecifier)) {
      const mod = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (clause.name !== undefined) t.ns.set(clause.name.text, mod);
      const b = clause.namedBindings;
      if (b !== undefined && ts.isNamespaceImport(b)) t.ns.set(b.name.text, mod);
      if (b !== undefined && ts.isNamedImports(b)) for (const el of b.elements) t.named.set(el.name.text, { mod, imported: el.propertyName === undefined ? el.name.text : el.propertyName.text });
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        const reqArg = init !== undefined && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require" ? init.arguments[0] : undefined;
        const reqMod = reqArg !== undefined && ts.isStringLiteralLike(reqArg) ? reqArg.text : undefined;
        if (reqMod !== undefined) {
          if (ts.isIdentifier(decl.name)) t.req.set(decl.name.text, { mod: reqMod, imported: undefined });
          if (ts.isObjectBindingPattern(decl.name)) for (const el of decl.name.elements) {
            if (!ts.isOmittedExpression(el) && ts.isIdentifier(el.name)) t.req.set(el.name.text, { mod: reqMod, imported: el.propertyName !== undefined && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text });
          }
        } else if (ts.isIdentifier(decl.name) && t.topVars.get(decl.name.text) === undefined) t.topVars.set(decl.name.text, decl);
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) t.topFuncs.set(stmt.name.text, stmt);
  }
  return t;
}
function collectGraph(entryReal: string, entryText: string, fs: ReaderTraceFS): Graph {
  const texts = new Map<string, string>();
  const realOf = new Map<string, string>();
  const edges = new Map<string, Map<string, string>>();
  const queue: string[] = [entryReal];
  const seen = new Set<string>([entryReal]);
  const pending = new Map<string, string>([[entryReal, entryText]]);
  while (queue.length > 0) {
    const real = queue.pop() as string;
    const text = pending.get(real) ?? fs.readText(real);
    if (text === undefined) continue;
    const prog = stripTxt(real);
    texts.set(prog, text);
    realOf.set(prog, real);
    const specs = new Map<string, string>();
    const visit = (node: ts.Node): void => {
      let spec: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) spec = node.moduleSpecifier.text;
      else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1) {
        const a = node.arguments[0];
        if (a !== undefined && ts.isStringLiteralLike(a)) spec = a.text;
      }
      if (spec?.startsWith(".")) {
        const target = fs.resolveRelative(real, spec);
        if (target !== undefined) {
          specs.set(spec, stripTxt(target));
          if (!seen.has(target)) {
            seen.add(target);
            queue.push(target);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(prog, text, ts.ScriptTarget.Latest, true));
    edges.set(prog, specs);
  }
  const tables = new Map<string, FileTables>();
  for (const [prog, text] of texts) tables.set(prog, recordTables(prog, text));
  return { texts, realOf, edges, tables };
}
function buildProgram(g: Graph): { checker: ts.TypeChecker; files: Map<string, ts.SourceFile> } {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const origGet = host.getSourceFile.bind(host);
  host.fileExists = (f) => g.texts.has(f) || ts.sys.fileExists(f);
  host.readFile = (f) => g.texts.get(f) ?? ts.sys.readFile(f);
  host.getSourceFile = (f, v, onErr, shouldCreate) => {
    const hit = g.texts.get(f);
    return hit !== undefined ? ts.createSourceFile(f, hit, v, true) : origGet(f, v, onErr, shouldCreate);
  };
  host.resolveModuleNames = (specs, containing) => specs.map((spec) => {
    if (spec.startsWith(".")) {
      const hit = g.edges.get(containing)?.get(spec);
      return hit !== undefined && g.texts.has(hit) ? { resolvedFileName: hit, extension: ts.Extension.Ts, isExternalLibraryImport: false } : undefined;
    }
    const r = ts.resolveModuleName(spec, containing, options, ts.sys).resolvedModule;
    return r === undefined ? undefined : { resolvedFileName: r.resolvedFileName, extension: r.extension, isExternalLibraryImport: r.isExternalLibraryImport ?? false };
  });
  const program = ts.createProgram([...g.texts.keys()], options, host);
  const files = new Map<string, ts.SourceFile>();
  for (const prog of g.texts.keys()) {
    const sf = program.getSourceFile(prog);
    if (sf !== undefined) files.set(prog, sf);
  }
  return { checker: program.getTypeChecker(), files };
}
/* ---- arg->param fixpoint, comparison scan, verdicts ---- */
function collectCallsites(s: State): Array<{ target: FnLike; args: readonly ts.Expression[] }> {
  const sites: Array<{ target: FnLike; args: readonly ts.Expression[] }> = [];
  for (const sf of s.files.values()) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const info = identCallee(node.expression.text, node.expression, s);
        if (info.kind === "fn") sites.push({ target: info.node, args: node.arguments });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}
function runFixpoint(s: State): void {
  const sites = collectCallsites(s);
  for (let pass = 0; pass < 12; pass++) {
    s.retMemo.clear();
    let changed = false;
    for (const site of sites) {
      const params = site.target.parameters;
      for (let i = 0; i < params.length && i < site.args.length; i++) {
        const p = params[i];
        const arg = site.args[i];
        if (p === undefined || arg === undefined || !ts.isExpression(arg) || !ts.isIdentifier(p.name)) continue;
        // A bare .glb NAME stays PATH (never LIVE): only a read/sink result over PATH upgrades (see Tcall).
        const t = T(arg, s) | pathTaintOf(arg, s);
        let m = s.paramTaint.get(site.target);
        if (m === undefined) {
          m = new Map();
          s.paramTaint.set(site.target, m);
        }
        if (((m.get(p.name.text) ?? 0) | t) !== (m.get(p.name.text) ?? 0)) {
          m.set(p.name.text, (m.get(p.name.text) ?? 0) | t);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  s.retMemo.clear();
}
/** The live operand is derived by the analyzed code (a read, hash, or sink call, or a const chain
 *  to one) rather than an opaque inflow: a bare parameter, or an alias chain ending at one,
 *  compared raw is a validator, not a pinning (e.g. the lash-ancestor lineage check takes
 *  liveSha256 plus a sidecar as parameters). */
function liveConstructed(node: ts.Expression, s: State): boolean {
  let cur: ts.Expression = node;
  const guard = new Set<string>();
  for (let g = 0; g < 25; g++) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isNonNullExpression(cur) || ts.isAwaitExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (!ts.isIdentifier(cur)) return true;
    const key = `${cur.getSourceFile().fileName}#${cur.getStart(cur.getSourceFile())}`;
    if (guard.has(key)) return true;
    guard.add(key);
    const d = declOf(cur, s);
    if (d === undefined || ts.isParameter(d)) return false;
    if (ts.isVariableDeclaration(d) && d.initializer !== undefined && ts.isExpression(d.initializer)) {
      cur = d.initializer;
      continue;
    }
    return true;
  }
  return true;
}
/** A caller-tainted parameter (H6): the call chain feeds this parameter a
 *  LIVE whole-GLB value. A validator that checks such input against another
 *  caller inflow (both sides are parameters) stays exempt; only a compare
 *  against a module-fixed pin is a pinning. Follows one alias chain, bounded. */
function paramCallerLive(node: ts.Expression, s: State): boolean {
  let cur: ts.Expression = node;
  const guard = new Set<string>();
  for (let g = 0; g < 25; g++) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isNonNullExpression(cur) || ts.isAwaitExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (!ts.isIdentifier(cur)) return false;
    const key = `${cur.getSourceFile().fileName}#${cur.getStart(cur.getSourceFile())}`;
    if (guard.has(key)) return false;
    guard.add(key);
    const d = declOf(cur, s);
    if (d !== undefined && ts.isParameter(d)) {
      const owner = isFnNode(d.parent) ? s.paramTaint.get(d.parent)?.get(cur.text) ?? 0 : 0;
      return (owner & LIVE) !== 0;
    }
    if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined || !ts.isExpression(d.initializer)) return false;
    cur = d.initializer;
  }
  return false;
}
/** Whether a derivation passes through a function parameter (a caller
 *  inflow rather than a module-fixed value). Bounded and cycle-safe. */
function storedThroughParam(node: ts.Expression, s: State): boolean {
  const seen = new Set<string>();
  const walk = (n: ts.Expression): boolean => {
    const key = `${n.getSourceFile().fileName}#${n.getStart()}#${n.getEnd()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n)) return walk(n.expression);
    if (ts.isIdentifier(n)) {
      const d = declOf(n, s);
      if (d !== undefined && ts.isParameter(d)) return true;
      return d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined && ts.isExpression(d.initializer) ? walk(d.initializer) : false;
    }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) return walk(n.expression);
    if (ts.isCallExpression(n)) return n.arguments.some((a) => ts.isExpression(a) && walk(a));
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return walk(n.left) || walk(n.right);
    return false;
  };
  return walk(node);
}
function storedViaSidecar(node: ts.Expression, s: State, seen: Set<string>): boolean {
  if (ts.isIdentifier(node)) {
    const key = `${node.getSourceFile().fileName}#${node.text}`;
    if (seen.has(key)) return false;
    const d = declOf(node, s);
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined && ts.isExpression(d.initializer)) {
      seen.add(key);
      return storedViaSidecar(d.initializer, s, seen);
    }
    const hit = findAssign(node.text, node.getSourceFile());
    if (hit === undefined) return false;
    seen.add(key);
    return storedViaSidecar(hit.src, s, seen);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return storedViaSidecar(node.expression, s, seen);
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "parse" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "JSON";
}
function isRawRead(node: ts.Expression, s: State, seen: Set<string>): boolean {
  if (ts.isCallExpression(node)) return isFsReadCall(node, s);
  if (ts.isIdentifier(node)) {
    const key = `${node.getSourceFile().fileName}#${node.text}`;
    if (seen.has(key)) return false;
    const d = declOf(node, s);
    if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined || !ts.isExpression(d.initializer)) return false;
    seen.add(key);
    return isRawRead(d.initializer, s, seen);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) return isRawRead(node.expression, s, seen);
  return false;
}
function checkPair(a: ts.Expression, b: ts.Expression, node: ts.Node, sf: ts.SourceFile, s: State, hits: ScanHit[], rowFile: string): void {
  const ta = T(a, s);
  const tb = T(b, s);
  if (!(((ta & LIVE) !== 0 && (tb & STORED) !== 0) || ((tb & LIVE) !== 0 && (ta & STORED) !== 0))) return;
  const storedSide = (ta & LIVE) !== 0 ? b : a;
  const liveSide = (ta & LIVE) !== 0 ? a : b;
  if (!liveConstructed(liveSide, s) && !(paramCallerLive(liveSide, s) && !storedThroughParam(storedSide, s))) return;
  if (rowFile.endsWith(".json") && !storedBoundToRow(storedSide, rowFile, s)) return;
  const reason = storedViaSidecar(storedSide, s, new Set()) ? "sidecar" : isRawRead(liveSide, s, new Set()) ? "bytes" : "pin";
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  hits.push({ file: sf.fileName, line: pos.line + 1, code: (sf.text.slice(node.getStart(sf), node.getEnd()).split("\n")[0] ?? "").trim(), reason });
}
/** A .json sidecar row pins its digest inside the row file, so a flagged
 *  comparison's STORED side must derive from a real read of that file. The
 *  binding is the read path, never a text or comment mention of the basename.
 *  Non-.json rows (reader/test files pinning inline) keep the literal rule. */
/** F7: a helper returning the sidecar pin binds the row through its returns,
 *  including relatively imported helpers. Cycle-safe via the walk seen set. */
function fnBound(fn: FnLike, s: State, walk: (n: ts.Expression) => boolean): boolean {
  if (fn.body === undefined) return false;
  if (!ts.isBlock(fn.body)) return ts.isExpression(fn.body) && walk(fn.body);
  let hit = false;
  const gather = (node: ts.Node): void => {
    if (hit || ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined && ts.isExpression(node.expression)) hit = walk(node.expression);
    if (!hit) ts.forEachChild(node, gather);
  };
  ts.forEachChild(fn.body, gather);
  return hit;
}
function storedBoundToRow(node: ts.Expression, rowFile: string, s: State): boolean {
  const seen = new Set<string>();
  const walk = (n: ts.Expression): boolean => {
    // Key includes the end offset: a property access shares its start offset
    // with its receiver (F1), and a start-only key drops a real sidecar read.
    const key = `${n.getSourceFile().fileName}#${n.getStart()}#${n.getEnd()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n)) return walk(n.expression);
    if (ts.isIdentifier(n)) {
      const d = declOf(n, s);
      if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined && ts.isExpression(d.initializer) && walk(d.initializer)) return true;
      for (const a of assignSources(n, s)) if (walk(a.src)) return true; // B1
      const hit = findAssign(n.text, n.getSourceFile());
      if (hit !== undefined) return walk(hit.src);
      return false;
    }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      // B2: follow the selected property into the sidecar read.
      const propKey = ts.isPropertyAccessExpression(n) ? n.name.text : (ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : undefined);
      if (propKey !== undefined && ts.isIdentifier(n.expression)) {
        const d = declOf(n.expression, s);
        if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined && ts.isExpression(d.initializer) && ts.isObjectLiteralExpression(d.initializer)) {
          const p = findProp(d.initializer, propKey);
          if (p !== undefined) return walk(p.initializer);
        }
      }
      return walk(n.expression);
    }
    if (ts.isCallExpression(n)) {
      if (isFsReadCall(n, s)) {
        const p = n.arguments[0];
        const lit = p !== undefined && ts.isExpression(p) ? constString(p, s, new Set()) : undefined;
        // Binding matches the resolved row path, never the bare basename (F2):
        // other/receipt.json must not bind to mapped proof/receipt.json.
        const row = rowFile.startsWith("./") ? rowFile.slice(2) : rowFile;
        const norm = lit !== undefined && lit.startsWith("./") ? lit.slice(2) : lit;
        if (norm !== undefined && (norm === row || norm.endsWith(`/${row}`))) return true;
      }
      if (ts.isIdentifier(n.expression)) {
        const k = identCallee(n.expression.text, n.expression, s);
        if (k.kind === "fn") {
          const fkey = `fn#${n.getSourceFile().fileName}#${n.getStart()}`;
          if (!seen.has(fkey)) {
            seen.add(fkey);
            if (fnBound(k.node, s, walk)) return true;
          }
        }
      }
      return n.arguments.some((a) => ts.isExpression(a) && walk(a));
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return walk(n.left) || walk(n.right);
    if (ts.isTemplateExpression(n)) return n.templateSpans.some((sp) => walk(sp.expression));
    return false;
  };
  return walk(node);
}
/* ---- call-shape dispatch: matchers, Buffer/Object comparisons, assert-likes ---- */
function checkCall(callee: ts.Expression, args: readonly ts.Expression[], node: ts.CallExpression, sf: ts.SourceFile, s: State, hits: ScanHit[], rowFile: string): void {
  if (ts.isPropertyAccessExpression(callee)) {
    const m = callee.name.text;
    if (MATCHERS.has(m)) {
      const recv = callee.expression;
      const base = ts.isPropertyAccessExpression(recv) && recv.name.text === "not" ? recv.expression : recv;
      if (ts.isCallExpression(base) && ts.isIdentifier(base.expression) && base.expression.text === "expect" && base.arguments.length > 0) {
        const a0 = base.arguments[0];
        const b0 = args[0];
        if (a0 !== undefined && b0 !== undefined && ts.isExpression(a0) && ts.isExpression(b0)) checkPair(a0, b0, node, sf, s, hits, rowFile);
      }
      return;
    }
    const a0 = args[0];
    const a1 = args[1];
    if ((m === "equals" || m === "compare" || m === "is") && a0 !== undefined && ts.isExpression(a0)) {
      const recv = callee.expression;
      if (ts.isExpression(recv) && !(ts.isIdentifier(recv) && (recv.text === "Buffer" || recv.text === "Object"))) checkPair(recv, a0, node, sf, s, hits, rowFile);
      else if (a1 !== undefined && ts.isExpression(a1)) checkPair(a0, a1, node, sf, s, hits, rowFile);
      return;
    }
    if (/equal/i.test(m) && a0 !== undefined && a1 !== undefined && ts.isExpression(a0) && ts.isExpression(a1)) checkPair(a0, a1, node, sf, s, hits, rowFile);
    return;
  }
  if (ts.isIdentifier(callee)) {
    const a0 = args[0];
    const a1 = args[1];
    if (a0 === undefined || a1 === undefined || !ts.isExpression(a0) || !ts.isExpression(a1)) return;
    if (identCallee(callee.text, callee, s).kind === "assert-equal") checkPair(a0, a1, node, sf, s, hits, rowFile);
  }
}
const REASONS = { pin: REASON_PIN, bytes: REASON_BYTES, sidecar: REASON_SIDECAR } as const;
/** One LIVE whole-GLB value compared to a STORED pin, with its source line. */
export interface ReaderCompare { file: string; line: number; code: string; reason: string }
/** Build the checker state for one reader (undefined when it has no program). */
function buildState(readerPath: string, text: string, fs: ReaderTraceFS): State | undefined {
  const graph = collectGraph(readerPath, text, fs);
  const built = buildProgram(graph);
  if (built.files.size === 0) return undefined;
  const s: State = { checker: built.checker, files: built.files, realOf: graph.realOf, edges: graph.edges, tables: graph.tables, paramTaint: new Map(), retMemo: new Map(), active: new Set(), busy: new Set() };
  runFixpoint(s);
  return s;
}
/** Every LIVE-vs-STORED comparison in the reader graph, in scan order. */
function scanCompares(rowFile: string, s: State): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const sf of s.files.values()) {
    const walk = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) {
        if (EQS.has(node.operatorToken.kind)) checkPair(node.left, node.right, node, sf, s, hits, rowFile);
      } else if (ts.isCallExpression(node)) checkCall(node.expression, node.arguments, node, sf, s, hits, rowFile);
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return hits;
}
/** Every flagged comparison for a row file plus field against one reader file. */
export function assessReaderCompares(rowFile: string, _field: string, readerPath: string, fs: ReaderTraceFS): ReaderCompare[] {
  const text = fs.readText(readerPath);
  if (text === undefined) return [];
  const stripped = stripTxt(readerPath);
  if (!stripped.endsWith(".ts") && !stripped.endsWith(".tsx")) return [];
  const s = buildState(readerPath, text, fs);
  if (s === undefined) return [];
  return scanCompares(rowFile, s).map((hit) => ({ file: s.realOf.get(hit.file) ?? hit.file, line: hit.line, code: hit.code, reason: REASONS[hit.reason as keyof typeof REASONS] }));
}
/** MISLABELLED verdict for a row file plus field against one reader file. */
export function assessReader(rowFile: string, field: string, readerPath: string, fs: ReaderTraceFS): ReaderVerdict {
  const text = fs.readText(readerPath);
  if (text === undefined) return { mislabelled: true, reason: REASON_UNREADABLE, detail: `${rowFile} :: ${field} (reader ${readerPath}): unreadable reader`, parsed: false };
  const stripped = stripTxt(readerPath);
  if (!stripped.endsWith(".ts") && !stripped.endsWith(".tsx")) return { mislabelled: true, reason: REASON_LANGUAGE, detail: `${rowFile} :: ${field} (reader ${readerPath}): unsupported reader language`, parsed: true };
  const parsed = parseOK(text, stripped);
  const s = buildState(readerPath, text, fs);
  if (s === undefined) return { mislabelled: true, reason: REASON_UNREADABLE, detail: `${rowFile} :: ${field} (reader ${readerPath}): unreadable reader`, parsed };
  const hits = scanCompares(rowFile, s);
  if (hits.length === 0) return { mislabelled: false, reason: "clean", detail: "", parsed };
  const hit = hits[0] as ScanHit;
  const display = s.realOf.get(hit.file) ?? hit.file;
  return { mislabelled: true, reason: REASONS[hit.reason as keyof typeof REASONS], detail: `${rowFile} :: ${field} (reader ${display}): line ${hit.line}: ${hit.code}`, parsed };
}
/** MISLABELLED verdict for a data row's reader mapping ([] and unmapped fail closed). */
export function assessDataRow(rowFile: string, field: string, readers: string[] | undefined): ReaderVerdict {
  if (readers === undefined) return { mislabelled: true, reason: REASON_UNMAPPED, detail: `UNMAPPED accessor-digest data row: ${rowFile} (add an explicit reader entry)`, parsed: true };
  if (readers.length === 0) return { mislabelled: true, reason: REASON_EMPTY_MAP, detail: `${rowFile} :: ${field}: data row maps to no readers`, parsed: true };
  return { mislabelled: false, reason: "clean", detail: "", parsed: true };
}
/** Names the data basename when a DATA_READERS-mapped reader never mentions it. */
export function mapProblem(dataFile: string, readerPath: string, readerText: string): string | undefined {
  const base = dataFile.split("/").pop() ?? dataFile;
  if (readerText.includes(base)) return undefined;
  return `MAP ENTRY ${dataFile} -> ${readerPath}: reader does not name the data file basename ${base}`;
}
