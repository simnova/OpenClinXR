import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measureSurface } from "./resolve.js";

/**
 * Scoped compiler measurement: the same real TS program/checker as the
 * default full scan, restricted to the requested canonical packageDirs
 * before entrypoint resolution. Fails closed on unknown or empty sets.
 */

function withTree(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "surface-scoped-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const manifest = (name: string): string =>
  JSON.stringify({ name, exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } });

const TREE: Record<string, string> = {
  "packages/openclinxr/fixture-a/package.json": manifest("@openclinxr/fixture-a"),
  "packages/openclinxr/fixture-a/src/index.ts": "export const alpha = 1;\nexport type Beta = string;\n",
  "packages/openclinxr/fixture-b/package.json": manifest("@openclinxr/fixture-b"),
  "packages/openclinxr/fixture-b/src/index.ts": "export const gamma = 2;\n",
};

describe("measureSurface scoping", () => {
  it("scoped report equals the matching slice of the default full report", () => {
    withTree(TREE, (root) => {
      const full = measureSurface(root);
      expect(full.packages.map((pkg) => pkg.packageDir).sort()).toEqual([
        "packages/openclinxr/fixture-a",
        "packages/openclinxr/fixture-b",
      ]);
      const scoped = measureSurface(root, { packageDirs: ["packages/openclinxr/fixture-a"] });
      const wanted = full.packages.find((pkg) => pkg.packageDir === "packages/openclinxr/fixture-a");
      expect(wanted).toBeDefined();
      expect(scoped.packages).toEqual(wanted === undefined ? [] : [wanted]);
      expect(scoped.totals.roots).toBe(1);
      expect(scoped.totals.rootSymbols).toBe(wanted?.rootSymbols ?? 0);
    });
  });

  it("omits the other package's exports", () => {
    withTree(TREE, (root) => {
      const scoped = measureSurface(root, { packageDirs: ["packages/openclinxr/fixture-a"] });
      const names = scoped.packages.flatMap((pkg) =>
        pkg.entrypoints.flatMap((entry) => entry.symbols.map((symbol) => symbol.name)),
      );
      expect(names).toContain("alpha");
      expect(names).not.toContain("gamma");
      expect(scoped.packages.some((pkg) => pkg.packageDir === "packages/openclinxr/fixture-b")).toBe(false);
    });
  });

  it("rejects unknown packageDirs and explicit empty sets", () => {
    withTree(TREE, (root) => {
      expect(() => measureSurface(root, { packageDirs: ["packages/openclinxr/nope"] })).toThrow();
      expect(() => measureSurface(root, { packageDirs: [] })).toThrow();
    });
  });

  it("undefined option preserves the exact default full scan", () => {
    withTree(TREE, (root) => {
      const def = measureSurface(root);
      const explicitUndefined = measureSurface(root, { packageDirs: undefined });
      expect(explicitUndefined).toEqual(def);
      expect(def.totals.roots).toBe(2);
    });
  });
});
