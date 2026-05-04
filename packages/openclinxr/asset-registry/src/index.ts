import type { Scenario } from "@openclinxr/shared-schemas";

export type AssetKind = "character" | "environment" | "equipment" | "prop" | "texture" | "audio";

export type AssetTargetRuntime = "quest3_webxr" | "desktop_webxr";

export type AssetGenerationMethod = "procedural_placeholder" | "makehuman2" | "anny" | "stablegen" | "smplitex" | "manual_modeling";

export type AssetLicenseStatus = "approved" | "permissive_review_required" | "copyleft_blocked" | "unknown";

export type AssetPipelineLane =
  | "human_base_mesh"
  | "skin_texture"
  | "clothing"
  | "rigging"
  | "animation"
  | "face_lip_sync"
  | "environment_equipment"
  | "optimization";

export type AssetToolRuntimePlacement =
  | "local_or_ci_authoring"
  | "offline_gpu_authoring"
  | "external_commercial_adapter"
  | "production_runtime";

export type AssetToolLicensePolicy =
  | "production_allowed"
  | "authoring_output_allowed"
  | "sidecar_review_required"
  | "blocked_without_exception";

export type AssetPipelineTool = {
  toolId: string;
  displayName: string;
  lanes: AssetPipelineLane[];
  sourceRefs: string[];
  licenseSummary: string;
  licensePolicy: AssetToolLicensePolicy;
  runtimePlacement: AssetToolRuntimePlacement;
  preferredForInitialBuild: boolean;
  hardRequirements: string[];
  approvalBlockers: string[];
  requiredOutputEvidence: string[];
  prohibitedUses: string[];
};

export type AssetPipelineToolReadiness = {
  toolId: string;
  authoringAllowedNow: boolean;
  productionRuntimeAllowed: boolean;
  sidecarCandidate: boolean;
  blockers: string[];
  warnings: string[];
};

export type AssetPipelineToolMatrixReadiness = {
  authoringReadyToolIds: string[];
  sidecarCandidateToolIds: string[];
  blockedToolIds: string[];
  productionRuntimeToolIds: string[];
  policyBlockers: string[];
};

export type AssetPipelineStageName = "requested" | "source_reviewed" | "mesh_generated" | "rigged" | "optimized" | "qa_ready";

export type AssetPipelineStage = {
  stage: AssetPipelineStageName;
  completedAt: string;
  notes: string;
};

export type AssetOptimizationEvidence = {
  lodTiers?: string[];
  textureCompressionFormat?: string;
  textureBudgetReportId?: string;
  colliderSimplificationReportId?: string;
};

export type AssetGenerationEvidence = {
  generatedHumanRiggingReportId?: string;
  skinClothingProvenanceId?: string;
  medicalEquipmentLibraryRecordId?: string;
  animationRetargetingReportId?: string;
};

export type AssetManifest = {
  assetId: string;
  scenarioId: string;
  kind: AssetKind;
  displayName: string;
  description: string;
  requiredForScenario: boolean;
  targetRuntime: AssetTargetRuntime;
  provenance: {
    generationMethod: AssetGenerationMethod;
    sourceRefs: string[];
    licenseStatus: AssetLicenseStatus;
  };
  generationEvidence?: AssetGenerationEvidence;
  optimizationEvidence?: AssetOptimizationEvidence;
  geometryBudget: {
    maxTriangles: number;
    maxTextureMegabytes: number;
    maxDrawCalls: number;
  };
  pipelineStages: AssetPipelineStage[];
  tags: string[];
};

export type AssetReadiness = {
  assetId: string;
  devReady: boolean;
  productionReady: boolean;
  blockers: string[];
  productionBlockers: string[];
  warnings: string[];
};

export type ScenarioAssetReadiness = {
  scenarioId: string;
  devReady: boolean;
  productionReady: boolean;
  stationBudget: ScenarioAssetBudget;
  missingRequiredAssetIds: string[];
  blockedAssets: Array<{
    assetId: string;
    blockers: string[];
  }>;
  productionBlockedAssets: Array<{
    assetId: string;
    blockers: string[];
  }>;
};

export type ScenarioAssetBudget = {
  maxVisibleTriangles: number;
  maxTextureMegabytes: number;
  maxDrawCalls: number;
  totalTriangles: number;
  totalTextureMegabytes: number;
  totalDrawCalls: number;
  blockers: string[];
};

export type ScenarioOptimizationEvidence = {
  lodTiersObserved: boolean;
  textureCompressionBudgetObserved: boolean;
  colliderSimplificationObserved: boolean;
  placeholderOnly: boolean;
  blockers: string[];
};

export type ScenarioGenerationEvidence = {
  generatedHumanRiggingObserved: boolean;
  skinClothingProvenanceObserved: boolean;
  medicalEquipmentLibraryObserved: boolean;
  animationRetargetingObserved: boolean;
  placeholderOnly: boolean;
  blockers: string[];
};

const quest3AssetBudget = {
  maxTriangles: 60000,
  maxTextureMegabytes: 64,
  maxDrawCalls: 24,
};

const quest3StationBudget = {
  maxVisibleTriangles: 180000,
  maxTextureMegabytes: 512,
  maxDrawCalls: 120,
};

export const recommendedAssetPipelineTools: AssetPipelineTool[] = [
  {
    toolId: "anny",
    displayName: "Anny",
    lanes: ["human_base_mesh"],
    sourceRefs: ["src-anny-github-2026"],
    licenseSummary: "Apache-2.0 code with CC0 adapted assets noted in the technology brief.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: true,
    hardRequirements: ["per_asset_provenance", "body_diversity_review", "quest_lod_export"],
    approvalBlockers: [],
    requiredOutputEvidence: ["source_license_record", "mesh_topology_report", "quest_budget_report"],
    prohibitedUses: ["live_quest_runtime_generation", "unreviewed_identity_replica_generation"],
  },
  {
    toolId: "blender",
    displayName: "Blender",
    lanes: ["human_base_mesh", "clothing", "environment_equipment", "optimization"],
    sourceRefs: ["src-blender-license-2026"],
    licenseSummary: "GPL-licensed executable acceptable as an external authoring tool; do not embed Blender source or scripts into production runtime without review.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: true,
    hardRequirements: ["headless_bake_script", "deterministic_export_settings", "asset_license_manifest"],
    approvalBlockers: [],
    requiredOutputEvidence: ["blender_bake_report", "gltf_validation_report", "quest_budget_report"],
    prohibitedUses: ["production_runtime_dependency", "bundled_binary_without_distribution_review"],
  },
  {
    toolId: "makehuman_outputs",
    displayName: "MakeHuman / MPFB Outputs",
    lanes: ["human_base_mesh", "clothing"],
    sourceRefs: ["src-makehuman-community-license-2026", "src-makehuman-makeclothes-github-2026"],
    licenseSummary: "Application/source packages are AGPL/GPL in places, while core assets are documented as CC0; use reviewed outputs only.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: false,
    hardRequirements: ["asset_output_license_record", "no_makehuman_source_embedding", "human_review_for_clinical_realism"],
    approvalBlockers: [],
    requiredOutputEvidence: ["asset_license_manifest", "mesh_topology_report", "quest_budget_report"],
    prohibitedUses: ["shipping_makehuman_source", "production_runtime_dependency", "unreviewed_community_assets"],
  },
  {
    toolId: "mesh2motion",
    displayName: "Mesh2Motion",
    lanes: ["rigging", "animation"],
    sourceRefs: ["src-mesh2motion-2026"],
    licenseSummary: "MIT code with exported animation-content claims that still require output QA.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: true,
    hardRequirements: ["rig_deformation_qa", "animation_retarget_report", "quest_lod_export"],
    approvalBlockers: [],
    requiredOutputEvidence: ["rig_validation_report", "motion_retarget_report", "quest_animation_budget_report"],
    prohibitedUses: ["live_quest_runtime_rigging", "unreviewed_patient_motion_library_release"],
  },
  {
    toolId: "skintokens_tokenrig",
    displayName: "SkinTokens / TokenRig",
    lanes: ["rigging"],
    sourceRefs: ["src-skintokens-github-2026"],
    licenseSummary: "MIT code, but local inference path documents Python 3.11, CUDA, flash-attn, and NVIDIA GPU memory requirements; model/data provenance still requires review.",
    licensePolicy: "sidecar_review_required",
    runtimePlacement: "offline_gpu_authoring",
    preferredForInitialBuild: false,
    hardRequirements: ["cuda_gpu_worker_or_external_gpu_box", "model_data_provenance_review", "rig_deformation_qa"],
    approvalBlockers: ["not_apple_silicon_default", "cuda_gpu_required", "model_data_provenance_review_required"],
    requiredOutputEvidence: ["skeleton_hierarchy_report", "skin_weight_quality_report", "retargeting_qa_report"],
    prohibitedUses: ["quest_runtime_dependency", "default_m4_local_pipeline", "production_adoption_without_model_provenance_review"],
  },
  {
    toolId: "stablegen",
    displayName: "StableGen",
    lanes: ["skin_texture"],
    sourceRefs: ["src-stablegen-github-2026"],
    licenseSummary: "GPL-3.0 source path; treat as blocked unless counsel approves an isolated authoring exception.",
    licensePolicy: "blocked_without_exception",
    runtimePlacement: "offline_gpu_authoring",
    preferredForInitialBuild: false,
    hardRequirements: ["legal_exception", "isolated_authoring_environment", "texture_provenance_manifest"],
    approvalBlockers: ["gpl3_source_path", "legal_exception_required"],
    requiredOutputEvidence: ["texture_provenance_manifest", "derivative_asset_review", "clinical_skin_tone_bias_review"],
    prohibitedUses: ["production_runtime_dependency", "default_local_pipeline", "committed_generated_texture_without_license_review"],
  },
  {
    toolId: "audio2face_adapter",
    displayName: "NVIDIA ACE / Audio2Face Adapter",
    lanes: ["face_lip_sync", "animation"],
    sourceRefs: ["src-nvidia-ace-audio2face-2026"],
    licenseSummary: "Commercial/proprietary adapter candidate, not an open-source baseline.",
    licensePolicy: "sidecar_review_required",
    runtimePlacement: "external_commercial_adapter",
    preferredForInitialBuild: false,
    hardRequirements: ["commercial_terms_review", "deployment_cost_review", "voice_face_safety_review"],
    approvalBlockers: ["commercial_terms_review_required", "cloud_or_gpu_dependency_review_required"],
    requiredOutputEvidence: ["latency_report", "lip_sync_quality_report", "data_processing_review"],
    prohibitedUses: ["unapproved_cloud_runtime", "default_local_development_dependency"],
  },
];

export function evaluateAssetPipelineTool(tool: AssetPipelineTool): AssetPipelineToolReadiness {
  const blockers = [...tool.approvalBlockers];
  const warnings: string[] = [];

  if (tool.sourceRefs.length === 0) {
    blockers.push("missing_source_refs");
  }
  if (tool.licensePolicy === "blocked_without_exception") {
    blockers.push("license_exception_required");
  }
  if (tool.runtimePlacement === "production_runtime" && tool.licensePolicy !== "production_allowed") {
    blockers.push("production_runtime_license_policy_not_allowed");
  }
  if (tool.runtimePlacement !== "production_runtime") {
    warnings.push("not_a_production_runtime_dependency");
  }
  if (!tool.preferredForInitialBuild) {
    warnings.push("not_preferred_for_initial_build");
  }

  return {
    toolId: tool.toolId,
    authoringAllowedNow: blockers.length === 0
      && (tool.licensePolicy === "production_allowed" || tool.licensePolicy === "authoring_output_allowed"),
    productionRuntimeAllowed: blockers.length === 0
      && tool.runtimePlacement === "production_runtime"
      && tool.licensePolicy === "production_allowed",
    sidecarCandidate: tool.licensePolicy === "sidecar_review_required",
    blockers,
    warnings,
  };
}

export function evaluateAssetPipelineToolMatrix(tools: readonly AssetPipelineTool[] = recommendedAssetPipelineTools): AssetPipelineToolMatrixReadiness {
  const readiness = tools.map((tool) => evaluateAssetPipelineTool(tool));
  const authoringReadyToolIds = readiness.filter((tool) => tool.authoringAllowedNow).map((tool) => tool.toolId);
  const sidecarCandidateToolIds = readiness.filter((tool) => tool.sidecarCandidate).map((tool) => tool.toolId);
  const blockedToolIds = readiness.filter((tool) => tool.blockers.length > 0 && !tool.sidecarCandidate).map((tool) => tool.toolId);
  const productionRuntimeToolIds = readiness.filter((tool) => tool.productionRuntimeAllowed).map((tool) => tool.toolId);
  const policyBlockers = readiness.flatMap((tool) => tool.blockers.map((blocker) => `${tool.toolId}:${blocker}`));

  return {
    authoringReadyToolIds,
    sidecarCandidateToolIds,
    blockedToolIds,
    productionRuntimeToolIds,
    policyBlockers,
  };
}

export function selectAssetPipelineToolsForLane(
  lane: AssetPipelineLane,
  tools: readonly AssetPipelineTool[] = recommendedAssetPipelineTools,
): AssetPipelineTool[] {
  return tools
    .filter((tool) => tool.lanes.includes(lane))
    .sort((left, right) => Number(right.preferredForInitialBuild) - Number(left.preferredForInitialBuild));
}

export function evaluateAssetManifest(manifest: AssetManifest): AssetReadiness {
  const blockers: string[] = [];
  const productionBlockers: string[] = [];
  const warnings: string[] = [];
  const stages = new Set(manifest.pipelineStages.map((stage) => stage.stage));

  if (manifest.provenance.licenseStatus === "copyleft_blocked") {
    blockers.push("license_copyleft_blocked");
  }
  if (manifest.provenance.licenseStatus === "unknown") {
    blockers.push("license_unknown");
  }
  if (manifest.provenance.licenseStatus === "permissive_review_required") {
    blockers.push("license_review_required");
  }
  if (!stages.has("qa_ready")) {
    blockers.push("missing_qa_ready_stage");
  }
  if (manifest.geometryBudget.maxTriangles > quest3AssetBudget.maxTriangles) {
    blockers.push("over_triangle_budget");
  }
  if (manifest.geometryBudget.maxTextureMegabytes > quest3AssetBudget.maxTextureMegabytes) {
    blockers.push("over_texture_budget");
  }
  if (manifest.geometryBudget.maxDrawCalls > quest3AssetBudget.maxDrawCalls) {
    blockers.push("over_draw_call_budget");
  }
  if (!stages.has("optimized")) {
    warnings.push("missing_optimized_stage");
  }
  if (isPlaceholderAsset(manifest)) {
    productionBlockers.push("placeholder_asset_not_clinical_release_ready");
  }

  return {
    assetId: manifest.assetId,
    devReady: blockers.length === 0,
    productionReady: blockers.length === 0 && productionBlockers.length === 0,
    blockers,
    productionBlockers,
    warnings,
  };
}

export class InMemoryAssetRegistry {
  private readonly manifests = new Map<string, AssetManifest>();

  upsert(manifest: AssetManifest): void {
    this.manifests.set(manifest.assetId, manifest);
  }

  get(assetId: string): AssetManifest | undefined {
    return this.manifests.get(assetId);
  }

  listByScenario(scenarioId: string): AssetManifest[] {
    return [...this.manifests.values()].filter((manifest) => manifest.scenarioId === scenarioId);
  }

  evaluateScenarioReadiness(scenario: Scenario): ScenarioAssetReadiness {
    const requiredAssetIds = scenario.assetNeeds?.map((assetNeed) => assetNeed.assetId) ?? [];
    const missingRequiredAssetIds: string[] = [];
    const blockedAssets: Array<{ assetId: string; blockers: string[] }> = [];
    const productionBlockedAssets: Array<{ assetId: string; blockers: string[] }> = [];
    const presentRequiredManifests: AssetManifest[] = [];

    for (const assetId of requiredAssetIds) {
      const manifest = this.manifests.get(assetId);
      if (!manifest) {
        missingRequiredAssetIds.push(assetId);
        continue;
      }
      presentRequiredManifests.push(manifest);

      const readiness = evaluateAssetManifest(manifest);
      if (!readiness.productionReady) {
        if (readiness.productionBlockers.length > 0) {
          productionBlockedAssets.push({
            assetId,
            blockers: readiness.productionBlockers,
          });
        }
      }
      if (!readiness.devReady) {
        blockedAssets.push({
          assetId,
          blockers: readiness.blockers,
        });
      }
    }
    const stationBudget = evaluateScenarioAssetBudget(presentRequiredManifests);

    return {
      scenarioId: scenario.scenarioId,
      devReady: missingRequiredAssetIds.length === 0 && blockedAssets.length === 0 && stationBudget.blockers.length === 0,
      productionReady: missingRequiredAssetIds.length === 0
        && blockedAssets.length === 0
        && productionBlockedAssets.length === 0
        && stationBudget.blockers.length === 0,
      stationBudget,
      missingRequiredAssetIds,
      blockedAssets,
      productionBlockedAssets,
    };
  }
}

export function evaluateScenarioAssetBudget(manifests: readonly AssetManifest[]): ScenarioAssetBudget {
  const totals = manifests.reduce(
    (sum, manifest) => ({
      totalTriangles: sum.totalTriangles + manifest.geometryBudget.maxTriangles,
      totalTextureMegabytes: sum.totalTextureMegabytes + manifest.geometryBudget.maxTextureMegabytes,
      totalDrawCalls: sum.totalDrawCalls + manifest.geometryBudget.maxDrawCalls,
    }),
    { totalTriangles: 0, totalTextureMegabytes: 0, totalDrawCalls: 0 },
  );
  const blockers = [
    totals.totalTriangles > quest3StationBudget.maxVisibleTriangles ? "station_triangle_budget_exceeded" : undefined,
    totals.totalTextureMegabytes > quest3StationBudget.maxTextureMegabytes ? "station_texture_budget_exceeded" : undefined,
    totals.totalDrawCalls > quest3StationBudget.maxDrawCalls ? "station_draw_call_budget_exceeded" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    ...quest3StationBudget,
    ...totals,
    blockers,
  };
}

export function evaluateScenarioOptimizationEvidence(manifests: readonly AssetManifest[]): ScenarioOptimizationEvidence {
  const lodTiersObserved = manifests.length > 0
    && manifests.every((manifest) => (manifest.optimizationEvidence?.lodTiers?.length ?? 0) >= 2);
  const textureCompressionBudgetObserved = manifests.length > 0
    && manifests.every((manifest) => Boolean(
      manifest.optimizationEvidence?.textureCompressionFormat
      && manifest.optimizationEvidence.textureBudgetReportId,
    ));
  const colliderSimplificationObserved = manifests.length > 0
    && manifests.every((manifest) => Boolean(manifest.optimizationEvidence?.colliderSimplificationReportId));
  const blockers = [
    lodTiersObserved ? undefined : "lod_tiers_missing",
    textureCompressionBudgetObserved ? undefined : "texture_compression_budget_missing",
    colliderSimplificationObserved ? undefined : "collider_simplification_report_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    lodTiersObserved,
    textureCompressionBudgetObserved,
    colliderSimplificationObserved,
    placeholderOnly: manifests.length > 0 && manifests.every(isPlaceholderAsset),
    blockers,
  };
}

export function evaluateScenarioGenerationEvidence(manifests: readonly AssetManifest[]): ScenarioGenerationEvidence {
  const characterManifests = manifests.filter((manifest) => manifest.kind === "character");
  const equipmentOrEnvironmentManifests = manifests.filter((manifest) => manifest.kind === "equipment" || manifest.kind === "environment");
  const placeholderOnly = manifests.length > 0 && manifests.every(isPlaceholderAsset);
  const hasProductionSource = (manifest: AssetManifest) => !isPlaceholderAsset(manifest)
    && manifest.provenance.licenseStatus === "approved"
    && manifest.provenance.sourceRefs.length > 0;
  const generatedHumanRiggingObserved = characterManifests.length > 0
    && characterManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.generatedHumanRiggingReportId));
  const skinClothingProvenanceObserved = characterManifests.length > 0
    && characterManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.skinClothingProvenanceId));
  const medicalEquipmentLibraryObserved = equipmentOrEnvironmentManifests.length > 0
    && equipmentOrEnvironmentManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.medicalEquipmentLibraryRecordId));
  const animationRetargetingObserved = characterManifests.length > 0
    && characterManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.animationRetargetingReportId));
  const blockers = [
    generatedHumanRiggingObserved ? undefined : "generated_human_rigging_missing",
    skinClothingProvenanceObserved ? undefined : "skin_clothing_provenance_missing",
    medicalEquipmentLibraryObserved ? undefined : "medical_equipment_library_missing",
    animationRetargetingObserved ? undefined : "animation_retargeting_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    generatedHumanRiggingObserved,
    skinClothingProvenanceObserved,
    medicalEquipmentLibraryObserved,
    animationRetargetingObserved,
    placeholderOnly,
    blockers,
  };
}

export function createEdChestPainPlaceholderManifests(): AssetManifest[] {
  return [
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "patient_robert_hayes_character",
      kind: "character",
      displayName: "Robert Hayes patient character",
      description: "Middle-aged standardized patient placeholder with chest discomfort poses and hospital gown.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-mesh"],
      maxTriangles: 18000,
      maxTextureMegabytes: 24,
      maxDrawCalls: 8,
      tags: ["patient", "diaphoretic", "hospital-gown"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "nurse_maria_alvarez_character",
      kind: "character",
      displayName: "Maria Alvarez nurse character",
      description: "ED nurse placeholder with scrubs, badge, tablet, and urgent escalation gestures.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-mesh"],
      maxTriangles: 18000,
      maxTextureMegabytes: 24,
      maxDrawCalls: 8,
      tags: ["nurse", "scrubs", "team-communication"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "ed_exam_bay_environment",
      kind: "environment",
      displayName: "Emergency department exam bay",
      description: "Quest-budgeted ED bay placeholder with stretcher, wall monitor, ECG cart position, IV pole, and doorway panel.",
      generationMethod: "manual_modeling",
      sourceRefs: ["openclinxr-placeholder-environment"],
      maxTriangles: 24000,
      maxTextureMegabytes: 32,
      maxDrawCalls: 12,
      tags: ["environment", "ed-bay", "stretcher", "monitor"],
    }),
  ];
}

export function createScenarioPlaceholderManifests(scenario: Scenario): AssetManifest[] {
  return (scenario.assetNeeds ?? []).map((assetNeed) => {
    const kind = assetKindFromNeed(assetNeed.assetType);
    const budget = placeholderBudgetForKind(kind);

    return createManifest({
      scenarioId: scenario.scenarioId,
      assetId: assetNeed.assetId,
      kind,
      displayName: humanizeAssetId(assetNeed.assetId),
      description: assetNeed.description,
      generationMethod: kind === "environment" ? "manual_modeling" : "procedural_placeholder",
      sourceRefs: [`openclinxr-placeholder-${kind}`],
      maxTriangles: budget.maxTriangles,
      maxTextureMegabytes: budget.maxTextureMegabytes,
      maxDrawCalls: budget.maxDrawCalls,
      tags: [kind, scenario.scenarioId],
    });
  });
}

function createManifest(input: {
  scenarioId: string;
  assetId: string;
  kind: AssetKind;
  displayName: string;
  description: string;
  generationMethod: AssetGenerationMethod;
  sourceRefs: string[];
  maxTriangles: number;
  maxTextureMegabytes: number;
  maxDrawCalls: number;
  tags: string[];
}): AssetManifest {
  return {
    assetId: input.assetId,
    scenarioId: input.scenarioId,
    kind: input.kind,
    displayName: input.displayName,
    description: input.description,
    requiredForScenario: true,
    targetRuntime: "quest3_webxr",
    provenance: {
      generationMethod: input.generationMethod,
      sourceRefs: [...input.sourceRefs],
      licenseStatus: "approved",
    },
    geometryBudget: {
      maxTriangles: input.maxTriangles,
      maxTextureMegabytes: input.maxTextureMegabytes,
      maxDrawCalls: input.maxDrawCalls,
    },
    pipelineStages: [
      stage("requested", `Asset need extracted from ${input.scenarioId}.`),
      stage("source_reviewed", "Placeholder source is local and approved for repository use."),
      stage("mesh_generated", "Low-poly placeholder mesh generated for runtime scaffolding."),
      stage("rigged", "Placeholder character or static-scene rig metadata recorded."),
      stage("optimized", "Quest 3 budget checked for initial WebXR shell."),
      stage("qa_ready", "Ready for deterministic runtime tests; not production clinical realism."),
    ],
    tags: [...input.tags],
  };
}

function assetKindFromNeed(assetType: string): AssetKind {
  if (assetType === "character" || assetType === "environment" || assetType === "equipment" || assetType === "prop" || assetType === "texture" || assetType === "audio") {
    return assetType;
  }
  return "prop";
}

function placeholderBudgetForKind(kind: AssetKind): Pick<AssetManifest["geometryBudget"], "maxTriangles" | "maxTextureMegabytes" | "maxDrawCalls"> {
  if (kind === "character") {
    return { maxTriangles: 18000, maxTextureMegabytes: 24, maxDrawCalls: 8 };
  }
  if (kind === "environment") {
    return { maxTriangles: 24000, maxTextureMegabytes: 32, maxDrawCalls: 12 };
  }
  if (kind === "equipment" || kind === "prop") {
    return { maxTriangles: 5000, maxTextureMegabytes: 8, maxDrawCalls: 4 };
  }
  return { maxTriangles: 1000, maxTextureMegabytes: 4, maxDrawCalls: 2 };
}

function humanizeAssetId(assetId: string): string {
  return assetId
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stage(stageName: AssetPipelineStageName, notes: string): AssetPipelineStage {
  return {
    stage: stageName,
    completedAt: "2026-05-03T16:15:00.000Z",
    notes,
  };
}

function isPlaceholderAsset(manifest: AssetManifest): boolean {
  return manifest.provenance.generationMethod === "procedural_placeholder"
    || manifest.provenance.sourceRefs.some((sourceRef) => sourceRef.includes("placeholder"))
    || manifest.pipelineStages.some((stage) => stage.notes.toLowerCase().includes("not production clinical realism"));
}
