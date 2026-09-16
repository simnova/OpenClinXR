import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const src = dirname(fileURLToPath(import.meta.url));

function importsFrom(text: string): string[] {
  const source = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true);
  return source.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function productionGraph(entry: string): Set<string> {
  const reached = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || reached.has(file) || !existsSync(file)) continue;
    reached.add(file);
    for (const specifier of importsFrom(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(file), specifier.replace(/\.js$/u, ".ts")));
      }
    }
  }
  return reached;
}

describe("production wire data remains independent of test oracles", () => {
  it("the actual runtime graph compiles through shared production data without importing plants or the destructive oracle", () => {
    const graph = productionGraph(resolve(src, "index.ts"));
    for (const path of [
      "compile-motion-program.ts",
      "primitive-registry.ts",
      "motion-wire-format.ts",
      "regions/region-anchor-space.ts",
    ]) {
      expect(graph.has(resolve(src, path)), `production graph must reach ${path}`).toBe(true);
    }
    for (const path of ["plant-motion-regions.ts", "canonical-motion-contract.ts"]) {
      expect(graph.has(resolve(src, path)), `production must not import test data/oracle ${path}`).toBe(false);
    }
  });

  it("the independent graph probe follows genuine declarations, including reexports, without interpreting comments or quoted fixture source", () => {
    expect(importsFrom(`
      // import { fake } from "./comment.js";
      const fixture = 'import { fake } from "./quoted.js";';
      import type { Type } from "./type.js";
      import { runtime } from "./runtime.js";
      export { forwarded } from "./forwarded.js";
    `)).toEqual(["./type.js", "./runtime.js", "./forwarded.js"]);
  });
});
