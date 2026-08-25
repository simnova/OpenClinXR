/**
 * issue-293 + issue-605 — deterministic descriptor -> numeric lookup
 * (factory_step: body_param).
 *
 * Shipped cases carry clinical facts as DESCRIPTORS (assetNeeds prose,
 * bodyMechanics.habitus), not numbers, and the seed scenario's authored
 * phenotypes map those profiles to their numbers. This module resolves an
 * actor's descriptors to generator numeric identity through a versioned table
 * SEEDED FROM those authored examples: deterministic, no model in the loop
 * (D9), and it refuses to invent what the case does not state.
 *
 * issue-605 (route decided on #603): the table's single pediatric row refused
 * every adult actor. The table now also maps adult age-band/role descriptors to
 * the TWO adult profiles the seed scenario already authors (the parent's
 * `adult_standard_parent`, the nurse's `adult_clinical_team`) — no new clinical
 * authoring was added; the seeds already existed. A clinical seed can still
 * override any individual actor later without changing the mechanism.
 *
 * WHAT IS DERIVED and WHAT IS NOT:
 *   - derived: body_profile (from the age-band descriptor) and the profile's
 *     numeric identity (age, height_cm, bmi).
 *   - NOT derived, deliberately absent: gender_presentation (#664), hair_color,
 *     eye_color, skin_tone, build, pose, clothing — identity and
 *     disease-specific fields the descriptor cannot supply. Exporting them would
 *     be inventing clinical content: #276 refused the silent generic-adult
 *     default, #293 refuses the silent generic-child. #664 removed
 *     gender_presentation from this side specifically: the seed's sex belongs to
 *     THE SEED'S PERSON (Maria Alvarez is not Kevin Lee), so reading it out of
 *     another actor's authored row invents a person. Consumers treat an absent
 *     presentation as MPFB/Anny's neutral default, which is honest about a case
 *     that does not state a sex.
 *
 *   - An actor whose descriptors match nothing returns undefined: the case keeps
 *     the refuse gate rather than a defaulted body.
 *
 * Derived entries carry `descriptor_derived: true` so consumers can tell an
 * authored phenotype from a derived one (e.g. the phenotype-sufficiency gate pins
 * AUTHORED known-good actors and must not count derived entries as authored).
 */

import type { Scenario } from "@openclinxr/shared-schemas";

import { pediatricAsthmaScenario } from "./pediatric-asthma.js";

export const DESCRIPTOR_LOOKUP_VERSION = "descriptor-lookup:v2";

/** Marker key on derived phenotype entries; absent on authored ones. */
export const DESCRIPTOR_DERIVED_MARKER = "descriptor_derived";

const SEED_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";
const SEED_ACTOR_ID = "patient_maya_johnson_v1";

/**
 * Versioned index: clinical age-band/role descriptor phrase -> generator
 * body_profile. The table is seeded by the seed scenario's authored profiles;
 * adding a NEW profile still requires an authored seed for it, which is
 * clinical authoring, not an implementer edit. Order is load-bearing: `.find()`
 * returns the FIRST matching entry, so the pediatric row stays first (the
 * school-aged child must keep resolving to the child profile), then the
 * clinical-team roles, then adult patients/family.
 */
const DESCRIPTOR_TO_BODY_PROFILE: ReadonlyArray<{ pattern: RegExp; bodyProfile: string }> = [
  { pattern: /school[- ]aged child/i, bodyProfile: "pediatric_school_age" },
  // issue-605: the seed scenario's nurse authored `adult_clinical_team`.
  // Deliberately no bare "interpreter" here: the clinic interpreter's family
  // actor ("father actor for interpreter and family-dynamics pressure") carries
  // that word for the service, not for the role.
  {
    pattern: /nurse|physician|resident|consultant|respiratory therapist|medical assistant/i,
    bodyProfile: "adult_clinical_team",
  },
  // issue-605: adult patients and family members map to the seed scenario's
  // parent-authored `adult_standard_parent` — the only non-clinical adult seed.
  // Coverage is by age-band ("Older adult", "Middle-aged", "Teen", "Adult",
  // "Pregnant") or family/patient role word, so every adult whose fixture
  // already carries descriptor text derives deterministically.
  {
    pattern:
      /older adult|middle[- ]aged|adult|pregnant|teen|patient|spouse|son|daughter|father|sister|partner|parent/i,
    bodyProfile: "adult_standard_parent",
  },
];

type ProfileIdentity = {
  age: number;
  height_cm: number;
  bmi: number;
};

/**
 * The numeric identity the seed scenario's authored phenotypes pin for each
 * body_profile. Read at export time from the fixture so the mapping literally
 * follows the seed: clause (3) of the issue-293 RED guards the exported seed,
 * and this table can never drift from it. issue-605 reads ALL of the seed
 * scenario's authored phenotypes (child, parent, nurse), so the adult rows
 * resolve to identities that already existed — nothing was authored to add them.
 */
function seededProfileIdentity(): ReadonlyMap<string, ProfileIdentity> {
  const map = new Map<string, ProfileIdentity>();
  if (pediatricAsthmaScenario.scenarioId !== SEED_SCENARIO_ID) return map;
  for (const seed of pediatricAsthmaScenario.actors) {
    const authored = seed.phenotype;
    if (authored === undefined) continue;
    const bodyProfile = authored.body_profile;
    const { age, height_cm: heightCm, bmi } = authored;
    if (
      typeof bodyProfile !== "string" ||
      bodyProfile.length === 0 ||
      typeof age !== "number" ||
      typeof heightCm !== "number" ||
      typeof bmi !== "number"
    ) {
      continue;
    }
    const identity: ProfileIdentity = { age, height_cm: heightCm, bmi };
    // #664: gender_presentation is deliberately NOT carried here. The seed's sex
    // belongs to the seed's person; a derived row must not inherit it.
    map.set(bodyProfile, identity);
  }
  return map;
}

/** The fixture-wide character assetId convention: actorId with `_v<digits>` replaced by `_character`. */
function characterAssetIdFor(actorId: string): string {
  return `${actorId.replace(/_v\d+$/, "")}_character`;
}

/** The actor's descriptor text: bodyMechanics.habitus plus its character assetNeed description. */
function descriptorTextFor(scenario: Scenario, actor: Scenario["actors"][number]): string {
  const parts: string[] = [];
  const habitus = actor.bodyMechanics?.habitus;
  if (habitus !== undefined && habitus.length > 0) parts.push(habitus);
  const characterNeed = (scenario.assetNeeds ?? []).find(
    (need) => need.assetType === "character" && need.assetId === characterAssetIdFor(actor.actorId),
  );
  if (characterNeed !== undefined) parts.push(characterNeed.description);
  return parts.join(" ").trim();
}

/**
 * Resolve an actor's descriptors to generator numeric identity, or undefined when
 * the case states nothing mappable (the case keeps the refuse gate). Authored
 * phenotypes always win: callers pass actors without one.
 */
export function derivePhenotypeFromDescriptors(
  scenario: Scenario,
  actor: Scenario["actors"][number],
): Record<string, unknown> | undefined {
  if (actor.phenotype !== undefined && Object.keys(actor.phenotype).length > 0) {
    return undefined;
  }
  const text = descriptorTextFor(scenario, actor);
  if (text.length === 0) return undefined;
  const matched = DESCRIPTOR_TO_BODY_PROFILE.find((entry) => entry.pattern.test(text));
  if (matched === undefined) return undefined;
  const identity = seededProfileIdentity().get(matched.bodyProfile);
  if (identity === undefined) return undefined;
  const derived: Record<string, unknown> = {
    body_profile: matched.bodyProfile,
    age: identity.age,
    height_cm: identity.height_cm,
    bmi: identity.bmi,
    [DESCRIPTOR_DERIVED_MARKER]: true,
    // gender_presentation is deliberately absent (#664): sex is an identity field
    // a role descriptor cannot supply. Consumers keep their neutral default.
  };
  return derived;
}
