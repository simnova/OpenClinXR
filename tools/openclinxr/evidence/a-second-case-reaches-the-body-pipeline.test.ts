import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **One case of fifteen has a phenotype. D9's success measure is throughput of CASES, and it is 1.**
 *
 * Measured 2026-08-14:
 *
 *   shipped scenario bundles                              15
 *   scenarios with an exported phenotype                 **1**  (peds_asthma_parent_anxiety_v1)
 *
 * #293 reads this as "the cases do not contain the facts a phenotype needs". Measured, that is not
 * quite right and the difference decides who can do the work: **the facts are present as clinical
 * DESCRIPTORS, not as numbers.** `peds-fever.ts` has no `age:` field, but it has
 *
 *     :235  "School-aged child with fever flush, listless affect, and seated distress poses"
 *     :53   habitus: "average"
 *
 * and the one authored phenotype already maps that exact pair:
 *
 *     patient_maya_johnson_v1   body_profile: pediatric_school_age   age 8   height_cm 125   bmi 16.5
 *
 * At least five fixtures carry such descriptors: `peds-fever`, `pediatric-asthma`, `ed-chest-pain`,
 * `abdominal-pain-interpreter`, `primary-care-dyslipidemia`.
 *
 * ## WHY THAT MATTERS: IT MOVES THE WORK OUT OF CLINICAL AUTHORING
 *
 * If the cases genuinely lacked the facts, every new phenotype would be authored clinical content —
 * an age and a build invented per case, which SS8d and SS8y say is not an implementer's decision.
 * Because the descriptors are present, the work is a **descriptor -> numeric lookup**: deterministic,
 * seeded by an authored example already in the tree, and with **no model in the loop**. That is D9's
 * shape — *"take multiple cases, run them through, get a full experience"* — and this is the step
 * that turns 1 into N.
 *
 * ## THE KNOWN-GOOD IS THE AUTHORED SEED (SS9h)
 *
 * `patient_maya_johnson_v1` is a hand-authored phenotype for `pediatric_school_age` + average habitus.
 * It is the reference, not an output. Clause (3) pins it so a mapping cannot be made to "fit" by
 * rewriting the one example it should be derived from.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) second case | (2) same in/same out | (3) seed intact | result
 *   ---------------------------------------------------|-----------------|----------------------|-----------------|--------
 *   a) today                                           |   **FAIL**      |   vacuous, see below |      pass       | REFUSED
 *   b) author a second phenotype by hand, per case     |     pass        |      **FAIL**        |      pass       | REFUSED
 *   c) adjust maya's numbers so a table fits her       |     pass        |        pass          |    **FAIL**     | REFUSED
 *   d) descriptor -> numeric mapping, seeded by maya   |     pass        |        pass          |      pass       | ALL PASS
 *
 * **(b) is the one to watch and it is the whole point.** Hand-authoring a second phenotype satisfies
 * clause (1) and leaves the thirteenth case exactly as blocked as today — plus it puts invented
 * clinical numbers in the tree. Clause (2) refuses it: **two actors with the same `body_profile` must
 * carry identical numbers.** An LLM inventing per case cannot satisfy that; a lookup satisfies it for
 * free.
 *
 * **Clause (2) is VACUOUS TODAY and I am saying so rather than shipping it quietly (SS7t):** with one
 * exported scenario, no two actors share a `body_profile`, so it has nothing to compare. It is not
 * decoration, because it **cannot stay vacuous if (1) is satisfied by the obvious route** — the
 * closest unblocked case is `peds_fever_v1`, whose patient is a school-aged child, which creates a
 * second `pediatric_school_age` the moment it is exported. (1) and (2) are coupled by construction.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today at 1 of 15. (2) is a
 * counterweight, vacuous today, live the instant (1) passes. (3) is a counterweight and is
 * non-vacuous today — maya's four numeric fields are pinned.
 *
 * NOT TESTED:
 *   - **That a phenotype is sufficient to traverse the pipeline.** #293's other measurement — that no
 *     blocked case reuses an already-authored actor — is untouched and may bind independently.
 *   - **That the other 13 descriptors are as clean as `peds_fever_v1`'s.** Five fixtures were grepped
 *     for descriptor words; per-actor coverage across all 15 was not enumerated. Some may state nothing,
 *     and for those the work really is clinical authoring.
 *   - **BMI reaching the mesh.** Stature does (125 -> 122.9 cm, 176 -> 174.3 cm, both within 2 cm), but
 *     a waist-girth proxy for BMI returned an anatomically impossible result and no claim is made.
 *   - **Which numbers are clinically right.** This asserts consistency and provenance, never that
 *     8 / 125 / 16.5 is the correct rendering of "school-aged". That is a clinical question.
 *
 * ## FIXED (#293)
 *
 * `peds_fever_v1` now exports a phenotype for `patient_noah_chen_v1`, derived
 * deterministically from his descriptors ("School-aged child" in the character
 * assetNeed + `habitus: "average"`) by
 * `packages/openclinxr/scenario-fixtures/src/descriptor-phenotype-lookup.ts`,
 * seeded FROM the authored example (patient_maya_johnson_v1) — no model in the
 * loop, no invented identity. Measured after: **2** shipped scenarios export a
 * phenotype (peds_asthma_parent_anxiety_v1 + peds_fever_v1); clause (2) is now
 * LIVE — both pediatric_school_age actors carry identical age/height_cm/bmi —
 * and clause (3) still pins the seed verbatim. The other two peds_fever actors
 * (parent_mei_chen_v1, nurse_aisha_brooks_v1) state no age-band descriptor and
 * are deliberately not exported. Derived entries carry `descriptor_derived: true`
 * so authored and derived phenotypes stay distinguishable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const BUNDLES = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated");
const EXPORT = join(
  REPO_ROOT,
  "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json",
);

/** D9 counts cases. One is not throughput; two is the first evidence of a repeatable path. */
const MIN_SCENARIOS_WITH_PHENOTYPE = 2;

/** The authored seed. These exact values are the reference a mapping must be derived FROM. */
const SEED_SCENARIO = "peds_asthma_parent_anxiety_v1";
const SEED_ACTOR = "patient_maya_johnson_v1";
const SEED_VALUES: Record<string, number | string> = {
  body_profile: "pediatric_school_age",
  age: 8,
  height_cm: 125,
  bmi: 16.5,
};

/** Numeric fields a body-generation step needs. Compared across actors sharing a body_profile. */
const NUMERIC_FIELDS = ["age", "height_cm", "bmi"] as const;

type Actor = { scenario: string; actor: string; phenotype: Record<string, unknown> };

function shippedScenarios(): string[] {
  if (!existsSync(BUNDLES)) return [];
  return readdirSync(BUNDLES)
    .filter((d) => existsSync(join(BUNDLES, d, "learner-runtime-bundle.v1.json")))
    .sort();
}

function exportedActors(): Actor[] {
  if (!existsSync(EXPORT)) return [];
  let doc: { entries?: Record<string, Record<string, { phenotype?: Record<string, unknown> }>> };
  try {
    doc = JSON.parse(readFileSync(EXPORT, "utf8")) as typeof doc;
  } catch {
    return [];
  }
  const out: Actor[] = [];
  for (const [scenario, actors] of Object.entries(doc.entries ?? {})) {
    for (const [actor, body] of Object.entries(actors)) {
      if (body?.phenotype) out.push({ scenario, actor, phenotype: body.phenotype });
    }
  }
  return out;
}

const scenarios = shippedScenarios();
const actors = exportedActors();
const scenariosWithPhenotype = [...new Set(actors.map((a) => a.scenario))];

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(scenarios.length, `shipped scenario bundles under ${BUNDLES} (15 measured 2026-08-14)`)
    .toBeGreaterThanOrEqual(12);
  expect(actors.length, `actors with an exported phenotype in ${EXPORT}`).toBeGreaterThanOrEqual(1);
}

describe("a second case reaches the body pipeline", () => {
  it("(1) RED: at least two shipped scenarios export a phenotype", () => {
    requireMeasured();
    expect(
      scenariosWithPhenotype.length,
      `shipped scenarios with an exported phenotype, of ${scenarios.length} (today: ${scenariosWithPhenotype.join(", ") || "none"})`,
    ).toBeGreaterThanOrEqual(MIN_SCENARIOS_WITH_PHENOTYPE);
  });

  it("(2) COUNTERWEIGHT: actors sharing a body_profile carry identical numbers", () => {
    // Refuses (b): hand-authoring a second phenotype satisfies (1) and leaves case 13 as blocked as
    // today, with invented clinical numbers in the tree. A lookup satisfies this for free; per-case
    // invention cannot. VACUOUS today (one scenario, no shared profile) and it cannot stay vacuous —
    // the closest unblocked case is a school-aged child, which creates a second pediatric_school_age.
    requireMeasured();
    const byProfile = new Map<string, Actor[]>();
    for (const a of actors) {
      const profile = String(a.phenotype.body_profile ?? "");
      if (!profile) continue;
      byProfile.set(profile, [...(byProfile.get(profile) ?? []), a]);
    }
    const inconsistent: string[] = [];
    for (const [profile, group] of byProfile) {
      if (group.length < 2) continue;
      for (const field of NUMERIC_FIELDS) {
        const values = [...new Set(group.map((g) => JSON.stringify(g.phenotype[field])))];
        if (values.length > 1) {
          inconsistent.push(
            `body_profile "${profile}": ${field} differs across ${group.map((g) => g.actor).join(", ")} — ${values.join(" vs ")}. Same descriptor must give same numbers, or the values were invented per case.`,
          );
        }
      }
    }
    expect(inconsistent, "descriptors mapped to different numbers in different cases").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the authored seed phenotype is unchanged", () => {
    // Refuses (c): adjusting maya to fit a table inverts the derivation — she is the reference the
    // mapping is derived FROM, not an output of it.
    requireMeasured();
    const seed = actors.find((a) => a.scenario === SEED_SCENARIO && a.actor === SEED_ACTOR);
    const drift: string[] = [];
    if (!seed) drift.push(`${SEED_ACTOR} missing from ${SEED_SCENARIO} — the authored seed must not be removed`);
    else {
      for (const [field, expected] of Object.entries(SEED_VALUES)) {
        if (seed.phenotype[field] !== expected) {
          drift.push(`${SEED_ACTOR}.${field} is ${JSON.stringify(seed.phenotype[field])}, authored value was ${JSON.stringify(expected)}`);
        }
      }
    }
    expect(drift, "authored seed phenotype rewritten to fit a mapping").toEqual([]);
  });
});
