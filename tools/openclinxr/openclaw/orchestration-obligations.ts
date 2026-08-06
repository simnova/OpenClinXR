/**
 * Declared orchestration obligations — the gateable half of "pieces built, left unconnected".
 *
 * That class recurred six times in one day (merge-kill, contract report, DONE_WHEN vocabulary,
 * integrationEvents, planted-contract honesty, known-broken freeze). Prose in PROTO_BOARD_LOOP
 * ("what calls this?") did not stop the pattern. Every other same-day lesson became a gate; this
 * is the gate for runtime obligations that must stay wired.
 *
 * NOT a scan of exports. Measured: "export with no importer outside its file/test" flags 184/233
 * (~79%) of openclaw exports — most exist for their own unit test. A scan is permanently frozen or
 * useless. Intent is declared: a small curated registry of symbols sold as gates / SSOTs /
 * land-path steps / honesty checks, plus the callers that must invoke them.
 *
 * Seed = historical cases that are wired on the live land path today. Staged checkers that still
 * lack a production caller (plantedContractsAreHonest, staleFreezeEntries → architecture suite)
 * are NOT listed until a requiredCaller exists — declaring them early would either fail forever or
 * ban legitimate staging.
 *
 * #37: detection is CALL-level (TS AST), not mention-level. An import / re-export / comment /
 * string of the symbol name does not satisfy the obligation — only a real value use (call callee,
 * property access root, etc.) outside ImportDeclaration / ExportDeclaration bindings.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export type OrchestrationObligation = {
  id: string;
  /** Exported symbol that must be invoked by each required caller. */
  symbol: string;
  /** Module that owns / exports the symbol (repo-relative). Documented; not scanned. */
  fromModule: string;
  /** Repo-relative production callers that must invoke `symbol`. At least one required. */
  requiredCallers: readonly string[];
};

/**
 * Fixture shape for injected-registry checks. Live-tree path uses ORCHESTRATION_OBLIGATIONS + disk.
 * Injected path is the only way to prove the flagging direction without breaking the repo.
 */
export type ObligationWithSources = OrchestrationObligation & {
  /** Caller path → source text. Keys must cover each requiredCaller under test. */
  sources: Readonly<Record<string, string>>;
};

/**
 * Curated registry. Keep small (<40). Every entry names who must call it.
 * Add an entry when shipping a new runtime obligation; remove only when the obligation is retired.
 */
export const ORCHESTRATION_OBLIGATIONS: readonly OrchestrationObligation[] = [
  // 1. merge-kill exited 2 into the void until integrate called it first.
  {
    id: "merge-kill-on-land",
    symbol: "runMergeKill",
    fromModule: "tools/openclinxr/openclaw/merge-kill.ts",
    requiredCallers: ["tools/openclinxr/openclaw/integrate.ts"],
  },
  // 2. integrate passed contract:null while the report existed — land path must load it.
  {
    id: "contract-loaded-on-land",
    symbol: "contractForSlice",
    fromModule: "tools/openclinxr/openclaw/integrate.ts",
    requiredCallers: ["tools/openclinxr/openclaw/integrate.ts"],
  },
  // 3. DONE_WHEN_RULE_VOCABULARY was a "single source of truth" the evaluator never read.
  {
    id: "done-when-vocabulary-ssot",
    symbol: "DONE_WHEN_RULE_VOCABULARY",
    fromModule: "packages/openclinxr/agent-loop/src/done-when-rules.ts",
    requiredCallers: ["tools/openclinxr/openclaw/dispatch-worker.ts"],
  },
  // 4. integrationEvents built to replace subject-regexing; scorecard / pause must use it.
  {
    id: "integration-events-for-landed-inference",
    symbol: "integrationEvents",
    fromModule: "tools/openclinxr/openclaw/integrate.ts",
    requiredCallers: [
      "tools/openclinxr/openclaw/delegation-scorecard.ts",
      "tools/openclinxr/openclaw/loop-pause.ts",
    ],
  },
] as const;

/**
 * True when `node` is an Identifier that is only a binding name in an import/export declaration
 * (including multi-line import bodies and `export { X } from`). Those mention the symbol without
 * invoking it — the #37 failure class.
 */
function isImportOrExportBindingName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (ts.isImportSpecifier(parent)) {
    // `import { runMergeKill }` / `import { runMergeKill as kill }` — both names are bindings.
    return parent.name === node || parent.propertyName === node;
  }
  if (ts.isExportSpecifier(parent)) {
    // `export { runMergeKill }` / `export { runMergeKill as kill }` / re-export from.
    return parent.name === node || parent.propertyName === node;
  }
  if (ts.isNamespaceImport(parent) || ts.isNamespaceExport(parent)) {
    return parent.name === node;
  }
  if (ts.isImportClause(parent)) {
    // `import runMergeKill from "..."` default import.
    return parent.name === node;
  }
  if (ts.isImportEqualsDeclaration(parent)) {
    return parent.name === node;
  }
  return false;
}

/**
 * Declaration *names* (function/class/const that introduce the symbol) are not invocations.
 * Same-file `export function contractForSlice` must not satisfy "caller invokes contractForSlice"
 * without a real use site.
 */
function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (
    (ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent)
      || ts.isGetAccessorDeclaration(parent)
      || ts.isSetAccessorDeclaration(parent))
    && parent.name === node
  ) {
    return true;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (ts.isEnumMember(parent) && parent.name === node) return true;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return true;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return true;
  // Object literal shorthand / property name is a key, not a value use of the obligation.
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    // Shorthand `{ runMergeKill }` *is* a value use of the binding — treat as invocation.
    return false;
  }
  return false;
}

/**
 * Type-only positions do not wire a runtime obligation.
 */
function isTypeOnlyPosition(node: ts.Identifier): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isTypeReferenceNode(current)
      || ts.isTypeQueryNode(current)
      || ts.isExpressionWithTypeArguments(current)
      || ts.isImportTypeNode(current)
      || ts.isTypeOperatorNode(current)
      || ts.isIndexedAccessTypeNode(current)
    ) {
      return true;
    }
    // `import type { X }` already covered by import binding; also skip type-only export.
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) {
      // Walk stops; binding check already handled.
      break;
    }
    current = current.parent;
  }
  return false;
}

/**
 * AST walk: symbol is invoked when an Identifier of that name appears as a real value use —
 * call callee, property-access root, argument, etc. — not as an import/export binding, not as
 * a declaration name, and not type-only. Comments and string literals never create Identifiers,
 * so they cannot satisfy the obligation (the cheap-string prior's fatal hole).
 */
export function sourceInvokesSymbol(source: string, symbol: string, fileName = "caller.ts"): boolean {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );

  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (ts.isIdentifier(node) && node.text === symbol) {
      if (
        !isImportOrExportBindingName(node)
        && !isDeclarationName(node)
        && !isTypeOnlyPosition(node)
      ) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function violationFor(obligation: OrchestrationObligation, caller: string): string {
  return (
    `obligation "${obligation.id}": required caller ${caller} never invokes ` +
    `${obligation.symbol} (unwired)`
  );
}

function missingCallerViolation(obligation: OrchestrationObligation, caller: string): string {
  return (
    `obligation "${obligation.id}": required caller ${caller} is missing — ` +
    `${obligation.symbol} is unwired (not called)`
  );
}

/**
 * Injected-registry checker — the only way to prove the flagging path without breaking the
 * live tree. Each obligation supplies `sources` for its required callers.
 */
export function unwiredObligationsIn(
  obligations: readonly ObligationWithSources[],
): string[] {
  const violations: string[] = [];

  for (const obligation of obligations) {
    for (const caller of obligation.requiredCallers) {
      const source = obligation.sources[caller];
      if (source === undefined) {
        violations.push(missingCallerViolation(obligation, caller));
        continue;
      }
      if (!sourceInvokesSymbol(source, obligation.symbol, caller)) {
        violations.push(violationFor(obligation, caller));
      }
    }
  }

  return violations;
}

/**
 * Returns human-readable violations for declared obligations whose required callers do not
 * invoke the symbol. Empty array = every declared obligation is actually wired on the tree.
 */
export function unwiredObligations(repoRoot: string): string[] {
  const violations: string[] = [];

  for (const obligation of ORCHESTRATION_OBLIGATIONS) {
    for (const caller of obligation.requiredCallers) {
      const callerPath = join(repoRoot, caller);
      if (!existsSync(callerPath)) {
        violations.push(missingCallerViolation(obligation, caller));
        continue;
      }
      const source = readFileSync(callerPath, "utf8");
      if (!sourceInvokesSymbol(source, obligation.symbol, caller)) {
        violations.push(violationFor(obligation, caller));
      }
    }
  }

  return violations;
}
