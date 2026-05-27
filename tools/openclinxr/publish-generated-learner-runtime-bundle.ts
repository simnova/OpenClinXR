import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import {
  buildEncounterRuntimeBundlePublicationMetadata,
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  type EncounterRuntimeBundlePublicationMetadata,
  type LearnerRuntimeAssetBundle,
} from "../../packages/openclinxr/asset-registry/src/index.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

type CliOptions = {
  outputPath?: string;
  validatePath?: string;
  bundleReportPath?: string;
  validateLatest: boolean;
  stdout: boolean;
  help: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type GeneratedLearnerRuntimeBundlePublicationReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.generated-learner-runtime-bundle-publication.v1";
  status: "planned_not_persisted";
  sourceBundleReportPath?: string;
  publication: EncounterRuntimeBundlePublicationMetadata;
  persistence: {
    mongoUriConfigured: false;
    mongoWritePerformed: false;
    blobWritePerformed: false;
    localReportOnly: true;
  };
  evidenceBoundaries: {
    localPublicationPlanPrepared: true;
    learnerRuntimeUseEnabled: false;
    cloudOperationPerformed: false;
    paidApisUsed: false;
    productionDeploymentPerformed: false;
    productionReadinessClaimed: false;
    questReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
};

const defaultOutputPath = `docs/openclinxr/generated-learner-runtime-bundle-publication-${new Date().toISOString().slice(0, 10)}.json`;

export function buildGeneratedLearnerRuntimeBundlePublicationReport(input: {
  generatedAt?: string;
  learnerBundle?: LearnerRuntimeAssetBundle;
  sourceBundleReportPath?: string;
} = {}): GeneratedLearnerRuntimeBundlePublicationReport {
  const learnerBundle = input.learnerBundle ?? createEdChestPainLocalLearnerRuntimeAssetBundle({
    assetStore: {
      storeKind: "azurite_blob",
      containerName: "openclinxr-assets",
    },
  });
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    schemaVersion: "openclinxr.generated-learner-runtime-bundle-publication.v1",
    status: "planned_not_persisted",
    ...(input.sourceBundleReportPath ? { sourceBundleReportPath: input.sourceBundleReportPath } : {}),
    publication: buildEncounterRuntimeBundlePublicationMetadata(learnerBundle),
    persistence: {
      mongoUriConfigured: false,
      mongoWritePerformed: false,
      blobWritePerformed: false,
      localReportOnly: true,
    },
    evidenceBoundaries: {
      localPublicationPlanPrepared: true,
      learnerRuntimeUseEnabled: false,
      cloudOperationPerformed: false,
      paidApisUsed: false,
      productionDeploymentPerformed: false,
      productionReadinessClaimed: false,
      questReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
  };
}

export function validateGeneratedLearnerRuntimeBundlePublicationReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.generated-learner-runtime-bundle-publication.v1", "/schemaVersion", errors);
  requireLiteral(value.status, "planned_not_persisted", "/status", errors);
  requireRecord(value.publication, "/publication", errors);
  requireRecord(value.persistence, "/persistence", errors);
  requireRecord(value.evidenceBoundaries, "/evidenceBoundaries", errors);
  if (isRecord(value.publication)) {
    requireLiteral(value.publication.learnerRuntimeUseBlocked, true, "/publication/learnerRuntimeUseBlocked", errors);
    requireLiteral(value.publication.claimBoundary, "local_publication_metadata_not_runtime_readiness", "/publication/claimBoundary", errors);
    requireArrayIncludes(value.publication.notEvidenceFor, "quest_readiness", "/publication/notEvidenceFor", errors);
    requireArrayIncludes(value.publication.notEvidenceFor, "clinical_validity", "/publication/notEvidenceFor", errors);
    requireArrayIncludes(value.publication.pendingEvidenceGateIds, "runtime_realism_evidence", "/publication/pendingEvidenceGateIds", errors);
    requireArrayIncludes(value.publication.pendingEvidenceGateIds, "visual_qa_evidence", "/publication/pendingEvidenceGateIds", errors);
    requireArrayIncludes(value.publication.pendingEvidenceGateIds, "quest_runtime_evidence", "/publication/pendingEvidenceGateIds", errors);
  }
  if (Object.prototype.hasOwnProperty.call(value, "sourceBundleReportPath")) {
    requireString(value.sourceBundleReportPath, "/sourceBundleReportPath", errors);
  }
  if (isRecord(value.persistence)) {
    requireLiteral(value.persistence.mongoWritePerformed, false, "/persistence/mongoWritePerformed", errors);
    requireLiteral(value.persistence.blobWritePerformed, false, "/persistence/blobWritePerformed", errors);
    requireLiteral(value.persistence.localReportOnly, true, "/persistence/localReportOnly", errors);
  }
  if (isRecord(value.evidenceBoundaries)) {
    requireLiteral(value.evidenceBoundaries.localPublicationPlanPrepared, true, "/evidenceBoundaries/localPublicationPlanPrepared", errors);
    requireLiteral(value.evidenceBoundaries.learnerRuntimeUseEnabled, false, "/evidenceBoundaries/learnerRuntimeUseEnabled", errors);
    requireLiteral(value.evidenceBoundaries.cloudOperationPerformed, false, "/evidenceBoundaries/cloudOperationPerformed", errors);
    requireLiteral(value.evidenceBoundaries.paidApisUsed, false, "/evidenceBoundaries/paidApisUsed", errors);
    requireLiteral(value.evidenceBoundaries.productionDeploymentPerformed, false, "/evidenceBoundaries/productionDeploymentPerformed", errors);
    requireLiteral(value.evidenceBoundaries.productionReadinessClaimed, false, "/evidenceBoundaries/productionReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.questReadinessClaimed, false, "/evidenceBoundaries/questReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.clinicalValidityClaimed, false, "/evidenceBoundaries/clinicalValidityClaimed", errors);
    requireLiteral(value.evidenceBoundaries.scoringValidityClaimed, false, "/evidenceBoundaries/scoringValidityClaimed", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export async function runGeneratedLearnerRuntimeBundlePublicationCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(helpText());
    return;
  }
  if (options.stdout && options.outputPath) {
    throw new Error("--stdout cannot be combined with --output; choose one local report destination");
  }
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/generated-learner-runtime-bundle-publication-*.json");
    if (!validatePath) {
      throw new Error("Missing generated learner runtime bundle publication report to validate.");
    }
    const validation = validateGeneratedLearnerRuntimeBundlePublicationReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }
  const learnerBundle = options.bundleReportPath
    ? learnerBundleFromGeneratedBundleReport(await readJson<GeneratedEdStationRuntimeBundleReport>(options.bundleReportPath), options.bundleReportPath)
    : undefined;
  const report = buildGeneratedLearnerRuntimeBundlePublicationReport({
    learnerBundle,
    ...(options.bundleReportPath ? { sourceBundleReportPath: options.bundleReportPath } : {}),
  });
  if (options.stdout) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  return files.sort().at(-1);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { validateLatest: false, stdout: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--bundle-report") {
      options.bundleReportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }
    if (arg === "--validate") {
      options.validatePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a path value`);
  }
  return value;
}

function helpText(): string {
  return [
    "OpenClinXR generated learner runtime bundle publication plan",
    "",
    "Usage:",
    "  tsx tools/openclinxr/publish-generated-learner-runtime-bundle.ts [--bundle-report <path>] [--output <path>]",
    "  tsx tools/openclinxr/publish-generated-learner-runtime-bundle.ts --validate <path>",
    "  tsx tools/openclinxr/publish-generated-learner-runtime-bundle.ts --validate-latest",
    "  tsx tools/openclinxr/publish-generated-learner-runtime-bundle.ts --stdout",
    "",
    "Boundary:",
    "  Local report planning only; no Blob/Mongo writes, cloud calls, learner-use enablement,",
    "  Quest readiness, clinical validity, scoring validity, or production readiness claims.",
  ].join("\n");
}

function learnerBundleFromGeneratedBundleReport(
  report: GeneratedEdStationRuntimeBundleReport,
  sourcePath: string,
): LearnerRuntimeAssetBundle {
  if (report.status !== "bundle_ready" || !report.learnerBundle) {
    throw new Error(`Generated runtime bundle report is not bundle_ready with learnerBundle: ${sourcePath}`);
  }
  return report.learnerBundle;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireLiteral(value: unknown, expected: string | boolean, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function requireArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${path} must include ${expected}`);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path} must be string`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGeneratedLearnerRuntimeBundlePublicationCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
