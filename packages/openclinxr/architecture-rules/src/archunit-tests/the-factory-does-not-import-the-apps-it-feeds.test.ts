import { describe, expect, it } from "vitest";
import {
  APP_IMPORT_INVERSION_FREEZE,
  FACTORY_SCAN_ROOTS,
  detectFactoryAppImportInversions,
} from "../checks/factory-app-import-inversion.js";
/**
 * PLANT-PHASE NOTE (kept because it explains the diagnosis header below): while this file was a
 * planted RED the check module did not exist, and `pnpm hygiene:knip` fails closed on an
 * unresolved import, so the plant reached it through a non-static specifier. Now that the
 * module exists the import is static — knip fails closed the other way, reporting a module
 * whose only importer is non-static as an unused file.
 */
async function check(): Promise<{
  APP_IMPORT_INVERSION_FREEZE: typeof APP_IMPORT_INVERSION_FREEZE;
  FACTORY_SCAN_ROOTS: typeof FACTORY_SCAN_ROOTS;
  detectFactoryAppImportInversions: typeof detectFactoryAppImportInversions;
}> {
  return { APP_IMPORT_INVERSION_FREEZE, FACTORY_SCAN_ROOTS, detectFactoryAppImportInversions };
}

/**
 * OBSERVABLE: the production factory imports the learner app it is supposed to feed.
 * tools/openclinxr/dark-factory/multi-case-runner.ts runs its `room` stage through
 * apps/ui-xr/src/station-environment.ts and its `equipment` stage through
 * apps/ui-xr/src/station-equipment-builders.ts, so the chain cannot run without the
 * XR app's source tree and the dependency arrow points from factory to UI.
 *
 * MEASURED 2026-09-06 on main 5553652b, over packages/ and
 * tools/openclinxr/{dark-factory,factory}/ minus node_modules and dist:
 *   grep -rnE 'from "[^"]*apps/'  ->  exactly 2 matches, both in
 *   multi-case-runner.ts (station-environment.js, station-equipment-builders.js).
 *   packages/ has 0. tools/openclinxr/evidence/ has many and is OUT OF SCOPE by
 *   design: an evidence harness exists to drive the app, so importing it is correct.
 *
 * KNOWN-GOOD COLUMN: checks/file-size-budgets.ts is the same ratchet done right —
 * a hard rule for new code, a named brownfield freeze at the CURRENT measurement,
 * and a second assertion that an entry which no longer violates must be removed.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED.
 *
 * claimScope: a fitness rule that stops the inversion growing and names the two
 * that exist.
 * notEvidenceFor: that the two imports have been removed (the move of
 * station-environment and station-equipment-builders into a package is a separate
 * slice with 57 importers); Blender; Quest.
 */

describe("the factory does not import the apps it feeds", () => {
  it("(1) the scan covers the production factory path and excludes evidence harnesses", async () => {
    const { FACTORY_SCAN_ROOTS } = await check();
    expect(FACTORY_SCAN_ROOTS).toContain("packages");
    expect(FACTORY_SCAN_ROOTS.some((root) => root.includes("dark-factory"))).toBe(true);
    expect(FACTORY_SCAN_ROOTS.some((root) => root.includes("evidence"))).toBe(false);
  });

  it("(2) with an empty freeze list the detector reports exactly the two known inversions", async () => {
    const { detectFactoryAppImportInversions } = await check();
    const found = detectFactoryAppImportInversions({ freeze: {} });
    const paths = [...new Set(found.map((row) => row.file))].sort();
    expect(paths).toEqual(["tools/openclinxr/dark-factory/multi-case-runner.ts"]);
    expect(found.map((row) => row.specifier).sort()).toEqual([
      "../../../apps/ui-xr/src/station-environment.js",
      "../../../apps/ui-xr/src/station-equipment-builders.js",
    ]);
  });

  it("(3) with the shipped freeze list the tree is clean", async () => {
    const { detectFactoryAppImportInversions } = await check();
    expect(detectFactoryAppImportInversions()).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: an unfrozen violation in a scanned root is reported", async () => {
    const { APP_IMPORT_INVERSION_FREEZE, detectFactoryAppImportInversions } = await check();
    const found = detectFactoryAppImportInversions({
      freeze: APP_IMPORT_INVERSION_FREEZE,
      sources: [
        {
          file: "packages/openclinxr/factory-stations/src/planted-violation.ts",
          text: 'import { buildStationEnvironment } from "../../../../apps/ui-xr/src/station-environment.js";',
        },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].file).toBe("packages/openclinxr/factory-stations/src/planted-violation.ts");
  });

  it("(5) COUNTERWEIGHT: the freeze list may not name a path that does not violate", async () => {
    const { APP_IMPORT_INVERSION_FREEZE, detectFactoryAppImportInversions } = await check();
    const live = new Set(detectFactoryAppImportInversions({ freeze: {} }).map((row) => row.file));
    const padded = Object.keys(APP_IMPORT_INVERSION_FREEZE).filter((path) => !live.has(path));
    expect(padded).toEqual([]);
  });

  it("(6) COUNTERWEIGHT: a scanned file with no app import is not reported", async () => {
    const { detectFactoryAppImportInversions } = await check();
    const found = detectFactoryAppImportInversions({
      freeze: {},
      sources: [
        {
          file: "packages/openclinxr/factory-stations/src/clean.ts",
          text: 'import { thing } from "./catalog.js";\nimport type { X } from "@openclinxr/shared-schemas";',
        },
      ],
    });
    expect(found).toEqual([]);
  });
});

// PLANT LOCATION: this file is planted OUTSIDE src/archunit-tests/ deliberately —
// pre-commit runs `pnpm architecture`, which globs src/archunit-tests/**, so a red planted
// there would block every commit in the repo until it was fixed. Relocating this file into
// src/archunit-tests/ with its header VERBATIM is part of the contract, once it is green.
//
// NOT TESTED: that the two frozen imports are ever removed; that the move of
// station-environment.ts and station-equipment-builders.ts into a package happens (57
// importers, a separate slice).
