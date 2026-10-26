// Shared causal-boundary source contract for actor-audio oracles.
// Frozen policy: sync precedes fixed-clock dispatch in the SAME lexical frame
// callback; simulate points at the named simulation callback; the named callback
// drives the facial loop; the unclocked path still drives the same callback.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function nearestFn(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return n;
  }
  return null;
}

function blockFromAst(code, openIdx) {
  const sf = ts.createSourceFile('oracle.ts', code, ts.ScriptTarget.ESNext, true, true);
  // Lexical frame callback equality: find the arrow/function whose body block
  // starts exactly at openIdx (the sim-def brace), then return its exact span.
  let found = null;
  const visit = (node) => {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body && ts.isBlock(node.body)) {
      if (node.body.getStart(sf) === openIdx) found = node.body;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  assert.ok(found, 'named simulation callback body resolves in the lexical frame');
  return found.getText(sf);
}

function blockFrom(code, openIdx) {
  return blockFromAst(code, openIdx);
}

export function uncomment(s) {
  return s.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,
    (all, string) => string ?? ' ',
  );
}

// Proves actual causality on real source text: the named simulation callback
// `stepActorSimulation(deltaSeconds, now)` contains the facial-loop drive, the
// sync tick precedes the fixed-clock dispatch in the same frame callback, and
// the unclocked fallback still drives the same callback. A wrong global text
// order or a detached simulate target cannot pass.
export function assertClock(code) {
  const simDef = code.match(
    /const\s+stepActorSimulation\s*=\s*\(\s*deltaSeconds\s*:\s*number\s*,\s*now\s*:\s*number\s*\)\s*:\s*void\s*=>\s*\{/,
  );
  assert.ok(simDef, 'named simulation callback keeps the legacy frame tick params');
  const simBody = blockFrom(code, simDef.index + simDef[0].length - 1);
  assert.match(
    simBody,
    /updateGeneratedHumanoidAnimations\s*\(\s*deltaSeconds\s*,\s*now\b/,
    'simulation callback drives the facial loop on the same tick',
  );
  const syncAt = code.search(/syncPreparedActorAudio\s*\(\s*frameNowMs\s*\)/);
  const stepAt = code.search(/stepFixedClockFrame\s*\(\s*fixedClockFrame/);
  assert.ok(syncAt >= 0, 'clock sync tick persists');
  assert.ok(stepAt >= 0, 'facial loop dispatched through the admitted fixed clock');
  assert.ok(
    simDef.index < syncAt && syncAt < stepAt,
    'sync tick precedes fixed-clock dispatch in the same frame callback',
  );
  {
    const sf = ts.createSourceFile('oracle.ts', code, ts.ScriptTarget.ESNext, true, true);
    let syncNode = null;
    let stepNode = null;
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'syncPreparedActorAudio' && !syncNode) syncNode = node;
        if (node.expression.text === 'stepFixedClockFrame' && !stepNode) stepNode = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const syncFrame = syncNode ? nearestFn(syncNode) : null;
    const stepFrame = stepNode ? nearestFn(stepNode) : null;
    assert.ok(syncFrame && stepFrame && syncFrame === stepFrame, 'sync and dispatch share the same lexical frame callback');
    assert.ok(syncNode.getStart(sf) < stepNode.getStart(sf), 'sync tick source position precedes dispatch in the same lexical frame callback');
  }
  assert.match(
    code.slice(syncAt, stepAt),
    /if\s*\(\s*!fixedClockDisabled\s*\)/,
    'sync and dispatch share one frame callback',
  );
  assert.match(
    code,
    /simulate\s*:\s*stepActorSimulation\b/,
    'fixed-clock simulate points at the named simulation callback',
  );
  assert.match(
    code,
    /\}\s*else\s*\{\s*stepActorSimulation\s*\(\s*frameDtSeconds\s*,\s*frameNowMs\s*\)/,
    'unclocked path still drives the same simulation callback',
  );
}

// Negative: sync moved outside the frame callback (after the unclocked branch)
// must fail the causality oracle.
export function assertSyncNotMovedOutsideFrame(good, assertHost) {
  const movedSync = good.replace('syncPreparedActorAudio(frameNowMs); ', '');
  assert.throws(
    () => assertHost(
      movedSync.replace(
        '} else { stepActorSimulation(frameDtSeconds, frameNowMs); }',
        '} else { stepActorSimulation(frameDtSeconds, frameNowMs); } syncPreparedActorAudio(frameNowMs);',
      ),
    ),
    /precedes fixed-clock dispatch/,
  );
}

// Extract module references from actual bounded root-tool sources without any
// dependency: strip comments (preserving string literals), blank string
// contents, then match static import/export-from, dynamic import(), and
// require() forms. Comments and non-specifier strings are never reported.
export function extractModuleSpecs(sourceText) {
  // Real lexical parse via the installed TypeScript API: comments and string
  // contents are never specifiers. Static import/export-from (all four forms:
  // default, named, namespace, side-effect), dynamic import(), require(),
  // and import-equals are extracted; only root-tool runtime subpath wiring
  // is admitted by callers.
  const sf = ts.createSourceFile('oracle.ts', sourceText, ts.ScriptTarget.ESNext, true);
  const specs = new Set();
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) specs.add(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if ((isImport || isRequire) && node.arguments.length === 1) add(node.arguments[0]);
    } else if (ts.isImportEqualsDeclaration(node)) {
      // import x = require('spec') — external-module-reference form.
      const ref = node.moduleReference;
      if (ref && ts.isExternalModuleReference(ref) && ref.expression) add(ref.expression);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return [...specs].sort();
}
