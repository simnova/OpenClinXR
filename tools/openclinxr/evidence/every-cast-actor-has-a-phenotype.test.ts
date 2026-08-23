import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Six of the nine cast slots a learner can meet have no authored phenotype**, and nothing in the
 * repo said so until this file. I found it by tracing why actors had no eyes.
 *
 * MEASURED 2026-08-13 against `scenario-fixtures/generated/actor-phenotype.v1.json`, for every actor
 * `humanoid-runtime-asset-url.ts` casts:
 *
 *   station                            actor                       phenotype   driving fields
 *   --------------------------------   -------------------------   ---------   --------------
 *   ed_chest_pain_priority_v2          patient_robert_hayes_v1     **no**      0 / 7
 *   ed_chest_pain_priority_v2          nurse_maria_alvarez_v1      **no**      0 / 7
 *   ed_chest_pain_priority_v2          spouse_anna_hayes_v1        **no**      0 / 7
 *   peds_asthma_parent_anxiety_v1      patient_maya_johnson_v1     yes         7 / 7
 *   peds_asthma_parent_anxiety_v1      parent_tara_johnson_v1      yes         7 / 7
 *   peds_asthma_parent_anxiety_v1      nurse_kevin_lee_v1          yes         7 / 7
 *   ob_headache_preeclampsia_triage_v1 patient_aisha_khan_v1       **no**      0 / 7
 *   ob_headache_preeclampsia_triage_v1 ob_nurse_williams_v1        **no**      0 / 7
 *   ob_headache_preeclampsia_triage_v1 partner_omar_khan_v1        **no**      0 / 7
 *
 * **Peds is the only fully-authored station, and it is the only station that looks finished.** That is
 * not a coincidence — it is the whole finding.
 *
 * ## WHY THIS MATTERS, traced from a learner-visible defect
 *
 * 1. 2 of 3 stations cast actors with **no eye geometry** — ED 0/3 including the patient (#337).
 * 2. The fix is casting those slots to MPFB bodies, which is the D11 split and is structurally
 *    supported by the resolver.
 * 3. Casting to the EXISTING MPFB bodies would duplicate people across stations — the three that
 *    exist are genuinely distinct (`bodySha` 94ce7e50 / 0f32b5e2 / af980230; 166.6 / 176.0 /
 *    124.1 cm), so reuse puts the same person in two rooms.
 * 4. So new bodies must be generated. Capability is proven (#328 distinct bodies, #329 macros from
 *    phenotype, height to ±1 cm).
 * 5. Generation reads this export. `actor-phenotype-export.test.ts` states the mechanism plainly:
 *    *"Authoring a phenotype on a fixture actor is the way to add a case."*
 * 6. **`ed-chest-pain.ts` contains zero occurrences of `phenotype`.**
 *
 * So the pipeline is not the constraint — the corpus is. Every phenotype-driven capability landed this
 * week (body solve, garment role colours #180, per-actor eye colour #356) reads from three authored
 * actors in one station.
 *
 * ## THIS RED CANNOT BE CLOSED BY AN ENGINEERING SLICE, AND THAT IS DELIBERATE
 *
 * Closing it means authoring age, build, stature, skin tone and eye colour for six clinical actors.
 * **That is not an implementer decision** (§8d, §8y): a worker inventing those values would be writing
 * clinical content into a fixture under cover of an engineering fix. This file exists to make the
 * backlog countable and loud, not to pressure anyone into fabricating a patient.
 *
 * It is planted `it.fails` precisely so it does not block the land path while it waits. See #293.
 *
 * ## THE CHEAP FIX THIS REFUSES
 *
 *   treatment                                   | (1) all cast authored | (2) fields drive something | result
 *   --------------------------------------------|-----------------------|----------------------------|--------
 *   a) today                                    |      **FAIL** 3/9     |           pass             | REFUSED
 *   b) add empty `phenotype: {}` to the six      |        pass           |         **FAIL**           | REFUSED
 *   c) author six real phenotypes                |        pass           |           pass             | ALL PASS
 *
 * (b) is the obvious way to green a "has a phenotype" assertion and it drives nothing — the generator
 * reads `height_cm`, `build`, `skin_tone` and the rest, not the presence of a key. Clause (2) requires
 * the same seven driving fields the peds actors carry, which is why the known-good is measured at 7/7
 * rather than asserted at 1.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 6 of 9. (2) passes today — on the
 * three authored actors — and is the counterweight; it can only fail once someone adds a stub.
 *
 * NOT TESTED:
 *   - **Whether the six unauthored actors have phenotype data somewhere else.** I checked
 *     `ed-chest-pain.ts` and this generated export, not every fixture file.
 *   - **Whether authoring a phenotype is SUFFICIENT to generate a body for that actor.** #328/#329
 *     prove the solver works on the three that exist; nothing here shows a fourth would come out
 *     clean, and other blockers may wait behind this one.
 *   - **Nothing about clinical correctness.** This counts fields; it cannot say a phenotype is right.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const EXPORT_PATH = "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json";

/** Every actor slot `humanoid-runtime-asset-url.ts` resolves to a humanoid. */
const CAST: ReadonlyArray<readonly [string, string]> = [
  ["ed_chest_pain_priority_v2", "patient_robert_hayes_v1"],
  ["ed_chest_pain_priority_v2", "nurse_maria_alvarez_v1"],
  ["ed_chest_pain_priority_v2", "spouse_anna_hayes_v1"],
  ["peds_asthma_parent_anxiety_v1", "patient_maya_johnson_v1"],
  ["peds_asthma_parent_anxiety_v1", "parent_tara_johnson_v1"],
  ["peds_asthma_parent_anxiety_v1", "nurse_kevin_lee_v1"],
  ["ob_headache_preeclampsia_triage_v1", "patient_aisha_khan_v1"],
  ["ob_headache_preeclampsia_triage_v1", "ob_nurse_williams_v1"],
  ["ob_headache_preeclampsia_triage_v1", "partner_omar_khan_v1"],
] as const;

/**
 * The fields the generator actually consumes, taken from the peds entries rather than invented —
 * a phenotype missing these drives nothing however present its key is.
 */
const DRIVING_FIELDS = [
  "height_cm",
  "build",
  "body_profile",
  "skin_tone",
  "eye_color",
  "gender_presentation",
  "bmi",
] as const;

type Row = { scenarioId: string; actorId: string; hasPhenotype: boolean; derived: boolean; drivingFields: number };

const raw = JSON.parse(readFileSync(join(REPO_ROOT, EXPORT_PATH), "utf8")) as {
  entries?: Record<string, Record<string, { phenotype?: Record<string, unknown> }>>;
};
const entries = raw.entries ?? {};

const rows: Row[] = CAST.map(([scenarioId, actorId]) => {
  const phenotype = entries[scenarioId]?.[actorId]?.phenotype;
  return {
    scenarioId,
    actorId,
    hasPhenotype: phenotype !== undefined,
    // issue-605: descriptor-derived entries (descriptor_derived) are deliberately
    // partial — the lookup supplies body_profile/age/height_cm/bmi and nothing
    // more (#293). They must not count as authored stubs, or every derived actor
    // trips this counterweight on the missing cosmetic fields.
    derived: phenotype?.descriptor_derived === true,
    drivingFields: phenotype ? DRIVING_FIELDS.filter((f) => phenotype[f] !== undefined).length : 0,
  };
});

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t).
 *
 * **AN `it.fails` CLAUSE CANNOT GUARD ITS OWN VACUITY, and probing this file proved it.** Calling this
 * guard inside clause (1) does nothing: `it.fails` is satisfied when its body fails for ANY reason,
 * including the guard throwing. Probed by emptying the export — clause (1) still "passed".
 *
 * So the guard for clause (1) is **clause (2)**, which is a plain `it` and goes red when the export is
 * empty or unreadable. The file as a whole fails; clause (1) alone never could. That is exactly the
 * trap `hairline-is-a-line-not-a-sawtooth` fell into when its subject was deleted — its RED read green
 * for cycles while measuring nothing — and the general rule is: **every `it.fails` needs a sibling
 * plain `it` over the same enumeration, or its greenness means nothing.**
 */
function requireRows(): void {
  expect(rows.length, `cast slots enumerated (of ${CAST.length})`).toBe(CAST.length);
  expect(Object.keys(entries).length, "scenarios present in the phenotype export").toBeGreaterThan(0);
}

describe("every cast actor has an authored phenotype", () => {
  it.fails("(1) RED: no learner-facing cast slot is missing its phenotype", () => {
    requireRows();
    const missing = rows
      .filter((r) => !r.hasPhenotype)
      .map((r) => `${r.scenarioId}/${r.actorId}`);
    expect(
      missing,
      `cast slots with no authored phenotype (${rows.length - missing.length}/${rows.length} authored)`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: an authored phenotype carries the fields the generator reads", () => {
    // Refuses `phenotype: {}` stubs. The generator reads height_cm/build/skin_tone/…, not the key.
    // Derived (#293/#605) entries are excluded: they are lookup output — partial by design.
    requireRows();
    const stubs = rows
      .filter((r) => r.hasPhenotype && !r.derived && r.drivingFields < DRIVING_FIELDS.length)
      .map((r) => `${r.actorId}: ${r.drivingFields}/${DRIVING_FIELDS.length} driving fields`);
    expect(stubs, "authored phenotypes that drive nothing").toEqual([]);
  });
});
