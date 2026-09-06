import { describe, expect, it } from "vitest";
import {
  checkAppFileNaming,
  checkAppSourceBudgets,
  checkValidationSeparation,
  COMPOSITION_ROOT_APP_BUDGETS,
  KEBAB_CASE_APP_ROOTS,
  measureAppSource,
  VALIDATION_SEPARATION_FREEZE,
} from "../checks/composition-root-conventions.js";

/**
 * OBSERVABLE: apps/ are not composition roots. They hold the product.
 *
 * MEASURED 2026-09-06 on main 52f80ec9, non-test .ts/.tsx under each src/,
 * excluding node_modules, dist and *.d.ts:
 *
 *   apps/api        41 files    10,106 lines   (api-route-support.ts 1,118)
 *   apps/ui-admin   40 files    11,941 lines   (app.tsx 1,601)
 *   apps/ui-xr     101 files    33,795 lines   (main.ts 9,928)
 *                  ---------------------------
 *                  182 files    55,842 lines
 *
 * KNOWN-GOOD COLUMN, the reference the operator named: the CellixJs clone at
 * /Volumes/files/src/cellixjs-current, same measurement:
 *
 *   apps/api                        15 files      686 lines
 *   apps/ui-community               19 files    1,506 lines
 *   apps/ui-staff                   18 files    1,054 lines
 *   apps/server-mongodb-memory-mock 10 files      606 lines
 *   apps/docs                       10 files      416 lines
 *   apps/server-oauth2-mock          4 files      138 lines
 *
 * Its largest app is 1,506 lines and its apps/ total is about 4,400. Every
 * behaviour lives in packages/ocom/** and packages/cellix/**; apps/api/src/index.ts
 * registers infrastructure services and sets context, and nothing else.
 *
 * Three defects follow from that, and this file gates all three:
 *
 *  (a) SIZE. Nothing stops an app growing. A ratchet frozen at the measurement
 *      above makes every new behaviour land in a package.
 *  (b) VALIDATION MIXED WITH FUNCTIONALITY. 31 non-test apps/** files export a
 *      function named parse…, validate…, assert… or is… alongside other exports. Two of them
 *      (world-compile-routes.ts, factory-run-table-routes.ts) were added earlier
 *      today, so this is the live default, not legacy drift.
 *  (c) NAMING. The kebab-case rule covers packages/openclinxr/ui-* and
 *      apps/ui-admin only. apps/ui-xr measures 0 violations and is uncovered;
 *      apps/arena measures 4, all in model-vetting-studio/src/pipeline-admin.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED.
 *
 * ## SUPERSEDED (cellix-m1)
 * The header's numbers are the measurement at plant time and stay. The api migration
 * moved apps/api/src/routes and its six support modules into @openclinxr/rest, taking
 * apps/api from 41 files / 10,106 lines to 11 / 2,541, and the xr-station move took
 * apps/ui-xr from 101 / 33,795 to 67 / 27,799. The admin panels moved to @openclinxr/ui-route-admin, taking apps/ui-admin from
 * 40 / 11,941 to 7 / 3,724. The mixer count fell 31 -> 16.
 * Both ratchets are shrink-only: they may fall further, never rise.
 *
 * claimScope: gates that stop apps/ growing and force new code into packages.
 * notEvidenceFor: that any code has moved yet; that the package layout matches
 * ocom's; runtime behaviour of anything measured here.
 */

async function check(): Promise<{
  COMPOSITION_ROOT_APP_BUDGETS: typeof COMPOSITION_ROOT_APP_BUDGETS;
  VALIDATION_SEPARATION_FREEZE: typeof VALIDATION_SEPARATION_FREEZE;
  KEBAB_CASE_APP_ROOTS: typeof KEBAB_CASE_APP_ROOTS;
  measureAppSource: typeof measureAppSource;
  checkAppSourceBudgets: typeof checkAppSourceBudgets;
  checkValidationSeparation: typeof checkValidationSeparation;
  checkAppFileNaming: typeof checkAppFileNaming;
}> {
  return {
    COMPOSITION_ROOT_APP_BUDGETS,
    VALIDATION_SEPARATION_FREEZE,
    KEBAB_CASE_APP_ROOTS,
    measureAppSource,
    checkAppSourceBudgets: checkAppSourceBudgets as typeof checkAppSourceBudgets,
    checkValidationSeparation: checkValidationSeparation as typeof checkValidationSeparation,
    checkAppFileNaming: checkAppFileNaming as typeof checkAppFileNaming,
  };
}

describe("the apps are composition roots", () => {
  it("(1) the budget list covers exactly the three production apps", async () => {
    const { COMPOSITION_ROOT_APP_BUDGETS } = await check();
    expect(COMPOSITION_ROOT_APP_BUDGETS.map((b) => b.app).sort()).toEqual([
      "apps/api",
      "apps/ui-admin",
      "apps/ui-xr",
    ]);
  });

  it("(2) every app is at or under its frozen budget", async () => {
    const { checkAppSourceBudgets } = await check();
    expect(checkAppSourceBudgets()).toEqual([]);
  });

  it("(3) the budgets are the measured ceiling, so one more line fails", async () => {
    // Not "some large number": the freeze must equal what the tree measures today,
    // or the ratchet has slack and apps keep growing inside it.
    const { COMPOSITION_ROOT_APP_BUDGETS, measureAppSource, checkAppSourceBudgets } = await check();
    for (const budget of COMPOSITION_ROOT_APP_BUDGETS) {
      const measured = measureAppSource(budget.app);
      expect(budget.maxLines, `${budget.app} maxLines`).toBe(measured.lines);
      expect(budget.maxFiles, `${budget.app} maxFiles`).toBe(measured.files);
    }
    const tightened = COMPOSITION_ROOT_APP_BUDGETS.map((b) => ({ ...b, maxLines: b.maxLines - 1 }));
    expect(checkAppSourceBudgets(tightened)).toHaveLength(COMPOSITION_ROOT_APP_BUDGETS.length);
  });

  it("(4) COUNTERWEIGHT: the measurement is taken from the tree, not from a literal", async () => {
    const { measureAppSource } = await check();
    const api = measureAppSource("apps/api");
    const xr = measureAppSource("apps/ui-xr");
    expect(api.files).toBeGreaterThan(0);
    expect(xr.lines).toBeGreaterThan(api.lines);
    expect(measureAppSource("apps/does-not-exist")).toEqual({ files: 0, lines: 0 });
  });

  it("(5) validation separation is frozen and the freeze is not padded", async () => {
    const { VALIDATION_SEPARATION_FREEZE, checkValidationSeparation } = await check();
    expect(checkValidationSeparation()).toEqual([]);
    const live = new Set(
      checkValidationSeparation({ freeze: {} }).map((violation) => violation.file ?? ""),
    );
    const padded = Object.keys(VALIDATION_SEPARATION_FREEZE).filter((file) => !live.has(file));
    expect(padded).toEqual([]);
  });

  it("(6) the frozen validation-mixing set is the 15 measured files", async () => {
    const { checkValidationSeparation } = await check();
    expect(checkValidationSeparation({ freeze: {} })).toHaveLength(15);
  });

  it("(7) COUNTERWEIGHT: a NEW file mixing a validator with other exports is reported", async () => {
    const { VALIDATION_SEPARATION_FREEZE, checkValidationSeparation } = await check();
    const found = checkValidationSeparation({
      freeze: VALIDATION_SEPARATION_FREEZE,
      sources: [
        {
          file: "apps/api/src/planted-mixed-module.ts",
          text: [
            "export function parseThing(raw: unknown) { return raw; }",
            "export function doTheWork() { return 1; }",
          ].join("\n"),
        },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].file).toBe("apps/api/src/planted-mixed-module.ts");
  });

  it("(8) COUNTERWEIGHT: a validator-only module is NOT reported", async () => {
    const { checkValidationSeparation } = await check();
    const found = checkValidationSeparation({
      freeze: {},
      sources: [
        {
          file: "apps/api/src/planted-validation.ts",
          text: [
            "export function parseThing(raw: unknown) { return raw; }",
            "export function validateOther(raw: unknown) { return raw; }",
          ].join("\n"),
        },
      ],
    });
    expect(found).toEqual([]);
  });

  it("(9) kebab-case now covers ui-xr and arena, at zero violations", async () => {
    const { KEBAB_CASE_APP_ROOTS, checkAppFileNaming } = await check();
    expect(KEBAB_CASE_APP_ROOTS).toContain("apps/ui-xr/src");
    expect(KEBAB_CASE_APP_ROOTS).toContain("apps/arena");
    expect(checkAppFileNaming()).toEqual([]);
  });

  it("(10) COUNTERWEIGHT: a PascalCase source in a covered root is reported", async () => {
    const { checkAppFileNaming } = await check();
    const found = checkAppFileNaming({
      sources: [{ file: "apps/ui-xr/src/PlantedPascalCase.ts", text: "export const x = 1;" }],
    });
    expect(found).toHaveLength(1);
  });

  it("(11) COUNTERWEIGHT: a test file keeps the name of the source it covers", async () => {
    const { checkAppFileNaming } = await check();
    const found = checkAppFileNaming({
      sources: [{ file: "apps/ui-xr/src/SomeThing.test.ts", text: "export const x = 1;" }],
    });
    expect(found).toEqual([]);
  });
});

// PLANT LOCATION: outside src/archunit-tests/ deliberately. Pre-commit runs
// pnpm architecture, which globs that directory, so a red planted there blocks every
// commit in the repo until it is fixed. Relocating this file into src/archunit-tests/
// with its header verbatim is part of the contract, once it is green.
//
// NOT TESTED: that any behaviour has moved from apps/ into packages/ (the budgets only
// stop growth); that packages/openclinxr is organised the way packages/ocom is; that
// the 31 frozen files are ever split.
