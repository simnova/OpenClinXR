import { describe, expect, it } from "vitest";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";

/**
 * Campaign #478, lanes L1 + L2. Operator direction 2026-08-20: MPFB only for learners, because Anny
 * "has difficulty with eyes, mouths, animations".
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE. Flip assertions and append `## FIXED (#N)`.
 *
 * 39 casts across 14 shipped scenarios: **MPFB 30 | ANNY 8 | LIBRARY 1**. After #476 every remaining
 * non-MPFB cast is a patient, plus one spouse. Two of those are NOT gowned and have an MPFB body
 * already shipping:
 *
 *   peds_fever_v1              patient  patient_noah_chen_v1  peds_patient_child.glb                    <- Anny
 *   ed_chest_pain_priority_v1  family   spouse_anna_hayes_v1  body-param-adult_lean_female-library.glb  <- library
 *
 * `actor-casting.ts:320` hardcodes `PEDS_CHILD_GLB` for ANY child band, unconditionally.
 * `actor-casting.ts:363-368` hardcodes a `libraryCastEntry` for the ED spouse.
 *
 * ## THE ANNY DEFICIT, measured from the bytes — why this is not cosmetic
 *
 *                     Anny    MPFB
 *   joints              23     137
 *   jaw joint           NO     YES
 *   FACS mouth-*         0      13
 *   FACS eye-*           0       6
 *   eye MESH          NONE     eyes_low_poly present
 *
 * Anny has no eye mesh at all — two eye bones and nothing to move. The library body is a THIRD rail:
 * 64 joints, no jaw, 0 visemes02, 13 FACS. Neither rail can articulate a face.
 *
 * ## KNOWN-GOOD COLUMN (SS9h) — both mechanisms already work in this same file
 *
 * `peds_asthma_parent_anxiety_v1` casts its child on `mpfb-peds-patient-child.glb` today, via the
 * hardcoded cast list at `:372`. Other stations already cast family-class on
 * `MPFB_FAMILY_PARTNER_ADULT_GLB`. Neither body needs to be produced — both ship.
 *
 * ## THE SEVEN GOWNED PATIENTS ARE OUT OF SCOPE — clause (3) pins them
 *
 * The lead refused the wider swap as "P1 in disguise": `ed_chest_pain_adult_cast.glb` carries
 * `openclinxr_declared_upper_layers__hospital_gown_mesh`, `hospitalGownFound: false` across 44 cached
 * `.mhclo`, and 13 cached garments include **zero** gowns (`crudegown.mhclo` is an evening dress).
 * Moving them today is the S2 swap. The operator unparked PRODUCING the gown (L3-L5), not this.
 *
 * **If clause (1) or (2) cannot be satisfied without touching a gowned patient, STOP and say so.**
 *
 * ## PRIOR INTENT THE WORKER MUST NOT STEAMROLL
 *
 * `:361` reads `// #218: stage ONE library body via ordinary cast resolution (spouse only).` The
 * library spouse is a DELIBERATE staging decision, not an oversight. The lead has ruled it moves to
 * MPFB anyway (a 64-joint body cannot articulate a face), but #218's intent — exercising the library
 * rail through ordinary cast resolution — deserves a sentence in your report saying where that
 * coverage goes, or that it is deliberately dropped.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1)(2) fail today: **REDS**, planted `it.fails`. (3)(4) pass today: **TRUE NETS** — (3) stops this
 * slice taking P1, (4) keeps (1)(2) from being vacuous.
 *
 * NOT TESTED:
 *   - The seven gowned patients (L6, after the gown exists).
 *   - Whether either MPFB body LOOKS right in its new role — no pixel claim; the orchestrator grades
 *     per land, and a child in street clothes replacing a child in an exam t-shirt is a visible change.
 *   - Retiring the Anny files (L7, post-soak; ~168 contract references become inverted guards).
 *   - Quest, clinical validity, exam equivalence.
 *
 * ## FIXED (#479)
 *
 * (1) and (2) flipped from `it.fails` to `it` on 2026-08-20. `actor-casting.ts` child-band branch
 * now casts MPFB_PEDS_PATIENT_CHILD_GLB (the peds_fever patient was the only child-band slot outside
 * the peds_asthma explicit table), and the ED spouse moves off the 64-joint library rail to
 * MPFB_FAMILY_PARTNER_ADULT_GLB. Mirrored in apps/ui-xr/src/humanoid-runtime-asset-url.ts
 * (child band + ED_RUNTIME_CAST_BY_ACTOR.spouse_anna_hayes_v1). #218's library-rail coverage is
 * deliberately dropped — LIBRARY_ADULT_LEAN_FEMALE_GLB stays exported for the S2 gowned-patient swap.
 *
 * ## FIXED (#491)
 *
 * L6 landed the recast: the seven gowned adult patients now resolve to
 * `MPFB_GOWN_ADULT_PATIENT_GLB` in both resolvers. Clause (3)'s "still on the gowned Anny body"
 * P1 pin flips to "0 on Anny, 7 on the gowned MPFB body". The Anny FILE still ships; L7 retires it.
 */

const ANNY_OR_LIBRARY = [
  "ed_chest_pain_adult_cast.glb",
  "ed_chest_pain_nurse_adult.glb",
  "ed_chest_pain_spouse_adult.glb",
  "peds_anxious_parent.glb",
  "peds_nurse_kevin.glb",
  "peds_patient_child.glb",
  "adult_male_street_casual.glb",
  "body-param-",
] as const;

const isMpfb = (p: string): boolean => p.includes("mpfb-");
const isNonMpfbRail = (p: string): boolean => ANNY_OR_LIBRARY.some((a) => p.includes(a));

type Cast = { role?: string; actorId?: string; assetPath?: string };

/** Enumerated from what ships — four hand-typed populations failed earlier in this campaign. */
function everyCast(): { scenarioId: string; cast: Cast }[] {
  return listShippedCastScenarioIds().flatMap((scenarioId: string) =>
    (resolveScenarioActorCast(scenarioId) as Cast[]).map((cast) => ({ scenarioId, cast })),
  );
}

function castFor(scenarioId: string, actorId: string): Cast {
  const hit = everyCast().find((r) => r.scenarioId === scenarioId && r.cast.actorId === actorId);
  expect(hit, `${scenarioId}/${actorId} must still be cast`).toBeDefined();
  return hit!.cast;
}

describe("every non-gowned cast is on an MPFB body", () => {
  it("(1) the peds_fever child is cast on the MPFB child body", () => {
    const c = castFor("peds_fever_v1", "patient_noah_chen_v1");
    expect(isMpfb(c.assetPath ?? ""), `resolved ${c.assetPath}; actor-casting.ts:320 hardcodes PEDS_CHILD_GLB for any child band`).toBe(true);
  });

  it("(2) the ED spouse is cast on an MPFB body, not the 64-joint library rail", () => {
    const c = castFor("ed_chest_pain_priority_v1", "spouse_anna_hayes_v1");
    expect(isMpfb(c.assetPath ?? ""), `resolved ${c.assetPath}; actor-casting.ts:363-368 hardcodes a libraryCastEntry`).toBe(true);
  });

  it("(3) NET: the seven gowned patients are recast onto the gowned MPFB body", () => {
    // #491 L6 lifted the P1 freeze: the seven gowned adult patients now resolve to
    // MPFB_GOWN_ADULT_PATIENT_GLB (138 joints + jaw, hospital gown), so none is Anny.
    const onAnny = everyCast().filter(
      (r) => (r.cast.role ?? "").toLowerCase() === "patient"
        && (r.cast.assetPath ?? "").includes("ed_chest_pain_adult_cast.glb"),
    );
    const onGown = everyCast().filter(
      (r) => (r.cast.role ?? "").toLowerCase() === "patient"
        && (r.cast.assetPath ?? "").includes("mpfb-gown-adult-patient.glb"),
    );
    expect(onAnny.length, "no gowned adult patient may still be cast on the 23-joint Anny body").toBe(0);
    expect(onGown.length, "the seven gowned adult patients must resolve to the gowned MPFB body").toBe(7);
  });

  it("(4) VACUITY GUARD: the enumeration is real and both target rails are distinguishable", () => {
    const all = everyCast();
    expect(all.length, "casts enumerated from listShippedCastScenarioIds()").toBeGreaterThan(30);
    expect(all.every((r) => typeof r.cast.assetPath === "string" && r.cast.assetPath.length > 0),
      "every cast must name an assetPath, or clauses (1)(2) silently pass").toBe(true);
    // The known-good column: the SAME mechanism already puts an MPFB child on the peds asthma station.
    expect(isMpfb(castFor("peds_asthma_parent_anxiety_v1", "patient_maya_johnson_v1").assetPath ?? ""),
      "peds asthma already casts the MPFB child — the body ships and the path works").toBe(true);
    expect(isNonMpfbRail("body-param-adult_lean_female-library.glb") && !isMpfb("body-param-adult_lean_female-library.glb"),
      "the library rail must not read as MPFB, or clause (2) is unfalsifiable").toBe(true);
  });
});
