import * as ts from "typescript";
import { declOf, type FnLike, HEX64, identCallee, isFnNode, isFsReadCall, LIVE, PATH, PIN_FIELDS, resolveImportDecl, STORED, type State, TMP } from "./decls.js";

export function findProp(obj: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = p.name;
    if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)) && key.text === name) return p;
  }
  return undefined;
}
const asExpr = (n: ts.Node | undefined): ts.Expression | undefined => (n !== undefined && ts.isExpression(n) ? n : undefined);
function resolveInit(expr: ts.Expression, s: State): ts.Expression | undefined {
  if (!ts.isIdentifier(expr)) return expr;
  const decl = declOf(expr, s);
  return decl !== undefined && ts.isVariableDeclaration(decl) ? asExpr(decl.initializer) : undefined;
}
function childTmp(node: ts.Expression, s: State, seen: Set<string>): boolean {
  let found = false;
  ts.forEachChild(node, function visit(child: ts.Node): void {
    if (!found && ts.isExpression(child) && isTmp(child, s, seen)) found = true;
  });
  return found;
}
function isTmp(node: ts.Expression, s: State, seen: Set<string>): boolean {
  if (ts.isCallExpression(node)) {
    const cal = node.expression;
    const name = ts.isIdentifier(cal) ? cal.text : ts.isPropertyAccessExpression(cal) ? cal.name.text : undefined;
    if (name === "tmpdir" || name === "mkdtempSync" || name === "mkdtemp") return true;
    return node.arguments.some((a) => ts.isExpression(a) && isTmp(a, s, seen));
  }
  if (ts.isIdentifier(node)) {
    const key = `${node.getSourceFile().fileName}#${node.text}`;
    if (seen.has(key)) return false;
    const init = resolveInit(node, s);
    if (init === undefined) return false;
    seen.add(key);
    return isTmp(init, s, seen);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isNonNullExpression(node)) return isTmp(node.expression, s, seen);
  return childTmp(node, s, seen);
}
/** Constant path strings: literals, concatenation, templates, join/resolve tails, array/record entries. */
export function constString(node: ts.Expression, s: State, seen: Set<string>): string | undefined {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return constString(node.expression, s, seen);
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const part = constString(span.expression, s, seen);
      if (part === undefined) return undefined;
      out += part + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = constString(node.left, s, seen);
    const r = constString(node.right, s, seen);
    return l !== undefined && r !== undefined ? l + r : undefined;
  }
  if (ts.isIdentifier(node)) {
    const key = `${node.getSourceFile().fileName}#${node.text}`;
    if (seen.has(key)) return undefined;
    const init = resolveInit(node, s);
    if (init === undefined) return undefined;
    // Enter/exit (F4): a shared initializer reached twice is a diamond, not a
    // cycle. A true cycle still terminates: re-entry nests while active.
    seen.add(key);
    try {
      return constString(init, s, seen);
    } finally {
      seen.delete(key);
    }
  }
  if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
    const key = `${node.getSourceFile().fileName}#${node.getStart()}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    try {
      return containerString(node, node.expression, s, seen);
    } finally {
      seen.delete(key);
    }
  }
  if (ts.isCallExpression(node)) {
    const cal = node.expression;
    const name = ts.isIdentifier(cal) ? cal.text : ts.isPropertyAccessExpression(cal) ? cal.name.text : undefined;
    if ((name === "join" || name === "resolve") && node.arguments.length > 0) {
      const last = node.arguments[node.arguments.length - 1];
      if (last !== undefined && ts.isExpression(last)) return constString(last, s, seen);
    }
  }
  return undefined;
}
function containerString(node: ts.ElementAccessExpression | ts.PropertyAccessExpression, recv: ts.Expression, s: State, seen: Set<string>): string | undefined {
  const base = resolveInit(recv, s);
  if (base === undefined) return undefined;
  const key = ts.isElementAccessExpression(node)
    ? (node.argumentExpression !== undefined && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined)
    : node.name.text;
  if (key === undefined) {
    if (ts.isElementAccessExpression(node) && ts.isArrayLiteralExpression(base) && node.argumentExpression !== undefined && ts.isNumericLiteral(node.argumentExpression)) {
      const el = base.elements[Number(node.argumentExpression.text)];
      if (el !== undefined && ts.isExpression(el) && !ts.isSpreadElement(el)) return constString(el, s, seen);
    }
    return undefined;
  }
  const src = ts.isArrayLiteralExpression(base) ? (/^\d+$/.test(key) ? base.elements[Number(key)] : undefined) : ts.isObjectLiteralExpression(base) ? findProp(base, key)?.initializer : undefined;
  return src !== undefined && ts.isExpression(src) && !ts.isSpreadElement(src) ? constString(src, s, seen) : undefined;
}
export function pathTaintOf(arg: ts.Expression | undefined, s: State): number {
  if (arg === undefined || !ts.isExpression(arg)) return 0;
  if (isTmp(arg, s, new Set())) return TMP;
  const lit = constString(arg, s, new Set());
  if (lit !== undefined) return lit.endsWith(".glb") ? PATH : STORED;
  if (ts.isIdentifier(arg)) {
    const d = declOf(arg, s);
    if (d !== undefined && ts.isParameter(d) && isFnNode(d.parent)) return s.paramTaint.get(d.parent)?.get(arg.text) ?? 0;
  }
  return 0;
}
/** Taint through createHash().update(x).digest() chains, following hasher variables across the file. */
function digestTaint(node: ts.CallExpression, s: State): number {
  if (s.busy.has(node)) return 0;
  s.busy.add(node);
  try {
    let cur: ts.Expression = node;
    const roots: ts.Identifier[] = [];
    let t = 0;
    for (let g = 0; g < 25; g++) {
      if (!ts.isCallExpression(cur) || !ts.isPropertyAccessExpression(cur.expression)) break;
      const m = cur.expression.name.text;
      if (m !== "update" && m !== "digest") break;
      if (m === "update") {
        const a = cur.arguments[0];
        if (a !== undefined && ts.isExpression(a)) t |= T(a, s);
      }
      const recv = cur.expression.expression;
      if (ts.isIdentifier(recv)) {
        roots.push(recv);
        break;
      }
      if (!ts.isCallExpression(recv)) break;
      cur = recv;
    }
    let rooted = ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === "createHash";
    for (const r of roots) {
      const d = declOf(r, s);
      rooted = rooted || (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === "createHash");
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "update" && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === r.text) {
          const a = n.arguments[0];
          if (a !== undefined && ts.isExpression(a)) t |= T(a, s);
        }
        ts.forEachChild(n, visit);
      };
      visit(r.getSourceFile());
    }
    return rooted ? t : 0;
  } finally {
    s.busy.delete(node);
  }
}
export function returnTaint(fn: FnLike, s: State): number {
  const hit = s.retMemo.get(fn);
  if (hit !== undefined) return hit;
  if (s.active.has(fn) || fn.body === undefined) return 0;
  s.active.add(fn);
  let t = 0;
  try {
    if (ts.isBlock(fn.body)) {
      const gather = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
        if (ts.isReturnStatement(node) && node.expression !== undefined) t |= T(node.expression, s);
        ts.forEachChild(node, gather);
      };
      ts.forEachChild(fn.body, gather);
    } else t = T(fn.body, s);
  } finally {
    s.active.delete(fn);
  }
  s.retMemo.set(fn, t);
  return t;
}
/** for-of / Object.entries loop bindings over constant containers. */
function loopTaint(name: string, id: ts.Identifier, s: State): number | undefined {
  let cur: ts.Node | undefined = id.parent;
  while (cur !== undefined) {
    if (ts.isFunctionLike(cur)) return undefined;
    if (ts.isForOfStatement(cur)) return forOfTaint(name, cur, s);
    cur = cur.parent;
  }
  return undefined;
}
function forOfTaint(name: string, cur: ts.ForOfStatement, s: State): number | undefined {
  const init = cur.initializer;
  if (!ts.isVariableDeclarationList(init) || init.declarations.length === 0) return undefined;
  const dn = (init.declarations[0] as ts.VariableDeclaration).name;
  let index: number | undefined;
  let bound = ts.isIdentifier(dn) && dn.text === name;
  if (!bound && ts.isArrayBindingPattern(dn)) {
    dn.elements.forEach((el, n) => {
      if (!ts.isOmittedExpression(el) && ts.isIdentifier(el.name) && el.name.text === name) {
        bound = true;
        index = n;
      }
    });
  }
  if (!bound) return undefined;
  const ex = cur.expression;
  if (ts.isCallExpression(ex) && ts.isPropertyAccessExpression(ex.expression) && ts.isIdentifier(ex.expression.expression) && ex.expression.expression.text === "Object" && ex.arguments.length > 0) {
    const first = ex.arguments[0];
    if ((ex.expression.name.text === "entries" || ex.expression.name.text === "values") && first !== undefined && ts.isExpression(first)) {
      return ex.expression.name.text === "entries" && index === 0 ? 0 : T(first, s);
    }
    return 0;
  }
  return T(ex, s);
}
function scopedT(guard: ts.Node, expr: ts.Expression, s: State): number {
  // A self-referential initializer re-enters its own guard (F3:
  // var paths = { glb: paths ? paths.glb : ... }): return a verdict, no throw.
  if (s.active.has(guard)) return 0;
  s.active.add(guard);
  try {
    return T(expr, s);
  } finally {
    s.active.delete(guard);
  }
}
function Tid(id: ts.Identifier, s: State): number {
  if (id.text === "undefined") return 0;
  const loop = loopTaint(id.text, id, s);
  if (loop !== undefined) return loop;
  const decl = declOf(id, s);
  if (decl === undefined) {
    const t = s.tables.get(id.getSourceFile().fileName);
    const named = t?.named.get(id.text) ?? t?.req.get(id.text);
    return named !== undefined && !named.mod.startsWith(".") ? STORED : 0;
  }
  if (ts.isParameter(decl)) return isFnNode(decl.parent) ? (s.paramTaint.get(decl.parent)?.get(id.text) ?? 0) : 0;
  if (ts.isVariableDeclaration(decl)) {
    if (decl.initializer === undefined || !ts.isExpression(decl.initializer) || s.active.has(decl)) return 0;
    return scopedT(decl, decl.initializer, s);
  }
  if (ts.isImportSpecifier(decl)) return importTaint(id, decl, s);
  return 0;
}
function importTaint(id: ts.Identifier, decl: ts.ImportSpecifier, s: State): number {
  const clause = decl.parent.parent;
  if (!ts.isImportClause(clause) || clause.parent === undefined || !ts.isImportDeclaration(clause.parent)) return 0;
  const spec = clause.parent.moduleSpecifier;
  if (!ts.isStringLiteralLike(spec) || !spec.text.startsWith(".")) return STORED;
  const target = resolveImportDecl(id.getSourceFile().fileName, spec.text, decl.propertyName === undefined ? decl.name.text : decl.propertyName.text, s);
  if (target === undefined || !ts.isVariableDeclaration(target) || target.initializer === undefined || !ts.isExpression(target.initializer) || s.active.has(target)) return 0;
  return scopedT(target, target.initializer, s);
}
function Tcall(node: ts.CallExpression, s: State): number {
  const cal = node.expression;
  if (ts.isIdentifier(cal)) {
    const kind = identCallee(cal.text, cal, s);
    if (kind.kind === "fs-read" || kind.kind === "sink") {
      const a = node.arguments[0];
      const pt = pathTaintOf(a, s);
      if (pt === PATH) return LIVE;
      if (kind.kind === "fs-read") return pt;
      return pt !== 0 ? pt : a !== undefined && ts.isExpression(a) ? T(a, s) : 0;
    }
    if (kind.kind === "fn") return returnTaint(kind.node, s);
    return 0;
  }
  if (ts.isPropertyAccessExpression(cal)) {
    const m = cal.name.text;
    if (m === "digest" || m === "update") return digestTaint(node, s);
    if (isFsReadCall(node, s)) {
      const a = node.arguments[0];
      const pt = pathTaintOf(a, s);
      if (pt === PATH) return LIVE;
      return pt;
    }
    if (m === "parse" && ts.isIdentifier(cal.expression) && cal.expression.text === "JSON") {
      const a = node.arguments[0];
      return a !== undefined && ts.isExpression(a) ? T(a, s) : 0;
    }
    return 0;
  }
  return 0;
}
export function T(node: ts.Expression, s: State): number {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node)) return T(node.expression, s);
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return HEX64.test(node.text) ? STORED : 0;
  if (ts.isTemplateExpression(node)) {
    let t = 0;
    for (const span of node.templateSpans) t |= T(span.expression, s);
    return t;
  }
  if (ts.isConditionalExpression(node)) return T(node.whenTrue, s) | T(node.whenFalse, s);
  if (ts.isBinaryExpression(node)) return node.operatorToken.kind !== ts.SyntaxKind.PlusToken ? 0 : T(node.left, s) | T(node.right, s);
  if (ts.isIdentifier(node)) return Tid(node, s);
  if (ts.isObjectLiteralExpression(node)) {
    let t = 0;
    for (const p of node.properties) if (ts.isPropertyAssignment(p)) t |= T(p.initializer, s);
    return t;
  }
  if (ts.isArrayLiteralExpression(node)) {
    let t = 0;
    for (const el of node.elements) if (ts.isExpression(el) && !ts.isSpreadElement(el)) t |= T(el, s);
    return t;
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (PIN_FIELDS.has(node.name.text)) {
      const b = T(node.expression, s);
      return (b & STORED) !== 0 ? STORED : 0;
    }
    const base = resolveInit(node.expression, s);
    if (base !== undefined && ts.isObjectLiteralExpression(base)) {
      const p = findProp(base, node.name.text);
      if (p !== undefined) return scopedT(p, p.initializer, s);
    }
    return 0;
  }
  if (ts.isElementAccessExpression(node)) {
    const inner = ts.isAwaitExpression(node.expression) || ts.isParenthesizedExpression(node.expression) ? node.expression.expression : node.expression;
    if (ts.isCallExpression(inner) && isFsReadCall(inner, s)) return 0;
    const base = resolveInit(node.expression, s);
    const arg = node.argumentExpression;
    if (base !== undefined && ts.isArrayLiteralExpression(base) && arg !== undefined && ts.isNumericLiteral(arg)) {
      const el = base.elements[Number(arg.text)];
      if (el !== undefined && ts.isExpression(el) && !ts.isSpreadElement(el)) return T(el, s);
      return 0;
    }
    if (base !== undefined && ts.isObjectLiteralExpression(base) && arg !== undefined && ts.isStringLiteralLike(arg)) {
      const p = findProp(base, arg.text);
      if (p !== undefined) return scopedT(p, p.initializer, s);
      return 0;
    }
    return 0;
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) return Tcall(node as ts.CallExpression, s);
  return 0;
}
