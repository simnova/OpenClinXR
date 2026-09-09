import { describe, expect, it } from "vitest";
import {
  ENTRYPOINT_EXPORT_BUDGET,
  checkExportSurface,
  exportedSymbols,
  measureExportSurface,
  readExportCeiling,
} from "../checks/export-surface-budgets.ts";

/**
 * A package publishing 220 symbols has a namespace, not an interface. See
 * checks/export-surface-budgets.ts for the budget's two provenances and for why the star-wall
 * clause is a pure shrink-only ratchet with no budget.
 *
 * Clause (2) is a POSITIVE CONTROL, for the reason recorded in
 * packages-take-a-narrow-context.test.ts: the CellixJs reference ships checks that return []
 * unconditionally, and a suite asserting only toEqual([]) cannot tell a clean tree from a
 * deleted check.
 */
describe("packages publish an interface", () => {
  it("(1) no package publishes more than its ceiling, and no new star wall appears", () => {
    const violations = checkExportSurface();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(2) POSITIVE CONTROL: an over-budget entrypoint with no ceiling IS reported", () => {
    const violations = checkExportSurface([{ pkg: "invented", exports: 90, starExports: 0 }], () => null);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain(`90 symbols > budget ${ENTRYPOINT_EXPORT_BUDGET}`);
  });

  it("(3) POSITIVE CONTROL: a star wall in a package with no ceiling IS reported", () => {
    const violations = checkExportSurface([{ pkg: "invented", exports: 4, starExports: 2 }], () => null);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("2 `export * from` wall(s) with no ceiling");
  });

  it("(4) COUNTERWEIGHT: growth above an existing ceiling is reported", () => {
    const violations = checkExportSurface(
      [{ pkg: "p", exports: 80, starExports: 3 }],
      () => ({ rootEntrypointExports: 70, starExports: 3 }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("grew to 80 symbols > ceiling 70");
  });

  it("(5) COUNTERWEIGHT: a ceiling left above a shrunken surface is reported, so the ratchet tightens", () => {
    const violations = checkExportSurface(
      [{ pkg: "p", exports: 40, starExports: 1 }],
      () => ({ rootEntrypointExports: 70, starExports: 4 }),
    );
    expect(violations.map((v) => v.detail).join("\n")).toContain("ceiling 70 is above the measured 40");
    expect(violations.map((v) => v.detail).join("\n")).toContain("star ceiling 4 is above the measured 1");
  });

  it("(6) COUNTERWEIGHT: a package under budget with no star walls and no ceiling is NOT reported", () => {
    expect(checkExportSurface([{ pkg: "p", exports: 12, starExports: 0 }], () => null)).toEqual([]);
  });

  it("(7) the symbol counter follows export * chains rather than counting lines", () => {
    // This clause named xr-station, which reached 214 symbols through 32 walls. The narrowing
    // campaign removed every one of its stars on 2026-09-08, so the specimen disappeared and the
    // clause failed on its own success. It is written against the PROPERTY now, not a specimen:
    // some package still has stars, and its symbol count exceeds its star count.
    const measured = measureExportSurface();
    const walled = measured.filter((m) => m.starExports > 0);
    expect(walled.length, "no package has an export * wall left; retire this clause").toBeGreaterThan(0);
    for (const pkg of walled) {
      expect(pkg.exports, `${pkg.pkg} symbols vs walls`).toBeGreaterThan(pkg.starExports);
      const ceiling = readExportCeiling(pkg.pkg)?.rootEntrypointExports;
      if (ceiling !== undefined) expect(ceiling, `${pkg.pkg} ceiling`).toBe(pkg.exports);
    }
  });

  it("(8) a re-exported name is counted once, under its exported alias", () => {
    const url = new URL("../checks/export-surface-budgets.ts", import.meta.url);
    const symbols = exportedSymbols(url.pathname);
    expect(symbols.has("checkExportSurface")).toBe(true);
    expect(symbols.has("ENTRYPOINT_EXPORT_BUDGET")).toBe(true);
    expect(symbols.has("STAR_EXPORT")).toBe(false);
  });
});
