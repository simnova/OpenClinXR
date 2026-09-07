/**
 * Humanoid variant asset-path resolution — extracted verbatim from
 * apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE). State reads go through ctx.
 */

import type { AssetLoadingContext } from "./types.js";

export function runtimeHumanoidVariantAssetPath(
  ctx: AssetLoadingContext,
  actorId: string,
  fallbackPath: string,
): string {
  const role = (ctx.runtimeActorRole(actorId) ?? '').toLowerCase();
  const scenarioId = ctx.scenarioId();

  // #144: OB bake-off comparators only. Default cast must use resolveHumanoidVariantOrCastPath
  // (same six regenerated humanoids as psych) — do NOT fall back to stale
  // /xr-assets/humanoids/variants/ob-*-generated-human.glb (pre-#103 torn/nude mesh path).
  if (scenarioId === 'ob_headache_preeclampsia_triage_v1') {
    const humanoidSourceComparator = ctx.selectedHumanoidSourceComparator();
    if (humanoidSourceComparator === "mpfb_ob_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb';
    }
    if (humanoidSourceComparator === "charmorph_antonia_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/charmorph-antonia-ob-patient-candidate.glb';
    }
    if (humanoidSourceComparator === "charmorph_reom_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/charmorph-reom-ob-patient-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_local_fitted_garment_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/makeclothes-hm08-scrub-shirt-library.glb';
    }
    if (humanoidSourceComparator === "reom_local_authored_curved_garment_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-local-authored-curved-clinical-top-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_shirts01_cc0_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-shirts01-cc0-elvs-crude-tshirt-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_toigo_basic_tucked_tshirt_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-toigo-basic-tucked-tshirt-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_namuhekam_polo_patient" && actorId === ctx.runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-namuhekam-polo-clearance-candidate.glb';
    }
    // No default variant short-circuit — fall through to cast SSOT below.
  }

  if (scenarioId === 'peds_asthma_parent_anxiety_v1') {
    const humanoidSourceComparator = ctx.selectedHumanoidSourceComparator();
    if (humanoidSourceComparator === "peds_anny_comfy_masked_skin") {
      if (actorId === ctx.runtimePatientActorId() || role === "patient") {
        return "/cagematch/anny-comfy-masked-skin/current/peds_patient_child.glb";
      }
      if (actorId === ctx.runtimeFamilyActorId() || role === "parent" || role === "family") {
        return "/cagematch/anny-comfy-masked-skin/current/peds_anxious_parent.glb";
      }
      if (actorId === ctx.runtimeClinicalTeamActorId() || role === "nurse") {
        return "/cagematch/anny-comfy-masked-skin/current/peds_nurse_kevin.glb";
      }
    }
    if (humanoidSourceComparator === "peds_anny_mpfb2_eye_rig_patient" && (actorId === ctx.runtimePatientActorId() || role === "patient")) {
      return "/cagematch/anny-mpfb2-eye-rig/current/peds_patient_child_mpfb2_eye_rig.glb";
    }
    if (humanoidSourceComparator === "peds_anny_school_age_mpfb2_eye_patient" && (actorId === ctx.runtimePatientActorId() || role === "patient")) {
      return "/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb";
    }
    if (humanoidSourceComparator === "peds_anny_real_garment_patient" && (actorId === ctx.runtimePatientActorId() || role === "patient")) {
      return "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb";
    }
    // ui-xr-parent-nurse-runtime-comparator-v1: parent/nurse real-garment on patient primary (camera center) AND role slot; no re-orchestrate
    // #314: patient (child) and family/parent are DIFFERENT actors — the patient must
    // never resolve to the parent GLB. Split the cast: patient → child, family → parent.
    if (humanoidSourceComparator === "peds_anny_real_garment_parent") {
      if (actorId === ctx.runtimePatientActorId() || role === "patient") {
        return "/generated-humanoids/peds_patient_child.glb";
      }
      if (actorId === ctx.runtimeFamilyActorId() || role === "parent" || role === "family") {
        return "/generated-humanoids/peds_anxious_parent.glb";
      }
    }
    // #314: same split for the nurse comparator — patient → child, clinical team → nurse.
    if (humanoidSourceComparator === "peds_anny_real_garment_nurse") {
      if (actorId === ctx.runtimePatientActorId() || role === "patient") {
        return "/generated-humanoids/peds_patient_child.glb";
      }
      if (actorId === ctx.runtimeClinicalTeamActorId() || role === "nurse") {
        return "/generated-humanoids/peds_nurse_kevin.glb";
      }
    }
    const pedsHandoff = ctx.encounterBundle().pedsHumanoidMaterializationHandoff;
    if (pedsHandoff?.assets?.length) {
      const targetRole = (actorId === ctx.runtimePatientActorId() || role === 'patient')
        ? "patient"
        : (actorId === ctx.runtimeClinicalTeamActorId() || role === 'nurse')
          ? "nurse"
          : "anxious_parent";
      const asset = pedsHandoff.assets.find((a: { actorRole: string }) => a.actorRole === targetRole);
      const handoffPath = asset?.runtimeAssetPath || asset?.assetPath;
      // #278: cast SSOT is authoritative for re-cast roles — handoff routes only when it agrees.
      if (handoffPath && handoffPath === ctx.resolveCastPath({ scenarioId, actorId, role, fallbackPath })) return handoffPath;
    }
    // #366: cast SSOT is authoritative for the default (non-comparator, non-handoff) path.
    // The previous hardcoded fallback returned the Anny child for the patient and hm08 library
    // bodies for parent/nurse — the exact mis-load #366 measured in the learner view while the
    // casting table already resolved all three roles to MPFB. Route through the same SSOT the
    // ED/OB/default branches use instead of a second, stale resolution site.
    return ctx.resolveCastPath({ scenarioId, actorId, role, fallbackPath });
  }

  if (scenarioId === 'ed_chest_pain_priority_v1' || scenarioId === 'ed_chest_pain_priority_v2') {
    const humanoidSourceComparator = ctx.selectedHumanoidSourceComparator();
    const comparatorOverride =
      humanoidSourceComparator === "ed_anny_real_garment_patient" && (actorId === ctx.runtimePatientActorId() || role === "patient")
        ? "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb"
        : null;
    // #85: age-band casting SSOT — adult ED roles resolve to adult cast, never peds_patient_child.
    return ctx.resolveCastPath({ scenarioId, actorId, role, fallbackPath, comparatorOverridePath: comparatorOverride });
  }

  // #111: cast SSOT only — no older|elder|geriatric|delirium substring short-circuit.
  return ctx.resolveCastPath({ scenarioId, actorId, role, fallbackPath });
}
