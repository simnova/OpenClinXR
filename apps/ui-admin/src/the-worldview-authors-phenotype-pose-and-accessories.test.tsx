import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: remaining phenotype keys pose, body_profile, clothing_color,
 * role_visual_cue, materialFinish, accessoryMarkers, fitProfile have no form
 * control. Wardrobe bake inputs beyond the four lock-override paths are hidden.
 *
 * MEASURED 2026-08-29. FACULTY_COMPILE_OVERRIDE_PATHS is four pointers
 * (faculty-compile-lock.tsx:8-13). ActorPhenotypeFields omits pose/accessories.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W16 tsk_7e3e199ba2760a8d)
 * ActorPhenotypeFields binds pose, accessoryMarkers, fitProfile plus the
 * remaining schema keys body_profile, clothing_color, role_visual_cue,
 * materialFinish. wardrobeRole stays.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const FIELDS = readFileSync(join(SRC, "ActorPhenotypeFields.tsx"), "utf8");

describe("the worldview authors phenotype pose and accessories", () => {
  it("(1) ActorPhenotypeFields binds pose", () => {
    expect(FIELDS).toMatch(/"pose"/);
  });

  it("(2) ActorPhenotypeFields binds accessoryMarkers", () => {
    expect(FIELDS).toMatch(/accessoryMarkers/);
  });

  it("(3) ActorPhenotypeFields binds fitProfile", () => {
    expect(FIELDS).toMatch(/fitProfile/);
  });

  it("(4) COUNTERWEIGHT: wardrobeRole control remains", () => {
    expect(FIELDS).toMatch(/wardrobeRole/);
  });
});

// NOT TESTED: garment visual grade; #167.
