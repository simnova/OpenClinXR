import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import {
  createEdChestPainLocalAssetEvidenceFixtureManifests,
  createEdChestPainPlaceholderManifests,
  evaluateScenarioAssetBudget,
  evaluateScenarioGenerationEvidence,
  evaluateScenarioOptimizationEvidence,
  type AssetManifest,
  type ScenarioAssetBudget,
  type ScenarioGenerationEvidence,
  type ScenarioOptimizationEvidence,
} from "../../packages/openclinxr/asset-registry/src/index.js";

type CliOptions = {
  gltfPipelineSmokePath?: string;
  blenderAssetBakeSmokePath?: string;
  outputPath?: string;
  useLocalAssetEvidenceFixture: boolean;
};

export type GltfPipelineSmokeReport = {
  generatedAt: string;
  tool: {
    command: string;
    package: string;
    version: string;
    license: string;
  };
  output: {
    glbBytes: number;
    magic: string;
    version: number | null;
    declaredLength: number | null;
    elapsedMs: number;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

export type BlenderAssetBakeSmokeReport = {
  generatedAt: string;
  tool: {
    command: string;
    package: string;
    version: string;
    license: string;
  };
  input: {
    fixture: string;
    externalAssetsUsed: boolean;
    sourceLicensePosture: string;
    expectedObjectCount: number;
  };
  output: {
    glbBytes: number;
    magic: string;
    version: number | null;
    declaredLength: number | null;
    elapsedMs: number;
    semanticInventory?: {
      sceneCount: number;
      nodeCount: number;
      meshCount: number;
      materialCount: number;
      observedObjectNames: string[];
      requiredObjectNames: string[];
      missingRequiredObjectNames: string[];
    } | null;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type ProofLaneId =
  | "generatedHumanRigging"
  | "skinClothingProvenance"
  | "medicalEquipmentLibrary"
  | "animationRetargeting"
  | "lodTextureColliderBudget"
  | "multiActorQuestBudget";

type ProofLanes = Record<ProofLaneId, boolean>;

type ProofLaneReport = {
  observed: boolean;
  requiredEvidence: string[];
  blockers: string[];
};

type StationBudgetEvidence = {
  scenarioId: string;
  source: string;
  requiredAssetCount: number;
  budget: ScenarioAssetBudget;
  placeholderOnly: boolean;
  observed: boolean;
  blockers: string[];
};

export type AssetProductionReadinessReport = {
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    externalAssetsUsed: boolean;
    productionUseAllowed: false;
    copyleftRuntimeAllowed: false;
  };
  input: {
    gltfPipelineSmokeFile: string;
    blenderAssetBakeSmokeFile: string;
    gltfGeneratedAt: string;
    blenderGeneratedAt: string;
    localAssetEvidenceFixtureUsed: boolean;
  };
  sourceEvidence: {
    gltfPipelineSmokePassed: boolean;
    blenderBakeSmokePassed: boolean;
    blenderSourceLicensePosture: string;
    placeholderBakeOnly: boolean;
    blenderSemanticInventoryObserved: boolean;
    blenderMissingRequiredObjectNames: string[];
    blockers: string[];
  };
  productionProofs: Record<ProofLaneId, ProofLaneReport>;
  stationBudgetEvidence: StationBudgetEvidence;
  generationEvidence: ScenarioGenerationEvidence;
  optimizationEvidence: ScenarioOptimizationEvidence;
  runtimeBudget: {
    singleAssetPackGlbBytes: number;
    targetStationBundleMb: 80;
    maxVisibleTriangles: 180000;
    maxDrawCalls: 120;
    maxTextureMemoryMb: 512;
    multiActorBudgetObserved: boolean;
    blockers: string[];
  };
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
    caveats: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const gltfPipelineSmokeFile = options.gltfPipelineSmokePath ?? await latestPath("docs/openclinxr/gltf-pipeline-smoke-*.json");
  const blenderAssetBakeSmokeFile = options.blenderAssetBakeSmokePath ?? await latestPath("docs/openclinxr/blender-asset-bake-smoke-*.json");
  if (!gltfPipelineSmokeFile) {
    throw new Error("Missing GLTF pipeline smoke report. Run asset:gltf:smoke first or pass --gltf-smoke.");
  }
  if (!blenderAssetBakeSmokeFile) {
    throw new Error("Missing Blender asset bake smoke report. Run asset:blender:bake first or pass --blender-smoke.");
  }

  const report = buildAssetProductionReadinessReport({
    gltfPipelineSmokeFile,
    blenderAssetBakeSmokeFile,
    gltfPipelineSmoke: await readJson<GltfPipelineSmokeReport>(gltfPipelineSmokeFile),
    blenderAssetBakeSmoke: await readJson<BlenderAssetBakeSmokeReport>(blenderAssetBakeSmokeFile),
    useLocalAssetEvidenceFixture: options.useLocalAssetEvidenceFixture,
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    useLocalAssetEvidenceFixture: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--gltf-smoke") {
      options.gltfPipelineSmokePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--blender-smoke") {
      options.blenderAssetBakeSmokePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--use-local-asset-evidence-fixture") {
      options.useLocalAssetEvidenceFixture = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  return files.sort().at(-1);
}

export function buildAssetProductionReadinessReport(input: {
  generatedAt?: string;
  gltfPipelineSmokeFile: string;
  blenderAssetBakeSmokeFile: string;
  gltfPipelineSmoke: GltfPipelineSmokeReport;
  blenderAssetBakeSmoke: BlenderAssetBakeSmokeReport;
  proofOverrides?: Partial<ProofLanes>;
  stationBudgetEvidence?: StationBudgetEvidence;
  generationEvidence?: ScenarioGenerationEvidence;
  optimizationEvidence?: ScenarioOptimizationEvidence;
  useLocalAssetEvidenceFixture?: boolean;
}): AssetProductionReadinessReport {
  const localEvidenceFixtureManifests = input.useLocalAssetEvidenceFixture
    ? createEdChestPainLocalAssetEvidenceFixtureManifests()
    : undefined;
  const stationBudgetEvidence = input.stationBudgetEvidence ?? buildEdChestPainStationBudgetEvidence(localEvidenceFixtureManifests);
  const generationEvidence = input.generationEvidence ?? buildEdChestPainGenerationEvidence(localEvidenceFixtureManifests);
  const optimizationEvidence = input.optimizationEvidence ?? buildEdChestPainOptimizationEvidence(localEvidenceFixtureManifests);
  const proofs = buildProofLanes(input.proofOverrides ?? {}, stationBudgetEvidence, generationEvidence, optimizationEvidence);
  const sourceEvidence = inspectSourceEvidence(input.gltfPipelineSmoke, input.blenderAssetBakeSmoke);
  const runtimeBudget = inspectRuntimeBudget(input.blenderAssetBakeSmoke, stationBudgetEvidence.observed);
  const blockers = [
    ...sourceEvidence.blockers.map((blocker) => `source:${blocker}`),
    stationBudgetEvidence.placeholderOnly ? "station_budget:placeholder_asset_budget_only" : undefined,
    generationEvidence.placeholderOnly ? "generation:placeholder_asset_generation_only" : undefined,
    optimizationEvidence.placeholderOnly ? "optimization:placeholder_asset_optimization_only" : undefined,
    ...proofs.generatedHumanRigging.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.skinClothingProvenance.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.medicalEquipmentLibrary.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.animationRetargeting.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.lodTextureColliderBudget.blockers.map((blocker) => `optimization:${blocker}`),
    ...runtimeBudget.blockers.map((blocker) => `runtime:${blocker}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const passed = blockers.length === 0;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: input.blenderAssetBakeSmoke.input.externalAssetsUsed,
      productionUseAllowed: false,
      copyleftRuntimeAllowed: false,
    },
    input: {
      gltfPipelineSmokeFile: input.gltfPipelineSmokeFile,
      blenderAssetBakeSmokeFile: input.blenderAssetBakeSmokeFile,
      gltfGeneratedAt: input.gltfPipelineSmoke.generatedAt,
      blenderGeneratedAt: input.blenderAssetBakeSmoke.generatedAt,
      localAssetEvidenceFixtureUsed: input.useLocalAssetEvidenceFixture === true,
    },
    sourceEvidence,
    productionProofs: proofs,
    stationBudgetEvidence,
    generationEvidence,
    optimizationEvidence,
    runtimeBudget,
    verdict: {
      passed,
      readyForProductionAssets: false,
      blockers,
      caveats: [
        "This report evaluates production-readiness evidence from local smoke outputs only; it does not generate new third-party assets.",
        sourceEvidence.placeholderBakeOnly
          ? "Placeholder GLB smoke proves the authoring tool chain can emit a GLB, not that generated clinical characters or environments are production-ready."
          : "Reviewed local clinical fixture output still requires visual QA, clinical fidelity review, and headset frame-pacing evidence before production use.",
        ...(input.useLocalAssetEvidenceFixture === true
          ? ["The local asset evidence fixture supplies contract-level proof slots only; fixture IDs are not artifact-backed generated production assets."]
          : []),
      ],
    },
  };
}

function buildEdChestPainStationBudgetEvidence(inputManifests?: readonly AssetManifest[]): StationBudgetEvidence {
  const manifests = inputManifests ?? createEdChestPainPlaceholderManifests();
  const budget = evaluateScenarioAssetBudget(manifests);
  const usesLocalEvidenceFixture = inputManifests !== undefined;

  return {
    scenarioId: "ed_chest_pain_priority_v1",
    source: usesLocalEvidenceFixture
      ? "@openclinxr/asset-registry:createEdChestPainLocalAssetEvidenceFixtureManifests"
      : "@openclinxr/asset-registry:createEdChestPainPlaceholderManifests",
    requiredAssetCount: manifests.length,
    budget,
    placeholderOnly: manifestsArePlaceholderOnly(manifests),
    observed: budget.blockers.length === 0,
    blockers: [...budget.blockers],
  };
}

function buildEdChestPainGenerationEvidence(inputManifests?: readonly AssetManifest[]): ScenarioGenerationEvidence {
  return evaluateScenarioGenerationEvidence(inputManifests ?? createEdChestPainPlaceholderManifests());
}

function buildEdChestPainOptimizationEvidence(inputManifests?: readonly AssetManifest[]): ScenarioOptimizationEvidence {
  return evaluateScenarioOptimizationEvidence(inputManifests ?? createEdChestPainPlaceholderManifests());
}

function manifestsArePlaceholderOnly(manifests: readonly AssetManifest[]): boolean {
  return manifests.length > 0 && manifests.every((manifest) => {
    const generationMethodIsPlaceholder = manifest.provenance.generationMethod === "procedural_placeholder";
    const sourceRefsArePlaceholder = manifest.provenance.sourceRefs.some((sourceRef) => sourceRef.includes("placeholder"));
    const stageNotesArePlaceholder = manifest.pipelineStages.some((stage) => stage.notes.toLowerCase().includes("placeholder"));

    return generationMethodIsPlaceholder || sourceRefsArePlaceholder || stageNotesArePlaceholder;
  });
}

function inspectSourceEvidence(
  gltfSmoke: GltfPipelineSmokeReport,
  blenderSmoke: BlenderAssetBakeSmokeReport,
): AssetProductionReadinessReport["sourceEvidence"] {
  const placeholderBakeOnly = blenderSmoke.input.sourceLicensePosture === "repo_generated_placeholder";
  const requiresSemanticInventory = blenderSmoke.input.sourceLicensePosture === "reviewed_local_clinical_asset_fixture";
  const blenderSemanticInventoryObserved = blenderSmoke.output.semanticInventory !== null && blenderSmoke.output.semanticInventory !== undefined;
  const blenderMissingRequiredObjectNames = blenderSmoke.output.semanticInventory?.missingRequiredObjectNames ?? [];
  const blockers = [
    gltfSmoke.verdict.passed ? undefined : "gltf_pipeline_smoke_failed",
    blenderSmoke.verdict.passed ? undefined : "blender_bake_smoke_failed",
    placeholderBakeOnly ? "placeholder_bake_only" : undefined,
    blenderSmoke.input.externalAssetsUsed ? "external_asset_provenance_not_reviewed" : undefined,
    requiresSemanticInventory && !blenderSemanticInventoryObserved ? "blender_semantic_inventory_missing" : undefined,
    ...blenderMissingRequiredObjectNames.map((name) => `blender_required_object_missing:${name}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    gltfPipelineSmokePassed: gltfSmoke.verdict.passed,
    blenderBakeSmokePassed: blenderSmoke.verdict.passed,
    blenderSourceLicensePosture: blenderSmoke.input.sourceLicensePosture,
    placeholderBakeOnly,
    blenderSemanticInventoryObserved,
    blenderMissingRequiredObjectNames,
    blockers,
  };
}

function buildProofLanes(
  overrides: Partial<ProofLanes>,
  stationBudgetEvidence: StationBudgetEvidence,
  generationEvidence: ScenarioGenerationEvidence,
  optimizationEvidence: ScenarioOptimizationEvidence,
): Record<ProofLaneId, ProofLaneReport> {
  return {
    generatedHumanRigging: proofLane(overrides.generatedHumanRigging ?? generationEvidence.generatedHumanRiggingObserved, [
      "neutral generated human GLB",
      "canonical skeleton binding",
      "skin-weight or rigging report",
    ], "generated_human_rigging_missing"),
    skinClothingProvenance: proofLane(overrides.skinClothingProvenance ?? generationEvidence.skinClothingProvenanceObserved, [
      "skin/texture provenance",
      "clothing mesh provenance",
      "runtime-safe material report",
    ], "skin_clothing_provenance_missing"),
    medicalEquipmentLibrary: proofLane(overrides.medicalEquipmentLibrary ?? generationEvidence.medicalEquipmentLibraryObserved, [
      "equipment GLB library",
      "clinical equipment metadata",
      "license provenance",
    ], "medical_equipment_library_missing"),
    animationRetargeting: proofLane(overrides.animationRetargeting ?? generationEvidence.animationRetargetingObserved, [
      "canonical skeleton clips",
      "viseme or facial target mapping",
      "retargeting QA report",
    ], "animation_retargeting_missing"),
    lodTextureColliderBudget: proofLane(optimizationEvidence.blockers.length === 0, [
      "LOD tiers",
      "KTX2 or texture budget report",
      "collider simplification report",
    ], optimizationEvidence.blockers),
    multiActorQuestBudget: proofLane(overrides.multiActorQuestBudget ?? stationBudgetEvidence.observed, [
      "multi-actor station budget",
      "Quest frame budget",
      "draw-call and texture-memory budget",
    ], "multi_actor_quest_budget_missing"),
  };
}

function proofLane(observed: boolean, requiredEvidence: string[], blocker: string | string[]): ProofLaneReport {
  return {
    observed,
    requiredEvidence,
    blockers: observed ? [] : Array.isArray(blocker) ? blocker : [blocker],
  };
}

function inspectRuntimeBudget(
  blenderSmoke: BlenderAssetBakeSmokeReport,
  multiActorBudgetObserved: boolean,
): AssetProductionReadinessReport["runtimeBudget"] {
  return {
    singleAssetPackGlbBytes: blenderSmoke.output.glbBytes,
    targetStationBundleMb: 80,
    maxVisibleTriangles: 180000,
    maxDrawCalls: 120,
    maxTextureMemoryMb: 512,
    multiActorBudgetObserved,
    blockers: multiActorBudgetObserved ? [] : ["multi_actor_quest_budget_missing"],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
