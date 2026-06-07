import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { glob } from "tinyglobby";
import {
  validateModelVettingReport,
  type ModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import {
  validateReviewGlbOptimizationBenchmarkReport,
  type ReviewGlbOptimizationBenchmarkReport,
} from "./review-glb-optimization-benchmark.js";

export const REVIEW_GLB_OPTIMIZATION_VISUAL_CAGEMATCH_SCHEMA_VERSION = "openclinxr.review-glb-optimization-visual-cagematch.v1" as const;

type CliOptions = {
  benchmarkReportPath?: string;
  sourceModelVettingReportPath: string;
  runId: string;
  port: number;
  views: Array<"front" | "side" | "three_quarter">;
  captureRoot: string;
  publicRoot: string;
  validateLatest: boolean;
  validatePath?: string;
};

type BrowserVariantEvidence = {
  candidateId: string;
  actorId: string;
  variantId: string;
  sourceGlbPath: string;
  sourceBytes: number;
  optimizedBytes: number;
  percentSmaller: number;
  metricsPreserved: boolean;
  browserReplacementAllowedByBenchmark: boolean;
  captures: Array<{
    view: "front" | "side" | "three_quarter";
    screenshotPath: string;
    loaded: boolean;
    meshCount: number;
    normalizedBoundsMeters: { width: number; height: number; depth: number };
    nonBackgroundPixelRatio: number;
    bodyVisible: boolean;
    blockers: string[];
  }>;
  visualUsability: {
    usableAsBrowserReviewFixture: boolean;
    usableAsWebXrRuntimeReplacement: false;
    blockers: string[];
  };
};

type ReviewGlbOptimizationVisualCagematchReport = {
  schemaVersion: typeof REVIEW_GLB_OPTIMIZATION_VISUAL_CAGEMATCH_SCHEMA_VERSION;
  generatedAt: string;
  claimScope: "browser_visual_cagematch_for_review_fixture_only_not_webxr_runtime_or_readiness";
  benchmarkReportPath: string;
  modelVettingReportPath: string;
  publicModelVettingReportPath: string;
  runId: string;
  captureRoot: string;
  variants: BrowserVariantEvidence[];
  summary: Array<{
    variantId: string;
    captureCount: number;
    bodyVisibleCount: number;
    averagePercentSmaller: number;
    usableAsBrowserReviewFixture: boolean;
    usableAsWebXrRuntimeReplacement: false;
    blockers: string[];
  }>;
  notEvidenceFor: string[];
};

const DEFAULT_SOURCE_REPORT = "docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-07.json";
const DEFAULT_CAPTURE_ROOT = ".openclinxr/evidence/review-glb-optimization-visual";
const DEFAULT_PUBLIC_ROOT = "apps/arena/model-vetting-studio/public/cagematch/review-glb-optimization";

export async function runReviewGlbOptimizationVisualCagematch(options: Partial<CliOptions> = {}): Promise<ReviewGlbOptimizationVisualCagematchReport> {
  const benchmarkReportPath = options.benchmarkReportPath ?? await latestBenchmarkReportPath();
  if (!benchmarkReportPath) throw new Error("No review GLB optimization benchmark report found. Run asset:review-glb:optimization-benchmark first.");
  const sourceModelVettingReportPath = options.sourceModelVettingReportPath ?? DEFAULT_SOURCE_REPORT;
  const runId = options.runId ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const captureRoot = path.join(options.captureRoot ?? DEFAULT_CAPTURE_ROOT, runId);
  const publicRunRoot = path.join(options.publicRoot ?? DEFAULT_PUBLIC_ROOT, runId);
  const publicModelVettingReportPath = path.join(publicRunRoot, "model-vetting-report.json");
  const views = options.views?.length ? options.views : ["front", "side", "three_quarter"];
  const port = options.port ?? 5196;

  const benchmark = JSON.parse(await readFile(benchmarkReportPath, "utf8")) as ReviewGlbOptimizationBenchmarkReport;
  const benchmarkValidation = validateReviewGlbOptimizationBenchmarkReport(benchmark);
  if (!benchmarkValidation.ok) throw new Error(`Invalid benchmark report: ${benchmarkValidation.errors.join("; ")}`);
  const sourceReport = JSON.parse(await readFile(sourceModelVettingReportPath, "utf8")) as ModelVettingReport;
  const report = await buildVisualModelVettingReport({ sourceReport, benchmark, publicRunRoot });
  await mkdir(publicRunRoot, { recursive: true });
  await writeFile(publicModelVettingReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const server = await startStudioServer(port);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1280 }, deviceScaleFactor: 1 });
    const variants: BrowserVariantEvidence[] = [];
    for (const candidate of report.candidates) {
      const metadata = candidate as ModelVettingReport["candidates"][number] & {
        optimizationVisualCagematch?: {
          variantId: string;
          sourceBytes: number;
          optimizedBytes: number;
          percentSmaller: number;
          metricsPreserved: boolean;
          browserReplacementAllowedByBenchmark: boolean;
        };
      };
      const optimization = metadata.optimizationVisualCagematch;
      if (!optimization) continue;
      const captures: BrowserVariantEvidence["captures"] = [];
      for (const view of views) {
        captures.push(await captureVariant({
          page,
          baseUrl: `http://127.0.0.1:${port}`,
          publicReportPath: publicPathFor(publicModelVettingReportPath),
          candidateId: candidate.candidateId,
          actorId: candidate.actorId,
          variantId: optimization.variantId,
          view,
          captureRoot,
        }));
      }
      const captureBlockers = uniqueStrings(captures.flatMap((capture) => capture.blockers));
      const allBodyVisible = captures.every((capture) => capture.bodyVisible);
      const browserFixtureBlockers = [
        ...captureBlockers,
        ...(!allBodyVisible ? ["not_all_fixed_camera_views_have_visible_body"] : []),
      ];
      variants.push({
        candidateId: candidate.candidateId,
        actorId: candidate.actorId,
        variantId: optimization.variantId,
        sourceGlbPath: candidate.sourceGlbPath,
        sourceBytes: optimization.sourceBytes,
        optimizedBytes: optimization.optimizedBytes,
        percentSmaller: optimization.percentSmaller,
        metricsPreserved: optimization.metricsPreserved,
        browserReplacementAllowedByBenchmark: optimization.browserReplacementAllowedByBenchmark,
        captures,
        visualUsability: {
          usableAsBrowserReviewFixture: browserFixtureBlockers.length === 0,
          usableAsWebXrRuntimeReplacement: false,
          blockers: [
            ...browserFixtureBlockers,
            "webxr_runtime_replacement_requires_ui_xr_load_and_interaction_evidence",
          ],
        },
      });
    }

    const reportOut: ReviewGlbOptimizationVisualCagematchReport = {
      schemaVersion: REVIEW_GLB_OPTIMIZATION_VISUAL_CAGEMATCH_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      claimScope: "browser_visual_cagematch_for_review_fixture_only_not_webxr_runtime_or_readiness",
      benchmarkReportPath,
      modelVettingReportPath: path.join(captureRoot, "review-glb-optimization-visual-cagematch.json"),
      publicModelVettingReportPath,
      runId,
      captureRoot,
      variants,
      summary: summarizeVariants(variants),
      notEvidenceFor: [
        "b_plus_visual_realism_gate",
        "webxr_runtime_replacement",
        "production_asset_readiness",
        "quest_readiness",
        "learner_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    };
    const validation = validateReviewGlbOptimizationVisualCagematchReport(reportOut);
    if (!validation.ok) throw new Error(`Invalid visual cagematch report: ${validation.errors.join("; ")}`);
    await mkdir(captureRoot, { recursive: true });
    await writeFile(reportOut.modelVettingReportPath, `${JSON.stringify(reportOut, null, 2)}\n`, "utf8");
    return reportOut;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

async function buildVisualModelVettingReport(input: {
  sourceReport: ModelVettingReport;
  benchmark: ReviewGlbOptimizationBenchmarkReport;
  publicRunRoot: string;
}): Promise<ModelVettingReport> {
  const candidates: ModelVettingReport["candidates"] = [];
  for (const benchmarkCandidate of input.benchmark.candidates) {
    const sourceCandidate = input.sourceReport.candidates.find((candidate) => path.basename(candidate.sourceGlbPath) === path.basename(benchmarkCandidate.sourceGlbPath));
    if (!sourceCandidate) throw new Error(`No source model-vetting candidate for ${benchmarkCandidate.sourceGlbPath}`);
    for (const variant of benchmarkCandidate.variants) {
      const candidateId = `${sourceCandidate.candidateId}_${variant.variantId}`;
      const publicGlbPath = path.join(input.publicRunRoot, `${candidateId}.glb`);
      await mkdir(path.dirname(publicGlbPath), { recursive: true });
      await copyFile(variant.outputGlbPath, publicGlbPath);
      candidates.push({
        ...structuredClone(sourceCandidate),
        candidateId,
        actorDisplayRole: `${sourceCandidate.actorDisplayRole} · ${variant.variantId}`,
        sourceGlbPath: publicPathFor(publicGlbPath),
        sourcePreflightStatus: "ready_for_browser_review_fixture_visual_cagematch",
        labModes: sourceCandidate.labModes.map((mode) => mode.modeId === "static_model_inspection"
          ? {
              ...mode,
              status: "block",
              evidence: [
                ...mode.evidence,
                `optimizationVariant:${variant.variantId}`,
                `sourceBytes:${variant.beforeBytes}`,
                `optimizedBytes:${variant.afterBytes}`,
                `percentSmaller:${variant.percentSmaller}`,
              ],
              blockers: [
                "browser_visual_cagematch_required_before_review_fixture_replacement",
              ],
            }
          : mode),
        provenance: {
          ...sourceCandidate.provenance,
          sourceGlbPath: publicPathFor(publicGlbPath),
          auditPointers: uniqueStrings([
            ...sourceCandidate.provenance.auditPointers,
            input.benchmark.outputRoot,
          ]),
        },
        optimizationVisualCagematch: {
          variantId: variant.variantId,
          sourceBytes: variant.beforeBytes,
          optimizedBytes: variant.afterBytes,
          percentSmaller: variant.percentSmaller,
          metricsPreserved: variant.metricsPreserved,
          browserReplacementAllowedByBenchmark: variant.browserReplacementAllowed,
        },
      } as ModelVettingReport["candidates"][number]);
    }
  }
  const report: ModelVettingReport = {
    ...structuredClone(input.sourceReport),
    generatedAt: new Date().toISOString(),
    claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only",
    candidates,
  };
  const validation = validateModelVettingReport(report);
  if (!validation.ok) throw new Error(`Invalid optimization visual model-vetting report: ${validation.errors.join("; ")}`);
  return report;
}

async function captureVariant(input: {
  page: Page;
  baseUrl: string;
  publicReportPath: string;
  candidateId: string;
  actorId: string;
  variantId: string;
  view: "front" | "side" | "three_quarter";
  captureRoot: string;
}): Promise<BrowserVariantEvidence["captures"][number]> {
  const url = `${input.baseUrl}/?reportUrl=${encodeURIComponent(input.publicReportPath)}&captureCandidateId=${encodeURIComponent(input.candidateId)}&captureView=${input.view}`;
  const screenshotPath = path.join(input.captureRoot, "captures", input.actorId, input.variantId, `${input.view}.png`);
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await input.page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  const evidence = await input.page.waitForFunction(() => window.__openClinXrModelVettingCandidateCaptureEvidence, null, { timeout: 60_000 })
    .then((handle) => handle.jsonValue() as Promise<{
      meshCount: number;
      normalizedBoundsMeters: { width: number; height: number; depth: number };
    }>);
  await input.page.screenshot({ path: screenshotPath, fullPage: true });
  const nonBackgroundPixelRatio = await input.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return 0;
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return 0;
    const width = canvas.width;
    const height = canvas.height;
    const data = new Uint8Array(width * height * 4);
    context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, data);
    let changed = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (Math.abs(red - 24) + Math.abs(green - 33) + Math.abs(blue - 29) > 28) changed += 1;
    }
    return Number((changed / (width * height)).toFixed(4));
  });
  const blockers: string[] = [];
  if (evidence.meshCount <= 0) blockers.push("browser_mesh_count_zero");
  if (evidence.normalizedBoundsMeters.height < 1.5) blockers.push("browser_visible_bounds_height_too_small");
  if (evidence.normalizedBoundsMeters.width < 0.2) blockers.push("browser_visible_bounds_width_too_small");
  if (
    nonBackgroundPixelRatio < 0.02
    && (evidence.normalizedBoundsMeters.height < 1.5 || evidence.normalizedBoundsMeters.width < 0.2)
  ) {
    blockers.push("browser_canvas_mostly_background");
  }
  return {
    view: input.view,
    screenshotPath,
    loaded: true,
    meshCount: evidence.meshCount,
    normalizedBoundsMeters: evidence.normalizedBoundsMeters,
    nonBackgroundPixelRatio,
    bodyVisible: blockers.length === 0,
    blockers,
  };
}

function summarizeVariants(variants: BrowserVariantEvidence[]): ReviewGlbOptimizationVisualCagematchReport["summary"] {
  const variantIds = uniqueStrings(variants.map((variant) => variant.variantId));
  return variantIds.map((variantId) => {
    const group = variants.filter((variant) => variant.variantId === variantId);
    const captures = group.flatMap((variant) => variant.captures);
    const blockers = uniqueStrings(group.flatMap((variant) => variant.visualUsability.blockers));
    return {
      variantId,
      captureCount: captures.length,
      bodyVisibleCount: captures.filter((capture) => capture.bodyVisible).length,
      averagePercentSmaller: round(group.reduce((sum, variant) => sum + variant.percentSmaller, 0) / Math.max(group.length, 1)),
      usableAsBrowserReviewFixture: group.every((variant) => variant.visualUsability.usableAsBrowserReviewFixture),
      usableAsWebXrRuntimeReplacement: false,
      blockers,
    };
  });
}

async function startStudioServer(port: number): Promise<ReturnType<typeof spawn>> {
  const child = spawn("pnpm", ["--filter", "@openclinxr/model-vetting-studio", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (output.includes(`http://127.0.0.1:${port}`) || output.includes(`http://localhost:${port}`)) return child;
    if (child.exitCode !== null) throw new Error(`Model Vetting Studio dev server exited early: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out starting Model Vetting Studio dev server: ${output}`);
}

function publicPathFor(filePath: string): string {
  const marker = "apps/arena/model-vetting-studio/public/";
  const normalized = filePath.replaceAll(path.sep, "/");
  const index = normalized.indexOf(marker);
  if (index === -1) throw new Error(`Path is not under model-vetting public root: ${filePath}`);
  return `/${normalized.slice(index + marker.length)}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

async function latestBenchmarkReportPath(): Promise<string | undefined> {
  const candidates = await glob(".openclinxr/evidence/review-glb-optimization/review-glb-optimization-benchmark-*.json");
  return candidates.sort().at(-1);
}

async function latestVisualReportPath(): Promise<string | undefined> {
  const candidates = await glob(`${DEFAULT_CAPTURE_ROOT}/*/review-glb-optimization-visual-cagematch.json`);
  return candidates.sort().at(-1);
}

export function validateReviewGlbOptimizationVisualCagematchReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["report must be an object"] };
  requireLiteral(value.schemaVersion, REVIEW_GLB_OPTIMIZATION_VISUAL_CAGEMATCH_SCHEMA_VERSION, "/schemaVersion", errors);
  requireLiteral(value.claimScope, "browser_visual_cagematch_for_review_fixture_only_not_webxr_runtime_or_readiness", "/claimScope", errors);
  if (!Array.isArray(value.variants) || value.variants.length === 0) errors.push("/variants must be a non-empty array");
  if (!Array.isArray(value.summary) || value.summary.length === 0) errors.push("/summary must be a non-empty array");
  if (Array.isArray(value.summary)) {
    for (const [index, summary] of value.summary.entries()) {
      if (!isRecord(summary)) {
        errors.push(`/summary/${index} must be an object`);
        continue;
      }
      if (summary.usableAsWebXrRuntimeReplacement !== false) {
        errors.push(`/summary/${index}/usableAsWebXrRuntimeReplacement must be false`);
      }
    }
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

async function runCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest || options.validatePath) {
    const reportPath = options.validatePath ?? await latestVisualReportPath();
    if (!reportPath) throw new Error("No review GLB optimization visual cagematch report found.");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
    const validation = validateReviewGlbOptimizationVisualCagematchReport(report);
    if (!validation.ok) {
      console.error(`Visual cagematch validation failed: ${validation.errors.join("; ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ reportPath, ok: true }, null, 2));
    return;
  }
  const report = await runReviewGlbOptimizationVisualCagematch(options);
  console.log(JSON.stringify({
    reportPath: report.modelVettingReportPath,
    publicModelVettingReportPath: report.publicModelVettingReportPath,
    runId: report.runId,
    summary: report.summary,
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceModelVettingReportPath: DEFAULT_SOURCE_REPORT,
    runId: new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z"),
    port: 5196,
    views: ["front", "side", "three_quarter"],
    captureRoot: DEFAULT_CAPTURE_ROOT,
    publicRoot: DEFAULT_PUBLIC_ROOT,
    validateLatest: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--benchmark-report") options.benchmarkReportPath = requireNext(args, ++index, arg);
    else if (arg === "--source-report") options.sourceModelVettingReportPath = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--views") options.views = requireNext(args, ++index, arg).split(",").map((item) => item.trim()).filter(Boolean) as CliOptions["views"];
    else if (arg === "--capture-root") options.captureRoot = requireNext(args, ++index, arg);
    else if (arg === "--public-root") options.publicRoot = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

function requireNext(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
