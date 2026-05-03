import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import { createEdChestPainPlaceholderManifests, evaluateAssetManifest, InMemoryAssetRegistry, type AssetManifest } from "./index.js";

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
});
