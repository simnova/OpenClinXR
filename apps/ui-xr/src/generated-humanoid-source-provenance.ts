/**
 * Humanoid source provenance metadata for scene asset evidence (#187 extract from main.ts freeze).
 */

import type { SceneAssetEvidence } from "./runtime-state.js";

type HumanoidSourceProvenance = NonNullable<
  SceneAssetEvidence["assets"][number]["humanoidSourceProvenance"]
>;

export function generatedHumanoidSourceProvenance(
  assetPath: string,
): HumanoidSourceProvenance | undefined {
  const realAnnyCandidate = {
    generatorMode: "real_anny_local_forward_pass_plus_blender_procedural" as const,
    sourceKind: "real_anny_candidate_unverified" as const,
    usesRealAnnyForwardPass: true,
    realAnnyWeightsUsed: false,
    textureMode: "procedural_fallback" as const,
    animationMode: "procedural_clinical_idle_conversation_posture_fallback" as const,
    realismGrade: "B" as const,
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
  if (assetPath === "/generated-humanoids/peds_patient_child.glb") {
    return { ...realAnnyCandidate, provenanceManifestPath: "/generated-humanoids/peds_patient_child.provenance.json" };
  }
  if (assetPath === "/generated-humanoids/peds_anxious_parent.glb") {
    return { ...realAnnyCandidate, provenanceManifestPath: "/generated-humanoids/peds_anxious_parent.provenance.json" };
  }
  if (assetPath === "/generated-humanoids/peds_nurse_kevin.glb") {
    return { ...realAnnyCandidate, provenanceManifestPath: "/generated-humanoids/peds_nurse_kevin.provenance.json" };
  }
  // #85/#96: any ed_chest_pain_* generated-humanoid cast (patient gown, nurse, spouse).
  if (assetPath.startsWith("/generated-humanoids/ed_chest_pain_") && assetPath.endsWith(".glb")) {
    return {
      ...realAnnyCandidate,
      provenanceManifestPath: assetPath.replace(/\.glb$/u, ".provenance.json"),
    };
  }
  if (assetPath.includes("/cagematch/anny-mpfb2-eye-rig/")) {
    return {
      ...realAnnyCandidate,
      sourceKind: "source_comparator_candidate",
      provenanceManifestPath: "ignored_public_cagematch/anny-mpfb2-eye-rig/current/mpfb2-eye-rig-report.json",
      notEvidenceFor: [
        ...realAnnyCandidate.notEvidenceFor,
        "default_runtime_asset_replacement",
        "generated_output_committed_to_git",
      ],
    };
  }
  if (assetPath.includes("/cagematch/anny-school-age/")) {
    return {
      ...realAnnyCandidate,
      sourceKind: "source_comparator_candidate",
      provenanceManifestPath: "ignored_public_cagematch/anny-school-age/current/mpfb2-eye-rig-report.json",
      notEvidenceFor: [
        ...realAnnyCandidate.notEvidenceFor,
        "default_runtime_asset_replacement",
        "generated_output_committed_to_git",
      ],
    };
  }
  if (assetPath.includes("/cagematch/anny-real-garment/")) {
    return {
      ...realAnnyCandidate,
      sourceKind: "source_comparator_candidate",
      provenanceManifestPath: "ignored_public_cagematch/anny-real-garment/current/peds_patient_child_real_garment_rigging_report.json",
      notEvidenceFor: [
        ...realAnnyCandidate.notEvidenceFor,
        "default_runtime_asset_replacement",
        "generated_output_committed_to_git",
      ],
    };
  }
  return undefined;
}
