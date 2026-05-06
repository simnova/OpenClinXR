import { describe, expect, it } from "vitest";
import {
  buildAssetProductionReadinessReport,
  type BlenderAssetBakeSmokeReport,
  type GltfPipelineSmokeReport,
} from "./asset-production-readiness-benchmark.js";

describe("asset production readiness report", () => {
  it("keeps placeholder Blender and GLTF smoke evidence blocked for production asset readiness", () => {
    const report = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-04T20:30:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
      gltfPipelineSmoke: gltfSmoke({ passed: true }),
      blenderAssetBakeSmoke: blenderSmoke({ passed: true, sourceLicensePosture: "repo_generated_placeholder" }),
    });

    expect(report.policy).toEqual({
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: false,
      productionUseAllowed: false,
      copyleftRuntimeAllowed: false,
    });
    expect(report.sourceEvidence).toMatchObject({
      gltfPipelineSmokePassed: true,
      blenderBakeSmokePassed: true,
      blenderSourceLicensePosture: "repo_generated_placeholder",
      placeholderBakeOnly: true,
    });
    expect(report.productionProofs).toMatchObject({
      generatedHumanRigging: { observed: false },
      skinClothingProvenance: { observed: false },
      medicalEquipmentLibrary: { observed: false },
      animationRetargeting: { observed: false },
      lodTextureColliderBudget: { observed: false },
      multiActorQuestBudget: { observed: true },
    });
    expect(report.optimizationEvidence).toEqual({
      lodTiersObserved: false,
      textureCompressionBudgetObserved: false,
      colliderSimplificationObserved: false,
      placeholderOnly: true,
      blockers: [
        "lod_tiers_missing",
        "texture_compression_budget_missing",
        "collider_simplification_report_missing",
      ],
    });
    expect(report.generationEvidence).toEqual({
      generatedHumanRiggingObserved: false,
      skinClothingProvenanceObserved: false,
      medicalEquipmentLibraryObserved: false,
      animationRetargetingObserved: false,
      placeholderOnly: true,
      blockers: [
        "generated_human_rigging_missing",
        "skin_clothing_provenance_missing",
        "medical_equipment_library_missing",
        "animation_retargeting_missing",
      ],
    });
    expect(report.runtimeBudget).toEqual({
      singlePlaceholderGlbBytes: 27284,
      targetStationBundleMb: 80,
      maxVisibleTriangles: 180000,
      maxDrawCalls: 120,
      maxTextureMemoryMb: 512,
      multiActorBudgetObserved: true,
      blockers: [],
    });
    expect(report.verdict).toEqual({
      passed: false,
      readyForProductionAssets: false,
      blockers: [
        "source:placeholder_bake_only",
        "station_budget:placeholder_asset_budget_only",
        "generation:placeholder_asset_generation_only",
        "optimization:placeholder_asset_optimization_only",
        "generation:generated_human_rigging_missing",
        "generation:skin_clothing_provenance_missing",
        "generation:medical_equipment_library_missing",
        "generation:animation_retargeting_missing",
        "optimization:lod_tiers_missing",
        "optimization:texture_compression_budget_missing",
        "optimization:collider_simplification_report_missing",
      ],
      caveats: [
        "This report evaluates production-readiness evidence from local smoke outputs only; it does not generate new third-party assets.",
        "Placeholder GLB smoke proves the authoring tool chain can emit a GLB, not that generated clinical characters or environments are production-ready.",
      ],
    });
  });

  it("passes when all production asset proof lanes are observed and smoke evidence is clean", () => {
    const report = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-04T20:30:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
      gltfPipelineSmoke: gltfSmoke({ passed: true }),
      blenderAssetBakeSmoke: blenderSmoke({ passed: true, sourceLicensePosture: "reviewed_generated_character_pipeline" }),
      proofOverrides: { multiActorQuestBudget: true },
      stationBudgetEvidence: completeStationBudgetEvidence(),
      generationEvidence: completeGenerationEvidence(),
      optimizationEvidence: completeOptimizationEvidence(),
    });

    expect(Object.values(report.productionProofs).every((proof) => proof.observed)).toBe(true);
    expect(report.runtimeBudget.blockers).toEqual([]);
    expect(report.verdict).toMatchObject({
      passed: true,
      readyForProductionAssets: false,
      blockers: [],
    });
  });

  it("uses local ED placeholder manifests as station-level Quest budget evidence without releasing production assets", () => {
    const report = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-04T20:30:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
      gltfPipelineSmoke: gltfSmoke({ passed: true }),
      blenderAssetBakeSmoke: blenderSmoke({ passed: true, sourceLicensePosture: "repo_generated_placeholder" }),
    });

    expect(report.stationBudgetEvidence).toEqual({
      scenarioId: "ed_chest_pain_priority_v1",
      source: "@openclinxr/asset-registry:createEdChestPainPlaceholderManifests",
      requiredAssetCount: 3,
      budget: {
        maxVisibleTriangles: 180000,
        maxTextureMegabytes: 512,
        maxDrawCalls: 120,
        totalTriangles: 60000,
        totalTextureMegabytes: 80,
        totalDrawCalls: 28,
        blockers: [],
      },
      placeholderOnly: true,
      observed: true,
      blockers: [],
    });
    expect(report.productionProofs.multiActorQuestBudget).toMatchObject({
      observed: true,
      blockers: [],
    });
    expect(report.runtimeBudget).toMatchObject({
      multiActorBudgetObserved: true,
      blockers: [],
    });
    expect(report.verdict.blockers).not.toContain("runtime:multi_actor_quest_budget_missing");
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "source:placeholder_bake_only",
      "station_budget:placeholder_asset_budget_only",
      "generation:generated_human_rigging_missing",
      "generation:placeholder_asset_generation_only",
      "optimization:placeholder_asset_optimization_only",
      "optimization:lod_tiers_missing",
      "optimization:texture_compression_budget_missing",
      "optimization:collider_simplification_report_missing",
    ]));
  });

  it("splits missing optimization evidence into LOD, texture, and collider blockers", () => {
    const report = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-04T20:30:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
      gltfPipelineSmoke: gltfSmoke({ passed: true }),
      blenderAssetBakeSmoke: blenderSmoke({ passed: true, sourceLicensePosture: "repo_generated_placeholder" }),
    });

    expect(report.productionProofs.lodTextureColliderBudget.blockers).toEqual([
      "lod_tiers_missing",
      "texture_compression_budget_missing",
      "collider_simplification_report_missing",
    ]);
    expect(report.optimizationEvidence.blockers).toEqual([
      "lod_tiers_missing",
      "texture_compression_budget_missing",
      "collider_simplification_report_missing",
    ]);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "optimization:lod_tiers_missing",
      "optimization:texture_compression_budget_missing",
      "optimization:collider_simplification_report_missing",
    ]));
    expect(report.verdict.blockers).not.toContain("optimization:lod_texture_collider_budget_missing");
  });

  it("splits missing generation evidence into manifest-derived production blockers", () => {
    const report = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-04T20:30:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
      gltfPipelineSmoke: gltfSmoke({ passed: true }),
      blenderAssetBakeSmoke: blenderSmoke({ passed: true, sourceLicensePosture: "repo_generated_placeholder" }),
    });

    expect(report.productionProofs.generatedHumanRigging.blockers).toEqual(["generated_human_rigging_missing"]);
    expect(report.productionProofs.skinClothingProvenance.blockers).toEqual(["skin_clothing_provenance_missing"]);
    expect(report.productionProofs.medicalEquipmentLibrary.blockers).toEqual(["medical_equipment_library_missing"]);
    expect(report.productionProofs.animationRetargeting.blockers).toEqual(["animation_retargeting_missing"]);
    expect(report.generationEvidence.blockers).toEqual([
      "generated_human_rigging_missing",
      "skin_clothing_provenance_missing",
      "medical_equipment_library_missing",
      "animation_retargeting_missing",
    ]);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "generation:generated_human_rigging_missing",
      "generation:skin_clothing_provenance_missing",
      "generation:medical_equipment_library_missing",
      "generation:animation_retargeting_missing",
    ]));
    expect(report.verdict.blockers).not.toContain("generation:production_asset_generation_missing");
  });

  it("blocks reviewed source evidence when station budget still comes only from placeholder manifests", () => {
    const report = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-06T02:15:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-05.json",
      gltfPipelineSmoke: gltfSmoke({ passed: true }),
      blenderAssetBakeSmoke: blenderSmoke({ passed: true, sourceLicensePosture: "reviewed_generated_character_pipeline" }),
      proofOverrides: { multiActorQuestBudget: true },
      generationEvidence: completeGenerationEvidence(),
      optimizationEvidence: completeOptimizationEvidence(),
    });

    expect(Object.values(report.productionProofs).every((proof) => proof.observed)).toBe(true);
    expect(report.sourceEvidence.blockers).toEqual([]);
    expect(report.stationBudgetEvidence).toMatchObject({
      source: "@openclinxr/asset-registry:createEdChestPainPlaceholderManifests",
      placeholderOnly: true,
      observed: true,
      blockers: [],
    });
    expect(report.verdict).toMatchObject({
      passed: false,
      readyForProductionAssets: false,
      blockers: ["station_budget:placeholder_asset_budget_only"],
    });
  });

  it("can consume local asset evidence fixture manifests while preserving the placeholder source blocker", () => {
    const report = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-06T02:00:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-05.json",
      gltfPipelineSmoke: gltfSmoke({ passed: true }),
      blenderAssetBakeSmoke: blenderSmoke({ passed: true, sourceLicensePosture: "repo_generated_placeholder" }),
      useLocalAssetEvidenceFixture: true,
    });

    expect(Object.values(report.productionProofs).every((proof) => proof.observed)).toBe(true);
    expect(report.input.localAssetEvidenceFixtureUsed).toBe(true);
    expect(report.generationEvidence).toMatchObject({
      generatedHumanRiggingObserved: true,
      skinClothingProvenanceObserved: true,
      medicalEquipmentLibraryObserved: true,
      animationRetargetingObserved: true,
      placeholderOnly: false,
      blockers: [],
    });
    expect(report.optimizationEvidence).toMatchObject({
      lodTiersObserved: true,
      textureCompressionBudgetObserved: true,
      colliderSimplificationObserved: true,
      placeholderOnly: false,
      blockers: [],
    });
    expect(report.stationBudgetEvidence).toMatchObject({
      source: "@openclinxr/asset-registry:createEdChestPainLocalAssetEvidenceFixtureManifests",
      placeholderOnly: false,
      observed: true,
      blockers: [],
    });
    expect(report.verdict).toMatchObject({
      passed: false,
      readyForProductionAssets: false,
      blockers: ["source:placeholder_bake_only"],
    });
    expect(report.verdict.caveats).toContain(
      "The local asset evidence fixture supplies contract-level proof slots only; fixture IDs are not artifact-backed generated production assets.",
    );
  });
});

function gltfSmoke(input: {
  passed: boolean;
}): GltfPipelineSmokeReport {
  return {
    generatedAt: "2026-05-03T22:35:14.615Z",
    tool: {
      command: "gltf-pipeline",
      package: "gltf-pipeline",
      version: "4.3.1",
      license: "Apache-2.0",
    },
    output: {
      glbBytes: 848,
      magic: "glTF",
      version: 2,
      declaredLength: 848,
      elapsedMs: 543.75,
    },
    verdict: {
      passed: input.passed,
      blockers: input.passed ? [] : ["glb_output_invalid"],
    },
  };
}

function completeOptimizationEvidence() {
  return {
    lodTiersObserved: true,
    textureCompressionBudgetObserved: true,
    colliderSimplificationObserved: true,
    placeholderOnly: false,
    blockers: [],
  };
}

function completeGenerationEvidence() {
  return {
    generatedHumanRiggingObserved: true,
    skinClothingProvenanceObserved: true,
    medicalEquipmentLibraryObserved: true,
    animationRetargetingObserved: true,
    placeholderOnly: false,
    blockers: [],
  };
}

function completeStationBudgetEvidence() {
  return {
    scenarioId: "ed_chest_pain_priority_v1",
    source: "@openclinxr/asset-registry:createEdChestPainLocalAssetEvidenceFixtureManifests",
    requiredAssetCount: 3,
    budget: {
      maxVisibleTriangles: 180000,
      maxTextureMegabytes: 512,
      maxDrawCalls: 120,
      totalTriangles: 60000,
      totalTextureMegabytes: 80,
      totalDrawCalls: 28,
      blockers: [],
    },
    placeholderOnly: false,
    observed: true,
    blockers: [],
  };
}

function blenderSmoke(input: {
  passed: boolean;
  sourceLicensePosture: string;
}): BlenderAssetBakeSmokeReport {
  return {
    generatedAt: "2026-05-04T05:06:10.560Z",
    tool: {
      command: "blender",
      package: "Blender",
      version: "Blender 5.1.1",
      license: "GPL-3.0-or-later-tooling",
    },
    input: {
      fixture: "low_poly_clinical_humanoid",
      externalAssetsUsed: false,
      sourceLicensePosture: input.sourceLicensePosture,
      expectedObjectCount: 7,
    },
    output: {
      glbBytes: 27284,
      magic: "glTF",
      version: 2,
      declaredLength: 27284,
      elapsedMs: 5610.77,
    },
    verdict: {
      passed: input.passed,
      blockers: input.passed ? [] : ["blender_bake_failed"],
    },
  };
}
