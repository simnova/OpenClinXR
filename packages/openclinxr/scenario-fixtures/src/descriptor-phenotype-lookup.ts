/**
 * issue-293 — deterministic descriptor -> numeric lookup (factory_step: body_param).
 *
 * The 13-case frontier is an authoring gap, not an engineering gap: shipped cases
 * carry clinical facts as DESCRIPTORS (assetNeeds prose, bodyMechanics.habitus),
 * not numbers, and the one authored phenotype (patient_maya_johnson_v1) already
 * maps the school-aged profile to its numbers. This module resolves an actor's
 * descriptors to generator numeric identity through a versioned table SEEDED FROM
 * that authored example: deterministic, no model in the loop (D9), and it refuses
 * to invent what the case does not state.
 *
 * WHAT IS DERIVED and WHAT IS NOT:
 *   - derived: body_profile (from the age-band descriptor) and the profile's
 *     numeric identity (age, height_cm, bmi) plus gender_presentation, READ FROM
 *     the authored seed so the mapping is derived FROM it, not an output of it.
 *   - NOT derived, deliberately absent: hair_color, eye_color, skin_tone, build,
 *     pose, clothing — identity and disease-specific fields the descriptor cannot
 *     supply. Exporting them would be inventing clinical content: #276 refused the
 *     silent generic-adult default, #293 refuses the silent generic-child.
 *   - An actor whose descriptors match nothing returns undefined: the case keeps
 *     the refuse gate rather than a defaulted body.
 *
 * Derived entries carry `descriptor_derived: true` so consumers can tell an
 * authored phenotype from a derived one (e.g. the phenotype-sufficiency gate pins
 * AUTHORED known-good actors and must not count derived entries as authored).
 */

import type { Scenario } from "@openclinxr/shared-schemas";

import { pediatricAsthmaScenario } from "./pediatric-asthma.js";

export const DESCRIPTOR_LOOKUP_VERSION = "descriptor-lookup:v1";

/** Marker key on derived phenotype entries; absent on authored ones. */
export const DESCRIPTOR_DERIVED_MARKER = "descriptor_derived";

const SEED_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";
const SEED_ACTOR_ID = "patient_maya_johnson_v1";

/**
 * Versioned index: clinical age-band descriptor phrase -> generator body_profile.
 * The table is seeded by the authored example's profile; adding a profile requires
 * an authored seed for it, which is clinical authoring, not an implementer edit.
 */
const DESCRIPTOR_TO_BODY_PROFILE: ReadonlyArray<{ pattern: RegExp; bodyProfile: string }> = [
  { pattern: /school[- ]aged child/i, bodyProfile: "pediatric_school_age" },
];

type ProfileIdentity = {
  age: number;
  height_cm: number;
  bmi: number;
  gender_presentation?: string;
};

/**
 * The numeric identity the authored seed pins for each body_profile. Read at
 * export time from the fixture so the mapping literally follows the seed: clause
 * (3) of the issue-293 RED guards the exported seed, and this table can never
 * drift from it.
 */
function seededProfileIdentity(): ReadonlyMap<string, ProfileIdentity> {
  const map = new Map<string, ProfileIdentity>();
  if (pediatricAsthmaScenario.scenarioId !== SEED_SCENARIO_ID) return map;
  const seed = pediatricAsthmaScenario.actors.find((actor) => actor.actorId === SEED_ACTOR_ID);
  const authored = seed?.phenotype;
  if (authored === undefined) return map;
  const bodyProfile = authored.body_profile;
  const { age, height_cm: heightCm, bmi } = authored;
  if (
    typeof bodyProfile !== "string" ||
    bodyProfile.length === 0 ||
    typeof age !== "number" ||
    typeof heightCm !== "number" ||
    typeof bmi !== "number"
  ) {
    return map;
  }
  const identity: ProfileIdentity = { age, height_cm: heightCm, bmi };
  const genderPresentation = authored.gender_presentation;
  if (typeof genderPresentation === "string" && genderPresentation.length > 0) {
    identity.gender_presentation = genderPresentation;
  }
  map.set(bodyProfile, identity);
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
    ...(identity.gender_presentation !== undefined
      ? { gender_presentation: identity.gender_presentation }
      : {}),
  };
  return derived;
}
