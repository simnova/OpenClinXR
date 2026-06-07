import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, resample, sparse } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { glob } from "tinyglobby";

export const REVIEW_GLB_OPTIMIZATION_BENCHMARK_SCHEMA_VERSION = "openclinxr.review-glb-optimization-benchmark.v1" as const;

const DEFAULT_SOURCE_GLB_PATHS = [
  "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
  "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
  "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
] as const;

const DEFAULT_OUTPUT_ROOT = ".openclinxr/asset-production/review-glb-optimization";
const DEFAULT_REPORT_ROOT = ".openclinxr/evidence/review-glb-optimization";

type OptimizationVariantId =
  | "prune_dedup"
  | "prune_dedup_resample_sparse"
  | "quantize_no_meshopt"
  | "meshopt_delivery";

export type ReviewGlbOptimizationVariantResult = {
  variantId: OptimizationVariantId;
  outputGlbPath: string;
  beforeBytes: number;
  afterBytes: number;
  byteReductionRatio: number;
  percentSmaller: number;
  metricsPreserved: boolean;
  reviewFixtureCandidate: boolean;
  browserReplacementAllowed: boolean;
  blockers: string[];
  warnings: string[];
  beforeMetrics: GlbStructureMetrics;
  afterMetrics: GlbStructureMetrics;
};

export type GlbStructureMetrics = {
  meshes: number;
  primitives: number;
  skins: number;
  animations: number;
  accessors: number;
  morphTargets: number;
  materials: number;
  nodes: number;
  extensionsUsed: string[];
};

export type ReviewGlbOptimizationBenchmarkReport = {
  schemaVersion: typeof REVIEW_GLB_OPTIMIZATION_BENCHMARK_SCHEMA_VERSION;
  generatedAt: string;
  claimScope: "browser_review_fixture_optimization_benchmark_not_visual_realism_or_readiness";
  runId: string;
  sourceGlbPaths: string[];
  outputRoot: string;
  candidates: Array<{
    sourceGlbPath: string;
    sourceBytes: number;
    variants: ReviewGlbOptimizationVariantResult[];
    bestSizeVariantId: OptimizationVariantId | null;
    recommendedReviewFixtureVariantId: OptimizationVariantId | null;
    browserReplacementReady: boolean;
    blockers: string[];
  }>;
  policy: {
    committedReviewAssetsAllowed: boolean;
    rawGeneratedOutputsAllowedInGit: false;
    browserReplacementRequiresCaptureEvidence: true;
    meshoptRequiresBrowserVisibilityProof: true;
  };
  notEvidenceFor: string[];
};

type CliOptions = {
  sourceGlbPaths: string[];
  outputRoot: string;
  reportRoot: string;
  runId: string;
  reportPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

export async function runReviewGlbOptimizationBenchmark(options: Partial<CliOptions> = {}): Promise<ReviewGlbOptimizationBenchmarkReport> {
  const runId = options.runId ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const sourceGlbPaths = options.sourceGlbPaths?.length ? options.sourceGlbPaths : [...DEFAULT_SOURCE_GLB_PATHS];
  const outputRoot = options.outputRoot ?? path.join(DEFAULT_OUTPUT_ROOT, runId);
  const reportRoot = options.reportRoot ?? DEFAULT_REPORT_ROOT;
  const reportPath = options.reportPath ?? path.join(reportRoot, `review-glb-optimization-benchmark-${runId}.json`);
  const io = createIo();

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const candidates: ReviewGlbOptimizationBenchmarkReport["candidates"] = [];
  for (const sourceGlbPath of sourceGlbPaths) {
    const sourceBytes = (await stat(sourceGlbPath)).size;
    const variants: ReviewGlbOptimizationVariantResult[] = [];
    for (const variantId of variantIds()) {
      variants.push(await runVariant({
        io,
        sourceGlbPath,
        sourceBytes,
        outputRoot,
        variantId,
      }));
    }

    const bestSizeVariant = [...variants].sort((a, b) => a.afterBytes - b.afterBytes)[0] ?? null;
    const reviewFixtureCandidates = variants.filter((variant) => variant.reviewFixtureCandidate);
    const recommended = reviewFixtureCandidates
      .filter((variant) => variant.variantId !== "meshopt_delivery")
      .sort((a, b) => a.afterBytes - b.afterBytes)[0]
      ?? reviewFixtureCandidates.sort((a, b) => a.afterBytes - b.afterBytes)[0]
      ?? null;
    const browserReplacementReady = variants.some((variant) => variant.browserReplacementAllowed);
    const blockers = browserReplacementReady ? [] : ["browser_visibility_capture_required_before_replacing_committed_review_glb"];

    candidates.push({
      sourceGlbPath,
      sourceBytes,
      variants,
      bestSizeVariantId: bestSizeVariant?.variantId ?? null,
      recommendedReviewFixtureVariantId: recommended?.variantId ?? null,
      browserReplacementReady,
      blockers,
    });
  }

  const report: ReviewGlbOptimizationBenchmarkReport = {
    schemaVersion: REVIEW_GLB_OPTIMIZATION_BENCHMARK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    claimScope: "browser_review_fixture_optimization_benchmark_not_visual_realism_or_readiness",
    runId,
    sourceGlbPaths,
    outputRoot,
    candidates,
    policy: {
      committedReviewAssetsAllowed: true,
      rawGeneratedOutputsAllowedInGit: false,
      browserReplacementRequiresCaptureEvidence: true,
      meshoptRequiresBrowserVisibilityProof: true,
    },
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };

  const validation = validateReviewGlbOptimizationBenchmarkReport(report);
  if (!validation.ok) throw new Error(`Invalid review GLB optimization benchmark: ${validation.errors.join("; ")}`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function runVariant(input: {
  io: NodeIO;
  sourceGlbPath: string;
  sourceBytes: number;
  outputRoot: string;
  variantId: OptimizationVariantId;
}): Promise<ReviewGlbOptimizationVariantResult> {
  const document = await input.io.read(input.sourceGlbPath);
  const beforeMetrics = metrics(document);
  await applyVariant(document, input.variantId);
  const outputGlbPath = path.join(input.outputRoot, path.basename(input.sourceGlbPath, ".glb"), `${input.variantId}.glb`);
  await mkdir(path.dirname(outputGlbPath), { recursive: true });
  await input.io.write(outputGlbPath, document);
  const afterDocument = await input.io.read(outputGlbPath);
  const afterMetrics = metrics(afterDocument);
  const afterBytes = (await stat(outputGlbPath)).size;
  const byteReductionRatio = roundRatio(afterBytes / input.sourceBytes);
  const percentSmaller = roundRatio((1 - byteReductionRatio) * 100);
  const metricsPreserved = preserveReviewFixtureMetrics(beforeMetrics, afterMetrics);
  const warnings = warningsForVariant(input.variantId, beforeMetrics, afterMetrics);
  const blockers = blockersForVariant(input.variantId, metricsPreserved, byteReductionRatio);

  return {
    variantId: input.variantId,
    outputGlbPath,
    beforeBytes: input.sourceBytes,
    afterBytes,
    byteReductionRatio,
    percentSmaller,
    metricsPreserved,
    reviewFixtureCandidate: blockers.length === 0,
    browserReplacementAllowed: false,
    blockers: [
      ...blockers,
      "browser_visibility_capture_required_before_replacing_committed_review_glb",
    ],
    warnings,
    beforeMetrics,
    afterMetrics,
  };
}

function createIo(): NodeIO {
  return new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      "meshopt.decoder": MeshoptDecoder,
    });
}

function variantIds(): OptimizationVariantId[] {
  return ["prune_dedup", "prune_dedup_resample_sparse", "quantize_no_meshopt", "meshopt_delivery"];
}

async function applyVariant(document: Document, variantId: OptimizationVariantId): Promise<void> {
  if (variantId === "prune_dedup") {
    await document.transform(dedup(), prune());
    return;
  }
  if (variantId === "prune_dedup_resample_sparse") {
    await document.transform(dedup(), prune(), resample(), sparse());
    return;
  }
  if (variantId === "quantize_no_meshopt") {
    await document.transform(dedup(), prune(), resample(), sparse(), quantize());
    return;
  }
  await document.transform(dedup(), prune(), resample(), sparse(), quantize(), meshopt({ encoder: MeshoptEncoder }));
}

function metrics(document: Document): GlbStructureMetrics {
  const root = document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  return {
    meshes: root.listMeshes().length,
    primitives: primitives.length,
    skins: root.listSkins().length,
    animations: root.listAnimations().length,
    accessors: root.listAccessors().length,
    morphTargets: primitives.reduce((sum, primitive) => sum + primitive.listTargets().length, 0),
    materials: root.listMaterials().length,
    nodes: root.listNodes().length,
    extensionsUsed: root.listExtensionsUsed().map((extension) => extension.extensionName).sort(),
  };
}

function preserveReviewFixtureMetrics(before: GlbStructureMetrics, after: GlbStructureMetrics): boolean {
  return after.meshes === before.meshes
    && after.primitives === before.primitives
    && after.skins === before.skins
    && after.animations === before.animations
    && after.morphTargets === before.morphTargets
    && after.materials === before.materials;
}

function blockersForVariant(variantId: OptimizationVariantId, metricsPreserved: boolean, byteReductionRatio: number): string[] {
  const blockers: string[] = [];
  if (!metricsPreserved) blockers.push("review_fixture_structure_changed");
  if (byteReductionRatio >= 0.98) blockers.push("size_reduction_too_small_for_review_fixture_replacement");
  if (variantId === "meshopt_delivery") blockers.push("meshopt_body_visibility_capture_required");
  return blockers;
}

function warningsForVariant(
  variantId: OptimizationVariantId,
  before: GlbStructureMetrics,
  after: GlbStructureMetrics,
): string[] {
  const warnings: string[] = [];
  if (after.accessors !== before.accessors) warnings.push("accessor_count_changed_expected_for_prune_or_quantize");
  if (after.nodes !== before.nodes) warnings.push("node_count_changed_expected_for_prune");
  if (variantId === "quantize_no_meshopt") warnings.push("quantized_attributes_require_browser_visual_spot_check");
  if (variantId === "meshopt_delivery") warnings.push("requires_three_meshopt_decoder_and_prior_body_visibility_regression_check");
  return warnings;
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

export function validateReviewGlbOptimizationBenchmarkReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["report must be an object"] };
  requireLiteral(value.schemaVersion, REVIEW_GLB_OPTIMIZATION_BENCHMARK_SCHEMA_VERSION, "/schemaVersion", errors);
  requireLiteral(value.claimScope, "browser_review_fixture_optimization_benchmark_not_visual_realism_or_readiness", "/claimScope", errors);
  if (!Array.isArray(value.candidates) || value.candidates.length === 0) errors.push("/candidates must be a non-empty array");
  if (Array.isArray(value.candidates)) {
    value.candidates.forEach((candidate, candidateIndex) => {
      if (!isRecord(candidate)) {
        errors.push(`/candidates/${candidateIndex} must be an object`);
        return;
      }
      if (!Array.isArray(candidate.variants) || candidate.variants.length !== variantIds().length) {
        errors.push(`/candidates/${candidateIndex}/variants must contain all optimization variants`);
      }
      if (candidate.browserReplacementReady !== false) {
        errors.push(`/candidates/${candidateIndex}/browserReplacementReady must stay false until browser evidence is attached`);
      }
      if (!Array.isArray(candidate.blockers) || !candidate.blockers.includes("browser_visibility_capture_required_before_replacing_committed_review_glb")) {
        errors.push(`/candidates/${candidateIndex}/blockers must require browser visibility evidence`);
      }
      if (Array.isArray(candidate.variants)) {
        const meshopt = candidate.variants.find((variant) => isRecord(variant) && variant.variantId === "meshopt_delivery");
        if (!isRecord(meshopt) || !Array.isArray(meshopt.blockers) || !meshopt.blockers.includes("meshopt_body_visibility_capture_required")) {
          errors.push(`/candidates/${candidateIndex}/variants/meshopt_delivery must require body visibility proof`);
        }
      }
    });
  }
  const policy = value.policy;
  if (!isRecord(policy)) errors.push("/policy must be an object");
  else {
    if (policy.rawGeneratedOutputsAllowedInGit !== false) errors.push("/policy/rawGeneratedOutputsAllowedInGit must be false");
    if (policy.browserReplacementRequiresCaptureEvidence !== true) errors.push("/policy/browserReplacementRequiresCaptureEvidence must be true");
    if (policy.meshoptRequiresBrowserVisibilityProof !== true) errors.push("/policy/meshoptRequiresBrowserVisibilityProof must be true");
  }
  if (!Array.isArray(value.notEvidenceFor) || !value.notEvidenceFor.includes("quest_readiness")) {
    errors.push("/notEvidenceFor must preserve false readiness gates");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireLiteral(value: unknown, expected: string, pointer: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pointer} must be ${expected}`);
}

async function latestReportPath(): Promise<string | null> {
  const candidates = await glob(`${DEFAULT_REPORT_ROOT}/review-glb-optimization-benchmark-*.json`);
  return candidates.sort().at(-1) ?? null;
}

export async function runReviewGlbOptimizationBenchmarkCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest || options.validatePath) {
    const reportPath = options.validatePath ?? await latestReportPath();
    if (!reportPath) throw new Error("No review GLB optimization benchmark report found to validate.");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
    const validation = validateReviewGlbOptimizationBenchmarkReport(report);
    if (!validation.ok) {
      console.error(`Review GLB optimization benchmark validation failed: ${validation.errors.join("; ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ reportPath, ok: true }, null, 2));
    return;
  }

  const report = await runReviewGlbOptimizationBenchmark(options);
  const reportPath = options.reportPath ?? path.join(options.reportRoot, `review-glb-optimization-benchmark-${report.runId}.json`);
  console.log(JSON.stringify({
    reportPath,
    runId: report.runId,
    candidates: report.candidates.map((candidate) => ({
      sourceGlbPath: candidate.sourceGlbPath,
      sourceBytes: candidate.sourceBytes,
      bestSizeVariantId: candidate.bestSizeVariantId,
      recommendedReviewFixtureVariantId: candidate.recommendedReviewFixtureVariantId,
      variants: candidate.variants.map((variant) => ({
        variantId: variant.variantId,
        afterBytes: variant.afterBytes,
        percentSmaller: variant.percentSmaller,
        reviewFixtureCandidate: variant.reviewFixtureCandidate,
        browserReplacementAllowed: variant.browserReplacementAllowed,
        blockers: variant.blockers,
      })),
    })),
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceGlbPaths: [...DEFAULT_SOURCE_GLB_PATHS],
    outputRoot: DEFAULT_OUTPUT_ROOT,
    reportRoot: DEFAULT_REPORT_ROOT,
    runId: new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z"),
    validateLatest: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--source-glb") options.sourceGlbPaths = [requireNext(args, ++index, arg)];
    else if (arg === "--source-glbs") options.sourceGlbPaths = requireNext(args, ++index, arg).split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--output-root") options.outputRoot = requireNext(args, ++index, arg);
    else if (arg === "--report-root") options.reportRoot = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--report") options.reportPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.reportPath) {
    options.outputRoot = path.join(options.outputRoot, options.runId);
  }
  return options;
}

function requireNext(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReviewGlbOptimizationBenchmarkCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
