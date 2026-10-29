import { createHash } from "node:crypto";
import ts from "typescript";

export const PREDICATE = "shouldUseCleanHumanoidSourceComparatorCapture";
export const HIDER = "updateReusableExteriorAnteroomVisibility";
export const PANEL = "scenario-expectation-visual-review-panel";

export type Baseline = { commit: string; sourceFile: string; blobSha256: string; count: number; predicateBodySha256: string };

const KNOWN_INCLUDES = new Set([
  "patient-note-capture-cue",
  "portal-left-wall",
  "portal-right-wall",
  "portal-header-wall",
  "portal-left-jamb",
  "portal-right-jamb",
  "portal-lintel",
  "encounter-portal-dynamic-threshold",
  "encounter-portal-dynamic-opening",
]);
const MARKER = "openClinXrPortalInteriorReviewAffordance";

function parseOrThrow(src: string, name: string): ts.SourceFile {
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: { messageText: unknown }[] }).parseDiagnostics ?? [];
  if (diags.length > 0) throw new Error(`syntax invalid in ${name}`);
  return sf;
}

/** The actual frozen-clean-capture evaluator. Throws on any drift. */
export function assertFrozenCleanCapture(
  src: string,
  baseline: Baseline,
): { body: string; bodySha256: string; callSites: number } {
  const sf = parseOrThrow(src, baseline.sourceFile);
  const decls: ts.FunctionDeclaration[] = [];
  let calls = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === PREDICATE) decls.push(n);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === PREDICATE && n.arguments.length === 0) calls++;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (decls.length !== 1) throw new Error(`predicate ${PREDICATE} declarations: ${decls.length}, want exactly 1`);
  if (calls !== baseline.count - 1) throw new Error(`clean-capture call-sites ${calls} !== frozen ${baseline.count - 1}`);
  const body = decls[0].getText(sf);
  const sha = createHash("sha256").update(body, "utf8").digest("hex");
  if (sha !== baseline.predicateBodySha256) throw new Error(`predicate body sha ${sha} !== frozen ${baseline.predicateBodySha256}`);
  return { body, bodySha256: sha, callSites: calls };
}

function findHider(src: string): { sf: ts.SourceFile; decl: ts.FunctionDeclaration } {
  const sf = parseOrThrow(src, "portal-trail.ts");
  const found: ts.FunctionDeclaration[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === HIDER) found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (found.length !== 1) throw new Error(`hider ${HIDER}: found ${found.length}, want exactly 1`);
  if (!found[0].body) throw new Error(`hider ${HIDER} has no body`);
  return { sf, decl: found[0] };
}

function traversalParamName(decl: ts.FunctionDeclaration): string {
  let name: string | null = null;
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "traverse" && n.arguments.length >= 1 &&
      (ts.isArrowFunction(n.arguments[0]) || ts.isFunctionExpression(n.arguments[0]))
    ) {
      const fn = n.arguments[0] as ts.ArrowFunction | ts.FunctionExpression;
      if (fn.parameters.length >= 1 && ts.isIdentifier(fn.parameters[0].name)) {
        name = fn.parameters[0].name.text;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(decl);
  if (!name) throw new Error("hider traversal callback parameter not found");
  return name;
}

function leafKind(expr: ts.Expression, receiver: string): { kind: string; value?: string } {
  // object.name.includes("x") bound to the actual traversal callback parameter
  if (
    ts.isCallExpression(expr) && expr.arguments.length === 1 &&
    ts.isPropertyAccessExpression(expr.expression) &&
    (expr.expression.name.text === "includes" || expr.expression.name.text === "endsWith") &&
    ts.isPropertyAccessExpression(expr.expression.expression) &&
    expr.expression.expression.name.text === "name" &&
    ts.isIdentifier(expr.expression.expression.expression) &&
    expr.expression.expression.expression.text === receiver &&
    ts.isStringLiteralLike(expr.arguments[0])
  ) {
    return { kind: expr.expression.name.text, value: expr.arguments[0].text };
  }
  // object.userData["marker"] === true bound to the same receiver
  if (
    ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isElementAccessExpression(expr.left) && ts.isStringLiteralLike(expr.left.argumentExpression) &&
    ts.isPropertyAccessExpression(expr.left.expression) &&
    expr.left.expression.name.text === "userData" &&
    ts.isIdentifier(expr.left.expression.expression) &&
    expr.left.expression.expression.text === receiver &&
    expr.right.kind === ts.SyntaxKind.TrueKeyword
  ) {
    return { kind: "marker", value: expr.left.argumentExpression.text };
  }
  return { kind: "unknown" };
}

function collectOrLeaves(expr: ts.Expression, out: ts.Expression[]): void {
  if (ts.isParenthesizedExpression(expr)) { collectOrLeaves(expr.expression, out); return; }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    collectOrLeaves(expr.left, out);
    collectOrLeaves(expr.right, out);
    return;
  }
  out.push(expr);
}

/**
 * Semantic hider gate: locates the IfStatement whose then-branch assigns
 * object.visible and validates its condition as an OR of known explicit terms.
 * Comments and string literals are never consulted: only AST leaves count.
 */
export function assertHiderSemantics(src: string): { terms: number } {
  const { decl } = findHider(src);
  const ifs: ts.IfStatement[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIfStatement(n)) {
      let writesVisible = false;
      const scan = (m: ts.Node): void => {
        if (
          ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(m.left) && m.left.name.text === "visible"
        ) writesVisible = true;
        ts.forEachChild(m, scan);
      };
      scan(n.thenStatement);
      if (writesVisible) ifs.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(decl);
  if (ifs.length !== 1) throw new Error(`hider visibility IfStatement: found ${ifs.length}, want exactly 1`);
  const leaves: ts.Expression[] = [];
  collectOrLeaves(ifs[0].expression, leaves);
  if (leaves.length < 3) throw new Error(`hider condition terms: ${leaves.length}, want >= 3`);
  let hasLintel = false, hasFloor = false, hasMarker = false;
  const receiver = traversalParamName(decl);
  for (const leaf of leaves) {
    const t = leafKind(leaf, receiver);
    if (t.kind === "includes") {
      if (!t.value || !KNOWN_INCLUDES.has(t.value)) throw new Error(`hider includes term not whitelisted: ${JSON.stringify(t.value)}`);
      if (t.value === "portal-lintel") hasLintel = true;
    } else if (t.kind === "endsWith") {
      if (t.value !== ".floor") throw new Error(`hider endsWith term not whitelisted: ${JSON.stringify(t.value)}`);
      hasFloor = true;
    } else if (t.kind === "marker") {
      if (t.value !== MARKER) throw new Error(`hider marker not exact: ${JSON.stringify(t.value)}`);
      hasMarker = true;
    } else {
      throw new Error(`hider condition has non-explicit term (${leaf.getText().slice(0, 80)})`);
    }
  }
  if (!hasLintel) throw new Error("hider missing portal-lintel term");
  if (!hasFloor) throw new Error("hider missing .floor term");
  if (!hasMarker) throw new Error("hider missing marker term");
  const text = decl.getText();
  if (text.includes(PANEL)) throw new Error("hider names the panel");
  return { terms: leaves.length };
}
