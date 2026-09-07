/**
 * Peds viseme utterance + morph-target neutralize — extracted from
 * apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE). Reads go through ctx.
 */

import { type Group, Mesh } from "three";
import type { AssetLoadingContext } from "./types.js";

export function pedsAsthmaPatientBundleVisemeUtterance(ctx: AssetLoadingContext): string {
  const bundleTurn = (ctx.encounterBundle().sceneManifest.dialogueTurns ?? []).find(
    (turn) => turn.traceTag === "work_of_breathing_assessment" && turn.actorId === ctx.runtimePatientActorId(),
  );
  return bundleTurn?.text ?? "Maya Johnson: It is hard to breathe and my chest feels tight.";
}

export function neutralizeGeneratedHumanoidMorphTargets(humanoid: Group): void {
  neutralizeMorphTargets(humanoid);
}

function neutralizeMorphTargets(humanoid: Group): void {
  let meshCount = 0;
  let influenceCount = 0;
  const targetNames = new Set<string>();
  humanoid.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    meshCount++;
    const targetDictionary = object.morphTargetDictionary ?? {};
    const morphTargetCount = Math.max(
      object.morphTargetInfluences?.length ?? 0,
      Object.keys(targetDictionary).length,
    );
    if (!object.morphTargetInfluences || object.morphTargetInfluences.length !== morphTargetCount) {
      object.morphTargetInfluences = Array.from({ length: morphTargetCount }, () => 0);
    }
    const influences = object.morphTargetInfluences;
    if (influences) {
      for (let index = 0; index < influences.length; index++) {
        influences[index] = 0;
        influenceCount++;
      }
    }
    for (const targetName of Object.keys(targetDictionary)) {
      targetNames.add(targetName);
    }
    (object.userData as Record<string, unknown>)["openClinXrNeutralMorphTargetPolicy"] =
      "all_imported_morph_targets_zeroed_until_runtime_speech_expression_sets_controlled_weights";
  });
  (humanoid.userData as Record<string, unknown>)["openClinXrNeutralMorphTargetPolicy"] = {
    mode: "zero_imported_default_morph_weights_on_load",
    meshCount,
    influenceCount,
    targetNames: [...targetNames].sort(),
    reason: "generated_anny_mpfb2_candidates_can_export_nonzero_default_viseme_expression_weights_that_hide_the_body_in_clean_review",
  };
}

export function suppressRuntimeDiagnosticOverlaysForSourceComparator(humanoid: Group): void {
  // Never hide phenotype real-garment meshes (name includes openclinxr_real_garment / casual_top / scrub).
  const scaffoldingNamePattern = /comparator|diagnostic|gown|blanket|wrist_band|visible_lip|eye_focus|hair_cap|patient_lap|patient_gown|patient_visible|actor-specific|specific|clothing|accent|pregnancy|abdomen|belly|morph_target|wardrobe|torso|cue/u;
  const protectGarmentPattern = /openclinxr_real_garment|real_garment_from_phenotype|real_garment_peds|casual_top|scrub_top|cardigan/i;
  humanoid.traverse((object) => {
    const name = object.name.toLowerCase();
    const userData = object.userData as Record<string, unknown>;
    if (protectGarmentPattern.test(object.name) || userData["openClinXrGarmentEvidenceSurface"] || userData["openClinXrSleeveDeformEvidence"]) {
      object.visible = true;
      return;
    }
    if (!scaffoldingNamePattern.test(name)) return;
    object.visible = false;
    userData["openClinXrComparatorVisibilityPolicy"] = "hidden_for_source_realism_review_to_avoid_scaffolding_dominating_grade";
  });
  (humanoid.userData as Record<string, unknown>)["openClinXrSourceComparatorScaffoldingSuppressed"] =
    "source_fitted_mesh_prioritized_over_runtime_or_generator_debug_overlays_for_realism_scoring";
}
