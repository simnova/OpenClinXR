import { pathToFileURL } from "node:url";
import {
  type AssetManifest,
  createEdChestPainLocalAssetEvidenceFixtureManifests,
  createEdChestPainPlaceholderManifests,
  evaluateScenarioAssetBudget,
  evaluateScenarioGenerationEvidence,
  evaluateScenarioOptimizationEvidence,
  type ScenarioAssetBudget,
  type ScenarioGenerationEvidence,
  type ScenarioOptimizationEvidence,
} from "../../../packages/openclinxr/asset-registry/src/index.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import { validateBlenderBakeSmokeReport } from "./blender-asset-bake-smoke.js";
import { validateGltfPipelineSmokeReport } from "./gltf-pipeline-smoke.js";
import {
  type GltfTransformSmokeReport,
  validateGltfTransformSmokeReport,
} from "./gltf-transform-smoke.js";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  gltfSmokePath?: string;
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

export type GltfSourceSmokeReport = GltfPipelineSmokeReport | GltfTransformSmokeReport;

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

const proofLaneIds: ProofLaneId[] = [
  "generatedHumanRigging",
  "skinClothingProvenance",
  "medicalEquipmentLibrary",
  "animationRetargeting",
  "lodTextureColliderBudget",
  "multiActorQuestBudget",
];

type ProofLanes = Record<ProofLaneId, boolean>;

type ProofLaneReport = {
  observed: boolean;
  requiredEvidence: string[];
  blockers: string[];
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

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
    gltfSmokeFile: string;
    gltfSmokeTool: string;
    blenderAssetBakeSmokeFile: string;
    gltfGeneratedAt: string;
    blenderGeneratedAt: string;
    localAssetEvidenceFixtureUsed: boolean;
  };
  sourceEvidence: {
    gltfSmokePassed: boolean;
    gltfSmokeTool: string;
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
  claimBoundaries: {
    localAssetEvidenceFixtureIsContractOnly: boolean;
    artifactBackedProductionAssetEvidenceObserved: boolean;
    allowedClaims: string[];
    notEvidenceFor: string[];
  };
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
    caveats: string[];
  };
};

async function main(): Promise<void> {
  await runAssetProductionReadinessCli(process.argv.slice(2));
}

export async function runAssetProductionReadinessCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/asset-production-readiness-benchmark-*.json");
    if (!validatePath) {
      throw new Error("Missing asset production readiness report to validate.");
    }
    const report = await readJson<unknown>(validatePath);
    const validation = validateAssetProductionReadinessReport(report);
    const sourceValidation = validation.ok
      ? await validateLinkedSmokeReports(report as AssetProductionReadinessReport)
      : { ok: true } satisfies ValidationResult;
    if (validation.ok) {
      if (!sourceValidation.ok) {
        for (const error of sourceValidation.errors) {
          console.error(error);
        }
        process.exitCode = 1;
        return;
      }

      console.log(`Validated ${validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const gltfSmokeFile = options.gltfSmokePath ?? await latestGltfSmokePath();
  const blenderAssetBakeSmokeFile = options.blenderAssetBakeSmokePath ?? await latestPath("docs/openclinxr/blender-asset-bake-smoke-*.json");
  if (!gltfSmokeFile) {
    throw new Error("Missing GLTF smoke report. Run asset:gltf:smoke or asset:gltf-transform:smoke first, or pass --gltf-smoke.");
  }
  if (!blenderAssetBakeSmokeFile) {
    throw new Error("Missing Blender asset bake smoke report. Run asset:blender:bake first or pass --blender-smoke.");
  }

  const report = buildAssetProductionReadinessReport({
    gltfSmokeFile,
    blenderAssetBakeSmokeFile,
    gltfSmoke: await readJson<GltfSourceSmokeReport>(gltfSmokeFile),
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
    validateLatest: false,
    useLocalAssetEvidenceFixture: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    if (arg === "--gltf-smoke") {
      options.gltfSmokePath = requireValue(normalizedArgs, index, arg);
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

async function latestGltfSmokePath(): Promise<string | undefined> {
  const files = [
    ...await globFiles("docs/openclinxr/gltf-pipeline-smoke-*.json"),
    ...await globFiles("docs/openclinxr/gltf-transform-smoke-*.json"),
  ];
  return files.sort().at(-1);
}

export function buildAssetProductionReadinessReport(input: {
  generatedAt?: string;
  gltfSmokeFile: string;
  blenderAssetBakeSmokeFile: string;
  gltfSmoke: GltfSourceSmokeReport;
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
  const sourceEvidence = inspectSourceEvidence(input.gltfSmoke, input.blenderAssetBakeSmoke);
  const runtimeBudget = inspectRuntimeBudget(input.blenderAssetBakeSmoke, stationBudgetEvidence.observed);
  const claimBoundaries = buildClaimBoundaries(
    input.useLocalAssetEvidenceFixture === true,
    sourceEvidence,
    proofs,
    stationBudgetEvidence,
    generationEvidence,
    optimizationEvidence,
  );
  const blockers = [
    ...sourceEvidence.blockers.map((blocker) => `source:${blocker}`),
    claimBoundaries.localAssetEvidenceFixtureIsContractOnly ? "artifact_backed_production_asset_evidence_missing" : undefined,
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
      gltfSmokeFile: input.gltfSmokeFile,
      gltfSmokeTool: sourceEvidence.gltfSmokeTool,
      blenderAssetBakeSmokeFile: input.blenderAssetBakeSmokeFile,
      gltfGeneratedAt: input.gltfSmoke.generatedAt,
      blenderGeneratedAt: input.blenderAssetBakeSmoke.generatedAt,
      localAssetEvidenceFixtureUsed: input.useLocalAssetEvidenceFixture === true,
    },
    sourceEvidence,
    productionProofs: proofs,
    stationBudgetEvidence,
    generationEvidence,
    optimizationEvidence,
    runtimeBudget,
    claimBoundaries,
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

export function validateAssetProductionReadinessReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed", "blocked"], "/status", errors);
  requireRecord(value.policy, "/policy", errors);
  if (isRecord(value.policy)) {
    requireLiteral(value.policy.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
    requireLiteral(value.policy.paidApisUsed, false, "/policy/paidApisUsed", errors);
    requireBoolean(value.policy.externalAssetsUsed, "/policy/externalAssetsUsed", errors);
    requireLiteral(value.policy.productionUseAllowed, false, "/policy/productionUseAllowed", errors);
    requireLiteral(value.policy.copyleftRuntimeAllowed, false, "/policy/copyleftRuntimeAllowed", errors);
  }
  requireRecord(value.input, "/input", errors);
  if (isRecord(value.input)) {
    requireString(value.input.gltfSmokeFile, "/input/gltfSmokeFile", errors);
    requireString(value.input.gltfSmokeTool, "/input/gltfSmokeTool", errors);
    requireString(value.input.blenderAssetBakeSmokeFile, "/input/blenderAssetBakeSmokeFile", errors);
    requireString(value.input.gltfGeneratedAt, "/input/gltfGeneratedAt", errors);
    requireString(value.input.blenderGeneratedAt, "/input/blenderGeneratedAt", errors);
    requireBoolean(value.input.localAssetEvidenceFixtureUsed, "/input/localAssetEvidenceFixtureUsed", errors);
  }
  requireRecord(value.sourceEvidence, "/sourceEvidence", errors);
  if (isRecord(value.sourceEvidence)) {
    requireBoolean(value.sourceEvidence.gltfSmokePassed, "/sourceEvidence/gltfSmokePassed", errors);
    requireString(value.sourceEvidence.gltfSmokeTool, "/sourceEvidence/gltfSmokeTool", errors);
    requireBoolean(value.sourceEvidence.blenderBakeSmokePassed, "/sourceEvidence/blenderBakeSmokePassed", errors);
    requireString(value.sourceEvidence.blenderSourceLicensePosture, "/sourceEvidence/blenderSourceLicensePosture", errors);
    requireBoolean(value.sourceEvidence.placeholderBakeOnly, "/sourceEvidence/placeholderBakeOnly", errors);
    requireBoolean(value.sourceEvidence.blenderSemanticInventoryObserved, "/sourceEvidence/blenderSemanticInventoryObserved", errors);
    requireStringArray(value.sourceEvidence.blenderMissingRequiredObjectNames, "/sourceEvidence/blenderMissingRequiredObjectNames", errors);
    requireStringArray(value.sourceEvidence.blockers, "/sourceEvidence/blockers", errors);
  }
  requireRecord(value.productionProofs, "/productionProofs", errors);
  if (isRecord(value.productionProofs)) {
    validateProofLanes(value.productionProofs, errors);
  }
  validateStationBudgetEvidence(value.stationBudgetEvidence, "/stationBudgetEvidence", errors);
  validateGenerationEvidence(value.generationEvidence, "/generationEvidence", errors);
  validateOptimizationEvidence(value.optimizationEvidence, "/optimizationEvidence", errors);
  requireRecord(value.runtimeBudget, "/runtimeBudget", errors);
  if (isRecord(value.runtimeBudget)) {
    requireNumber(value.runtimeBudget.singleAssetPackGlbBytes, "/runtimeBudget/singleAssetPackGlbBytes", errors);
    requireLiteral(value.runtimeBudget.targetStationBundleMb, 80, "/runtimeBudget/targetStationBundleMb", errors);
    requireLiteral(value.runtimeBudget.maxVisibleTriangles, 180000, "/runtimeBudget/maxVisibleTriangles", errors);
    requireLiteral(value.runtimeBudget.maxDrawCalls, 120, "/runtimeBudget/maxDrawCalls", errors);
    requireLiteral(value.runtimeBudget.maxTextureMemoryMb, 512, "/runtimeBudget/maxTextureMemoryMb", errors);
    requireBoolean(value.runtimeBudget.multiActorBudgetObserved, "/runtimeBudget/multiActorBudgetObserved", errors);
    requireStringArray(value.runtimeBudget.blockers, "/runtimeBudget/blockers", errors);
  }
  requireRecord(value.claimBoundaries, "/claimBoundaries", errors);
  if (isRecord(value.claimBoundaries)) {
    requireBoolean(value.claimBoundaries.localAssetEvidenceFixtureIsContractOnly, "/claimBoundaries/localAssetEvidenceFixtureIsContractOnly", errors);
    requireBoolean(
      value.claimBoundaries.artifactBackedProductionAssetEvidenceObserved,
      "/claimBoundaries/artifactBackedProductionAssetEvidenceObserved",
      errors,
    );
    requireStringArray(value.claimBoundaries.allowedClaims, "/claimBoundaries/allowedClaims", errors);
    requireStringArray(value.claimBoundaries.notEvidenceFor, "/claimBoundaries/notEvidenceFor", errors);
  }
  requireRecord(value.verdict, "/verdict", errors);
  if (isRecord(value.verdict)) {
    requireBoolean(value.verdict.passed, "/verdict/passed", errors);
    requireLiteral(value.verdict.readyForProductionAssets, false, "/verdict/readyForProductionAssets", errors);
    requireStringArray(value.verdict.blockers, "/verdict/blockers", errors);
    requireStringArray(value.verdict.caveats, "/verdict/caveats", errors);
  }
  validateConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function validateLinkedSmokeReports(report: AssetProductionReadinessReport): Promise<ValidationResult> {
  const errors: string[] = [];
  const gltfSmoke = await readLinkedGltfSmoke(report.input.gltfSmokeFile, errors);
  const blenderSmoke = await readLinkedBlenderSmoke(report.input.blenderAssetBakeSmokeFile, errors);

  if (gltfSmoke) {
    compareLinkedGltfSmoke(report, gltfSmoke, errors);
  }
  if (blenderSmoke) {
    compareLinkedBlenderSmoke(report, blenderSmoke, errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function readLinkedGltfSmoke(
  filePath: string,
  errors: string[],
): Promise<GltfSourceSmokeReport | undefined> {
  let linkedSmoke: unknown;
  try {
    linkedSmoke = await readJson<unknown>(filePath);
  } catch (error) {
    errors.push(`/input/gltfSmokeFile could not be read: ${formatError(error)}`);
    return undefined;
  }

  const pipelineValidation = validateGltfPipelineSmokeReport(linkedSmoke);
  const transformValidation = validateGltfTransformSmokeReport(linkedSmoke);
  if (!pipelineValidation.ok && !transformValidation.ok) {
    errors.push(
      ...pipelineValidation.errors.map((error) => `/input/gltfSmokeFile pipeline ${error}`),
      ...transformValidation.errors.map((error) => `/input/gltfSmokeFile transform ${error}`),
    );
    return undefined;
  }

  return linkedSmoke as GltfSourceSmokeReport;
}

async function readLinkedBlenderSmoke(
  filePath: string,
  errors: string[],
): Promise<BlenderAssetBakeSmokeReport | undefined> {
  let linkedSmoke: unknown;
  try {
    linkedSmoke = await readJson<unknown>(filePath);
  } catch (error) {
    errors.push(`/input/blenderAssetBakeSmokeFile could not be read: ${formatError(error)}`);
    return undefined;
  }

  const validation = validateBlenderBakeSmokeReport(linkedSmoke);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `/input/blenderAssetBakeSmokeFile ${error}`));
    return undefined;
  }

  return linkedSmoke as BlenderAssetBakeSmokeReport;
}

function compareLinkedGltfSmoke(
  report: AssetProductionReadinessReport,
  smoke: GltfSourceSmokeReport,
  errors: string[],
): void {
  if (report.input.gltfGeneratedAt !== smoke.generatedAt) {
    errors.push("/input/gltfGeneratedAt must match linked GLTF smoke generatedAt");
  }
  if (report.input.gltfSmokeTool !== smoke.tool.package || report.sourceEvidence.gltfSmokeTool !== smoke.tool.package) {
    errors.push("/input/gltfSmokeTool and /sourceEvidence/gltfSmokeTool must match linked GLTF smoke tool.package");
  }
  if (report.sourceEvidence.gltfSmokePassed !== smoke.verdict.passed) {
    errors.push("/sourceEvidence/gltfSmokePassed must match linked GLTF smoke verdict.passed");
  }
}

function compareLinkedBlenderSmoke(
  report: AssetProductionReadinessReport,
  smoke: BlenderAssetBakeSmokeReport,
  errors: string[],
): void {
  if (report.input.blenderGeneratedAt !== smoke.generatedAt) {
    errors.push("/input/blenderGeneratedAt must match linked Blender asset bake smoke generatedAt");
  }
  if (report.policy.externalAssetsUsed !== smoke.input.externalAssetsUsed) {
    errors.push("/policy/externalAssetsUsed must match linked Blender asset bake smoke input.externalAssetsUsed");
  }
  if (report.sourceEvidence.blenderBakeSmokePassed !== smoke.verdict.passed) {
    errors.push("/sourceEvidence/blenderBakeSmokePassed must match linked Blender asset bake smoke verdict.passed");
  }
  if (report.sourceEvidence.blenderSourceLicensePosture !== smoke.input.sourceLicensePosture) {
    errors.push("/sourceEvidence/blenderSourceLicensePosture must match linked Blender asset bake smoke sourceLicensePosture");
  }
  if (report.runtimeBudget.singleAssetPackGlbBytes !== smoke.output.glbBytes) {
    errors.push("/runtimeBudget/singleAssetPackGlbBytes must match linked Blender asset bake smoke output.glbBytes");
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildClaimBoundaries(
  localAssetEvidenceFixtureIsContractOnly: boolean,
  sourceEvidence: AssetProductionReadinessReport["sourceEvidence"],
  proofs: Record<ProofLaneId, ProofLaneReport>,
  stationBudgetEvidence: StationBudgetEvidence,
  generationEvidence: ScenarioGenerationEvidence,
  optimizationEvidence: ScenarioOptimizationEvidence,
): AssetProductionReadinessReport["claimBoundaries"] {
  const allProofLanesObserved = Object.values(proofs).every((proof) => proof.observed);
  const artifactBackedProductionAssetEvidenceObserved = !localAssetEvidenceFixtureIsContractOnly
    && sourceEvidence.blockers.length === 0
    && !stationBudgetEvidence.placeholderOnly
    && !generationEvidence.placeholderOnly
    && !optimizationEvidence.placeholderOnly
    && allProofLanesObserved;

  return {
    localAssetEvidenceFixtureIsContractOnly,
    artifactBackedProductionAssetEvidenceObserved,
    allowedClaims: [
      localAssetEvidenceFixtureIsContractOnly ? "local asset evidence fixture contract slots observed" : undefined,
      sourceEvidence.blenderSemanticInventoryObserved ? "reviewed local clinical fixture semantic inventory observed" : undefined,
      artifactBackedProductionAssetEvidenceObserved ? "artifact-backed production asset evidence observed" : undefined,
    ].filter((claim): claim is string => typeof claim === "string"),
    notEvidenceFor: artifactBackedProductionAssetEvidenceObserved ? [] : [
      "production clinical asset generation readiness",
      "artifact-backed generated human rigging",
      "artifact-backed skin and clothing provenance",
      "artifact-backed medical equipment library coverage",
      "artifact-backed animation retargeting",
      "artifact-backed Quest 3 production bundle budget",
    ],
  };
}

function validateProofLanes(value: Record<string, unknown>, errors: string[]): void {
  for (const laneId of proofLaneIds) {
    if (!(laneId in value)) {
      errors.push(`/productionProofs must include proof lane ${laneId}`);
      continue;
    }
    validateProofLane(value[laneId], `/productionProofs/${laneId}`, errors);
  }
}

function validateProofLane(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.observed, `${pathName}/observed`, errors);
  requireStringArray(value.requiredEvidence, `${pathName}/requiredEvidence`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
}

function validateStationBudgetEvidence(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireString(value.scenarioId, `${pathName}/scenarioId`, errors);
  requireString(value.source, `${pathName}/source`, errors);
  requireNumber(value.requiredAssetCount, `${pathName}/requiredAssetCount`, errors);
  requireRecord(value.budget, `${pathName}/budget`, errors);
  if (isRecord(value.budget)) {
    requireNumber(value.budget.maxVisibleTriangles, `${pathName}/budget/maxVisibleTriangles`, errors);
    requireNumber(value.budget.maxTextureMegabytes, `${pathName}/budget/maxTextureMegabytes`, errors);
    requireNumber(value.budget.maxDrawCalls, `${pathName}/budget/maxDrawCalls`, errors);
    requireNumber(value.budget.totalTriangles, `${pathName}/budget/totalTriangles`, errors);
    requireNumber(value.budget.totalTextureMegabytes, `${pathName}/budget/totalTextureMegabytes`, errors);
    requireNumber(value.budget.totalDrawCalls, `${pathName}/budget/totalDrawCalls`, errors);
    requireStringArray(value.budget.blockers, `${pathName}/budget/blockers`, errors);
  }
  requireBoolean(value.placeholderOnly, `${pathName}/placeholderOnly`, errors);
  requireBoolean(value.observed, `${pathName}/observed`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
}

function validateGenerationEvidence(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.generatedHumanRiggingObserved, `${pathName}/generatedHumanRiggingObserved`, errors);
  requireBoolean(value.skinClothingProvenanceObserved, `${pathName}/skinClothingProvenanceObserved`, errors);
  requireBoolean(value.medicalEquipmentLibraryObserved, `${pathName}/medicalEquipmentLibraryObserved`, errors);
  requireBoolean(value.animationRetargetingObserved, `${pathName}/animationRetargetingObserved`, errors);
  requireBoolean(value.placeholderOnly, `${pathName}/placeholderOnly`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
}

function validateOptimizationEvidence(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.lodTiersObserved, `${pathName}/lodTiersObserved`, errors);
  requireBoolean(value.textureCompressionBudgetObserved, `${pathName}/textureCompressionBudgetObserved`, errors);
  requireBoolean(value.colliderSimplificationObserved, `${pathName}/colliderSimplificationObserved`, errors);
  requireBoolean(value.placeholderOnly, `${pathName}/placeholderOnly`, errors);
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
}

function validateConsistency(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.verdict)) {
    return;
  }

  const expectedBlockers = expectedReadinessBlockers(value);
  if (Array.isArray(value.verdict.blockers)) {
    const verdictBlockers = new Set(value.verdict.blockers);
    for (const blocker of expectedBlockers) {
      if (!verdictBlockers.has(blocker)) {
        errors.push(`/verdict/blockers must include ${blocker}`);
      }
    }
  }
}

function expectedReadinessBlockers(value: Record<string, unknown>): string[] {
  const sourceEvidence = isRecord(value.sourceEvidence) ? value.sourceEvidence : {};
  const proofs = isRecord(value.productionProofs) ? value.productionProofs : {};
  const stationBudgetEvidence = isRecord(value.stationBudgetEvidence) ? value.stationBudgetEvidence : {};
  const generationEvidence = isRecord(value.generationEvidence) ? value.generationEvidence : {};
  const optimizationEvidence = isRecord(value.optimizationEvidence) ? value.optimizationEvidence : {};
  const runtimeBudget = isRecord(value.runtimeBudget) ? value.runtimeBudget : {};
  const claimBoundaries = isRecord(value.claimBoundaries) ? value.claimBoundaries : {};

  return [
    ...stringArray(sourceEvidence.blockers).map((blocker) => `source:${blocker}`),
    claimBoundaries.localAssetEvidenceFixtureIsContractOnly === true ? "artifact_backed_production_asset_evidence_missing" : undefined,
    stationBudgetEvidence.placeholderOnly === true ? "station_budget:placeholder_asset_budget_only" : undefined,
    generationEvidence.placeholderOnly === true ? "generation:placeholder_asset_generation_only" : undefined,
    optimizationEvidence.placeholderOnly === true ? "optimization:placeholder_asset_optimization_only" : undefined,
    ...proofBlockers(proofs.generatedHumanRigging, "generation"),
    ...proofBlockers(proofs.skinClothingProvenance, "generation"),
    ...proofBlockers(proofs.medicalEquipmentLibrary, "generation"),
    ...proofBlockers(proofs.animationRetargeting, "generation"),
    ...proofBlockers(proofs.lodTextureColliderBudget, "optimization"),
    ...stringArray(runtimeBudget.blockers).map((blocker) => `runtime:${blocker}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function proofBlockers(value: unknown, prefix: string): string[] {
  return isRecord(value) ? stringArray(value.blockers).map((blocker) => `${prefix}:${blocker}`) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
  }
}

function requireLiteral<T extends string | boolean | number>(
  value: unknown,
  literal: T,
  pathName: string,
  errors: string[],
): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pathName: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${pathName} must be one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
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
  gltfSmoke: GltfSourceSmokeReport,
  blenderSmoke: BlenderAssetBakeSmokeReport,
): AssetProductionReadinessReport["sourceEvidence"] {
  const placeholderBakeOnly = blenderSmoke.input.sourceLicensePosture === "repo_generated_placeholder";
  const requiresSemanticInventory = blenderSmoke.input.sourceLicensePosture === "reviewed_local_clinical_asset_fixture";
  const blenderSemanticInventoryObserved = blenderSmoke.output.semanticInventory !== null && blenderSmoke.output.semanticInventory !== undefined;
  const blenderMissingRequiredObjectNames = blenderSmoke.output.semanticInventory?.missingRequiredObjectNames ?? [];
  const blockers = [
    gltfSmoke.verdict.passed ? undefined : "gltf_source_smoke_failed",
    blenderSmoke.verdict.passed ? undefined : "blender_bake_smoke_failed",
    placeholderBakeOnly ? "placeholder_bake_only" : undefined,
    blenderSmoke.input.externalAssetsUsed ? "external_asset_provenance_not_reviewed" : undefined,
    requiresSemanticInventory && !blenderSemanticInventoryObserved ? "blender_semantic_inventory_missing" : undefined,
    ...blenderMissingRequiredObjectNames.map((name) => `blender_required_object_missing:${name}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    gltfSmokePassed: gltfSmoke.verdict.passed,
    gltfSmokeTool: gltfSmoke.tool.package,
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
