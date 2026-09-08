import { describe, expect, it } from "vitest";
import {
  checkTestImportSurface,
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
