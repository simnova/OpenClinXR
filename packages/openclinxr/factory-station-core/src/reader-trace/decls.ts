import * as ts from "typescript";

export const LIVE = 1;
export const STORED = 2;
export const TMP = 4;
/** Constant .glb path/actor NAME. NOT live bytes; only a read/sink result over PATH is LIVE. */
export const PATH = 8;
export const HEX64 = /^[0-9a-f]{64}$/;
export const PIN_FIELDS = new Set(["outputSha256", "sha256", "glbSha256", "assetSha256"]);
export const HASH_SINKS = new Set(["sha256File", "sha256Hex", "sha256Of", "hashFile"]);
export const FS_MODS = new Set(["fs", "node:fs", "node:fs/promises"]);
export const FS_NAMES = new Set(["readFileSync", "readFile"]);
export type FnLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
export interface ImportTarget { mod: string; imported: string | undefined }
export interface FileTables { named: Map<string, ImportTarget>; ns: Map<string, string>; req: Map<string, ImportTarget>; topFuncs: Map<string, ts.FunctionDeclaration>; topVars: Map<string, ts.VariableDeclaration> }
export interface Graph { texts: Map<string, string>; realOf: Map<string, string>; edges: Map<string, Map<string, string>>; tables: Map<string, FileTables> }
export interface State { checker: ts.TypeChecker; files: Map<string, ts.SourceFile>; realOf: Map<string, string>; edges: Map<string, Map<string, string>>; tables: Map<string, FileTables>; paramTaint: Map<FnLike, Map<string, number>>; retMemo: Map<FnLike, number>; active: Set<ts.Node>; busy: Set<ts.Node> }
export type CalleeKind = { kind: "fs-read" } | { kind: "sink" } | { kind: "assert-equal" } | { kind: "fn"; node: FnLike } | { kind: "other" };
export function isFnNode(t: ts.Node | undefined): t is FnLike {
  return t !== undefined && (ts.isFunctionDeclaration(t) || ts.isFunctionExpression(t) || ts.isArrowFunction(t) || ts.isMethodDeclaration(t));
}
const isFnInit = (n: ts.Node | undefined): n is ts.ArrowFunction | ts.FunctionExpression =>
  n !== undefined && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
function synDecl(name: string, id: ts.Node, s: State): ts.Node | undefined {
  let cur: ts.Node | undefined = id.parent;
  while (cur !== undefined) {
    if (ts.isFunctionLike(cur)) {
      for (const p of (cur as ts.SignatureDeclaration).parameters) if (ts.isIdentifier(p.name) && p.name.text === name) return p;
      if (ts.isSourceFile(cur)) break;
      cur = cur.parent;
      continue;
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const stmt of cur.statements) {
        if (ts.isVariableStatement(stmt)) for (const decl of stmt.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl;
        if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined && stmt.name.text === name) return stmt;
      }
    }
    cur = cur.parent;
  }
  const t = s.tables.get(id.getSourceFile().fileName);
  return t?.topVars.get(name) ?? t?.topFuncs.get(name);
}
export function declOf(id: ts.Identifier, s: State): ts.Node | undefined {
  try {
    const d = s.checker.getSymbolAtLocation(id)?.declarations?.[0];
    if (d !== undefined && !ts.isShorthandPropertyAssignment(d)) return d;
  } catch { /* fall through to syntactic lookup */ }
  return synDecl(id.text, id, s);
}
/** Import resolution follows relative re-exports (`export { x } from`, `export * from`)
 *  to the leaf helper (bounded, cycle-safe: a re-export cycle resolves to undefined). */
export function resolveImportDecl(fromProg: string, mod: string, imported: string, s: State, seen?: Set<string>): ts.Node | undefined {
  const target = s.edges.get(fromProg)?.get(mod);
  if (target === undefined) return undefined;
  const seenNow = seen ?? new Set<string>();
  const key = `${target}#${imported}`;
  if (seenNow.has(key)) return undefined;
  seenNow.add(key);
  const checked = s.files.get(target);
  if (checked !== undefined) {
    for (const stmt of checked.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined && stmt.name.text === imported) return stmt;
      if (ts.isVariableStatement(stmt)) for (const decl of stmt.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.name.text === imported) return isFnInit(decl.initializer) ? decl.initializer : decl;
    }
    for (const stmt of checked.statements) {
      if (!ts.isExportDeclaration(stmt) || stmt.moduleSpecifier === undefined || !ts.isStringLiteralLike(stmt.moduleSpecifier)) continue;
      if (stmt.exportClause === undefined) {
        const hit = resolveImportDecl(target, stmt.moduleSpecifier.text, imported, s, seenNow);
        if (hit !== undefined) return hit;
      } else if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (el.name.text !== imported) continue;
          const hit = resolveImportDecl(target, stmt.moduleSpecifier.text, el.propertyName?.text ?? el.name.text, s, seenNow);
          if (hit !== undefined) return hit;
        }
      }
    }
  }
  const tt = s.tables.get(target);
  const v = tt?.topVars.get(imported);
  if (v !== undefined) return isFnInit(v.initializer) ? v.initializer : v;
  return tt?.topFuncs.get(imported);
}
function fnOrOther(target: ts.Node | undefined): CalleeKind {
  return isFnNode(target) ? { kind: "fn", node: target } : { kind: "other" };
}
/** Aliased APIs: fs reads, named hash sinks, assert-likes, relative fns (relative wins over sink names).
 *  Local `const` aliases of an imported API (`const read = readFileSync`) resolve
 *  to the same kind (bounded, cycle-safe: `const a = b; const b = a;` is other). */
export function identCallee(name: string, id: ts.Identifier, s: State): CalleeKind {
  return identCalleeSeen(name, id, s, new Set<string>());
}
function identCalleeSeen(name: string, id: ts.Identifier, s: State, seen: Set<string>): CalleeKind {
  const key = `${id.getSourceFile().fileName}#${name}`;
  if (seen.has(key)) return { kind: "other" };
  seen.add(key);
  const file = id.getSourceFile().fileName;
  const named = s.tables.get(file)?.named.get(name) ?? s.tables.get(file)?.req.get(name);
  if (named !== undefined) {
    if (named.imported !== undefined && FS_MODS.has(named.mod) && FS_NAMES.has(named.imported)) return { kind: "fs-read" };
    if (named.mod.startsWith(".")) return fnOrOther(resolveImportDecl(file, named.mod, named.imported ?? name, s));
    if (HASH_SINKS.has(name) || (named.imported !== undefined && HASH_SINKS.has(named.imported))) return { kind: "sink" };
    if (named.imported !== undefined && /equal/i.test(named.imported)) return { kind: "assert-equal" };
    return { kind: "other" };
  }
  const decl = declOf(id, s);
  if (decl !== undefined) {
    if (isFnNode(decl)) return { kind: "fn", node: decl };
    if (ts.isVariableDeclaration(decl) && decl.initializer !== undefined) {
      if (isFnInit(decl.initializer)) return { kind: "fn", node: decl.initializer };
      if (ts.isIdentifier(decl.initializer)) return identCalleeSeen(decl.initializer.text, decl.initializer, s, seen);
    }
    if (!ts.isParameter(decl) && !ts.isBindingElement(decl) && decl.getSourceFile().fileName.endsWith("fs.d.ts") && FS_NAMES.has(name)) return { kind: "fs-read" };
  }
  if (HASH_SINKS.has(name)) return { kind: "sink" };
  if (/equal/i.test(name)) {
    const t = s.tables.get(file);
    if (t?.topFuncs.get(name) === undefined && t?.topVars.get(name) === undefined) return { kind: "assert-equal" };
  }
  const topFn = s.tables.get(file)?.topFuncs.get(name);
  if (topFn !== undefined) return { kind: "fn", node: topFn };
  const topVar = s.tables.get(file)?.topVars.get(name);
  if (topVar !== undefined && isFnInit(topVar.initializer)) return { kind: "fn", node: topVar.initializer };
  return { kind: "other" };
}
export function isFsReadCall(node: ts.CallExpression, s: State): boolean {
  const cal = node.expression;
  if (ts.isIdentifier(cal)) return identCallee(cal.text, cal, s).kind === "fs-read";
  if (!ts.isPropertyAccessExpression(cal) || !FS_NAMES.has(cal.name.text)) return false;
  let recv: ts.Expression = cal.expression;
  while (ts.isPropertyAccessExpression(recv) || ts.isParenthesizedExpression(recv) || ts.isAsExpression(recv) || ts.isSatisfiesExpression(recv) || ts.isNonNullExpression(recv)) recv = recv.expression;
  if (!ts.isIdentifier(recv) || recv.text === "Buffer" || recv.text === "Object") return false;
  const t = s.tables.get(node.getSourceFile().fileName);
  const req = t?.req.get(recv.text);
  if (req !== undefined) return req.imported === undefined ? FS_MODS.has(req.mod) : false;
  const ns = t?.ns.get(recv.text);
  if (ns !== undefined) return FS_MODS.has(ns);
  const decl = declOf(recv, s);
  if (decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined && ts.isCallExpression(decl.initializer)) {
    const rc = decl.initializer.expression;
    const a = decl.initializer.arguments[0];
    if (ts.isIdentifier(rc) && rc.text === "require" && a !== undefined && ts.isStringLiteralLike(a)) return FS_MODS.has(a.text);
    return false;
  }
  return true;
}
