import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";

const defaultMarkerPrefixes = [
  "openclinxr_role_clothing_",
  "openclinxr_role_marker_",
];

type CliOptions = {
  inputPath: string;
  outputPath: string;
  reportPath?: string;
  publicReportPath?: string;
  candidateId?: string;
  cleanupReportPath?: string;
  markerPrefixes: string[];
};

type StructuralMetrics = {
  byteLength: number;
  sha256: string;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  skinCount: number;
  animationCount: number;
  morphTargetPrimitiveCount: number;
  vertexCount: number;
};

type CleanupReport = {
  schemaVersion: "openclinxr.cagematch-visual-audit-marker-cleanup.v1";
  generatedAt: string;
  claimScope: "copied_cagematch_visual_audit_marker_cleanup_no_runtime_promotion";
  inputPath: string;
  outputPath: string;
  modelVettingReportPath: string | null;
  publicModelVettingReportPath: string | null;
  candidateId: string | null;
  markerPrefixes: string[];
  removedNodeCount: number;
  removedNodeNames: string[];
  structuralMetrics: StructuralMetrics;
  providerBoundary: {
    localOnly: true;
    providerExecutionEnabled: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsUsed: false;
    runtimePromotionAllowed: false;
    productionAssetReadinessClaimed: false;
  };
  notEvidenceFor: [
    "stablegen_texture_success",
    "b_plus_visual_realism_gate",
    "scene_placement_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

export async function stripCagematchVisualAuditMarkers(options: CliOptions): Promise<CleanupReport> {
  await MeshoptDecoder.ready;
  const io = createGlbIo();
  const document = await io.read(options.inputPath);
  const removedNodeNames = await stripMarkerNodes(document, options.markerPrefixes);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await io.write(options.outputPath, document);
  const structuralMetrics = await inspectGlb(options.outputPath);

  const cleanupReport: CleanupReport = {
    schemaVersion: "openclinxr.cagematch-visual-audit-marker-cleanup.v1",
    generatedAt: new Date().toISOString(),
    claimScope: "copied_cagematch_visual_audit_marker_cleanup_no_runtime_promotion",
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    modelVettingReportPath: options.reportPath ?? null,
    publicModelVettingReportPath: options.publicReportPath ?? null,
    candidateId: options.candidateId ?? null,
    markerPrefixes: options.markerPrefixes,
    removedNodeCount: removedNodeNames.length,
    removedNodeNames,
    structuralMetrics,
    providerBoundary: {
      localOnly: true,
      providerExecutionEnabled: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsUsed: false,
      runtimePromotionAllowed: false,
      productionAssetReadinessClaimed: false,
    },
    notEvidenceFor: [
      "stablegen_texture_success",
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };

  if (options.cleanupReportPath) {
    await mkdir(path.dirname(options.cleanupReportPath), { recursive: true });
    await writeFile(options.cleanupReportPath, `${JSON.stringify(cleanupReport, null, 2)}\n`, "utf8");
  }
  if (options.reportPath && options.candidateId) {
    await updateModelVettingReport(options.reportPath, options.candidateId, structuralMetrics, options.cleanupReportPath);
  }
  if (options.publicReportPath && options.candidateId) {
    await updateModelVettingReport(options.publicReportPath, options.candidateId, structuralMetrics, options.cleanupReportPath);
  }

  return cleanupReport;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cleanupReport = await stripCagematchVisualAuditMarkers(options);
  process.stdout.write(`${JSON.stringify(cleanupReport, null, 2)}\n`);
}

async function stripMarkerNodes(document: Document, prefixes: string[]): Promise<string[]> {
  const removedNodeNames: string[] = [];
  for (const node of [...document.getRoot().listNodes()]) {
    const name = node.getName();
    if (prefixes.some((prefix) => name.startsWith(prefix))) {
      removedNodeNames.push(name);
      node.dispose();
    }
  }
  await document.transform(prune({ propertyTypes: ["mesh"] }));
  return removedNodeNames.sort();
}

async function updateModelVettingReport(
  reportPath: string,
  candidateId: string,
  structuralMetrics: StructuralMetrics,
  cleanupReportPath: string | undefined,
): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
  const candidates = Array.isArray(report["candidates"]) ? report["candidates"] as Array<Record<string, unknown>> : [];
  const candidate = candidates.find((item) => item["candidateId"] === candidateId);
  if (!candidate) throw new Error(`Candidate ${candidateId} not found in ${reportPath}`);
  candidate["structuralMetrics"] = structuralMetrics;
  const provenance = isRecord(candidate["provenance"]) ? candidate["provenance"] : {};
  const auditPointers = Array.isArray(provenance["auditPointers"]) ? provenance["auditPointers"].filter((item): item is string => typeof item === "string") : [];
  if (cleanupReportPath) provenance["auditPointers"] = uniqueStrings([...auditPointers, cleanupReportPath]);
  candidate["provenance"] = provenance;
  candidate["visualAuditMarkerCleanup"] = {
    claimScope: "copied_cagematch_visual_audit_marker_cleanup_no_runtime_promotion",
    cleanupReportPath: cleanupReportPath ?? null,
    markersHiddenInCopiedGlbOnly: true,
    runtimePromotionAllowed: false,
    productionAssetReadinessClaimed: false,
    notEvidenceFor: [
      "stablegen_texture_success",
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function inspectGlb(filePath: string): Promise<StructuralMetrics> {
  const [bytes, document] = await Promise.all([readFile(filePath), createGlbIo().read(filePath)]);
  const root = document.getRoot();
  const meshes = root.listMeshes();
  const primitives = meshes.flatMap((mesh) => mesh.listPrimitives());
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sceneCount: root.listScenes().length,
    nodeCount: root.listNodes().length,
    meshCount: meshes.length,
    materialCount: root.listMaterials().length,
    skinCount: root.listSkins().length,
    animationCount: root.listAnimations().length,
    morphTargetPrimitiveCount: primitives.filter((primitive) => primitive.listTargets().length > 0).length,
    vertexCount: primitives.reduce((total, primitive) => total + (primitive.getAttribute("POSITION")?.getCount() ?? 0), 0),
  };
}

function createGlbIo(): NodeIO {
  return new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: "",
    outputPath: "",
    markerPrefixes: [...defaultMarkerPrefixes],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--input") options.inputPath = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--report") options.reportPath = requireNext(args, ++index, arg);
    else if (arg === "--public-report") options.publicReportPath = requireNext(args, ++index, arg);
    else if (arg === "--candidate-id") options.candidateId = requireNext(args, ++index, arg);
    else if (arg === "--cleanup-report") options.cleanupReportPath = requireNext(args, ++index, arg);
    else if (arg === "--marker-prefixes") options.markerPrefixes = requireNext(args, ++index, arg).split(",").map((item) => item.trim()).filter(Boolean);
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.inputPath) throw new Error("Missing --input");
  if (!options.outputPath) throw new Error("Missing --output");
  if (options.markerPrefixes.length === 0) throw new Error("--marker-prefixes must include at least one prefix");
  return options;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
