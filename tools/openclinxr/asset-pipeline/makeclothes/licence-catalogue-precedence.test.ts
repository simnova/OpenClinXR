/**
 * 2026-09-17 — catalogue-over-file precedence (OPERATOR RULING: the MakeHuman
 * asset-pack catalogue listing governs even over an explicit per-file AGPL
 * declaration — "go with what site links say (CC0 over AGPLv3)").
 *
 * Synthetic fixtures only: no live provider-cache dependency, so these run
 * identically on a clean clone with nothing staged.
 *
 * NOT TESTED: pixel grade of any fitted garment, clinical appropriateness,
 * Quest readiness, skin-pack consumption (no skin consumer exists).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyHairLicence } from "./hair-licence-classify.js";
import {
  isPermittedGarmentLicense,
  readMhcloLicense,
  resolveGarmentLicense,
} from "./fit-cli.js";
import { resolveLicencePrecedence } from "./licence-precedence.js";
import { packSlugFromPath, type CatalogueEntry } from "./makehuman-catalogue.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../../..");

function silentMhclo(uuid: string): string {
  return [
    "# Exported from MakeClothes (TM)",
    "# author Synthetic",
    `uuid ${uuid}`,
    "basemesh hm08",
    "",
    "verts 0",
  ].join("\n");
}

function writeTmpMhclo(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "openclinxr-licence-"));
  const p = join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
}

function conflictPacks(entry: Record<string, unknown>): Record<string, CatalogueEntry> {
  return {
    skins01: {
      licence: "CC0",
      licences: ["CC0", "AGPL3"],
      sourceUrl: "https://static.makehumancommunity.org/assets/assetpacks/index.html",
      packPageUrl: "https://static.makehumancommunity.org/assets/assetpacks/skins01.html",
      label: "test",
      fetchedAt: "2026-09-17",
      ...entry,
    } as CatalogueEntry,
  };
}

function listedPacks(licence: string): Record<string, CatalogueEntry> {
  return {
    testpack01: {
      licence: licence as CatalogueEntry["licence"],
      licences: [],
      sourceUrl: "https://static.makehumancommunity.org/assets/assetpacks/index.html",
      packPageUrl: "https://static.makehumancommunity.org/assets/assetpacks/testpack01.html",
      label: "test",
      fetchedAt: "2026-09-17",
    },
  };
}

describe("bake-gate catalogue-over-file precedence (2026-09-17 ruling)", () => {
  it("silent header + pack listed CC0 -> catalogue-permitted, provenance visible", () => {
    const v = classifyHairLicence(null, "hair01");
    expect(v.permitted).toBe(true);
    expect(v.refusalReason).toBeNull();
    expect(v.viaCatalogue).toBe(true);
    expect(v.via).toBe("catalogue");
    expect(v.family).toBe("catalogue_cc0");
    expect(v.attributionRequired).toBe(false);
  });

  it("skins01-shaped: explicit AGPL file + CC0 catalogue -> catalogue governs", () => {
    const v = classifyHairLicence("This file is licensed AGPLv3", "skins01");
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("catalogue");
    expect(v.viaCatalogue).toBe(true);
    expect(v.family).toBe("catalogue_cc0");
    expect(v.overriddenFileLicence).toBe("This file is licensed AGPLv3");
    expect(v.refusalReason).toBeNull();
  });

  it("explicit AGPL file + listed CC0 pack -> catalogue governs", () => {
    const v = classifyHairLicence("AGPL3", "hair01");
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("catalogue");
    expect(v.overriddenFileLicence).toBe("AGPL3");
    expect(v.refusalReason).toBeNull();
  });

  it("silent + pack NOT in catalogue -> refused as before", () => {
    const v = classifyHairLicence(null, "no_such_pack_xyz");
    expect(v.permitted).toBe(false);
    expect(v.family).toBe("none");
    expect(v.viaCatalogue).toBe(false);
    expect(v.via).toBe("none");
    expect(v.refusalReason).toMatch(/no licence line/i);
  });

  it("unlisted pack + explicit AGPL file -> refused with copyleft reason, via file", () => {
    const v = classifyHairLicence("AGPL3", "no_such_pack_xyz");
    expect(v.permitted).toBe(false);
    expect(v.family).toBe("agpl3");
    expect(v.via).toBe("file");
    expect(v.viaCatalogue).toBe(false);
    expect(v.refusalReason).toMatch(/copyleft|AGPL/i);
  });

  it("listed pack + unrecognised token -> catalogue governs", () => {
    const v = classifyHairLicence("SomeCustom Licence 2.0 (all rights reserved)", "hair01");
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("catalogue");
    expect(v.overriddenFileLicence).toBe("SomeCustom Licence 2.0 (all rights reserved)");
  });

  it("unrecognised token + unlisted pack -> refused via file", () => {
    const v = classifyHairLicence("SomeCustom Licence 2.0 (all rights reserved)", "no_such_pack_xyz");
    expect(v.permitted).toBe(false);
    expect(v.family).toBe("unknown");
    expect(v.via).toBe("file");
    expect(v.viaCatalogue).toBe(false);
  });

  it("resolveGarmentLicense: silent shoes01 fixture -> catalogue CC0 permitted", () => {
    const p = writeTmpMhclo(
      "silent_shoe.mhclo",
      silentMhclo("11111111-1111-4111-8111-111111111111"),
    );
    expect(readMhcloLicense(p).token).toBe("license_not_found_in_mhclo_header");
    const r = resolveGarmentLicense(p, "shoes01");
    expect(r.permitted).toBe(true);
    expect(r.viaCatalogue).toBe(true);
    expect(r.via).toBe("catalogue");
    expect(r.token).toBe("CC0");
    expect(r.source).toMatch(/catalogue:shoes01=CC0/);
    expect(r.source).toMatch(/static\.makehumancommunity\.org/);
  });

  it("resolveGarmentLicense: explicit AGPL fixture + CC0 pack -> catalogue governs", () => {
    const p = writeTmpMhclo(
      "agpl_shoe.mhclo",
      ["# Exported from MakeClothes (TM)", "# license AGPL3", "uuid 22222222-2222-4222-8222-222222222222", "basemesh hm08", "", "verts 0"].join(
        "\n",
      ),
    );
    const r = resolveGarmentLicense(p, "skins01");
    expect(r.permitted).toBe(true);
    expect(r.via).toBe("catalogue");
    expect(r.viaCatalogue).toBe(true);
    expect(r.overriddenFileLicence).toMatch(/AGPL3/);
    expect(r.source).toMatch(/overrides file licence=AGPL3/);
    expect(r.source).toMatch(/static\.makehumancommunity\.org/);
  });

  it("resolveGarmentLicense: silent + unknown pack -> refused as before", () => {
    const p = writeTmpMhclo(
      "silent_unknown.mhclo",
      silentMhclo("33333333-3333-4333-8333-333333333333"),
    );
    const r = resolveGarmentLicense(p, "no_such_pack_xyz");
    expect(r.permitted).toBe(false);
    expect(r.viaCatalogue).toBe(false);
    expect(r.via).toBe("none");
  });

  it("resolveGarmentLicense: unrecognised token + listed pack -> catalogue governs", () => {
    const p = writeTmpMhclo(
      "weird.mhclo",
      ["# license: SomeCustom Licence 2.0", "uuid 44444444-4444-4444-8444-444444444444", "basemesh hm08", "", "verts 0"].join(
        "\n",
      ),
    );
    const r = resolveGarmentLicense(p, "shoes01");
    expect(r.permitted).toBe(true);
    expect(r.via).toBe("catalogue");
  });

  it("catalogue CC0 over a file CC BY 4.0 -> permitted via catalogue, attribution kept", () => {
    // Rank 3 (catalogue CC0) > rank 2 (file CC-BY): the more permissive side governs.
    const v = classifyHairLicence("CC BY 4.0", "hair01");
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("catalogue");
    expect(v.attributionRequired).toBe(true);
    expect(v.overriddenFileLicence).toBe("CC BY 4.0");
  });

  it("stricter catalogue loses: listed CC-BY + file CC0 -> the FILE governs", () => {
    const v = resolveLicencePrecedence({
      packSlug: "testpack01",
      file: { declared: "CC0", permitted: true, attributionRequired: false, refusalReason: null },
      packs: listedPacks("CC-BY"),
    });
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("file");
    expect(v.licence).toBe("CC0");
    expect(v.overriddenFileLicence).toBeNull();
    expect(v.attributionRequired).toBe(false);
  });

  it("resolveGarmentLicense: CC0 file + listed CC0 pack -> file governs, catalogue no longer overrides", () => {
    // resolveGarmentLicense reads the committed all-CC0 snapshot (no pack injection),
    // so this leg proves the equal-rank file-governs path; the listed-CC-BY direction
    // is covered on resolveLicencePrecedence with injected packs above.
    const p = writeTmpMhclo(
      "cc0_shoe.mhclo",
      ["# Exported from MakeClothes (TM)", "# license CC0", "uuid 66666666-6666-4666-8666-666666666666", "basemesh hm08", "", "verts 0"].join(
        "\n",
      ),
    );
    const r = resolveGarmentLicense(p, "shoes01");
    expect(r.permitted).toBe(true);
    expect(r.via).toBe("file");
    expect(r.viaCatalogue).toBe(false);
    expect(r.token).toBe("CC0");
    expect(r.overriddenFileLicence).toBeNull();
  });

  it("a garbled file token never beats a listed catalogue: CC0 pack governs", () => {
    const v = resolveLicencePrecedence({
      packSlug: "testpack01",
      file: {
        declared: "Fancy Custom Licence 9 (all rights reserved)",
        permitted: false,
        attributionRequired: false,
        refusalReason: "unrecognised",
      },
      packs: listedPacks("CC0"),
    });
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("catalogue");
    expect(v.licence).toBe("CC0");
    expect(v.overriddenFileLicence).toBe("Fancy Custom Licence 9 (all rights reserved)");
  });

  it("a garbled catalogue value never beats a CC0 file: the FILE governs", () => {
    const v = resolveLicencePrecedence({
      packSlug: "testpack01",
      file: { declared: "CC0", permitted: true, attributionRequired: false, refusalReason: null },
      packs: listedPacks("Fancy Custom Licence 9 (all rights reserved)"),
    });
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("file");
    expect(v.licence).toBe("CC0");
    expect(v.overriddenFileLicence).toBeNull();
  });

  it("equal ranks keep the file: listed CC0 pack + file CC-0 -> via file", () => {
    const v = resolveLicencePrecedence({
      packSlug: "testpack01",
      file: { declared: "CC-0", permitted: true, attributionRequired: false, refusalReason: null },
      packs: listedPacks("CC0"),
    });
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("file");
    expect(v.licence).toBe("CC-0");
    expect(v.overriddenFileLicence).toBeNull();
  });

  it("conflicting catalogue listing refuses; the file never rescues it", () => {
    const agpl = resolveLicencePrecedence({
      packSlug: "skins01",
      file: { declared: "AGPL3", permitted: false, attributionRequired: false, refusalReason: "copyleft" },
      packs: conflictPacks({}),
    });
    expect(agpl.permitted).toBe(false);
    expect(agpl.via).toBe("none");
    expect(agpl.refusalReason).toMatch(/CC0/);
    expect(agpl.refusalReason).toMatch(/AGPL3/);
    const cc0 = resolveLicencePrecedence({
      packSlug: "skins01",
      file: { declared: "CC0", permitted: true, attributionRequired: false, refusalReason: null },
      packs: conflictPacks({}),
    });
    expect(cc0.permitted).toBe(false);
    expect(cc0.via).toBe("none");
  });

  it("a CC0/CC-0 spelling-only pair is NOT a conflict", () => {
    const v = resolveLicencePrecedence({
      packSlug: "shoes01",
      file: { declared: null, permitted: false, attributionRequired: false, refusalReason: "silent" },
      packs: {
        shoes01: {
          licence: "CC0" as const,
          licences: ["CC-0"],
          sourceUrl: "https://static.makehumancommunity.org/assets/assetpacks/index.html",
          packPageUrl: "https://static.makehumancommunity.org/assets/assetpacks/shoes01.html",
          label: "test",
          fetchedAt: "2026-09-17",
        },
      },
    });
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("catalogue");
  });

  it("copyleft catalogue never governs: listed AGPL3 + silent file -> refused via none", () => {
    const v = resolveLicencePrecedence({
      packSlug: "testpack01",
      file: { declared: null, permitted: false, attributionRequired: false, refusalReason: "silent" },
      packs: listedPacks("AGPL3"),
    });
    expect(v.permitted).toBe(false);
    expect(v.via).toBe("none");
    expect(v.licence).toBeNull();
    expect(v.refusalReason).toMatch(/AGPL3/);
    expect(v.refusalReason).toMatch(/testpack01/);
  });

  it("garbled catalogue never governs: listed custom token + garbled file -> refused via none", () => {
    const v = resolveLicencePrecedence({
      packSlug: "testpack01",
      file: {
        declared: "Fancy Custom Licence 9 (all rights reserved)",
        permitted: false,
        attributionRequired: false,
        refusalReason: "unrecognised",
      },
      packs: listedPacks("Fancy Custom Licence 9"),
    });
    expect(v.permitted).toBe(false);
    expect(v.via).toBe("none");
  });

  it("counterweight: listed CC-BY + silent file -> permitted via catalogue, attribution required", () => {
    const v = resolveLicencePrecedence({
      packSlug: "testpack01",
      file: { declared: null, permitted: false, attributionRequired: false, refusalReason: "silent" },
      packs: listedPacks("CC-BY"),
    });
    expect(v.permitted).toBe(true);
    expect(v.via).toBe("catalogue");
    expect(v.attributionRequired).toBe(true);
  });

  it("the file-side token test still describes the file side", () => {
    expect(isPermittedGarmentLicense("AGPL3")).toBe(false);
    expect(isPermittedGarmentLicense("CC0")).toBe(true);
  });

  it("resolveGarmentLicense derives the slug from a staged-style path", () => {
    const p = writeTmpMhclo(
      "silent_derived.mhclo",
      silentMhclo("55555555-5555-4555-8555-555555555555"),
    );
    expect(packSlugFromPath(".openclinxr-local/provider-cache/garments/sources/makehuman-shoes01/toigo_flats/toigo_flats.mhclo")).toBe(
      "shoes01",
    );
    const r = resolveGarmentLicense(
      p,
      packSlugFromPath(
        ".openclinxr-local/provider-cache/garments/sources/makehuman-shoes01/toigo_flats/toigo_flats.mhclo",
      ),
    );
    expect(r.permitted).toBe(true);
    expect(r.viaCatalogue).toBe(true);
  });

  it("python licence_precedence_test.py passes", () => {
    execFileSync(
      "python3",
      ["tools/openclinxr/asset-pipeline/makeclothes/licence_precedence_test.py"],
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
  });
});
