import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import {
  validateModelVettingReport,
  type ModelVettingCandidate,
  type ModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { globFiles, readJson } from "../../agent-factory/lib.js";
import {
  buildCagematchOutputHome,
  ensureCagematchOutputHome,
  type CagematchOutputHome,
} from "./generated-output-home.js";

const defaultRunId = new Date().toISOString().slice(0, 10);
const defaultOutputHome = buildCagematchOutputHome("anny-skin-track-a-mit-pbr", defaultRunId);
const defaultOutputDir = defaultOutputHome.publicMirrorDir;
const defaultModelVettingReportPath = path.join(defaultOutputHome.localEvidenceDir, "model-vetting-report.json");
const defaultCagematchReportPath = path.join(defaultOutputHome.localEvidenceDir, "cagematch-report.json");

type TextureRole = "basecolor" | "normal" | "roughness" | "metallic" | "ao";

type CagematchManifest = {
  schemaVersion: "openclinxr.anny-skin-texture-cagematch-manifest.v1";
  evidencePlan: {
    mitPbrBakes: Record<string, Record<TextureRole | "beforeAfterPlan", string>>;
  };
};

type AppliedCandidate = {
  role: string;
  sourceCandidateId: string;
  afterCandidateId: string;
  actorId: string;
  sourceGlbPath: string;
  outputGlbPath: string;
  outputSha256: string;
  appliedTextureMaps: Record<TextureRole, string>;
  metrics: ModelVettingCandidate["structuralMetrics"];
};

type TrackAReport = {
  schemaVersion: "openclinxr.anny-skin-track-a-pbr-cagematch.v1";
  generatedAt: string;
  claimScope: "copied_candidate_mit_track_a_pbr_texture_application_no_runtime_promotion";
  sourceManifestPath: string;
  sourceModelVettingReportPath: string;
  outputHome: CagematchOutputHome;
  outputDir: string;
  candidates: AppliedCandidate[];
  providerBoundary: {
    localOnly: true;
    stableGenGenerationAttempted: false;
    comfyWorkflowQueued: false;
    diffusionWeightsLoaded: false;
    modelDownloadsUsed: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsUsed: false;
    runtimePromotionAllowed: false;
    productionAssetReadinessClaimed: false;
  };
  generatedModelVettingReportPath: string;
  publicModelVettingReportPath: string;
  notEvidenceFor: [
    "stablegen_texture_success",
    "diffusion_model_license_clearance",
    "b_plus_visual_realism_gate",
    "scene_placement_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

type CliOptions = {
  manifestPath?: string;
  sourceReportPath?: string;
  outputDir: string;
  modelVettingReportPath: string;
  cagematchReportPath: string;
  validateLatest: boolean;
  validatePath?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validateLatest || options.validatePath) {
    const validatePath = options.validatePath ?? await latestPath(".openclinxr/evidence/cagematch/anny-skin-track-a-mit-pbr/*/cagematch-report.json")
      ?? await latestPath("docs/openclinxr/anny-skin-track-a-mit-pbr-cagematch-*.json");
    if (!validatePath) throw new Error("Missing Anny skin Track A PBR cagematch report to validate.");
    const errors = validateTrackAReport(await readJson<unknown>(validatePath));
    if (errors.length === 0) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const manifestPath = options.manifestPath ?? await requiredLatestPath("docs/openclinxr/anny-skin-texture-cagematch-manifest-*.json");
  const sourceReportPath = options.sourceReportPath ?? await requiredLatestPath("docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-*.json");
  const sourceReport = await readJson<ModelVettingReport>(sourceReportPath);
  const outputHome = await ensureCagematchOutputHome(buildCagematchOutputHome("anny-skin-track-a-mit-pbr", path.basename(path.dirname(options.cagematchReportPath))));
  const trackReport = await buildTrackAPbrCagematch({
    manifest: await readJson<CagematchManifest>(manifestPath),
    manifestPath,
    sourceReport,
    sourceReportPath,
    outputHome,
    outputDir: options.outputDir,
    modelVettingReportPath: options.modelVettingReportPath,
  });
  const afterReport = buildAfterModelVettingReport(sourceReport, trackReport);
  const afterValidation = validateModelVettingReport(afterReport);
  if (!afterValidation.ok) throw new Error(`Invalid generated after model-vetting report: ${afterValidation.errors.join("; ")}`);
  await Promise.all([
    mkdir(path.dirname(options.modelVettingReportPath), { recursive: true }),
    mkdir(path.dirname(options.cagematchReportPath), { recursive: true }),
  ]);
  await writeFile(options.modelVettingReportPath, `${JSON.stringify(afterReport, null, 2)}\n`, "utf8");
  await writeFile(trackReport.publicModelVettingReportPath, `${JSON.stringify(afterReport, null, 2)}\n`, "utf8");
  await writeFile(options.cagematchReportPath, `${JSON.stringify(trackReport, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.modelVettingReportPath}`);
  console.log(`Wrote ${trackReport.publicModelVettingReportPath}`);
  console.log(`Wrote ${options.cagematchReportPath}`);
}

export async function buildTrackAPbrCagematch(input: {
  manifest: CagematchManifest;
  manifestPath: string;
  sourceReport: ModelVettingReport;
  sourceReportPath: string;
  outputHome?: CagematchOutputHome;
  outputDir: string;
  modelVettingReportPath: string;
}): Promise<TrackAReport> {
  const sourceValidation = validateModelVettingReport(input.sourceReport);
  if (!sourceValidation.ok) throw new Error(`Invalid source model-vetting report: ${sourceValidation.errors.join("; ")}`);
  await mkdir(input.outputDir, { recursive: true });
  await MeshoptDecoder.ready;
  const candidates = await Promise.all(input.sourceReport.candidates.map(async (candidate) => {
    const role = roleKeyForCandidate(candidate);
    const maps = input.manifest.evidencePlan.mitPbrBakes[role];
    if (!maps) throw new Error(`Missing MIT PBR bake map set for role ${role}`);
    const outputGlbPath = path.join(input.outputDir, `${path.basename(candidate.sourceGlbPath, ".glb")}_track_a_mit_pbr.glb`);
    await applyTextureMaps(candidate.sourceGlbPath, outputGlbPath, maps);
    const metrics = await inspectGlb(outputGlbPath);
    return {
      role,
      sourceCandidateId: candidate.candidateId,
      afterCandidateId: `${candidate.candidateId}_track_a_mit_pbr`,
      actorId: candidate.actorId,
      sourceGlbPath: candidate.sourceGlbPath,
      outputGlbPath,
      outputSha256: metrics.sha256,
      appliedTextureMaps: {
        basecolor: maps.basecolor,
        normal: maps.normal,
        roughness: maps.roughness,
        metallic: maps.metallic,
        ao: maps.ao,
      },
      metrics,
    };
  }));

  return {
    schemaVersion: "openclinxr.anny-skin-track-a-pbr-cagematch.v1",
    generatedAt: new Date().toISOString(),
    claimScope: "copied_candidate_mit_track_a_pbr_texture_application_no_runtime_promotion",
    sourceManifestPath: input.manifestPath,
    sourceModelVettingReportPath: input.sourceReportPath,
    outputHome: input.outputHome ?? buildCagematchOutputHome("anny-skin-track-a-mit-pbr", defaultRunId),
    outputDir: input.outputDir,
    candidates,
    providerBoundary: {
      localOnly: true,
      stableGenGenerationAttempted: false,
      comfyWorkflowQueued: false,
      diffusionWeightsLoaded: false,
      modelDownloadsUsed: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsUsed: false,
      runtimePromotionAllowed: false,
      productionAssetReadinessClaimed: false,
    },
    generatedModelVettingReportPath: input.modelVettingReportPath,
    publicModelVettingReportPath: path.join(input.outputDir, "model-vetting-report.json"),
    notEvidenceFor: [
      "stablegen_texture_success",
      "diffusion_model_license_clearance",
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

function buildAfterModelVettingReport(sourceReport: ModelVettingReport, trackReport: TrackAReport): ModelVettingReport {
  const afterBySource = new Map(trackReport.candidates.map((candidate) => [candidate.sourceCandidateId, candidate]));
  return {
    ...sourceReport,
    generatedAt: trackReport.generatedAt,
    candidates: sourceReport.candidates.map((candidate) => {
      const after = afterBySource.get(candidate.candidateId);
      if (!after) return candidate;
      return {
        ...candidate,
        candidateId: after.afterCandidateId,
        sourceGlbPath: after.outputGlbPath,
        structuralMetrics: after.metrics,
        provenance: {
          ...candidate.provenance,
          sourceGlbPath: after.outputGlbPath,
          auditPointers: uniqueStrings([
            ...candidate.provenance.auditPointers,
            trackReport.sourceManifestPath,
            ...Object.values(after.appliedTextureMaps),
          ]),
          notEvidenceFor: uniqueStrings([...candidate.provenance.notEvidenceFor, ...trackReport.notEvidenceFor]),
        },
        captureArtifacts: { fixedCameraScreenshots: [] },
        blockers: uniqueStrings([
          ...candidate.blockers,
          "track_a_after_fixed_camera_screenshots_missing",
          "track_a_after_turntable_video_missing",
          "visual_realism_adversary_delta_review_missing",
        ]),
        nextEvidenceRequired: uniqueStrings([
          ...candidate.nextEvidenceRequired,
          "track_a_before_after_fixed_camera_screenshots",
          "track_a_material_delta_visual_realism_adversary_review",
        ]),
      };
    }),
    decision: {
      ...sourceReport.decision,
      status: "blocked_before_scene",
      isolatedLabCaptureComplete: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep: "Capture before/after fixed-camera Track A MIT PBR evidence in the isolated model-vetting studio before any scene-placement or promotion claim.",
    },
  };
}

async function applyTextureMaps(sourceGlbPath: string, outputGlbPath: string, maps: Record<string, string>): Promise<void> {
  const io = createGlbIo();
  const document = await io.read(sourceGlbPath);
  const material = document.getRoot().listMaterials().find((item) => item.getName() === "anny_generated_pbr")
    ?? document.getRoot().listMaterials()[0];
  if (!material) throw new Error(`No material found in ${sourceGlbPath}`);
  material
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(await createTexture(document, "track_a_mit_pbr_basecolor", maps.basecolor))
    .setNormalTexture(await createTexture(document, "track_a_mit_pbr_normal", maps.normal))
    .setMetallicRoughnessTexture(await createTexture(document, "track_a_mit_pbr_roughness", maps.roughness))
    .setOcclusionTexture(await createTexture(document, "track_a_mit_pbr_ao", maps.ao))
    .setMetallicFactor(0)
    .setRoughnessFactor(0.82);
  await mkdir(path.dirname(outputGlbPath), { recursive: true });
  await io.write(outputGlbPath, document);
}

async function createTexture(document: Document, name: string, filePath: string) {
  return document.createTexture(name)
    .setImage(await readFile(filePath))
    .setMimeType("image/png");
}

async function inspectGlb(filePath: string): Promise<ModelVettingCandidate["structuralMetrics"]> {
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

function roleKeyForCandidate(candidate: ModelVettingCandidate): string {
  if (candidate.actorRole === "family") return "parent";
  if (candidate.actorRole === "nurse") return "nurse";
  return "patient";
}

function createGlbIo(): NodeIO {
  return new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
}

function validateTrackAReport(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["/ must be object"];
  if (value["schemaVersion"] !== "openclinxr.anny-skin-track-a-pbr-cagematch.v1") errors.push("/schemaVersion invalid");
  const provider = isRecord(value["providerBoundary"]) ? value["providerBoundary"] : {};
  for (const key of ["stableGenGenerationAttempted", "comfyWorkflowQueued", "diffusionWeightsLoaded", "modelDownloadsUsed", "externalNetworkUsed", "paidApiUsed", "credentialsUsed", "runtimePromotionAllowed", "productionAssetReadinessClaimed"]) {
    if (provider[key] !== false) errors.push(`/providerBoundary/${key} must be false`);
  }
  const candidates = Array.isArray(value["candidates"]) ? value["candidates"] : [];
  if (candidates.length !== 3) errors.push("/candidates must include patient, parent, and nurse");
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate["outputGlbPath"] !== "string") errors.push("/candidates/outputGlbPath missing");
    if (typeof candidate["outputSha256"] !== "string" || !/^[a-f0-9]{64}$/u.test(candidate["outputSha256"])) errors.push("/candidates/outputSha256 invalid");
  }
  for (const claim of ["b_plus_visual_realism_gate", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
    if (!Array.isArray(value["notEvidenceFor"]) || !value["notEvidenceFor"].includes(claim)) errors.push(`/notEvidenceFor must include ${claim}`);
  }
  return errors;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    outputDir: defaultOutputDir,
    modelVettingReportPath: defaultModelVettingReportPath,
    cagematchReportPath: defaultCagematchReportPath,
    validateLatest: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--manifest") options.manifestPath = requireNext(args, ++index, arg);
    else if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--output-dir") options.outputDir = requireNext(args, ++index, arg);
    else if (arg === "--model-vetting-report") options.modelVettingReportPath = requireNext(args, ++index, arg);
    else if (arg === "--cagematch-report") options.cagematchReportPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
  }
  return options;
}

async function requiredLatestPath(pattern: string): Promise<string> {
  const found = await latestPath(pattern);
  if (!found) throw new Error(`Missing required path for pattern ${pattern}`);
  return found;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
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
  void main();
}
