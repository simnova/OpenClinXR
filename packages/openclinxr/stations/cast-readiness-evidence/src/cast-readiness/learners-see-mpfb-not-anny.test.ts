import { describe, expect, it } from "vitest";
import { MPFB_GOWN_ADULT_PATIENT_GLB } from "@openclinxr/asset-registry/cast-asset-constants";
import { resolveScenarioActorCast } from "@openclinxr/asset-registry/runtime-bundles";
import { listShippedCastScenarioIds } from "@openclinxr/asset-registry";
import {
  environmentIdForScenario,
  patientWardrobeClassForEnvironment,
} from "../../../../../../packages/openclinxr/asset-registry/src/actor-casting.js";

type CaseScenarioSource = NonNullable<Parameters<typeof resolveScenarioActorCast>[1]>;

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
 *
 * ## FIXED (#476)
 *
 * (1) and (3) flipped from `it.fails` to `it` on 2026-08-20. Nurse-class roles now push
 * `MPFB_PEDS_NURSE_KEVIN_GLB` second (137-joint MPFB, the known-good column), so the two
 * co-present nurse-class slots that previously fell back to the 23-joint Anny nurse body —
 * `stepdown_sepsis_nurse_escalation_v1/nurse` and `postop_fever_consult_pressure_v1/consultant` —
 * resolve to MPFB instead. `ADULT_POOL_GLBS` is seeded with the five MPFB adult role bodies ahead
 * of the Anny tail, so the exhausted-pool fallback (`actor-casting.ts:290`) is no longer 100% Anny.
 * Mirrored in `apps/ui-xr/src/humanoid-runtime-asset-url.ts` (both the nurse-class list and its
 * `ADULT_POOL_GLBS`) so the dual-resolver agreement holds.
 *
 * ## FIXED (#491)
 *
 * L6 landed the recast: the seven gowned patients now resolve to
 * `MPFB_GOWN_ADULT_PATIENT_GLB` in both resolvers, so clause (2)'s "at least one gowned patient
 * must still be Anny" P1 pin is now the opposite — no gowned patient is Anny. The Anny FILE stays
 * on disk and in the pools as deep fallback; L7 retires it.
 *
 * ## PUBLIC-BEHAVIOR RECAST
 *
 * The cast-asset-constants split narrowed the admitted surface to keep-only re-exports, so the
 * old pool/Anny filename constants are no longer importable from an admitted specifier — and the
 * freeze ("a new specifier fails until the reach is removed") refuses a drop+add migration to the
 * private `-mod` file. Clauses (3)–(5) therefore assert the same properties through the admitted
 * resolver (`resolveScenarioActorCast`, admitted via `@openclinxr/asset-registry/runtime-bundles`)
 * with an injected caller-owned crowd: the interpreter role is adult-banded (declareAgeBand) and
 * falls through to the role-agnostic pool (pickAdultGlb else-branch), so N interpreters drain N
 * pool bodies and the remainder take the fallback. #491/#652 retired the Anny tails and lifted
 * the gown freeze with the gowned MPFB body as the exhausted-pool default, so clause (4) pins
 * the admitted fallback constant instead of the retired Anny names.
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
  it("(1) no in-scope role resolves to an Anny body", () => {
    const offenders = everyCast()
      .filter(({ cast }) => IN_SCOPE_ROLES.test(cast.role ?? "") && isAnny(cast.assetPath ?? ""))
      .map(({ scenarioId, cast }) => `${scenarioId}/${cast.role}=${cast.assetPath}`);
    expect(offenders, `these in-scope roles still land on a 23-joint Anny body`).toEqual([]);
  });

  it("(2) NET: the gowned patient is recast onto the gowned MPFB body", () => {
    // #491 L6 lifted the P1 freeze: the seven gowned patients now resolve to
    // MPFB_GOWN_ADULT_PATIENT_GLB (138 joints + jaw, hospital gown), so none is Anny.
    const gowned = everyCast().filter(({ scenarioId, cast }) =>
      (cast.role ?? "").toLowerCase() === "patient"
      && patientWardrobeClassForEnvironment(environmentIdForScenario(scenarioId)) !== "street_casual");
    expect(gowned.length, "the bank must still ship gowned patients").toBeGreaterThan(0);
    expect(gowned.every(({ cast }) => !isAnny(cast.assetPath ?? "")),
      "no gowned patient may still be Anny — #491 recast them onto the gowned MPFB body").toBe(true);
  });

  it("(3) the exhausted-pool fallback is not 100% Anny", () => {
    // Public-behavior drain proof: no private pool import. The interpreter role is
    // adult-banded (declareAgeBand) and falls through to the role-agnostic pool (pickAdultGlb
    // else-branch), so a crowd of interpreters drains pool bodies through the admitted
    // resolver. Crowd size derives from public data — distinct shipped adult assetPaths + 1 —
    // never a copied pool size or golden list.
    const adultPaths = new Set<string>();
    for (const scenarioId of listShippedCastScenarioIds()) {
      for (const cast of resolveScenarioActorCast(scenarioId)) {
        if (cast.declaredAgeBand === "adult") adultPaths.add(cast.assetPath);
      }
    }
    expect(adultPaths.size, "the shipped bank must cast adult bodies for the drain to mean something").toBeGreaterThan(0);
    const size = adultPaths.size + 1;
    const actors = Array.from({ length: size }, (_, i) => ({
      actorId: `pool_exhaustion_probe_interpreter_${i}_v1`,
      role: "interpreter",
    }));
    const source: CaseScenarioSource = { scenarioId: "pool-exhaustion-probe", actors };
    const casts = resolveScenarioActorCast("pool-exhaustion-probe", source);
    expect(casts.length, "one cast per crowded actor").toBe(size);
    expect(casts.every((c) => c.declaredAgeBand === "adult"), "the crowd is adult-banded").toBe(true);
    expect(
      (casts[0]?.assetPath ?? "").endsWith(MPFB_GOWN_ADULT_PATIENT_GLB),
      "the first cast takes a pool body, proving the pool is nonempty — an emptied pool fails here, never passes",
    ).toBe(false);
    const gowned = casts.filter((c) => (c.assetPath ?? "").endsWith(MPFB_GOWN_ADULT_PATIENT_GLB));
    expect(gowned.length, "an exhausted pool falls back to the admitted gowned MPFB body (#652)").toBeGreaterThan(0);
    const offenders = casts
      .filter(({ assetPath }) => isAnny(assetPath ?? ""))
      .map(({ actorId, assetPath }) => `${actorId}=${assetPath}`);
    expect(offenders, "no exhausted-pool cast lands on a 23-joint Anny body").toEqual([]);
  });

  it("(4) NET: the admitted exhausted-pool fallback constant still exists", () => {
    // #491 L6 recast the gowned patients onto MPFB_GOWN_ADULT_PATIENT_GLB and #652 retired
    // the Anny rail from casting with this body as the exhausted-pool default (pickAdultGlb
    // tail). The Anny filename constants left the admitted surface in the constants split,
    // so this pins the fallback the pool actually drains to — still a deletion refusal.
    expect(typeof MPFB_GOWN_ADULT_PATIENT_GLB, "MPFB_GOWN_ADULT_PATIENT_GLB must remain exported from the admitted constants").toBe("string");
    expect(MPFB_GOWN_ADULT_PATIENT_GLB.endsWith(".glb"), "and still name a GLB").toBe(true);
  });

  it("(5) VACUITY GUARD: the enumeration is real and covers in-scope roles", () => {
    const all = everyCast();
    expect(all.length, "shipped casts enumerated from listShippedCastScenarioIds()").toBeGreaterThan(3);
    expect(all.some(({ cast }) => IN_SCOPE_ROLES.test(cast.role ?? "")),
      "clause (1) is meaningless if no in-scope role is ever cast").toBe(true);
    expect(all.every(({ cast }) => typeof cast.assetPath === "string" && cast.assetPath.length > 0),
      "every cast must name an assetPath, or the offender filter silently passes").toBe(true);
    // Guards clause (3) from outside without a private pool import: the drain proof sizes its
    // crowd from distinct shipped adult bodies, so an empty adult bank must fail here rather
    // than let clause (3) pass over a crowd of one.
    const adultPaths = new Set<string>();
    for (const scenarioId of listShippedCastScenarioIds()) {
      for (const cast of resolveScenarioActorCast(scenarioId)) {
        if (cast.declaredAgeBand === "adult") adultPaths.add(cast.assetPath);
      }
    }
    expect(adultPaths.size, "clause (3) needs shipped adult bodies to size its drain crowd").toBeGreaterThan(0);
  });
});
