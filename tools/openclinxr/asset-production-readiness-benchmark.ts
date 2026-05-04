import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  gltfPipelineSmokePath?: string;
  blenderAssetBakeSmokePath?: string;
  outputPath?: string;
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
  };
  sourceEvidence: {
    gltfPipelineSmokePassed: boolean;
    blenderBakeSmokePassed: boolean;
    blenderSourceLicensePosture: string;
    placeholderBakeOnly: boolean;
    blockers: string[];
  };
  productionProofs: Record<ProofLaneId, ProofLaneReport>;
  runtimeBudget: {
    singlePlaceholderGlbBytes: number;
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
  const options: CliOptions = {};

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
}): AssetProductionReadinessReport {
  const proofs = buildProofLanes(input.proofOverrides ?? {});
  const sourceEvidence = inspectSourceEvidence(input.gltfPipelineSmoke, input.blenderAssetBakeSmoke);
  const runtimeBudget = inspectRuntimeBudget(input.blenderAssetBakeSmoke, proofs.multiActorQuestBudget.observed);
  const blockers = [
    ...sourceEvidence.blockers.map((blocker) => `source:${blocker}`),
    ...proofs.generatedHumanRigging.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.skinClothingProvenance.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.medicalEquipmentLibrary.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.animationRetargeting.blockers.map((blocker) => `generation:${blocker}`),
    ...proofs.lodTextureColliderBudget.blockers.map((blocker) => `optimization:${blocker}`),
    ...runtimeBudget.blockers.map((blocker) => `runtime:${blocker}`),
  ];
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
    },
    sourceEvidence,
    productionProofs: proofs,
    runtimeBudget,
    verdict: {
      passed,
      readyForProductionAssets: false,
      blockers,
      caveats: [
        "This report evaluates production-readiness evidence from local smoke outputs only; it does not generate new third-party assets.",
        "Placeholder GLB smoke proves the authoring tool chain can emit a GLB, not that generated clinical characters or environments are production-ready.",
      ],
    },
  };
}

function inspectSourceEvidence(
  gltfSmoke: GltfPipelineSmokeReport,
  blenderSmoke: BlenderAssetBakeSmokeReport,
): AssetProductionReadinessReport["sourceEvidence"] {
  const placeholderBakeOnly = blenderSmoke.input.sourceLicensePosture === "repo_generated_placeholder";
  const blockers = [
    gltfSmoke.verdict.passed ? undefined : "gltf_pipeline_smoke_failed",
    blenderSmoke.verdict.passed ? undefined : "blender_bake_smoke_failed",
    placeholderBakeOnly ? "placeholder_bake_only" : undefined,
    blenderSmoke.input.externalAssetsUsed ? "external_asset_provenance_not_reviewed" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    gltfPipelineSmokePassed: gltfSmoke.verdict.passed,
    blenderBakeSmokePassed: blenderSmoke.verdict.passed,
    blenderSourceLicensePosture: blenderSmoke.input.sourceLicensePosture,
    placeholderBakeOnly,
    blockers,
  };
}

function buildProofLanes(overrides: Partial<ProofLanes>): Record<ProofLaneId, ProofLaneReport> {
  return {
    generatedHumanRigging: proofLane(overrides.generatedHumanRigging ?? false, [
      "neutral generated human GLB",
      "canonical skeleton binding",
      "skin-weight or rigging report",
    ], "generated_human_rigging_missing"),
    skinClothingProvenance: proofLane(overrides.skinClothingProvenance ?? false, [
      "skin/texture provenance",
      "clothing mesh provenance",
      "runtime-safe material report",
    ], "skin_clothing_provenance_missing"),
    medicalEquipmentLibrary: proofLane(overrides.medicalEquipmentLibrary ?? false, [
      "equipment GLB library",
      "clinical equipment metadata",
      "license provenance",
    ], "medical_equipment_library_missing"),
    animationRetargeting: proofLane(overrides.animationRetargeting ?? false, [
      "canonical skeleton clips",
      "viseme or facial target mapping",
      "retargeting QA report",
    ], "animation_retargeting_missing"),
    lodTextureColliderBudget: proofLane(overrides.lodTextureColliderBudget ?? false, [
      "LOD tiers",
      "KTX2 or texture budget report",
      "collider simplification report",
    ], "lod_texture_collider_budget_missing"),
    multiActorQuestBudget: proofLane(overrides.multiActorQuestBudget ?? false, [
      "multi-actor station budget",
      "Quest frame budget",
      "draw-call and texture-memory budget",
    ], "multi_actor_quest_budget_missing"),
  };
}

function proofLane(observed: boolean, requiredEvidence: string[], blocker: string): ProofLaneReport {
  return {
    observed,
    requiredEvidence,
    blockers: observed ? [] : [blocker],
  };
}

function inspectRuntimeBudget(
  blenderSmoke: BlenderAssetBakeSmokeReport,
  multiActorBudgetObserved: boolean,
): AssetProductionReadinessReport["runtimeBudget"] {
  return {
    singlePlaceholderGlbBytes: blenderSmoke.output.glbBytes,
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
