import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkTestImportSurface,
  entrypointReachableModules,
  measureTestImports,
  publicEntrypoints,
  readTestImportCeiling,
} from "../checks/test-import-surface.ts";

/**
 * A co-located test importing `../thing.js` pins that module as if it were public, so the
 * package can no longer rename or merge it without editing tests. See
 * checks/test-import-surface.ts for the measurement and for why a per-package
 * `<name>-verification` sidecar was rejected in favour of this rule.
 *
 * Clause (3) is a POSITIVE CONTROL, for the reason recorded in
 * archunit-tests/packages-take-a-narrow-context.test.ts: the CellixJs reference ships checks
 * that return [] unconditionally, and a suite asserting only toEqual([]) cannot tell a clean
 * tree from a deleted check.
 */
describe("package tests use the public entrypoint", () => {
  it("(1) no package's tests reach further into internals than its ceiling", () => {
    const violations = checkTestImportSurface();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(2) POSITIVE CONTROL: internal imports with no ceiling ARE reported", () => {
    const violations = checkTestImportSurface([{ pkg: "invented", internal: 7, public: 0 }], () => null);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("7 test import(s) reach a module the package does not export");
  });

  it("(3) COUNTERWEIGHT: a package above its ceiling is reported", () => {
    const violations = checkTestImportSurface(
      [{ pkg: "p", internal: 9, public: 0 }],
      () => ({ testInternalImports: 5 }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("rose to 9 > ceiling 5");
  });

  it("(4) COUNTERWEIGHT: a ceiling above the measurement is reported, so the ratchet tightens", () => {
    const violations = checkTestImportSurface(
      [{ pkg: "p", internal: 2, public: 0 }],
      () => ({ testInternalImports: 8 }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("ceiling 8 is above the measured 2");
  });

  it("(5) COUNTERWEIGHT: a package at zero internal imports and no ceiling is NOT reported", () => {
    expect(checkTestImportSurface([{ pkg: "p", internal: 0, public: 12 }], () => null)).toEqual([]);
  });

  it("(6) a declared subpath export counts as public, not internal", () => {
    const manifest = JSON.stringify({
      exports: { ".": "./dist/index.js", "./catalog": { types: "./dist/catalog.d.ts", import: "./dist/catalog.js" } },
    });
    const points = publicEntrypoints(manifest);
    expect(points.has("./index.js")).toBe(true);
    expect(points.has("./catalog.js")).toBe(true);
    expect(points.has("./secret-helper.js")).toBe(false);
  });

  it("(7) the measurement comes from the tree, and the known offender is frozen", () => {
    const byPkg = new Map(measureTestImports().map((m) => [m.pkg, m.internal]));
    expect(byPkg.get("motion-compiler")).toBeGreaterThan(0);
    expect(readTestImportCeiling("motion-compiler")?.testInternalImports).toBe(
      byPkg.get("motion-compiler"),
    );
    // Seven packages already import only through their entrypoint; that set must not shrink.
    const clean = [...byPkg.values()].filter((n) => n === 0).length;
    expect(clean).toBeGreaterThanOrEqual(7);
  });
});

/**
 * An internal import counts ONLY when the module is reachable from a declared entrypoint.
 *
 * FOUND AS A DEADLOCK, 2026-09-08, not chosen as a preference. export-surface-budgets.ts ratchets
 * entrypoint exports down and this rule ratchets internal test imports down, both shrink-only. A
 * package whose tests exercise an internal module could satisfy neither: removing the symbol from
 * the entrypoint broke the test, and repointing the test at the module raised this count. Measured
 * on capability-gateway (119 exports, testInternalImports ceiling 1) and shared-schemas (107, 1).
 *
 * The rule's stated harm is "pins thing.ts AS IF IT WERE PUBLIC". A genuinely private module pins
 * nothing a consumer can see, so the package stays free to rename or merge it.
 *
 * MEASURED BEFORE THE CHANGE: of 234 internal test imports across the tree, 206 target a module
 * still reachable from an entrypoint and keep counting; 28 stop. Clause (10) freezes that ratio so
 * a later simplification cannot quietly reduce the rule to nothing.
 */
describe("only a reachable module is pinned as if public", () => {
  const withPackage = (files: Record<string, string>, run: (src: string) => void): void => {
    const root = mkdtempSync(join(tmpdir(), "test-import-"));
    try {
      for (const [rel, body] of Object.entries(files)) {
        const full = join(root, rel);
        mkdirSync(join(full, ".."), { recursive: true });
        writeFileSync(full, body);
      }
      run(join(root, "src"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("(8) a module re-exported from the entrypoint is reachable", () => {
    withPackage(
      {
        "src/index.ts": 'export { thing } from "./thing.js";\n',
        "src/thing.ts": "export const thing = 1;\n",
        "src/private.ts": "export const hidden = 2;\n",
      },
      (src) => {
        const reachable = entrypointReachableModules(src, new Set(["./index.js"]));
        expect([...reachable].some((f) => f.endsWith("thing.ts"))).toBe(true);
        expect([...reachable].some((f) => f.endsWith("private.ts"))).toBe(false);
      },
    );
  });

  it("(9) COUNTERWEIGHT: an entrypoint that re-exports nothing reaches only itself", () => {
    // The cheapest way to make clause (8) pass is to stop walking imports, which would make every
    // module unreachable and reduce the whole rule to zero.
    withPackage(
      { "src/index.ts": "export const only = 1;\n", "src/other.ts": "export const other = 2;\n" },
      (src) => {
        const reachable = entrypointReachableModules(src, new Set(["./index.js"]));
        expect(reachable.size).toBe(1);
      },
    );
  });

  it("(10) the live tree still counts the large majority of its internal test imports", () => {
    // 206 of 234 kept counting when this change was measured. A floor of 150 leaves room for the
    // campaign to shrink entrypoints (which legitimately lowers this) while failing loudly if the
    // reachability walk is ever broken into reporting nothing.
    const total = measureTestImports().reduce((sum, m) => sum + m.internal, 0);
    expect(total).toBeGreaterThan(150);
  });
});
