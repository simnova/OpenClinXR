import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import {
  type AssetProductionReadinessReport,
  validateAssetProductionReadinessReport,
} from "./asset-production-readiness-benchmark.js";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
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

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const ladderLaneIds: LadderLaneId[] = [
  "generatedHumanRigging",
  "skinClothingProvenance",
  "medicalEquipmentLibrary",
  "animationRetargeting",
  "lodTextureColliderBudget",
  "multiActorQuestBudget",
  "artifactBackedProductionAssetEvidence",
];

const ladderLaneStatuses: LadderLaneStatus[] = ["observed", "contract_only", "blocked"];

const evidencePostures: AssetProductionEvidenceLadderLane["currentEvidence"]["posture"][] = [
  "artifact_backed",
  "contract_only_fixture",
  "missing",
];

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
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/asset-production-evidence-ladder-*.json");
    if (!validatePath) {
      throw new Error("Missing asset production evidence ladder report to validate.");
    }
    const report = await readJson<unknown>(validatePath);
    const validation = validateAssetProductionEvidenceLadderReport(report);
    const sourceValidation = validation.ok
      ? await validateSourceReadinessReportLink(report as AssetProductionEvidenceLadderReport)
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

  const readinessReportPath = options.readinessReportPath
    ?? await latestPath("docs/openclinxr/asset-production-readiness-benchmark-*.json");
  if (!readinessReportPath) {
    throw new Error("Missing asset production readiness report. Run asset:production:readiness first or pass --readiness.");
  }

  const readinessReport = await readJson<unknown>(readinessReportPath);
  const readinessValidation = validateAssetProductionReadinessReport(readinessReport);
  if (!readinessValidation.ok) {
    for (const error of readinessValidation.errors) {
      console.error(`source readiness report ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  const validatedReadinessReport = readinessReport as AssetProductionReadinessReport;

  const report = buildAssetProductionEvidenceLadderReport({
    readinessReportFile: readinessReportPath,
    readinessReport: validatedReadinessReport,
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

export function validateAssetProductionEvidenceLadderReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.schemaVersion, "openclinxr.asset-production-evidence-ladder.v1", "/schemaVersion", errors);
  requireLiteral(value.kind, "asset_production_evidence_ladder", "/kind", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed", "blocked"], "/status", errors);
  requireRecord(value.sourceReadinessReport, "/sourceReadinessReport", errors);
  if (isRecord(value.sourceReadinessReport)) {
    requireString(value.sourceReadinessReport.file, "/sourceReadinessReport/file", errors);
    requireString(value.sourceReadinessReport.generatedAt, "/sourceReadinessReport/generatedAt", errors);
    requireString(value.sourceReadinessReport.status, "/sourceReadinessReport/status", errors);
    requireBoolean(
      value.sourceReadinessReport.localAssetEvidenceFixtureUsed,
      "/sourceReadinessReport/localAssetEvidenceFixtureUsed",
      errors,
    );
  }
  requireRecord(value.policy, "/policy", errors);
  if (isRecord(value.policy)) {
    requireLiteral(value.policy.installsIntroduced, false, "/policy/installsIntroduced", errors);
    requireLiteral(value.policy.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
    requireLiteral(value.policy.paidApisUsed, false, "/policy/paidApisUsed", errors);
    requireBoolean(value.policy.externalAssetsUsed, "/policy/externalAssetsUsed", errors);
    requireLiteral(value.policy.productionAssetReadinessClaimed, false, "/policy/productionAssetReadinessClaimed", errors);
  }
  requireArray(value.lanes, "/lanes", errors);
  if (Array.isArray(value.lanes)) {
    value.lanes.forEach((lane, index) => {
      validateLane(lane, `/lanes/${index}`, errors);
    });
  }
  requireRecord(value.summary, "/summary", errors);
  if (isRecord(value.summary)) {
    requireNumber(value.summary.totalLaneCount, "/summary/totalLaneCount", errors);
    requireNumber(value.summary.observedLaneCount, "/summary/observedLaneCount", errors);
    requireNumber(value.summary.contractOnlyLaneCount, "/summary/contractOnlyLaneCount", errors);
    requireNumber(value.summary.blockedLaneCount, "/summary/blockedLaneCount", errors);
    requireBoolean(
      value.summary.artifactBackedProductionAssetEvidenceObserved,
      "/summary/artifactBackedProductionAssetEvidenceObserved",
      errors,
    );
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

async function validateSourceReadinessReportLink(
  report: AssetProductionEvidenceLadderReport,
): Promise<ValidationResult> {
  const errors: string[] = [];
  let sourceReadinessReport: unknown;
  try {
    sourceReadinessReport = await readJson<unknown>(report.sourceReadinessReport.file);
  } catch (error) {
    errors.push(`/sourceReadinessReport/file could not be read: ${formatError(error)}`);
    return { ok: false, errors };
  }

  const sourceValidation = validateAssetProductionReadinessReport(sourceReadinessReport);
  if (!sourceValidation.ok) {
    return {
      ok: false,
      errors: sourceValidation.errors.map((error) => `/sourceReadinessReport/file ${error}`),
    };
  }

  const source = sourceReadinessReport as AssetProductionReadinessReport;
  if (report.sourceReadinessReport.generatedAt !== source.generatedAt) {
    errors.push("/sourceReadinessReport/generatedAt must match linked readiness report generatedAt");
  }
  if (report.sourceReadinessReport.status !== source.status) {
    errors.push("/sourceReadinessReport/status must match linked readiness report status");
  }
  if (report.sourceReadinessReport.localAssetEvidenceFixtureUsed !== source.input.localAssetEvidenceFixtureUsed) {
    errors.push(
      "/sourceReadinessReport/localAssetEvidenceFixtureUsed must match linked readiness report input.localAssetEvidenceFixtureUsed",
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateConsistency(value: Record<string, unknown>, errors: string[]): void {
  if (!Array.isArray(value.lanes) || !isRecord(value.summary) || !isRecord(value.verdict)) {
    return;
  }

  const lanes = value.lanes.filter(isRecord);
  const summary = value.summary;
  const verdict = value.verdict;
  const observedLaneIds = new Set<string>();
  const statusCounts = {
    observed: lanes.filter((lane) => lane.status === "observed").length,
    contractOnly: lanes.filter((lane) => lane.status === "contract_only").length,
    blocked: lanes.filter((lane) => lane.status !== "observed").length,
  };

  for (const lane of lanes) {
    if (typeof lane.id !== "string" || !ladderLaneIds.includes(lane.id as LadderLaneId)) {
      continue;
    }
    if (observedLaneIds.has(lane.id)) {
      errors.push(`/lanes must not repeat canonical lane id ${lane.id}`);
      continue;
    }
    observedLaneIds.add(lane.id);
  }
  for (const laneId of ladderLaneIds) {
    if (!observedLaneIds.has(laneId)) {
      errors.push(`/lanes must include canonical lane id ${laneId}`);
    }
  }
  if (summary.totalLaneCount !== value.lanes.length) {
    errors.push("/summary/totalLaneCount must match lanes.length");
  }
  if (summary.observedLaneCount !== statusCounts.observed) {
    errors.push("/summary/observedLaneCount must match observed lane count");
  }
  if (summary.contractOnlyLaneCount !== statusCounts.contractOnly) {
    errors.push("/summary/contractOnlyLaneCount must match contract-only lane count");
  }
  if (summary.blockedLaneCount !== statusCounts.blocked) {
    errors.push("/summary/blockedLaneCount must match non-observed lane count");
  }
  if (!Array.isArray(verdict.blockers)) {
    return;
  }

  const verdictBlockers = new Set(verdict.blockers);
  for (const lane of lanes) {
    if (typeof lane.id !== "string" || !Array.isArray(lane.blockers)) {
      continue;
    }
    for (const blocker of lane.blockers) {
      if (typeof blocker !== "string") {
        continue;
      }
      const expectedBlocker = lane.id === "artifactBackedProductionAssetEvidence"
        ? blocker
        : `${lane.id}:${blocker}`;
      if (!verdictBlockers.has(expectedBlocker)) {
        errors.push(`/verdict/blockers must include lane blocker ${expectedBlocker}`);
      }
    }
  }
}

function validateLane(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.id, ladderLaneIds, `${pathName}/id`, errors);
  requireString(value.title, `${pathName}/title`, errors);
  requireOneOf(value.status, ladderLaneStatuses, `${pathName}/status`, errors);
  requireStringArray(value.requiredArtifactEvidence, `${pathName}/requiredArtifactEvidence`, errors);
  requireRecord(value.currentEvidence, `${pathName}/currentEvidence`, errors);
  if (isRecord(value.currentEvidence)) {
    requireString(value.currentEvidence.source, `${pathName}/currentEvidence/source`, errors);
    requireBoolean(value.currentEvidence.observed, `${pathName}/currentEvidence/observed`, errors);
    requireOneOf(value.currentEvidence.posture, evidencePostures, `${pathName}/currentEvidence/posture`, errors);
  }
  requireRecord(value.claimBoundary, `${pathName}/claimBoundary`, errors);
  if (isRecord(value.claimBoundary)) {
    requireStringArray(value.claimBoundary.allowedClaims, `${pathName}/claimBoundary/allowedClaims`, errors);
    requireStringArray(value.claimBoundary.notEvidenceFor, `${pathName}/claimBoundary/notEvidenceFor`, errors);
  }
  requireStringArray(value.blockers, `${pathName}/blockers`, errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
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

function requireLiteral<T extends string | boolean>(
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
  allowed: T[],
  pathName: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(allowed as string[]).includes(value)) {
    errors.push(`${pathName} must be one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
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
