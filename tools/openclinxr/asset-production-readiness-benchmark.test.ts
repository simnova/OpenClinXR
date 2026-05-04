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
      multiActorQuestBudget: { observed: false },
    });
    expect(report.runtimeBudget).toEqual({
      singlePlaceholderGlbBytes: 27284,
      targetStationBundleMb: 80,
      maxVisibleTriangles: 180000,
      maxDrawCalls: 120,
      maxTextureMemoryMb: 512,
      multiActorBudgetObserved: false,
      blockers: ["multi_actor_quest_budget_missing"],
    });
    expect(report.verdict).toEqual({
      passed: false,
      readyForProductionAssets: false,
      blockers: [
        "source:placeholder_bake_only",
        "generation:generated_human_rigging_missing",
        "generation:skin_clothing_provenance_missing",
        "generation:medical_equipment_library_missing",
        "generation:animation_retargeting_missing",
        "optimization:lod_texture_collider_budget_missing",
        "runtime:multi_actor_quest_budget_missing",
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
      proofOverrides: {
        generatedHumanRigging: true,
        skinClothingProvenance: true,
        medicalEquipmentLibrary: true,
        animationRetargeting: true,
        lodTextureColliderBudget: true,
        multiActorQuestBudget: true,
      },
    });

    expect(Object.values(report.productionProofs).every((proof) => proof.observed)).toBe(true);
    expect(report.runtimeBudget.blockers).toEqual([]);
    expect(report.verdict).toMatchObject({
      passed: true,
      readyForProductionAssets: false,
      blockers: [],
    });
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
