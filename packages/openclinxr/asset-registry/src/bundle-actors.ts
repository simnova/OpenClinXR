import type { EncounterRuntimeActorAsset, EncounterRuntimeAsset } from "./runtime-bundles.js";

/**
 * The actor list the local encounter bundle stages.
 *
 * Split out of runtime-bundles.ts, whose frozen ceiling note asks for builder / validate / shape
 * to separate. This is shape: it arranges already-resolved ids and models into the published
 * actor records and constructs nothing.
 *
 * The FOURTH entry is conditional. RUNTIME_SLOT_KINDS has always had `additional_cast`
 * (xr-runtime-state/src/runtime-actor-slots.ts:19-24) and actor-staging.ts:267 has always read it,
 * but the bundle supplied only three actors, so a cast with four lost one silently. Measured
 * 2026-09-09: ward_delirium_med_rec_v1 casts patient, family, physician and nurse; the clinical
 * slot took the nurse by role order and the physician disappeared, so a learner met a ward nurse
 * where the case wrote a senior resident.
 */
export function buildLocalEncounterActors(input: {
  patientActorId: string;
  clinicalActorId: string;
  familyActorId: string;
  additionalActorId: string;
  additionalRole: "physician" | "other";
  patientModel: EncounterRuntimeAsset;
  nurseModel: EncounterRuntimeAsset;
  spouseModel: EncounterRuntimeAsset;
  additionalModel: EncounterRuntimeAsset | null;
}): EncounterRuntimeActorAsset[] {
  const gazeProfile = { defaultTarget: "learner_camera" as const, supportsActorTargets: true };
  return [
    {
      actorId: input.patientActorId,
      embodiment: "humanoid",
      role: "patient",
      model: input.patientModel,
      animationClips: [],
      gazeProfile,
    },
    {
      actorId: input.clinicalActorId,
      embodiment: "humanoid",
      role: "nurse",
      model: input.nurseModel,
      animationClips: [],
      gazeProfile,
    },
    {
      actorId: input.familyActorId,
      embodiment: "humanoid",
      role: "family_member",
      model: input.spouseModel,
      animationClips: [],
      gazeProfile,
    },
    ...(input.additionalActorId && input.additionalModel
      ? [{
          actorId: input.additionalActorId,
          embodiment: "humanoid" as const,
          role: input.additionalRole,
          model: input.additionalModel,
          animationClips: [],
          gazeProfile,
        }]
      : []),
  ];
}
