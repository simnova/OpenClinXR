import type { AssetManifest } from "./index.js";

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

export function isPlaceholderAsset(manifest: AssetManifest): boolean {
  return manifest.provenance?.generationMethod === "procedural_placeholder"
    || (manifest.provenance?.sourceRefs ?? []).some((sourceRef) => sourceRef.includes("placeholder"))
    || (manifest.pipelineStages ?? []).some((stage) => stage.notes.toLowerCase().includes("not production clinical realism"));
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
    && manifest.provenance.sourceRefs.some((sourceRef) => sourceRef.trim().length > 0);
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
