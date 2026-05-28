import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeAssetReviewDecision } from "../../packages/openclinxr/asset-registry/src/runtime-asset-review.js";

export type SceneGenerationReviewDecisionExportReport = {
  schemaVersion: "openclinxr.scene-generation-review-decision-export.v1";
  generatedAt: string;
  requestId: string;
  decisionCount: number;
  outputPath: string;
  claimBoundary: "runtime_asset_review_decision_export_not_bundle_publication";
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

type CliOptions = {
  inputPath: string;
  requestId: string;
  outputPath: string;
  reportPath: string;
  help: boolean;
};

const NOT_EVIDENCE_FOR = ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] as const;

export async function runSceneGenerationReviewDecisionExportCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  const input = JSON.parse(await readFile(options.inputPath, "utf8")) as unknown;
  const decisions = extractRuntimeAssetReviewDecisions(input, options.requestId);
  await mkdir(path.dirname(path.resolve(options.outputPath)), { recursive: true });
  await mkdir(path.dirname(path.resolve(options.reportPath)), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
  const report: SceneGenerationReviewDecisionExportReport = {
    schemaVersion: "openclinxr.scene-generation-review-decision-export.v1",
    generatedAt: new Date().toISOString(),
    requestId: options.requestId,
    decisionCount: decisions.length,
    outputPath: options.outputPath,
    claimBoundary: "runtime_asset_review_decision_export_not_bundle_publication",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Exported ${decisions.length} runtime asset review decisions\n`);
}

export function extractRuntimeAssetReviewDecisions(value: unknown, requestId: string): RuntimeAssetReviewDecision[] {
  const request = findSceneGenerationRequest(value, requestId);
  if (!request || !Array.isArray(request.runtimeAssetReviewDecisions)) {
    return [];
  }
  return request.runtimeAssetReviewDecisions.filter(isRuntimeAssetReviewDecision);
}

function findSceneGenerationRequest(value: unknown, requestId: string): Record<string, unknown> | null {
  if (isRecord(value) && value.requestId === requestId) {
    return value;
  }
  if (isRecord(value) && Array.isArray(value.requests)) {
    return value.requests.find((request): request is Record<string, unknown> => isRecord(request) && request.requestId === requestId) ?? null;
  }
  return null;
}

function isRuntimeAssetReviewDecision(value: unknown): value is RuntimeAssetReviewDecision {
  return isRecord(value)
    && typeof value.assetId === "string"
    && ["asset_pipeline", "clinical_simulation", "xr_performance", "security_privacy"].includes(String(value.reviewerRole))
    && typeof value.reviewerId === "string"
    && (value.decision === "approved_for_local_runtime" || value.decision === "changes_requested")
    && typeof value.comments === "string"
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.every((ref) => typeof ref === "string")
    && typeof value.reviewedAt === "string";
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: "docs/openclinxr/scene-generation-request-queue.json",
    requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
    outputPath: "docs/openclinxr/runtime-asset-review-decisions.json",
    reportPath: "docs/openclinxr/scene-generation-review-decision-export-report.json",
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input") options.inputPath = requireNext(args, ++index, arg);
    else if (arg === "--request-id") options.requestId = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--report") options.reportPath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function helpText(): string {
  return [
    "Usage: tsx tools/openclinxr/scene-generation-review-decision-export.ts [options]",
    "  --input <path>       Scene-generation request or request-queue JSON",
    "  --request-id <id>    Request ID to export",
    "  --output <path>      Runtime asset review decision JSON array output",
    "  --report <path>      Export report output",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSceneGenerationReviewDecisionExportCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
