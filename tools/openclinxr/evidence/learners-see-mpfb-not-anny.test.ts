import { describe, expect, it } from "vitest";
import { ADULT_POOL_GLBS, ED_ADULT_CAST_GLB } from "../../../packages/openclinxr/asset-registry/src/cast-asset-constants.js";
import {
  environmentIdForScenario,
  listShippedCastScenarioIds,
  patientWardrobeClassForEnvironment,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";

/**
 * OPERATOR DIRECTION 2026-08-20: "MPFB only for learners, this is correct."
 *
 * ## SCOPE — the SAFE HALF ONLY. The gowned patient is deliberately excluded.
 *
 * Measured before planting: for physician, nurse-class, family-class and street-casual patient the
 * preference list in `actor-casting.ts:250-284` ALREADY puts an MPFB body first, and an Anny body
 * fires only when a co-present actor took that MPFB body. Removing Anny from those four tails
 * therefore cannot change a learner's PRIMARY cast — only the collision fallback.
 *
 * **The gowned patient is a different case and is NOT in scope.** Its list is Anny-first with no
 * MPFB entry at all (`ED_ADULT_CAST_GLB → ED_NURSE → PEDS_NURSE → …`), and it cannot move, because
 * `garment-class-inventory.json` reports **`hospitalGownFound: false`** — no MPFB body carries a
 * hospital-class garment. Moving it today dresses a clinical patient in street clothes or scrubs,
 * which is the S0/S1/S2 failure (a swap that graded as a floor-length evening dress) and is exactly
 * why P1 is parked. Clause (2) PINS it so this slice cannot quietly take it.
 *
 * ## THE MEASURED DEFECT
 *
 * `ADULT_POOL_GLBS` (`cast-asset-constants.ts:93-100`) is **100% Anny** — all six entries:
 *
 *   ED_ADULT_CAST_GLB  ED_NURSE_GLB  ED_SPOUSE_GLB  PEDS_PARENT_GLB  PEDS_NURSE_GLB
 *   ADULT_MALE_STREET_CASUAL_GLB
 *
 * It is the second-loop fallback at `actor-casting.ts:290`, so ANY role can still land on a 23-joint
 * Anny body after its preference list is exhausted. Stripping the four tails without touching this
 * pool leaves the same outcome one step later — clause (3) refuses that.
 *
 * ## WHY THE TWO RAILS ARE NOT INTERCHANGEABLE (the confusion this removes)
 *
 *   Anny rail   23 joints,  9 visemes02, ZERO FACS mouth-* targets, no `jaw` joint
 *   MPFB rail  137 joints, 15 visemes02 (3 bodies) or 13 FACS, `jaw` present
 *
 * Measured this session. A cast that silently swaps rails changes the joint count six-fold and the
 * available morph system. #402's "parent vs child" comparison was invalid for precisely this reason.
 *
 * ## KNOWN-GOOD COLUMN (SS9h)
 *
 * The four MPFB role bodies already sitting first in each list — `MPFB_CLINICAL_PHYSICIAN_ADULT`,
 * `MPFB_CLINICAL_NURSE_ADULT`, `MPFB_FAMILY_PARTNER_ADULT`, `MPFB_STREET_ADULT_MALE`. Same function,
 * same mechanism, already shipping: the MPFB-first pattern works and only the tails are wrong.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1) and (3) fail today: **REDS**, planted `it.fails`. (2) (4) (5) pass today and are **TRUE NETS** —
 * they exist to stop this slice going further than the operator authorised.
 *
 * NOT TESTED:
 *   - The gowned patient, the child band (`actor-casting.ts:319`) and the ED chest-pain patient
 *     (`:350`), all of which stay Anny by design until a hospital-class garment exists.
 *   - That any MPFB body looks right in a given role — no pixel grade is claimed here.
 *   - The runtime URL resolver's own Anny list (`humanoid-runtime-asset-url.ts:42-48`), which mirrors
 *     this file and must change WITH it — the dual-resolver agreement is asserted elsewhere.
 *   - Quest, clinical validity, exam equivalence.
 */

const ANNY_GLBS = [
  "ed_chest_pain_adult_cast.glb",
  "ed_chest_pain_nurse_adult.glb",
  "ed_chest_pain_spouse_adult.glb",
  "peds_anxious_parent.glb",
  "peds_nurse_kevin.glb",
  "peds_patient_child.glb",
  "adult_male_street_casual.glb",
] as const;

const isAnny = (glb: string): boolean => ANNY_GLBS.some((a) => glb.endsWith(a));
/** Roles the operator's direction covers today. The gowned patient is excluded — see clause (2). */
const IN_SCOPE_ROLES = /^(physician|nurse|medical_assistant|respiratory_therapist|consultant|family|family_member|parent|spouse)$/i;

type Cast = { role?: string; assetPath?: string; runtimeAssetPath?: string; actorId?: string };

/** Enumerated from what ships, never a typed list — three hand-typed populations failed this session. */
function everyCast(): { scenarioId: string; cast: Cast }[] {
  const out: { scenarioId: string; cast: Cast }[] = [];
  for (const scenarioId of listShippedCastScenarioIds()) {
    for (const cast of resolveScenarioActorCast(scenarioId) as Cast[]) out.push({ scenarioId, cast });
  }
  return out;
}

describe("learners are cast on MPFB bodies, not Anny", () => {
  it.fails("(1) RED: no in-scope role resolves to an Anny body", () => {
    const offenders = everyCast()
      .filter(({ cast }) => IN_SCOPE_ROLES.test(cast.role ?? "") && isAnny(cast.assetPath ?? ""))
      .map(({ scenarioId, cast }) => `${scenarioId}/${cast.role}=${cast.assetPath}`);
    expect(offenders, `these in-scope roles still land on a 23-joint Anny body`).toEqual([]);
  });

  it("(2) NET: the gowned patient is NOT taken by this slice", () => {
    // Pins the P1-blocked half. hospitalGownFound is false — no MPFB body carries a hospital-class
    // garment, so moving the gowned patient dresses a clinical actor in street clothes (the S2
    // failure). If this clause ever goes red, someone has taken scope the operator did not grant.
    const gowned = everyCast().filter(({ scenarioId, cast }) =>
      (cast.role ?? "").toLowerCase() === "patient"
      && patientWardrobeClassForEnvironment(environmentIdForScenario(scenarioId)) !== "street_casual");
    expect(gowned.length, "the bank must still ship gowned patients").toBeGreaterThan(0);
    expect(gowned.some(({ cast }) => isAnny(cast.assetPath ?? "")),
      "at least one gowned patient must still be Anny — this slice does not touch that path").toBe(true);
  });

  it.fails("(3) RED: the exhausted-pool fallback is not 100% Anny", () => {
    // Refuses the cheap fix. Stripping the four preference tails while ADULT_POOL_GLBS stays
    // all-Anny moves the same outcome one step later: actor-casting.ts:290 walks this pool.
    // The length guard lives in clause (5), NOT here: probe D4 (2026-08-20) emptied the pool and this
    // clause still read as expected-fail, because an it.fails is satisfied by ANY failure including
    // the guard's own throw. A vacuity guard cannot live inside the clause it guards.
    const pool = [...ADULT_POOL_GLBS] as string[];
    expect(pool.some((g) => !isAnny(g)), `ADULT_POOL_GLBS is ${pool.length} entries and every one is Anny`).toBe(true);
  });

  it("(4) NET: the Anny constants still exist", () => {
    // Refuses deletion. The gowned patient, the child band and the ED patient still need them;
    // merge-kill also refuses deleted-test, and the same logic applies to the constants they assert on.
    expect(typeof ED_ADULT_CAST_GLB, "ED_ADULT_CAST_GLB must remain exported").toBe("string");
    expect(ED_ADULT_CAST_GLB.endsWith(".glb"), "and still name a GLB").toBe(true);
  });

  it("(5) VACUITY GUARD: the enumeration is real and covers in-scope roles", () => {
    const all = everyCast();
    expect(all.length, "shipped casts enumerated from listShippedCastScenarioIds()").toBeGreaterThan(3);
    expect(all.some(({ cast }) => IN_SCOPE_ROLES.test(cast.role ?? "")),
      "clause (1) is meaningless if no in-scope role is ever cast").toBe(true);
    expect(all.every(({ cast }) => typeof cast.assetPath === "string" && cast.assetPath.length > 0),
      "every cast must name an assetPath, or the offender filter silently passes").toBe(true);
    // Guards clause (3) from outside: emptying ADULT_POOL_GLBS must not read as a fix.
    expect([...ADULT_POOL_GLBS].length, "ADULT_POOL_GLBS must not be emptied to satisfy clause (3)").toBeGreaterThan(0);
  });
});
