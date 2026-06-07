import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import {
  validateModelVettingReport,
  type ModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { buildCagematchOutputHome, ensureCagematchOutputHome } from "./generated-output-home.js";

type CliOptions = {
  sourceReportPath: string;
  candidateId: string;
  sourceGlbPath: string;
  texturePath: string;
  lane: string;
  runId: string;
  outputGlbName: string;
  maskReportPath?: string; // optional: for mask-constrained composite input (when the provided --texture is a base albedo)
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await MeshoptDecoder.ready;
  const outputHome = buildCagematchOutputHome(options.lane, options.runId);
  await ensureCagematchOutputHome(outputHome);

  const outputGlbPath = path.join(outputHome.publicMirrorDir, options.outputGlbName);
  await mkdir(path.dirname(outputGlbPath), { recursive: true });
  const appliedTexture = await applyTextureToSkinMaterial({
    inputGlbPath: options.sourceGlbPath,
    outputGlbPath,
    texturePath: options.texturePath,
  });
  const publicMirrorUrlPath = `/${path.relative("apps/arena/model-vetting-studio/public", outputGlbPath).replaceAll(path.sep, "/")}`;
  const report = await buildAfterReport({
    sourceReportPath: options.sourceReportPath,
    candidateId: options.candidateId,
    sourceGlbPath: options.sourceGlbPath,
    outputGlbPath,
    publicMirrorUrlPath,
    texturePath: options.texturePath,
    appliedTexture,
  });
  const validation = validateModelVettingReport(report);
  if (!validation.ok) throw new Error(`Invalid RealVisXL direct texture model-vetting report: ${validation.errors.join("; ")}`);

  const localReportPath = path.join(outputHome.localEvidenceDir, "model-vetting-report.json");
  const publicReportPath = path.join(outputHome.publicMirrorDir, "model-vetting-report.json");
  const summaryPath = path.join(outputHome.localEvidenceDir, "realvisxl-direct-texture-cagematch.json");
  const candidate = report.candidates[0];
  await Promise.all([
    writeJsonFile(localReportPath, report),
    writeJsonFile(publicReportPath, report),
    writeJsonFile(summaryPath, {
      schemaVersion: "openclinxr.realvisxl-direct-texture-cagematch.v2",
      generatedAt: new Date().toISOString(),
      claimScope: "copied_candidate_realvisxl_albedo_application_no_runtime_promotion",
      sourceReportPath: options.sourceReportPath,
      sourceGlbPath: options.sourceGlbPath,
      outputGlbPath,
      publicMirrorUrlPath,
      texturePath: options.texturePath,
      sourceLineage: {
        scenarioId: candidate.scenarioId,
        actorId: candidate.actorId,
        actorRole: candidate.actorRole,
        reuseKey: candidate.reuseKey,
        sourceCandidateId: options.candidateId,
        outputCandidateId: candidate.candidateId,
        sourceManifestPath: candidate.sourceManifestPath,
        sourceReportPath: options.sourceReportPath,
        sourceGlbPath: options.sourceGlbPath,
      },
      appliedTexture,
      outputHome,
      providerBoundary: {
        localOnly: true,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialsUsed: false,
        stableGenAddonUsed: false,
        runtimePromotionAllowed: false,
        productionAssetReadinessClaimed: false,
        questReadinessClaimed: false,
        learnerReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
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
    }),
  ]);
  process.stdout.write(`${JSON.stringify({ localReportPath, publicReportPath, summaryPath, publicMirrorUrlPath, appliedTexture }, null, 2)}\n`);
}

async function applyTextureToSkinMaterial(input: {
  inputGlbPath: string;
  outputGlbPath: string;
  texturePath: string;
}): Promise<{ materialName: string; textureSha256: string; outputSha256: string }> {
  const io = createGlbIo();
  const document = await io.read(input.inputGlbPath);
  const material = document.getRoot().listMaterials().find((item) => item.getName() === "anny_generated_pbr");
  if (!material) throw new Error("Skin material anny_generated_pbr not found.");
  const textureBytes = await readFile(input.texturePath);
  const texture = document.createTexture("openclinxr_realvisxl_direct_skin_albedo")
    .setImage(textureBytes)
    .setMimeType("image/png");
  material
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(texture)
    .setRoughnessFactor(0.82)
    .setMetallicFactor(0);
  await io.write(input.outputGlbPath, document);
  return {
    materialName: material.getName(),
    textureSha256: sha256(textureBytes),
    outputSha256: sha256(await readFile(input.outputGlbPath)),
  };
}

async function buildAfterReport(input: {
  sourceReportPath: string;
  candidateId: string;
  sourceGlbPath: string;
  outputGlbPath: string;
  publicMirrorUrlPath: string;
  texturePath: string;
  appliedTexture: { materialName: string; textureSha256: string; outputSha256: string };
}): Promise<ModelVettingReport> {
  const sourceReport = JSON.parse(await readFile(input.sourceReportPath, "utf8")) as ModelVettingReport;
  const sourceCandidate = sourceReport.candidates.find((candidate) => candidate.candidateId === input.candidateId);
  if (!sourceCandidate) throw new Error(`Candidate ${input.candidateId} not found in ${input.sourceReportPath}`);
  const afterCandidate = structuredClone(sourceCandidate);
  afterCandidate.candidateId = `${sourceCandidate.candidateId}_realvisxl_direct_texture`;
  afterCandidate.sourceGlbPath = input.publicMirrorUrlPath;
  afterCandidate.captureArtifacts = {
    fixedCameraScreenshots: [],
    turntableVideo: null,
    morphVisemeTimelineCapture: null,
    emotionTransitionCapture: null,
  };
  afterCandidate.blockers = [
    ...new Set([
      ...sourceCandidate.blockers.filter((blocker) => blocker !== "fixed_camera_screenshots_missing"),
      "realvisxl_direct_after_fixed_camera_screenshots_missing",
      "visual_realism_adversary_delta_review_missing",
      "not_stablegen_addon_output",
    ]),
  ].sort();
  afterCandidate.provenance = {
    ...afterCandidate.provenance,
    sourceGlbPath: input.publicMirrorUrlPath,
    auditPointers: [
      ...new Set([
        ...afterCandidate.provenance.auditPointers,
        input.sourceReportPath,
        input.texturePath,
      ]),
    ].sort(),
  };
  return {
    ...sourceReport,
    generatedAt: new Date().toISOString(),
    sourceReportPath: input.sourceReportPath,
    candidates: [afterCandidate],
    decision: {
      ...sourceReport.decision,
      isolatedLabCaptureComplete: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep: "Capture before/after fixed-camera RealVisXL direct texture evidence in the isolated model-vetting studio before any scene-placement or promotion claim.",
    },
  };
}

function createGlbIo(): NodeIO {
  return new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
}

function parseArgs(args: string[]): CliOptions {
  const today = new Date().toISOString().slice(0, 10);
  const options: CliOptions = {
    sourceReportPath: "",
    candidateId: "peds_patient_child_anny_compatible_candidate",
    sourceGlbPath: "",
    texturePath: "",
    lane: "realvisxl-direct-texture",
    runId: today,
    outputGlbName: "peds_patient_child_realvisxl_direct_texture.glb",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--candidate-id") options.candidateId = requireNext(args, ++index, arg);
    else if (arg === "--source-glb") options.sourceGlbPath = requireNext(args, ++index, arg);
    else if (arg === "--texture") options.texturePath = requireNext(args, ++index, arg);
    else if (arg === "--lane") options.lane = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--output-glb-name") options.outputGlbName = requireNext(args, ++index, arg);
    else if (arg === "--mask-report") options.maskReportPath = requireNext(args, ++index, arg);
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.sourceReportPath) throw new Error("Missing --source-report");
  if (!options.sourceGlbPath) throw new Error("Missing --source-glb");
  if (!options.texturePath) throw new Error("Missing --texture");
  // --mask-report is optional (used when the caller wants the apply step itself to respect source UV masks
  // for the composite, e.g. when feeding a base RealVisXL albedo + mask instead of a pre-composited tile).
  return options;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
