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
};

/** The three slots the local encounter bundle stages, resolved from one cast table. */
export function resolveBundleCastActorIds(cast: readonly ScenarioActorCast[]): BundleCastActorIds {
  return {
    patientActorId: castActorIdForRoles(cast, ["patient"], "patient_robert_hayes_v1"),
    clinicalActorId: castActorIdForRoles(cast, ["nurse", "medical_assistant"], "nurse_maria_alvarez_v1"),
    familyActorId: castActorIdForRoles(cast, ["family", "family_member"], "spouse_anna_hayes_v1"),
  };
}
