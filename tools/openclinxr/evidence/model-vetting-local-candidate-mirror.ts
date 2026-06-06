import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildModelVettingReportFromAnnyPreflight,
  validateModelVettingReport,
  type AnnyLikePreflightReport,
  type ModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { readJson } from "../../agent-factory/lib.js";
import {
  buildCagematchOutputHome,
  ensureCagematchOutputHome,
  type CagematchOutputHome,
} from "./generated-output-home.js";
import { stripCagematchVisualAuditMarkers } from "./strip-cagematch-visual-audit-markers.js";

type CliOptions = {
  sourcePreflightPath: string;
  lane: string;
  runId: string;
  localReportPath?: string;
  stripVisualAuditMarkers: boolean;
};

type LocalCandidateMirrorManifest = {
  schemaVersion: "openclinxr.model-vetting-local-candidate-mirror.v1";
  generatedAt: string;
  sourcePreflightPath: string;
  outputHome: CagematchOutputHome;
  localModelVettingReportPath: string;
  publicModelVettingReportPath: string;
  mirroredCandidates: Array<{
    candidateId: string;
    actorId: string;
    sourceGlbPath: string;
    publicMirrorGlbPath: string;
    publicMirrorUrlPath: string;
    visualAuditMarkerCleanupReportPath: string | null;
  }>;
  skippedCandidates: Array<{
    candidateId: string;
    actorId: string;
    sourceGlbPath: string;
    reason: "source_glb_missing";
  }>;
  falseGates: {
    runtimePromotionAllowed: false;
    productionReadinessClaimed: false;
    questReadinessClaimed: false;
    learnerReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
};

export async function buildLocalCandidateModelVettingMirror(input: {
  sourcePreflightPath: string;
  sourcePreflight: AnnyLikePreflightReport;
  outputHome: CagematchOutputHome;
  generatedAt?: string;
  localReportPath?: string;
  stripVisualAuditMarkers?: boolean;
}): Promise<LocalCandidateMirrorManifest> {
  await ensureCagematchOutputHome(input.outputHome);
  const candidatesWithExistingGlbs: AnnyLikePreflightReport["candidates"] = [];
  const skippedCandidates: LocalCandidateMirrorManifest["skippedCandidates"] = [];
  for (const candidate of input.sourcePreflight.candidates) {
    const sourceGlbPath = candidate.paths.sourceGlbPath;
    if (await fileExists(sourceGlbPath)) {
      candidatesWithExistingGlbs.push(candidate);
    } else {
      skippedCandidates.push({
        candidateId: candidate.candidateId,
        actorId: candidate.actorMapping.actorId,
        sourceGlbPath,
        reason: "source_glb_missing",
      });
    }
  }
  const report = buildModelVettingReportFromAnnyPreflight({
    sourceReport: {
      ...input.sourcePreflight,
      candidates: candidatesWithExistingGlbs,
    },
  });
  const mirroredCandidates = await Promise.all(report.candidates.map(async (candidate) => {
    const publicMirrorGlbPath = path.join(input.outputHome.publicMirrorDir, path.basename(candidate.sourceGlbPath));
    await mkdir(path.dirname(publicMirrorGlbPath), { recursive: true });
    await copyFile(candidate.sourceGlbPath, publicMirrorGlbPath);
    const publicMirrorUrlPath = `/${path.relative("apps/arena/model-vetting-studio/public", publicMirrorGlbPath).replaceAll(path.sep, "/")}`;
    candidate.sourceGlbPath = publicMirrorUrlPath;
    candidate.provenance.sourceGlbPath = publicMirrorUrlPath;
    candidate.provenance.auditPointers = uniqueStrings([...candidate.provenance.auditPointers, input.sourcePreflightPath, input.outputHome.generatedOutputPolicyPath]);
    return {
      candidateId: candidate.candidateId,
      actorId: candidate.actorId,
      sourceGlbPath: input.sourcePreflight.candidates.find((source) => source.candidateId === candidate.candidateId)?.paths.sourceGlbPath ?? "unknown",
      publicMirrorGlbPath,
      publicMirrorUrlPath,
      visualAuditMarkerCleanupReportPath: null,
    };
  }));
  const validation = validateModelVettingReport(report);
  if (!validation.ok) throw new Error(`Invalid mirrored model-vetting report: ${validation.errors.join("; ")}`);
  const localModelVettingReportPath = input.localReportPath ?? path.join(input.outputHome.localEvidenceDir, "model-vetting-report.json");
  const publicModelVettingReportPath = path.join(input.outputHome.publicMirrorDir, "model-vetting-report.json");
  await Promise.all([
    writeJsonFile(localModelVettingReportPath, report),
    writeJsonFile(publicModelVettingReportPath, report),
  ]);
  if (input.stripVisualAuditMarkers) {
    for (const candidate of mirroredCandidates) {
      const cleanupReportPath = path.join(input.outputHome.localEvidenceDir, "visual-audit-marker-cleanup", `${candidate.candidateId}.json`);
      await stripCagematchVisualAuditMarkers({
        inputPath: candidate.publicMirrorGlbPath,
        outputPath: candidate.publicMirrorGlbPath,
        reportPath: localModelVettingReportPath,
        publicReportPath: publicModelVettingReportPath,
        candidateId: candidate.candidateId,
        cleanupReportPath,
        markerPrefixes: [
          "openclinxr_role_clothing_",
          "openclinxr_role_marker_",
        ],
      });
      candidate.visualAuditMarkerCleanupReportPath = cleanupReportPath;
    }
    const updatedReport = JSON.parse(await readFile(localModelVettingReportPath, "utf8")) as ModelVettingReport;
    const updatedValidation = validateModelVettingReport(updatedReport);
    if (!updatedValidation.ok) throw new Error(`Invalid marker-cleaned model-vetting report: ${updatedValidation.errors.join("; ")}`);
  }
  const manifest: LocalCandidateMirrorManifest = {
    schemaVersion: "openclinxr.model-vetting-local-candidate-mirror.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourcePreflightPath: input.sourcePreflightPath,
    outputHome: input.outputHome,
    localModelVettingReportPath,
    publicModelVettingReportPath,
    mirroredCandidates,
    skippedCandidates,
    falseGates: {
      runtimePromotionAllowed: false,
      productionReadinessClaimed: false,
      questReadinessClaimed: false,
      learnerReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
  };
  await writeJsonFile(path.join(input.outputHome.localEvidenceDir, "local-candidate-mirror-manifest.json"), manifest);
  return manifest;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputHome = buildCagematchOutputHome(options.lane, options.runId);
  const manifest = await buildLocalCandidateModelVettingMirror({
    sourcePreflightPath: options.sourcePreflightPath,
    sourcePreflight: await readJson<AnnyLikePreflightReport>(options.sourcePreflightPath),
    outputHome,
    localReportPath: options.localReportPath,
    stripVisualAuditMarkers: options.stripVisualAuditMarkers,
  });
  console.log(JSON.stringify(manifest, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const today = new Date().toISOString().slice(0, 10);
  const options: CliOptions = {
    sourcePreflightPath: ".openclinxr/evidence/anny-preflight-local-full-candidates.json",
    lane: "anny-local-full-candidates",
    runId: today,
    stripVisualAuditMarkers: true,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source-preflight") options.sourcePreflightPath = requireNext(args, ++index, arg);
    else if (arg === "--lane") options.lane = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--local-report") options.localReportPath = requireNext(args, ++index, arg);
    else if (arg === "--no-strip-visual-audit-markers") options.stripVisualAuditMarkers = false;
  }
  return options;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
