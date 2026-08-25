import { describe, expect, it } from "vitest";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { derivePhenotypeFromDescriptors } from "../../../packages/openclinxr/scenario-fixtures/src/descriptor-phenotype-lookup.js";

/**
 * OBSERVABLE: an adult actor whose fixture already carries descriptor text derives a numeric body
 * profile, without anyone authoring a phenotype onto the fixture.
 *
 * MEASURED 2026-08-23, do not re-derive.
 *
 * `.openclinxr/evidence/issue-288/multi-case-rollup.json`: `casesFullyDeterministic 1 / 15`,
 * frontier `case_to_actor_params 13`. #601 landed the resolver + CLI allow-list, which unblocked the
 * FOUR actors that have a phenotype. This is what stands between 4 and the rest:
 *
 *   uncovered actors                     38
 *     of which SYSTEM, not human          1   telehealth_system_v1
 *     HUMAN actors needing phenotype     37
 *       already have descriptor text     25
 *       have none                        12
 *   DESCRIPTOR_TO_BODY_PROFILE maps       1   profile — pediatric_school_age
 *
 * **The mechanism works and has one row.** `derivePhenotypeFromDescriptors(scenario, actor)` passes
 * four gates: `actor.phenotype` empty -> `descriptorTextFor` non-empty -> a
 * `DESCRIPTOR_TO_BODY_PROFILE` pattern match -> a seeded profile identity. Every uncovered actor is
 * an adult and the table has no adult entry, so gate three refuses all 37.
 *
 * The descriptor text these adults already carry is clinically meaningful, not placeholder:
 *   patient_robert_hayes_v1   "average Middle-aged patient in hospital gown with anxious expression
 *                              and chest discomfort"
 *   patient_margaret_ellis_v1 "Older adult with frailty, confusion, hearing difficulty, and bed-exit
 *                              motion clips"
 *   nurse_maria_alvarez_v1    "ED nurse with badge, scrubs, clipboard/tablet, and urgent escalation
 *                              gestures"
 *
 * ROUTE DECIDED on #603 and NOT re-openable here: extend the table. Authoring a numeric phenotype per
 * actor is 37 clinical judgements to buy what one table plus twelve sentences buys, and a seed can
 * still override any individual actor later without changing the mechanism.
 *
 * KNOWN-GOOD COLUMN: `peds_fever_v1:patient_noah_chen_v1`, the one profile that derives today, at
 * `{body_profile: "pediatric_school_age", age: 8, height_cm: 125, bmi: 16.5, gender_presentation:
 * "child"}`. Clause (2) pins every one of those values.
 *
 * claimScope: whether an adult actor with existing descriptor text derives a numeric body profile.
 * notEvidenceFor: whether any derived number is clinically right; whether a body bakes from it; what
 * such a body looks like; the twelve actors that carry no descriptor text at all.
 */

/** Three uncovered adults, deliberately of THREE different roles — one adult row cannot satisfy all. */
const ADULT_TARGETS = [
  { actorId: "patient_robert_hayes_v1", role: "patient" },
  { actorId: "nurse_maria_alvarez_v1", role: "nurse" },
  { actorId: "patient_margaret_ellis_v1", role: "patient" },
] as const;

const CHILD = "patient_noah_chen_v1";

type Actor = { actorId: string; role?: string; phenotype?: Record<string, unknown> };
type Scen = { scenarioId: string; actors?: Actor[] };

function locate(actorId: string): { scenario: Scen; actor: Actor } {
  for (const s of scenarioBank as unknown as Scen[]) {
    const a = (s.actors ?? []).find((x) => x.actorId === actorId);
    if (a) return { scenario: s, actor: a };
  }
  throw new Error(`no fixture actor ${actorId}`);
}

function derived(actorId: string): Record<string, unknown> | undefined {
  const { scenario, actor } = locate(actorId);
  return derivePhenotypeFromDescriptors(scenario as never, actor as never);
}

describe("an adult actor derives a body profile from its descriptor", () => {
  it("(1) RED: three adults of different roles each derive a numeric body profile", () => {
    // Today the table maps only pediatric_school_age, so every one of these returns undefined.
    for (const t of ADULT_TARGETS) {
      const d = derived(t.actorId);
      expect(d, `${t.actorId} (${t.role}) must derive from the descriptor text it already carries`)
        .toBeDefined();
      const numeric = Object.entries(d ?? {}).filter(([, v]) => typeof v === "number");
      expect(numeric.length, `${t.actorId} must derive at least one NUMERIC field, not labels alone`)
        .toBeGreaterThan(0);
      expect(typeof (d ?? {}).body_profile, `${t.actorId} must name a body profile`).toBe("string");
    }
  });

  it("(2) RED: an adult profile is not the child profile wearing a new name", () => {
    // Refuses the cheapest table edit — widening the pediatric pattern to match adult text. The
    // child's numbers are 125 cm / 16.5 BMI / age 8; an adult that derives those has not derived.
    const child = derived(CHILD) ?? {};
    for (const t of ADULT_TARGETS) {
      const d = derived(t.actorId);
      // Guard against vacuity: without this the clause passes today purely because `d` is
      // undefined, so `undefined !== "pediatric_school_age"` and NaN !== 125. It would then be
      // green about nothing and would go on being green if the fix never landed.
      expect(d?.body_profile, `${t.actorId} must derive a profile before it can be compared`)
        .toBeDefined();
      expect(d?.body_profile, `${t.actorId} must not resolve to the pediatric profile`)
        .not.toBe(child.body_profile);
      expect(Number(d?.height_cm), `${t.actorId} must not inherit the child's 125 cm`).not.toBe(125);
    }
  });

  it("(3) KNOWN-GOOD COLUMN: the child still derives, unchanged", () => {
    const d = derived(CHILD);
    expect(d, "the one profile that works today must survive").toBeDefined();
    expect(d).toMatchObject({
      body_profile: "pediatric_school_age",
      age: 8,
      height_cm: 125,
      bmi: 16.5,
      descriptor_derived: true,
    });
    // Old assertion (pre-#664): this clause also pinned
    // `gender_presentation: "child"` on the DERIVED row. #664 moved that field to
    // the module's deliberately-absent list — a derived row carries no sex.
    expect(d?.["gender_presentation"], "#664: a derived row carries no sex").toBeUndefined();
  });

  it("(4) COUNTERWEIGHT: no phenotype is authored onto these fixtures", () => {
    // The other cheap fix is to hand-author `phenotype` onto each fixture actor — route (1),
    // rejected on #603. It would also make clause (1) fail by construction, because
    // derivePhenotypeFromDescriptors returns undefined when actor.phenotype is non-empty. This
    // clause states the intent explicitly so the refusal is legible rather than incidental.
    for (const t of ADULT_TARGETS) {
      const { actor } = locate(t.actorId);
      const authored = Object.keys(actor.phenotype ?? {}).length;
      expect(authored, `${t.actorId}: derive it from the descriptor table, do not author a phenotype`)
        .toBe(0);
    }
  });
});

/*
## FIXED (#605)

- `descriptor-phenotype-lookup.ts` `DESCRIPTOR_TO_BODY_PROFILE` gained two adult rows:
  clinical-team roles (`nurse|physician|resident|consultant|respiratory therapist|medical
  assistant`) -> `adult_clinical_team`, and adult patients/family (age-band words + role words)
  -> `adult_standard_parent`. The pediatric row stays FIRST so the child keeps resolving.
- `seededProfileIdentity()` now reads ALL of the seed scenario's authored phenotypes (child,
  parent, nurse) instead of only the child, so the two adult profiles resolve to identities
  that already existed — no new clinical authoring (route (2) on #603).
- `DESCRIPTOR_LOOKUP_VERSION` v1 -> v2.
- Measured after: 25 of the 37 uncovered human actors now derive (all 25 that carry descriptor
  text); 12 still carry no descriptor text and remain refused (Stage B). The three planted
  targets derive `adult_standard_parent` (patient_robert_hayes_v1, patient_margaret_ellis_v1)
  and `adult_clinical_team` (nurse_maria_alvarez_v1), none at the child's numbers.
- Both clauses flipped `it.fails` -> `it`; clauses (3) and (4) hold unchanged.
*/
