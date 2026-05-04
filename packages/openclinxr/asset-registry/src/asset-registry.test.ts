import { edChestPainScenario, scenarioBank } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  createEdChestPainPlaceholderManifests,
  createScenarioPlaceholderManifests,
  evaluateAssetManifest,
  evaluateAssetPipelineTool,
  evaluateAssetPipelineToolMatrix,
  evaluateScenarioOptimizationEvidence,
  InMemoryAssetRegistry,
  recommendedAssetPipelineTools,
  selectAssetPipelineToolsForLane,
  type AssetManifest,
} from "./index.js";

function requireManifest(manifests: AssetManifest[], index: number): AssetManifest {
  const manifest = manifests[index];
  if (!manifest) {
    throw new Error(`Missing test asset manifest at index ${index}`);
  }
  return manifest;
}

describe("asset registry", () => {
  it("marks approved Quest-budgeted placeholder assets as dev ready but not production ready", () => {
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);
    const readiness = evaluateAssetManifest(patient);

    expect(readiness).toEqual({
      assetId: "patient_robert_hayes_character",
      devReady: true,
      productionReady: false,
      blockers: [],
      productionBlockers: ["placeholder_asset_not_clinical_release_ready"],
      warnings: [],
    });
  });

  it("blocks assets with copyleft or unknown license posture", () => {
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);
    const readiness = evaluateAssetManifest({
      ...patient,
      assetId: "blocked_patient_mesh",
      provenance: {
        ...patient.provenance,
        licenseStatus: "copyleft_blocked",
        sourceRefs: ["agpl-character-generator"],
      },
    });

    expect(readiness.productionReady).toBe(false);
    expect(readiness.blockers).toContain("license_copyleft_blocked");

    const unknownReadiness = evaluateAssetManifest({
      ...patient,
      assetId: "unknown_patient_mesh",
      provenance: {
        ...patient.provenance,
        licenseStatus: "unknown",
        sourceRefs: ["unreviewed-character-source"],
      },
    });
    expect(unknownReadiness.productionReady).toBe(false);
    expect(unknownReadiness.blockers).toContain("license_unknown");
  });

  it("evaluates all required ED chest pain asset needs before scenario runtime use", () => {
    const registry = new InMemoryAssetRegistry();
    for (const manifest of createEdChestPainPlaceholderManifests()) {
      registry.upsert(manifest);
    }

    const readiness = registry.evaluateScenarioReadiness(edChestPainScenario);

    expect(readiness.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(readiness.devReady).toBe(true);
    expect(readiness.productionReady).toBe(false);
    expect(readiness.missingRequiredAssetIds).toEqual([]);
    expect(readiness.blockedAssets).toEqual([]);
    expect(readiness.productionBlockedAssets).toEqual([
      {
        assetId: "patient_robert_hayes_character",
        blockers: ["placeholder_asset_not_clinical_release_ready"],
      },
      {
        assetId: "nurse_maria_alvarez_character",
        blockers: ["placeholder_asset_not_clinical_release_ready"],
      },
      {
        assetId: "ed_exam_bay_environment",
        blockers: ["placeholder_asset_not_clinical_release_ready"],
      },
    ]);
  });

  it("reports missing or not-QA-ready assets as blockers", () => {
    const registry = new InMemoryAssetRegistry();
    const manifests = createEdChestPainPlaceholderManifests();
    const patient = requireManifest(manifests, 0);
    const nurse = requireManifest(manifests, 1);
    registry.upsert(patient);
    registry.upsert({
      ...nurse,
      assetId: "nurse_maria_alvarez_character",
      pipelineStages: nurse.pipelineStages.filter((stage) => stage.stage !== "qa_ready"),
    });

    const readiness = registry.evaluateScenarioReadiness(edChestPainScenario);

    expect(readiness.productionReady).toBe(false);
    expect(readiness.devReady).toBe(false);
    expect(readiness.missingRequiredAssetIds).toEqual(["ed_exam_bay_environment"]);
    expect(readiness.blockedAssets).toEqual([
      {
        assetId: "nurse_maria_alvarez_character",
        blockers: ["missing_qa_ready_stage"],
      },
    ]);
  });

  it("blocks scenario readiness when aggregate Quest station budgets are exceeded", () => {
    const registry = new InMemoryAssetRegistry();
    const baseManifests = createEdChestPainPlaceholderManifests().map((manifest) => ({
      ...manifest,
      geometryBudget: {
        ...manifest.geometryBudget,
        maxTriangles: 50000,
      },
    }));
    const extraActor: AssetManifest = {
      ...requireManifest(baseManifests, 0),
      assetId: "spouse_anna_hayes_character",
      displayName: "Anna Hayes spouse character",
      description: "Additional family member actor for interruption and emotional-pressure testing.",
      tags: ["family", "interruption"],
    };

    for (const manifest of [...baseManifests, extraActor]) {
      registry.upsert(manifest);
    }

    const readiness = registry.evaluateScenarioReadiness({
      ...edChestPainScenario,
      assetNeeds: [...baseManifests, extraActor].map((manifest) => ({
        assetId: manifest.assetId,
        assetType: manifest.kind,
        description: manifest.description,
        licenseStatus: "placeholder-approved",
      })),
    });

    expect(readiness.devReady).toBe(false);
    expect(readiness.stationBudget).toEqual({
      maxVisibleTriangles: 180000,
      maxTextureMegabytes: 512,
      maxDrawCalls: 120,
      totalTriangles: 200000,
      totalTextureMegabytes: 104,
      totalDrawCalls: 36,
      blockers: ["station_triangle_budget_exceeded"],
    });
  });

  it("derives scenario optimization evidence from manifest-level slots", () => {
    const placeholderEvidence = evaluateScenarioOptimizationEvidence(createEdChestPainPlaceholderManifests());

    expect(placeholderEvidence).toEqual({
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
  });

  it("creates dev-ready placeholder manifests for every seed-bank scenario without production release claims", () => {
    const registry = new InMemoryAssetRegistry();
    for (const scenario of scenarioBank) {
      for (const manifest of createScenarioPlaceholderManifests(scenario)) {
        registry.upsert(manifest);
      }
    }

    for (const scenario of scenarioBank) {
      const readiness = registry.evaluateScenarioReadiness(scenario);
      expect(readiness.devReady).toBe(true);
      expect(readiness.productionReady).toBe(false);
      expect(readiness.missingRequiredAssetIds).toEqual([]);
      expect(readiness.blockedAssets).toEqual([]);
      expect(readiness.productionBlockedAssets).toHaveLength(scenario.assetNeeds?.length ?? 0);
      expect(readiness.stationBudget.blockers).toEqual([]);
    }
  });

  it("keeps SkinTokens as an offline rigging sidecar candidate rather than a Quest runtime dependency", () => {
    const riggingTools = selectAssetPipelineToolsForLane("rigging");
    expect(riggingTools.map((tool) => tool.toolId)).toEqual(["mesh2motion", "skintokens_tokenrig"]);

    const skinTokens = riggingTools.find((tool) => tool.toolId === "skintokens_tokenrig");
    expect(skinTokens).toBeDefined();
    if (!skinTokens) {
      throw new Error("Missing SkinTokens tool contract.");
    }

    const readiness = evaluateAssetPipelineTool(skinTokens);
    expect(readiness).toEqual({
      toolId: "skintokens_tokenrig",
      authoringAllowedNow: false,
      productionRuntimeAllowed: false,
      sidecarCandidate: true,
      blockers: ["not_apple_silicon_default", "cuda_gpu_required", "model_data_provenance_review_required"],
      warnings: ["not_a_production_runtime_dependency", "not_preferred_for_initial_build"],
    });
    expect(skinTokens.prohibitedUses).toContain("quest_runtime_dependency");
    expect(skinTokens.requiredOutputEvidence).toContain("skin_weight_quality_report");
  });

  it("marks Blender and Mesh2Motion as authoring tools while keeping production runtime empty", () => {
    const matrix = evaluateAssetPipelineToolMatrix();

    expect(matrix.authoringReadyToolIds).toEqual([
      "anny",
      "blender",
      "makehuman_outputs",
      "mesh2motion",
    ]);
    expect(matrix.productionRuntimeToolIds).toEqual([]);
    expect(matrix.sidecarCandidateToolIds).toEqual(["skintokens_tokenrig", "audio2face_adapter"]);
    expect(matrix.blockedToolIds).toEqual(["stablegen"]);
    expect(matrix.policyBlockers).toEqual([
      "skintokens_tokenrig:not_apple_silicon_default",
      "skintokens_tokenrig:cuda_gpu_required",
      "skintokens_tokenrig:model_data_provenance_review_required",
      "stablegen:gpl3_source_path",
      "stablegen:legal_exception_required",
      "stablegen:license_exception_required",
      "audio2face_adapter:commercial_terms_review_required",
      "audio2face_adapter:cloud_or_gpu_dependency_review_required",
    ]);
  });

  it("requires every recommended pipeline tool to cite source records and explicit evidence outputs", () => {
    expect(recommendedAssetPipelineTools).toHaveLength(7);

    for (const tool of recommendedAssetPipelineTools) {
      expect(tool.sourceRefs.length, tool.toolId).toBeGreaterThan(0);
      expect(tool.requiredOutputEvidence.length, tool.toolId).toBeGreaterThan(0);
      expect(tool.prohibitedUses.length, tool.toolId).toBeGreaterThan(0);
    }
  });
});
