import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: ActorPhenotypeFields authors 8 of 24 ActorPhenotypeSchema keys
 * (garmentLayers, clothing_style, wardrobeRole, fabricPalette, skin_tone,
 * hair_color, eye_color, gender_presentation). Numeric identity that drives
 * Anny-as-reference → MPFB body match (age, height_cm, bmi, build,
 * hair_density, anxious, flush, brow_tension, age_wrinkle) has no control.
 *
 * MEASURED 2026-08-29. actor-phenotype-fields.tsx:73-173. Schema
 * packages/openclinxr/shared-schemas/src/schemas.ts:155-181.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W15 tsk_de200f793df072b6)
 * ActorPhenotypeFields binds age, height_cm, bmi (plus anxious). garmentLayers stays.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const FIELDS = readFileSync(join(SRC, "actor-phenotype-fields.tsx"), "utf8");

describe("the worldview authors phenotype identity numbers", () => {
  it("(1) ActorPhenotypeFields binds age", () => {
    expect(FIELDS).toMatch(/"age"/);
  });

  it("(2) ActorPhenotypeFields binds height_cm", () => {
    expect(FIELDS).toMatch(/height_cm/);
  });

  it("(3) ActorPhenotypeFields binds bmi", () => {
    expect(FIELDS).toMatch(/"bmi"/);
  });

  it("(4) COUNTERWEIGHT: garmentLayers control remains", () => {
    expect(FIELDS).toMatch(/garmentLayers/);
  });
});

// NOT TESTED: inventing ED/OB phenotypes; live MPFB bake; #167.
