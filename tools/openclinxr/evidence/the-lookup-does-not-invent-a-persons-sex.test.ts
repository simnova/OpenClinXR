import { describe, expect, it } from "vitest";
import { derivePhenotypeFromDescriptors } from "../../../packages/openclinxr/scenario-fixtures/src/descriptor-phenotype-lookup.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";

/**
 * OBSERVABLE: the descriptor lookup does not assign a named person's sex from their job.
 *
 * MEASURED 2026-08-25, do not re-derive. `derivePhenotypeFromDescriptors` supplies
 * `gender_presentation` to 25 of 42 bank actors, and it tracks the ROLE DESCRIPTOR, not the person:
 *
 *   nurse_maria_alvarez_v1     "Maria Alvarez"    role=nurse    -> adult_male_nurse
 *   patient_luis_martinez_v1   "Luis Martinez"    role=patient  -> adult_female_parent
 *   partner_omar_khan_v1       "Omar Khan"        role=family   -> adult_female_parent
 *   son_eric_brooks_v1         "Eric Brooks"      role=family   -> adult_female_parent
 *   patient_samuel_brooks_v1   "Samuel Brooks"    role=patient  -> adult_female_parent
 *
 * Every family/patient-class actor receives `adult_female_parent`; every nurse-class actor receives
 * `adult_male_nurse`. The split is 19 female / 6 male across 25 actors and it is a function of the
 * descriptor row, not of the human the case describes.
 *
 * THIS CONTRADICTS THE MODULE'S OWN STATED PRINCIPLE, which is why the fix is its own doctrine rather
 * than mine. descriptor-phenotype-lookup.ts:23-26 lists what it deliberately will NOT derive:
 *
 *   "NOT derived, deliberately absent: hair_color, eye_color, skin_tone, build, pose, clothing —
 *    identity and disease-specific fields the descriptor cannot supply. Exporting them would be
 *    inventing clinical content: #276 refused the silent generic-adult default, #293 refuses the
 *    silent generic-child."
 *
 * `gender_presentation` sits on the DERIVED side (:20-22) on the grounds that it is "READ FROM the
 * authored seed so the mapping is derived FROM it, not an output of it." The hole the measurement
 * exposes: the seed's sex belongs to THE SEED'S PERSON. Reading Maria Alvarez's sex out of Kevin Lee's
 * seed is inventing clinical content laundered through a seed rather than defaulted. Sex is an identity
 * field the descriptor cannot supply, exactly like skin_tone and build.
 *
 * FAILED TREATMENT, refused by clause (3): inferring sex from the displayName. A name is not a sex, a
 * name-based guesser is a new invention rather than a removed one, and it would fail on Jordan Reed.
 *
 * FAILED TREATMENT, refused by clause (2): dropping the whole derived row. The numeric identity
 * (body_profile, age, height_cm, bmi) is legitimately derived from an age-band descriptor and 25 actors
 * depend on it; removing it would return them to the refuse gate and shrink the cast.
 *
 * KNOWN-GOOD COLUMN: clause (2). The same 25 actors must still derive numeric identity after the fix.
 *
 * NO SCALAR THRESHOLD APPEARS IN THIS CONTRACT. Every assertion is field presence or set membership
 * over an enumerated population.
 *
 * claimScope: which fields `derivePhenotypeFromDescriptors` supplies for bank actors.
 * notEvidenceFor: what the bake does with a phenotype; whether any shipped body looks like the person
 *   the case describes; the 13 actors the lookup already refuses; authored phenotypes, which state
 *   gender_presentation themselves and are untouched by this contract.
 */

type Actor = { actorId: string; role: string; displayName?: string; phenotype?: Record<string, unknown> };
type Scen = { scenarioId: string; actors?: Actor[] };

const bank = (): Scen[] => scenarioBank as unknown as Scen[];

/** Actors with no authored phenotype — the population the lookup speaks for. */
function derivedRows(): { actorId: string; role: string; derived: Record<string, unknown> }[] {
  const out: { actorId: string; role: string; derived: Record<string, unknown> }[] = [];
  for (const s of bank()) {
    for (const a of s.actors ?? []) {
      if (a.phenotype && Object.keys(a.phenotype).length > 0) continue;
      const derived = derivePhenotypeFromDescriptors(s as never, a as never);
      if (derived === undefined) continue;
      out.push({ actorId: a.actorId, role: a.role, derived: derived as Record<string, unknown> });
    }
  }
  return out;
}

describe("the lookup does not invent a person's sex", () => {
  it("(1) no derived row supplies gender_presentation", () => {
    const rows = derivedRows();
    expect(rows.length, "the derived population must not vanish out from under this contract")
      .toBeGreaterThan(10);
    const invented = rows
      .filter((r) => r.derived.gender_presentation !== undefined)
      .map((r) => `${r.actorId} (${r.role}) -> ${String(r.derived.gender_presentation)}`);
    expect(
      invented,
      "sex is an identity field a role descriptor cannot supply; it belongs on the module's own "
        + "deliberately-absent list beside skin_tone and build",
    ).toEqual([]);
  });

  it("(2) KNOWN-GOOD: the numeric identity still derives for the same actors", () => {
    // Refuses the over-correction of dropping the derived row entirely. The age-band descriptor
    // legitimately supplies body_profile/age/height_cm/bmi and 25 actors depend on it.
    const rows = derivedRows();
    const incomplete = rows
      .filter((r) => ["body_profile", "age", "height_cm", "bmi"].some((k) => r.derived[k] === undefined))
      .map((r) => r.actorId);
    expect(rows.length, "the lookup must still speak for the actors it speaks for today")
      .toBeGreaterThanOrEqual(25);
    expect(incomplete, "numeric identity is legitimately derived and must survive").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the refuse gate still refuses, and nothing is inferred from a name", () => {
    // An actor whose descriptors match nothing must still return undefined rather than a defaulted
    // body — the module's stated behaviour. This also refuses a name-based sex guesser, which would
    // have to invent for every actor rather than refuse for some.
    const refused = bank()
      .flatMap((s) => (s.actors ?? []).map((a) => ({ s, a })))
      .filter(({ a }) => !(a.phenotype && Object.keys(a.phenotype).length > 0))
      .filter(({ s, a }) => derivePhenotypeFromDescriptors(s as never, a as never) === undefined);
    expect(
      refused.length,
      "the refuse gate is the module's stated contract; a fix that makes everything derivable has "
        + "replaced a refusal with an invention",
    ).toBeGreaterThan(0);
  });
});

/*
## FIXED (#664)

- `descriptor-phenotype-lookup.ts`: `gender_presentation` moved from the derived
  side to the module's deliberately-absent list. `seededProfileIdentity()` no
  longer copies the seed's presentation onto the profile row (the `ProfileIdentity`
  type dropped the optional field), and `derivePhenotypeFromDescriptors` no longer
  spreads it into the derived record. The seed's sex belongs to the seed's person.
- Header comment of the module updated to name #664 and state why: reading Maria
  Alvarez's sex out of Kevin Lee's authored row invents clinical content laundered
  through a seed; consumers (`materialize_mpfb_humanoid_candidate.py`,
  `body_param_stage.py:1808 _gender_presentation_to_macro`,
  anny `generate_mesh.py`) keep their neutral default when the field is absent,
  which is honest about a case that does not state a sex.
- SCOPE DECISIONS (recorded per brief):
  1. Dropped from BOTH the derived row AND `seededProfileIdentity()` — keeping it
     on the profile identity would preserve a dead field with no reader, since
     derivation was its only consumer inside this module. Authored phenotypes are
     untouched; they state gender_presentation themselves.
  2. Module header comment now lists `gender_presentation` FIRST on the
     deliberately-absent list with the #664 citation.
- `packages/.../descriptor-phenotype-lookup.test.ts`: first test's old assertion
  pinned `gender_presentation: "child"` on the DERIVED row — rewrote that pin out;
  added a test asserting the field is absent from derived rows, authored rows keep
  theirs, and (synthetic failure-class injection) the nurse seed's
  `adult_male_nurse` must not appear on any adult_standard_parent derived row.
- Regenerated `packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json`
  via the export CLI: all descriptor_derived rows lost `gender_presentation`
  (measured 27 such rows across the bank + ED v2 population); authored entries
  byte-identical apart from the removed keys.
- Clauses (2) KNOWN-GOOD and (3) COUNTERWEIGHT hold unchanged after the fix.
*/
