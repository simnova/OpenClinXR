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
  it("marks approved Quest-budgeted placeholder assets as production ready", () => {
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);
    const readiness = evaluateAssetManifest(patient);

    expect(readiness).toEqual({
      assetId: "patient_robert_hayes_character",
      productionReady: true,
      blockers: [],
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
    expect(readiness.productionReady).toBe(true);
    expect(readiness.missingRequiredAssetIds).toEqual([]);
    expect(readiness.blockedAssets).toEqual([]);
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
    expect(readiness.missingRequiredAssetIds).toEqual(["ed_exam_bay_environment"]);
    expect(readiness.blockedAssets).toEqual([
      {
        assetId: "nurse_maria_alvarez_character",
        blockers: ["missing_qa_ready_stage"],
      },
    ]);
  });
});
