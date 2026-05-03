import type { Scenario } from "@openclinxr/shared-schemas";

export type AssetKind = "character" | "environment" | "equipment" | "prop" | "texture" | "audio";

export type AssetTargetRuntime = "quest3_webxr" | "desktop_webxr";

export type AssetGenerationMethod = "procedural_placeholder" | "makehuman2" | "anny" | "stablegen" | "smplitex" | "manual_modeling";

export type AssetLicenseStatus = "approved" | "permissive_review_required" | "copyleft_blocked" | "unknown";

export type AssetPipelineStageName = "requested" | "source_reviewed" | "mesh_generated" | "rigged" | "optimized" | "qa_ready";

export type AssetPipelineStage = {
  stage: AssetPipelineStageName;
  completedAt: string;
  notes: string;
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
  productionReady: boolean;
  blockers: string[];
  warnings: string[];
};

export type ScenarioAssetReadiness = {
  scenarioId: string;
  productionReady: boolean;
  missingRequiredAssetIds: string[];
  blockedAssets: Array<{
    assetId: string;
    blockers: string[];
  }>;
};

const quest3Budget = {
  maxTriangles: 60000,
  maxTextureMegabytes: 64,
  maxDrawCalls: 24,
};

export function evaluateAssetManifest(manifest: AssetManifest): AssetReadiness {
  const blockers: string[] = [];
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
  if (manifest.geometryBudget.maxTriangles > quest3Budget.maxTriangles) {
    blockers.push("over_triangle_budget");
  }
  if (manifest.geometryBudget.maxTextureMegabytes > quest3Budget.maxTextureMegabytes) {
    blockers.push("over_texture_budget");
  }
  if (manifest.geometryBudget.maxDrawCalls > quest3Budget.maxDrawCalls) {
    blockers.push("over_draw_call_budget");
  }
  if (!stages.has("optimized")) {
    warnings.push("missing_optimized_stage");
  }

  return {
    assetId: manifest.assetId,
    productionReady: blockers.length === 0,
    blockers,
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

    for (const assetId of requiredAssetIds) {
      const manifest = this.manifests.get(assetId);
      if (!manifest) {
        missingRequiredAssetIds.push(assetId);
        continue;
      }

      const readiness = evaluateAssetManifest(manifest);
      if (!readiness.productionReady) {
        blockedAssets.push({
          assetId,
          blockers: readiness.blockers,
        });
      }
    }

    return {
      scenarioId: scenario.scenarioId,
      productionReady: missingRequiredAssetIds.length === 0 && blockedAssets.length === 0,
      missingRequiredAssetIds,
      blockedAssets,
    };
  }
}

export function createEdChestPainPlaceholderManifests(): AssetManifest[] {
  return [
    createManifest({
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

function createManifest(input: {
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
    scenarioId: "ed_chest_pain_priority_v1",
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
      stage("requested", "Asset need extracted from approved ED chest pain fixture."),
      stage("source_reviewed", "Placeholder source is local and approved for repository use."),
      stage("mesh_generated", "Low-poly placeholder mesh generated for runtime scaffolding."),
      stage("rigged", "Placeholder character or static-scene rig metadata recorded."),
      stage("optimized", "Quest 3 budget checked for initial WebXR shell."),
      stage("qa_ready", "Ready for deterministic runtime tests; not production clinical realism."),
    ],
    tags: [...input.tags],
  };
}

function stage(stageName: AssetPipelineStageName, notes: string): AssetPipelineStage {
  return {
    stage: stageName,
    completedAt: "2026-05-03T16:15:00.000Z",
    notes,
  };
}
