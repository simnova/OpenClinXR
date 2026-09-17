/**
 * 2026-09-17 — bake-gate silence fallback to the publisher catalogue.
 *
 * Synthetic fixtures only: no live provider-cache dependency, so these run
 * identically on a clean clone with nothing staged.
 *
 * NOT TESTED: pixel grade of any fitted garment, clinical appropriateness,
 * Quest readiness, skin-pack consumption (no skin consumer exists).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyHairLicence } from "./hair-licence-classify.js";
import {
  isPermittedGarmentLicense,
  readMhcloLicense,
  resolveGarmentLicense,
} from "./fit-cli.js";
import { packSlugFromPath } from "./makehuman-catalogue.js";

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

describe("bake-gate catalogue silence fallback (2026-09-17)", () => {
  it("silent header + pack listed CC0 -> catalogue-permitted, provenance visible", () => {
    const v = classifyHairLicence(null, "hair01");
    expect(v.permitted).toBe(true);
    expect(v.refusalReason).toBeNull();
    expect(v.viaCatalogue).toBe(true);
    expect(v.family).toBe("catalogue_cc0");
    expect(v.attributionRequired).toBe(false);
  });

  it("HARD GUARD: explicit AGPL + pack listed CC0 -> STAYS REFUSED", () => {
    const v = classifyHairLicence("AGPL3", "hair01");
    expect(v.permitted).toBe(false);
    expect(v.family).toBe("agpl3");
    expect(v.viaCatalogue).toBe(false);
    expect(v.refusalReason).toMatch(/hard refusal/i);
    // The real skins01/02 shape: `# This file is licensed AGPLv3` inside a
    // per-file descriptor of a CC0-listed pack must never flip.
    const v2 = classifyHairLicence("This file is licensed AGPLv3", "skins01");
    expect(v2.permitted).toBe(false);
    expect(v2.viaCatalogue).toBe(false);
  });

  it("silent + pack NOT in catalogue -> refused as before", () => {
    const v = classifyHairLicence(null, "no_such_pack_xyz");
    expect(v.permitted).toBe(false);
    expect(v.family).toBe("none");
    expect(v.viaCatalogue).toBe(false);
    expect(v.refusalReason).toMatch(/no licence line/i);
  });

  it("explicit-but-unrecognised token -> refused, catalogue never consulted", () => {
    const v = classifyHairLicence("SomeCustom Licence 2.0 (all rights reserved)", "hair01");
    expect(v.permitted).toBe(false);
    expect(v.family).toBe("unknown");
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
    expect(r.token).toBe("CC0");
    expect(r.source).toMatch(/catalogue:shoes01=CC0/);
    expect(r.source).toMatch(/static\.makehumancommunity\.org/);
  });

  it("resolveGarmentLicense: explicit AGPL fixture + CC0 pack -> STAYS REFUSED", () => {
    const p = writeTmpMhclo(
      "agpl_shoe.mhclo",
      ["# Exported from MakeClothes (TM)", "# license AGPL3", "uuid 22222222-2222-4222-8222-222222222222", "basemesh hm08", "", "verts 0"].join(
        "\n",
      ),
    );
    const r = resolveGarmentLicense(p, "shoes01");
    expect(r.permitted).toBe(false);
    expect(r.viaCatalogue).toBe(false);
    expect(isPermittedGarmentLicense(r.token)).toBe(false);
  });

  it("resolveGarmentLicense: silent + unknown pack -> refused as before", () => {
    const p = writeTmpMhclo(
      "silent_unknown.mhclo",
      silentMhclo("33333333-3333-4333-8333-333333333333"),
    );
    const r = resolveGarmentLicense(p, "no_such_pack_xyz");
    expect(r.permitted).toBe(false);
    expect(r.viaCatalogue).toBe(false);
  });

  it("resolveGarmentLicense: unrecognised token -> refused, catalogue never consulted", () => {
    const p = writeTmpMhclo(
      "weird.mhclo",
      ["# license: SomeCustom Licence 2.0", "uuid 44444444-4444-4444-8444-444444444444", "basemesh hm08", "", "verts 0"].join(
        "\n",
      ),
    );
    const r = resolveGarmentLicense(p, "shoes01");
    expect(r.permitted).toBe(false);
    expect(r.viaCatalogue).toBe(false);
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
});
