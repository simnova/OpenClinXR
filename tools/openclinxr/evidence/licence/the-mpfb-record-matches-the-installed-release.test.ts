import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installedMpfbPaths, readInstalledMpfbLicence } from "./mpfb-installed-release-licence.js";

/**
 * Brief §6, verbatim: "The repository records an unshipped-build-tool distinction, but its
 * extension row says AGPL-3 while its split-license row says GPL-3.0-or-later. Correct that record
 * against the exact installed release. Current upstream inspection supports GPL rather than the
 * AGPL label."
 *
 * THE MEASUREMENT (2026-09-09, installed MPFB 2.0.15, blender_manifest.toml sha256
 * b7e1d0732e67cc18955f91b91ff9049b9f0bc868f05eb074e4ea3cf38fa3ddd5):
 *
 *   license = ["SPDX:GPL-3.0-or-later"]        the only licence the extension declares
 *   3 files contain "AGPL"                     all three are the MakeClothes/MakeSkin
 *                                              author-selectable OUTPUT licence and its writer
 *
 * THE AGPL LABEL HAD PROPAGATED. Row 24 of the licence ledger said "AGPL-3 (plugin code)", and that
 * string reached the `licenseChain` of every shipped humanoid provenance record: eight assets each
 * asserting their build tool is AGPL when the installed release says GPL-3.0-or-later. This is why
 * the correction is a gate and not a note — a prose fix repairs the row a reader happens to open.
 *
 * THE EXTENSION IS OUTSIDE THE REPO, so clauses (1)-(3) are the durable half and run on any
 * machine; clause (4) re-verifies the installed bytes only where the extension exists.
 */

const REPO = path.resolve(import.meta.dirname, "../../../..");
const RECORD = path.join(REPO, "docs/openclinxr/asset-licence-records/row-24-mpfb2-blender-extension.json");
const HUMANOIDS = path.join(REPO, "apps/ui-xr/public/generated-humanoids");
const MANIFEST_SHA256 = "b7e1d0732e67cc18955f91b91ff9049b9f0bc868f05eb074e4ea3cf38fa3ddd5";

describe("the MPFB licence record matches the installed release", () => {
  it("(1) the extension row says GPL-3.0-or-later and NOT AGPL", () => {
    const row = readFileSync(RECORD, "utf8");
    expect(row).toContain("GPL-3.0-or-later");
    // The row must still say AGPL somewhere — it records the correction — but never as MPFB's own
    // licence. Matching the whole file for "AGPL" would forbid explaining what was wrong.
    const cells = (JSON.parse(row) as { cells: string[] }).cells;
    expect(cells[1], "the licence CELL is the claim; the rationale cell may discuss the old label").not.toMatch(/AGPL/u);
    expect(cells[1]).toMatch(/GPL-3\.0-or-later/u);
  });

  it("(2) no shipped humanoid provenance record asserts MPFB is AGPL", () => {
    // This is the class the row-only fix would have missed.
    const offenders: string[] = [];
    for (const file of readdirSync(HUMANOIDS)) {
      if (!file.endsWith(".provenance.json")) continue;
      const text = readFileSync(path.join(HUMANOIDS, file), "utf8");
      if (/MPFB is licensed AGPL/u.test(text)) offenders.push(file);
    }
    expect(
      offenders,
      "a shipped asset's licenceChain names AGPL for MPFB; the installed release declares SPDX:GPL-3.0-or-later",
    ).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the records still carry the split-licence fact, so this was not fixed by deletion", () => {
    // Removing every licence sentence would satisfy clauses (1) and (2) and destroy the ledger.
    const row = readFileSync(RECORD, "utf8");
    expect(row).toMatch(/LICENSE\.ASSETS\.md|CC0/u);
    const physician = readFileSync(path.join(HUMANOIDS, "mpfb-clinical-physician-adult.provenance.json"), "utf8");
    expect(physician).toMatch(/GPL-3\.0-or-later/u);
    expect(physician).toMatch(/CC0|CC-BY/u);
  });

  it("(4) where the extension IS installed, its manifest still declares what the record says", () => {
    const installed = installedMpfbPaths();
    if (installed.length === 0) {
      // Recorded rather than skipped: a machine without the extension cannot verify the bytes, and
      // saying so is the honest result. Clauses (1)-(3) still gate the repository's own records.
      expect(existsSync(RECORD)).toBe(true);
      return;
    }
    const measured = readInstalledMpfbLicence(installed[0]!);
    expect(measured.declaredLicenses).toEqual(["SPDX:GPL-3.0-or-later"]);
    expect(measured.manifestSha256, "the installed manifest moved since the recorded measurement").toBe(MANIFEST_SHA256);
    // Every AGPL mention must be classified. An unclassified one is a new fact, not noise.
    for (const mention of measured.agplMentions) {
      expect(mention.reason, `${mention.file} mentions AGPL and is unclassified`).not.toMatch(/unclassified/u);
    }
  });
});
