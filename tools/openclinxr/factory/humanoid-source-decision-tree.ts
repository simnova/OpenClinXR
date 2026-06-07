/**
 * Decision tree: when to use Anny parametric forward-pass vs MPFB/MakeHuman basemesh
 * for OpenClinXR humanoid asset generation. Emits false-gated cagematch guidance only.
 */

export type HumanoidAgeBand =
  | "infant"
  | "toddler"
  | "school_age_child"
  | "adolescent"
  | "adult"
  | "older_adult";

export type HumanoidSourcePath =
  | "anny_parametric_forward_pass"
  | "mpfb_makehuman_basemesh"
  | "hybrid_anny_mesh_mpfb_rig"
  | "blocked_pending_license_or_probe";

export type HumanoidSourceDecisionInput = {
  scenarioId: string;
  actorRole: string;
  ageBand: HumanoidAgeBand;
  requiresParametricBodyVariation: boolean;
  requiresEmbeddedEyesOrTongueTopology: boolean;
  requiresMpfbStandardRigOrShapekeys: boolean;
  requiresCaseDrivenPhenotypeSliders: boolean;
  mpfbAddonDetected: boolean;
  annyLocalImportAvailable: boolean;
  licenseReviewedForMakehumanOutputs: boolean;
};

export type HumanoidSourceDecision = {
  schemaVersion: "openclinxr.humanoid-source-decision-tree.v1";
  recommendedPath: HumanoidSourcePath;
  rationale: string[];
  fallbacks: HumanoidSourcePath[];
  blockedReasons: string[];
  compareBeforePromotion: string[];
  claimScope: "factory_routing_guidance_not_runtime_or_readiness";
  notEvidenceFor: Array<
    | "b_plus_visual_realism_gate"
    | "production_asset_readiness"
    | "quest_readiness"
    | "learner_readiness"
    | "clinical_validity"
    | "scoring_validity"
  >;
};

export function decideHumanoidSourcePath(input: HumanoidSourceDecisionInput): HumanoidSourceDecision {
  const blockedReasons: string[] = [];
  const rationale: string[] = [];
  const fallbacks: HumanoidSourcePath[] = [];
  const compareBeforePromotion = [
    "isolated_model_vetting_studio_fixed_camera_screenshots",
    "structural_glb_metrics_and_rig_morph_inventory",
    "license_and_provenance_record_for_chosen_source",
  ];

  if (!input.annyLocalImportAvailable && !input.mpfbAddonDetected) {
    return decision(
      "blocked_pending_license_or_probe",
      ["Neither Anny local import nor MPFB Blender addon is available on this workstation."],
      [],
      ["install_anny_module_or_enable_mpfb2_blender_addon"],
      compareBeforePromotion,
    );
  }

  if (input.requiresCaseDrivenPhenotypeSliders || input.requiresParametricBodyVariation) {
    rationale.push("Case-driven phenotype sliders and body variation map to Anny forward-pass parameters.");
    if (input.annyLocalImportAvailable) {
      fallbacks.push(input.mpfbAddonDetected ? "mpfb_makehuman_basemesh" : "blocked_pending_license_or_probe");
      return decision("anny_parametric_forward_pass", rationale, fallbacks, blockedReasons, compareBeforePromotion);
    }
    blockedReasons.push("anny_local_import_unavailable_for_parametric_case_binding");
  }

  if (input.requiresMpfbStandardRigOrShapekeys) {
    rationale.push("MPFB standard rig, face shape keys, and MakeHuman basemesh topology are MPFB-native.");
    if (input.mpfbAddonDetected) {
      if (!input.licenseReviewedForMakehumanOutputs) {
        blockedReasons.push("makehuman_output_license_not_reviewed_for_promotion");
      }
      fallbacks.push(input.annyLocalImportAvailable ? "hybrid_anny_mesh_mpfb_rig" : "blocked_pending_license_or_probe");
      return decision("mpfb_makehuman_basemesh", rationale, fallbacks, blockedReasons, compareBeforePromotion);
    }
    blockedReasons.push("mpfb_addon_not_detected");
    if (input.annyLocalImportAvailable) {
      rationale.push("MPFB rig requested but addon missing; hybrid path may record mpfb.add_standard_rig poll failure on Anny GLB.");
      return decision("hybrid_anny_mesh_mpfb_rig", rationale, ["mpfb_makehuman_basemesh"], blockedReasons, compareBeforePromotion);
    }
  }

  if (input.requiresEmbeddedEyesOrTongueTopology && input.ageBand === "school_age_child") {
    rationale.push("Pediatric default Anny topology includes embedded eyes/tongue suitable for UV-mask face cagematches.");
    if (input.annyLocalImportAvailable) {
      fallbacks.push(input.mpfbAddonDetected ? "mpfb_makehuman_basemesh" : "blocked_pending_license_or_probe");
      return decision("anny_parametric_forward_pass", rationale, fallbacks, blockedReasons, compareBeforePromotion);
    }
  }

  if (
    (input.ageBand === "adult" || input.ageBand === "older_adult") &&
    input.mpfbAddonDetected &&
    input.licenseReviewedForMakehumanOutputs
  ) {
    rationale.push("Adult/older-adult actors with reviewed MakeHuman output licensing favor MPFB basemesh + Rigify/MPFB rig for clothing/hair library compatibility.");
    fallbacks.push(input.annyLocalImportAvailable ? "anny_parametric_forward_pass" : "blocked_pending_license_or_probe");
    return decision("mpfb_makehuman_basemesh", rationale, fallbacks, blockedReasons, compareBeforePromotion);
  }

  if (input.annyLocalImportAvailable) {
    rationale.push("Default safe path: Anny parametric forward pass with false-gated preflight until an alternate source wins isolated cagematch.");
    fallbacks.push(input.mpfbAddonDetected ? "mpfb_makehuman_basemesh" : "blocked_pending_license_or_probe");
    return decision("anny_parametric_forward_pass", rationale, fallbacks, blockedReasons, compareBeforePromotion);
  }

  if (input.mpfbAddonDetected) {
    rationale.push("Anny unavailable; probe MPFB/MakeHuman as local alternate source for isolated cagematch only.");
    if (!input.licenseReviewedForMakehumanOutputs) blockedReasons.push("makehuman_output_license_not_reviewed_for_promotion");
    return decision("mpfb_makehuman_basemesh", rationale, ["blocked_pending_license_or_probe"], blockedReasons, compareBeforePromotion);
  }

  return decision("blocked_pending_license_or_probe", ["No approved local humanoid source path is ready."], [], blockedReasons, compareBeforePromotion);
}

function decision(
  recommendedPath: HumanoidSourcePath,
  rationale: string[],
  fallbacks: HumanoidSourcePath[],
  blockedReasons: string[],
  compareBeforePromotion: string[],
): HumanoidSourceDecision {
  return {
    schemaVersion: "openclinxr.humanoid-source-decision-tree.v1",
    recommendedPath,
    rationale,
    fallbacks,
    blockedReasons,
    compareBeforePromotion,
    claimScope: "factory_routing_guidance_not_runtime_or_readiness",
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export const PEDS_ASTHMA_PATIENT_DECISION_INPUT: HumanoidSourceDecisionInput = {
  scenarioId: "peds_asthma_parent_anxiety_v1",
  actorRole: "patient",
  ageBand: "school_age_child",
  requiresParametricBodyVariation: true,
  requiresEmbeddedEyesOrTongueTopology: true,
  requiresMpfbStandardRigOrShapekeys: false,
  requiresCaseDrivenPhenotypeSliders: true,
  mpfbAddonDetected: true,
  annyLocalImportAvailable: true,
  licenseReviewedForMakehumanOutputs: false,
};

export const PEDS_ASTHMA_PARENT_MPFB_COMPARE_INPUT: HumanoidSourceDecisionInput = {
  scenarioId: "peds_asthma_parent_anxiety_v1",
  actorRole: "parent",
  ageBand: "adult",
  requiresParametricBodyVariation: false,
  requiresEmbeddedEyesOrTongueTopology: false,
  requiresMpfbStandardRigOrShapekeys: true,
  requiresCaseDrivenPhenotypeSliders: false,
  mpfbAddonDetected: true,
  annyLocalImportAvailable: true,
  licenseReviewedForMakehumanOutputs: false,
};