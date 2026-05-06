import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import type { AssetProductionReadinessReport } from "./asset-production-readiness-benchmark.js";

type CliOptions = {
  readinessReportPath?: string;
  outputPath?: string;
};

type LadderLaneId =
  | "generatedHumanRigging"
  | "skinClothingProvenance"
  | "medicalEquipmentLibrary"
  | "animationRetargeting"
  | "lodTextureColliderBudget"
  | "multiActorQuestBudget"
  | "artifactBackedProductionAssetEvidence";

type LadderLaneStatus = "observed" | "contract_only" | "blocked";

type AssetProductionEvidenceLadderLane = {
  id: LadderLaneId;
  title: string;
  status: LadderLaneStatus;
  requiredArtifactEvidence: string[];
  currentEvidence: {
    source: string;
    observed: boolean;
    posture: "artifact_backed" | "contract_only_fixture" | "missing";
  };
  claimBoundary: {
    allowedClaims: string[];
    notEvidenceFor: string[];
  };
  blockers: string[];
};

export type AssetProductionEvidenceLadderReport = {
  schemaVersion: "openclinxr.asset-production-evidence-ladder.v1";
  kind: "asset_production_evidence_ladder";
  generatedAt: string;
  status: "passed" | "blocked";
  sourceReadinessReport: {
    file: string;
    generatedAt: string;
    status: AssetProductionReadinessReport["status"];
    localAssetEvidenceFixtureUsed: boolean;
  };
  policy: {
    installsIntroduced: false;
    cloudApisUsed: false;
    paidApisUsed: false;
    externalAssetsUsed: boolean;
    productionAssetReadinessClaimed: false;
  };
  lanes: AssetProductionEvidenceLadderLane[];
  summary: {
    totalLaneCount: number;
    observedLaneCount: number;
    contractOnlyLaneCount: number;
    blockedLaneCount: number;
    artifactBackedProductionAssetEvidenceObserved: boolean;
  };
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
    caveats: string[];
  };
};

const laneDefinitions: Array<{
  id: Exclude<LadderLaneId, "artifactBackedProductionAssetEvidence">;
  title: string;
  source: string;
  requiredArtifactEvidence: string[];
}> = [
  {
    id: "generatedHumanRigging",
    title: "Generated human rigging",
    source: "asset_production_readiness_benchmark.productionProofs.generatedHumanRigging",
    requiredArtifactEvidence: [
      "neutral generated human GLB",
      "canonical skeleton binding report",
      "skin-weight quality report",
    ],
  },
  {
    id: "skinClothingProvenance",
    title: "Skin and clothing provenance",
    source: "asset_production_readiness_benchmark.productionProofs.skinClothingProvenance",
    requiredArtifactEvidence: [
      "skin and texture provenance manifest",
      "clothing mesh provenance manifest",
      "runtime-safe material report",
    ],
  },
  {
    id: "medicalEquipmentLibrary",
    title: "Medical equipment library",
    source: "asset_production_readiness_benchmark.productionProofs.medicalEquipmentLibrary",
    requiredArtifactEvidence: [
      "equipment GLB artifact inventory",
      "clinical affordance metadata",
      "license provenance record",
    ],
  },
  {
    id: "animationRetargeting",
    title: "Animation retargeting",
    source: "asset_production_readiness_benchmark.productionProofs.animationRetargeting",
    requiredArtifactEvidence: [
      "canonical skeleton animation clips",
      "facial target or viseme mapping",
      "retargeting QA report",
    ],
  },
  {
    id: "lodTextureColliderBudget",
    title: "LOD, texture, and collider budget",
    source: "asset_production_readiness_benchmark.productionProofs.lodTextureColliderBudget",
    requiredArtifactEvidence: [
      "LOD0/LOD1/LOD2 artifact set",
      "KTX2 or texture budget report",
      "collider simplification report",
    ],
  },
  {
    id: "multiActorQuestBudget",
    title: "Multi-actor Quest 3 station budget",
    source: "asset_production_readiness_benchmark.productionProofs.multiActorQuestBudget",
    requiredArtifactEvidence: [
      "station bundle artifact manifest",
      "multi-actor draw-call and texture-memory budget",
      "Quest foreground frame-pacing evidence",
    ],
  },
];

async function main(): Promise<void> {
  await runAssetProductionEvidenceLadderCli(process.argv.slice(2));
}

export async function runAssetProductionEvidenceLadderCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const readinessReportPath = options.readinessReportPath
    ?? await latestPath("docs/openclinxr/asset-production-readiness-benchmark-*.json");
  if (!readinessReportPath) {
    throw new Error("Missing asset production readiness report. Run asset:production:readiness first or pass --readiness.");
  }

  const report = buildAssetProductionEvidenceLadderReport({
    readinessReportFile: readinessReportPath,
    readinessReport: await readJson<AssetProductionReadinessReport>(readinessReportPath),
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
    if (arg === "--readiness") {
      options.readinessReportPath = requireValue(normalizedArgs, index, arg);
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

export function buildAssetProductionEvidenceLadderReport(input: {
  generatedAt?: string;
  readinessReportFile: string;
  readinessReport: AssetProductionReadinessReport;
}): AssetProductionEvidenceLadderReport {
  const lanes = buildLanes(input.readinessReport);
  const blockers = [
    ...lanes
      .filter((lane) => lane.id === "artifactBackedProductionAssetEvidence")
      .flatMap((lane) => lane.blockers),
    ...lanes
      .filter((lane) => lane.id !== "artifactBackedProductionAssetEvidence")
      .flatMap((lane) => lane.blockers.map((blocker) => `${lane.id}:${blocker}`)),
  ];
  const passed = blockers.length === 0 && input.readinessReport.claimBoundaries.artifactBackedProductionAssetEvidenceObserved;

  return {
    schemaVersion: "openclinxr.asset-production-evidence-ladder.v1",
    kind: "asset_production_evidence_ladder",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed" : "blocked",
    sourceReadinessReport: {
      file: input.readinessReportFile,
      generatedAt: input.readinessReport.generatedAt,
      status: input.readinessReport.status,
      localAssetEvidenceFixtureUsed: input.readinessReport.input.localAssetEvidenceFixtureUsed,
    },
    policy: {
      installsIntroduced: false,
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: input.readinessReport.policy.externalAssetsUsed,
      productionAssetReadinessClaimed: false,
    },
    lanes,
    summary: {
      totalLaneCount: lanes.length,
      observedLaneCount: lanes.filter((lane) => lane.status === "observed").length,
      contractOnlyLaneCount: lanes.filter((lane) => lane.status === "contract_only").length,
      blockedLaneCount: lanes.filter((lane) => lane.status !== "observed").length,
      artifactBackedProductionAssetEvidenceObserved: input.readinessReport.claimBoundaries.artifactBackedProductionAssetEvidenceObserved,
    },
    verdict: {
      passed,
      readyForProductionAssets: false,
      blockers,
      caveats: [
        "This ladder names production asset proof lanes and claim boundaries only; it does not generate new assets.",
        "Contract-only local fixture evidence is useful for validating report shape but is not artifact-backed production asset evidence.",
      ],
    },
  };
}

function buildLanes(readinessReport: AssetProductionReadinessReport): AssetProductionEvidenceLadderLane[] {
  const proofLanes = laneDefinitions.map((definition) => {
    const proof = readinessReport.productionProofs[definition.id];
    return buildProofLane(definition, proof?.observed === true, readinessReport);
  });

  return [
    ...proofLanes,
    buildArtifactBackedLane(readinessReport),
  ];
}

function buildProofLane(
  definition: (typeof laneDefinitions)[number],
  proofObserved: boolean,
  readinessReport: AssetProductionReadinessReport,
): AssetProductionEvidenceLadderLane {
  const contractOnly = readinessReport.input.localAssetEvidenceFixtureUsed && proofObserved;
  const status: LadderLaneStatus = contractOnly ? "contract_only" : proofObserved ? "observed" : "blocked";
  const blockers = [
    contractOnly ? "contract_only_fixture_not_artifact_backed" : undefined,
    !proofObserved ? "proof_lane_not_observed" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    id: definition.id,
    title: definition.title,
    status,
    requiredArtifactEvidence: [...definition.requiredArtifactEvidence],
    currentEvidence: {
      source: definition.source,
      observed: proofObserved,
      posture: contractOnly ? "contract_only_fixture" : proofObserved ? "artifact_backed" : "missing",
    },
    claimBoundary: {
      allowedClaims: [...readinessReport.claimBoundaries.allowedClaims],
      notEvidenceFor: [...readinessReport.claimBoundaries.notEvidenceFor],
    },
    blockers,
  };
}

function buildArtifactBackedLane(readinessReport: AssetProductionReadinessReport): AssetProductionEvidenceLadderLane {
  const observed = readinessReport.claimBoundaries.artifactBackedProductionAssetEvidenceObserved;

  return {
    id: "artifactBackedProductionAssetEvidence",
    title: "Artifact-backed production asset evidence",
    status: observed ? "observed" : "blocked",
    requiredArtifactEvidence: [
      "artifact-backed generated clinical character and equipment assets",
      "reviewed provenance for generated source assets",
      "visual QA and Quest budget evidence tied to those artifacts",
    ],
    currentEvidence: {
      source: "asset_production_readiness_benchmark.claimBoundaries",
      observed,
      posture: observed ? "artifact_backed" : "missing",
    },
    claimBoundary: {
      allowedClaims: [...readinessReport.claimBoundaries.allowedClaims],
      notEvidenceFor: [...readinessReport.claimBoundaries.notEvidenceFor],
    },
    blockers: observed ? [] : ["artifact_backed_production_asset_evidence_missing"],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
