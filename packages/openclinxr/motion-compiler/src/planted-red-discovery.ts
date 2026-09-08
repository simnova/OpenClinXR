/**
 * Planted-RED discovery for this package (the derivation half of planted-red-manifest.ts).
 *
 * WHY: planted-red-manifest.ts was the #5 serialization point in this repo — 22 excess-writer
 * events over 20 days — because every worker planting or retiring a RED had to edit the same
 * hand-maintained list. This module scans the tree for `it.fails` clauses carrying the repo's
 * immutable diagnosis header and produces the same shape the manifest exports, so adding a RED
 * no longer touches a shared file.
 *
 * A planted RED is discoverable: a test using `it.fails` (the repo's planted convention) with
 * the immutable diagnosis header above it. The scan recovers two fields per clause:
 *   - `select`: the clause title, EXACTLY — the vitest `-t` selector and the coverage identity.
 *   - `stage`: `module_absent` where the header records an absent module, else `assertion`.
 *
 * The expected-failure fingerprint (`expected`) is NOT derivable: it records the reason the
 * clause is red, which lives in the worker's head, not in the tree. Fingerprints stay in the
 * small explicit RESIDUAL_FINGERPRINTS table below, keyed by `file select`. A clause with no
 * fingerprint entry is reported as unprobed, never silently green.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** One discovered clause: the file relative to this package's src, and the title verbatim. */
export type DiscoveredPlantedClause = { file: string; title: string };

/** A resolved entry: the discovery fields plus the `stage` read off the header. */
export type DerivedPlantedEntry = DiscoveredPlantedClause & {
  stage: "module_absent" | "assertion";
};

const HERE = dirname(fileURLToPath(import.meta.url));

function testFilesUnder(dir: string, prefix = ""): string[] {
  // RECURSIVE. A top-level-only scan would silently exclude a clause placed in a subdirectory
  // while the runner kept reporting package-wide coverage — the 14-of-26 defect.
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) out.push(...testFilesUnder(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".test.ts")) out.push(`${prefix}${entry.name}`);
  }
  return out;
}

function isFailsClause(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "planted";
  if (ts.isPropertyAccessExpression(callee)) {
    return (
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "it" &&
      ts.isIdentifier(callee.name) &&
      callee.name.text === "fails"
    );
  }
  return false;
}

function clauseTitle(call: ts.CallExpression): string {
  const first = call.arguments[0];
  if (first !== undefined && ts.isStringLiteralLike(first)) return first.text;
  return "<NON-LITERAL TITLE - the manifest cannot address this clause>";
}

function sourceHasDiagnosisHeader(text: string): boolean {
  return /IMMUTABLE[\s_]+DIAGNOSIS|IMMUTABLE diagnosis|IMMUTABLE HEADER|PLANTED RED/i.test(text);
}

function headerRecordsAbsentModule(text: string): boolean {
  return /\bABSENT\b/i.test(text);
}

/** All `planted(...)` / `it.fails(...)` clauses in the tree, in sorted file order. */
export function discoverPlantedClauses(srcDir: string = HERE): DiscoveredPlantedClause[] {
  const found: DiscoveredPlantedClause[] = [];
  for (const file of testFilesUnder(srcDir)) {
    const source = ts.createSourceFile(file, readFileSync(join(srcDir, file), "utf8"), ts.ScriptTarget.ESNext, true);
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isFailsClause(node)) found.push({ file, title: clauseTitle(node) });
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  return found;
}

/**
 * The `stage` cannot be read off the clause call, so it is read off the clause's own
 * file header: a header recording an ABSENT module means `module_absent`, any other
 * immutable diagnosis header means `assertion`. A clause in a file without the
 * immutable header is not a planted RED and is excluded.
 */
export function derivePlantedEntries(srcDir: string = HERE): DerivedPlantedEntry[] {
  const textCache = new Map<string, string>();
  const textFor = (file: string): string => {
    const cached = textCache.get(file);
    if (cached !== undefined) return cached;
    let text = "";
    try {
      text = readFileSync(join(srcDir, file), "utf8");
    } catch {
      text = "";
    }
    textCache.set(file, text);
    return text;
  };
  const out: DerivedPlantedEntry[] = [];
  for (const clause of discoverPlantedClauses(srcDir)) {
    const text = textFor(clause.file);
    if (!sourceHasDiagnosisHeader(text)) continue;
    out.push({
      ...clause,
      stage: headerRecordsAbsentModule(text) ? "module_absent" : "assertion",
    });
  }
  return out;
}

/**
 * RESIDUAL fingerprints: `expected` records the reason a clause is red, which lives in the
 * worker's head, not in the tree, so it cannot be derived. Each entry names what the clause
 * demands and what would let it be derived (a machine-readable fingerprint in the header).
 * A discovered clause with no entry here is UNPROBED — reported, never silently green.
 */
export const RESIDUAL_FINGERPRINTS: readonly { file: string; select: string; expected: RegExp }[] = [];