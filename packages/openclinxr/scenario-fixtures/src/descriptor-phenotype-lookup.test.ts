/**
 * issue-293 — unit safety rail for the descriptor -> numeric lookup.
 *
 * Pins the derivation contract independently of the committed export: the
 * lookup must reproduce the authored seed's numbers for the school-aged profile,
 * must NOT invent identity the case does not state (hair/eye/skin/build/pose),
 * and must return undefined for actors the case describes with nothing mappable.
 */

import { describe, expect, it } from "vitest";

import { DESCRIPTOR_DERIVED_MARKER, derivePhenotypeFromDescriptors } from "./descriptor-phenotype-lookup.js";
import { pediatricAsthmaScenario } from "./pediatric-asthma.js";
import { pedsFeverScenario } from "./peds-fever.js";

describe("descriptor phenotype lookup (issue-293)", () => {
  it("derives the school-aged child to the authored seed's exact numbers", () => {
    const noah = pedsFeverScenario.actors.find((actor) => actor.actorId === "patient_noah_chen_v1");
    expect(noah).toBeDefined();
    if (noah === undefined) throw new Error("fixture actor patient_noah_chen_v1 missing");
    const derived = derivePhenotypeFromDescriptors(pedsFeverScenario, noah);
    expect(derived).toMatchObject({
      body_profile: "pediatric_school_age",
      age: 8,
      height_cm: 125,
      bmi: 16.5,
      gender_presentation: "child",
      [DESCRIPTOR_DERIVED_MARKER]: true,
    });
  });

  it("never invents identity or disease-specific fields the descriptor cannot supply", () => {
    const noah = pedsFeverScenario.actors.find((actor) => actor.actorId === "patient_noah_chen_v1");
    if (noah === undefined) throw new Error("fixture actor patient_noah_chen_v1 missing");
    const derived = derivePhenotypeFromDescriptors(pedsFeverScenario, noah);
    expect(derived).toBeDefined();
    for (const field of ["hair_color", "eye_color", "skin_tone", "build", "pose", "clothing_style"]) {
      expect(derived?.[field], `${field} must stay absent — it is not derivable from the case`).toBeUndefined();
    }
  });

  it("returns undefined for actors the case describes with nothing mappable", () => {
    for (const actor of pedsFeverScenario.actors) {
      if (actor.actorId === "patient_noah_chen_v1") continue;
      expect(
        derivePhenotypeFromDescriptors(pedsFeverScenario, actor),
        `${actor.actorId}: no age-band descriptor — nothing to derive`,
      ).toBeUndefined();
    }
  });

  it("an authored phenotype always wins over the lookup", () => {
    const maya = pediatricAsthmaScenario.actors.find((actor) => actor.actorId === "patient_maya_johnson_v1");
    expect(maya).toBeDefined();
    if (maya === undefined) throw new Error("fixture actor patient_maya_johnson_v1 missing");
    expect(derivePhenotypeFromDescriptors(pediatricAsthmaScenario, maya)).toBeUndefined();
  });
});
