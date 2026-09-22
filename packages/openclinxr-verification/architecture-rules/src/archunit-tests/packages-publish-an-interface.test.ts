import { describe, expect, it } from "vitest";
import {
  ENTRYPOINT_EXPORT_BUDGET,
  checkExportSurface,
  exportedSymbols,
  measureExportSurface,
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
  it("(1) no new star wall appears; the numeric rootEntrypointExports ceiling is not the gate", () => {
    const violations = checkExportSurface();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(2) an over-budget entrypoint count is not reported; public-api.json is the gate", () => {
    const violations = checkExportSurface([{ pkg: "invented", exports: 90, starExports: 0 }], () => null);
    expect(ENTRYPOINT_EXPORT_BUDGET).toBe(25);
    expect(violations).toEqual([]);
  });

  it("(3) POSITIVE CONTROL: a star wall in a package with no ceiling IS reported", () => {
    const violations = checkExportSurface([{ pkg: "invented", exports: 4, starExports: 2 }], () => null);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("2 `export * from` wall(s) with no ceiling");
  });

  it("(4) growth above rootEntrypointExports is not a violation", () => {
    const violations = checkExportSurface(
      [{ pkg: "p", exports: 80, starExports: 3 }],
      () => ({ rootEntrypointExports: 70, starExports: 3 }),
    );
    expect(violations).toEqual([]);
  });

  it("(5) a star ceiling left above a removed wall is reported; the export count ceiling is not", () => {
    const violations = checkExportSurface(
      [{ pkg: "p", exports: 40, starExports: 1 }],
      () => ({ rootEntrypointExports: 70, starExports: 4 }),
    );
    const detail = violations.map((v) => v.detail).join("\n");
    expect(detail).not.toContain("ceiling 70");
    expect(detail).toContain("star ceiling 4 is above the measured 1");
  });

  it("(6) COUNTERWEIGHT: a package under budget with no star walls and no ceiling is NOT reported", () => {
    expect(checkExportSurface([{ pkg: "p", exports: 12, starExports: 0 }], () => null)).toEqual([]);
  });

  it("(7) SUPERSEDED: no package publishes an export * wall (plan criterion 3)", () => {
    // Was: "the symbol counter follows export * chains rather than counting lines", written against
    // whichever package still had stars (xr-station, then data-mongodb). On 2026-09-11 the public-surface
    // program removed the last two (data-mongodb src/index.ts), and plan criterion 3 requires zero
    // `export * from` in supported entrypoints, so this clause now guards that absence.
    // If a star wall returns, do NOT widen this: remove the wall. If the counter itself must be re-proved,
    // restore the old property assertion against a FIXTURE package with a star chain (symbols > walls,
    // ceiling == measured exports), not against a live package.
    const measured = measureExportSurface();
    const walled = measured.filter((m) => m.starExports > 0).map((m) => `${m.pkg} (${m.starExports})`);
    expect(walled, "packages with export * walls (plan criterion 3 requires none)").toEqual([]);
  });

  it("(8) a re-exported name is counted once, under its exported alias", () => {
    const url = new URL("../checks/export-surface-budgets.ts", import.meta.url);
    const symbols = exportedSymbols(url.pathname);
    expect(symbols.has("checkExportSurface")).toBe(true);
    expect(symbols.has("ENTRYPOINT_EXPORT_BUDGET")).toBe(true);
    expect(symbols.has("STAR_EXPORT")).toBe(false);
  });
});
