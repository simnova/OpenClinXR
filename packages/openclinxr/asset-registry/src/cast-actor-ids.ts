import type { ScenarioActorCast } from "./actor-casting.js";

/**
 * Who a scenario's cast puts in each runtime slot.
 *
 * The bundle builder used to hardcode ED literals for every case, so selecting any other scenario
 * staged the ED cast while the runtime merely recorded a scenario_mismatch. Measured 2026-09-09 on
 * the loaded humanoid in ui-xr: navigating to clinic_knee_pain_return_to_play_v1 staged
 * patient_robert_hayes_v1, which made the brief's §7 step 2 authored control unreachable because
 * the clinic case is the only one authoring a plantOffsetMeters.
 *
 * The cast table is the SSOT for who plays what; a consumer that hardcodes an actor id has
 * silently forked it. Roles come as a LIST because the same slot is cast differently across cases:
 * the ED cast fills the clinical slot with a `nurse`, the clinic cast with a `medical_assistant`.
 *
 * The ED literals remain as fallbacks, so a cast missing a role keeps today's behaviour rather
 * than losing an actor.
 */
export function castActorIdForRoles(
  cast: readonly ScenarioActorCast[],
  roles: readonly string[],
  fallbackActorId: string,
): string {
  return cast.find((entry) => roles.includes(entry.role))?.actorId ?? fallbackActorId;
}

export type BundleCastActorIds = {
  patientActorId: string;
  clinicalActorId: string;
  familyActorId: string;
  /**
   * The FOURTH slot. `RUNTIME_SLOT_KINDS` has always had `additional_cast`
   * (xr-runtime-state/src/runtime-actor-slots.ts:19-24) and the staging code has always read it
   * (actor-staging.ts:267), but the bundle supplied only three actors, so it was never filled.
   *
   * A physician takes it first, because a physician is the one role the brief names in step 3 and
   * the one a case cannot express any other way. Otherwise the first cast actor that no other slot
   * claimed. Empty when the cast has nothing left over.
   */
  additionalActorId: string;
};

/** The three slots the local encounter bundle stages, resolved from one cast table. */
export function resolveBundleCastActorIds(cast: readonly ScenarioActorCast[]): BundleCastActorIds {
  return {
    patientActorId: castActorIdForRoles(cast, ["patient"], "patient_robert_hayes_v1"),
    clinicalActorId: castActorIdForRoles(cast, ["nurse", "medical_assistant"], "nurse_maria_alvarez_v1"),
    familyActorId: castActorIdForRoles(cast, ["family", "family_member"], "spouse_anna_hayes_v1"),
    additionalActorId: additionalCastActorId(cast),
  };
}

/**
 * Who fills `additional_cast`: the physician if one is cast, otherwise the first actor no other
 * slot took, otherwise nobody.
 *
 * Physician-first is not a tiebreak, it is the brief's requirement. Measured 2026-09-09,
 * `ward_delirium_med_rec_v1` casts four — patient, family, physician and nurse — and the clinical
 * slot takes `nurse` by role order, so without this the physician is the one dropped and a learner
 * meets a ward nurse where the case wrote a senior resident.
 */
function additionalCastActorId(cast: readonly ScenarioActorCast[]): string {
  const taken = new Set([
    castActorIdForRoles(cast, ["patient"], ""),
    castActorIdForRoles(cast, ["nurse", "medical_assistant"], ""),
    castActorIdForRoles(cast, ["family", "family_member"], ""),
  ]);
  const physician = cast.find((entry) => entry.role === "physician" && !taken.has(entry.actorId));
  if (physician) return physician.actorId;
  return cast.find((entry) => !taken.has(entry.actorId))?.actorId ?? "";
}

/** A cast actor the local bundle does not stage, and why. */
export type UnstagedCastActor = { actorId: string; role: string; reason: string };

/**
 * Cast actors the local encounter bundle does NOT stage.
 *
 * Brief §7 step 3 asks, of the physician specifically: "Verify that fixed slot assignment stages
 * the intended physician ID; if omitted, report that outcome rather than substituting another
 * clinical actor." Today it is omitted AND unreported, which is the worse of the two.
 *
 * Measured 2026-09-09: `ward_delirium_med_rec_v1` casts four actors — patient, family,
 * `physician=senior_resident_ward_v1` and `nurse=ward_nurse_patel_v1` — and the bundle stages
 * three. The clinical slot takes the nurse and the physician disappears with no record. A learner
 * meets a nurse where the case wrote a senior resident.
 *
 * This does not stage them; the local bundle has three humanoid slots and adding a fourth is its
 * own slice. It makes the omission legible, which is what the brief asks for, and it is consumed
 * by `every-cast-actor-is-staged-or-reported.test.ts` so an actor cannot start being dropped
 * silently.
 */
export function unstagedCastActors(cast: readonly ScenarioActorCast[]): UnstagedCastActor[] {
  const staged = new Set(Object.values(resolveBundleCastActorIds(cast)).filter((id) => id !== ""));
  return cast
    .filter((entry) => !staged.has(entry.actorId))
    .map((entry) => ({
      actorId: entry.actorId,
      role: entry.role,
      reason: `role_${entry.role}_has_no_slot_in_the_local_encounter_bundle_which_stages_patient_clinical_family_only`,
    }));
}
