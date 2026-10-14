import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: ActorPhenotypeSchema declares skin_tone and eye_color but not
 * skin_asset_id, face_targets, lip_tone, or reference_portrait, so the D13
 * case home for chosen face-target weights has no declared field.
 * SKIN_MHMAT_BY_REFERENCE is 1 row keyed outside the case definition.
 *
 * MEASURED 2026-10-14. schemas.ts:262-290 declares skin_tone/eye_color with
 * additionalProperties true; none of the 4 face keys is declared.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const PHENO = readFileSync(join(SRC, "actor-phenotype.ts"), "utf8");
const SLICE = PHENO.slice(PHENO.indexOf("export const ActorPhenotypeSchema"));
const SCHEMAS = readFileSync(join(SRC, "..", "schemas.ts"), "utf8");

describe("the face phenotype fields are declared", () => {
  it("(1) ActorPhenotypeSchema declares the 4 face keys optional", () => {
    for (const key of ["skin_asset_id", "face_targets", "lip_tone", "reference_portrait"]) {
      expect(SLICE).toMatch(new RegExp(`${key}: Type\\.Optional\\(`));
    }
  });

  it("(2) COUNTERWEIGHT: face_targets is a name-to-weight map", () => {
    expect(SLICE).toMatch(/face_targets: Type\.Optional\(Type\.Record\(Type\.String\(\), Type\.Number\(\)\)\)/);
  });

  it("(3) COUNTERWEIGHT: reference_portrait carries path, sha256, and licence", () => {
    for (const sub of ["path", "sha256", "licence"]) {
      expect(SLICE).toMatch(new RegExp(`\\b${sub}: Type\\.String\\(\\)`));
    }
  });

  it("(4) COUNTERWEIGHT: schemas.ts still re-exports ActorPhenotypeSchema", () => {
    expect(SCHEMAS).toMatch(/import \{ ActorPhenotypeSchema \} from "\.\/face-phenotype\/actor-phenotype\.js"/);
    expect(SCHEMAS).toMatch(/export \{ ActorPhenotypeSchema \};/);
  });
});

// NOT TESTED: runtime consumption of the new keys is face-station.
