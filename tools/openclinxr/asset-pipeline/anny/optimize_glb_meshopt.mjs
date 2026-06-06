#!/usr/bin/env node
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, resample, sparse } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    args.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  return args;
}

function requireArg(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function metrics(document) {
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
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function updateRiggingReport(path, optimizationHandoff) {
  if (!path || !existsSync(path)) return;
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.optimizationHandoff = optimizationHandoff;
  writeJson(path, value);
}

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "input");
const outputPath = requireArg(args, "output");
const reportPath = requireArg(args, "report");
const riggingReportPath = args.get("rigging-report");
const tempOutputPath = inputPath === outputPath ? `${outputPath}.meshopt.tmp.glb` : outputPath;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });

const document = await io.read(inputPath);
const beforeMetrics = metrics(document);
const beforeBytes = statSync(inputPath).size;

await document.transform(
  dedup(),
  prune(),
  resample(),
  sparse(),
  quantize(),
  meshopt({ encoder: MeshoptEncoder }),
);

await io.write(tempOutputPath, document);
if (tempOutputPath !== outputPath) {
  renameSync(tempOutputPath, outputPath);
}

const afterDocument = await io.read(outputPath);
const afterBytes = statSync(outputPath).size;
const afterMetrics = metrics(afterDocument);
const optimizationHandoff = {
  schemaVersion: "openclinxr.generated-humanoid-glb-optimization.v1",
  optimizationApplied: true,
  simplificationApplied: false,
  simplificationStage: "none",
  optimizationStage: "post_blender_glb",
  optimizationTool: "@gltf-transform/core+@gltf-transform/functions meshopt",
  optimizationPasses: ["dedup", "prune", "resample", "sparse", "quantize", "meshopt"],
  meshoptEnabled: true,
  textureCompressionApplied: false,
  sourceCoordinateBasis: "anny_obj_import_local_source_basis_with_blender_world_transform",
  exportCoordinateBasis: "glb_y_up_export",
  beforeBytes,
  afterBytes,
  byteReductionRatio: Number((afterBytes / beforeBytes).toFixed(4)),
  beforeMetrics,
  afterMetrics,
  claimScope: "post_blender_webxr_delivery_optimization_not_realism_or_readiness_gate",
  notEvidenceFor: [
    "b_plus_visual_realism_gate",
    "production_asset_readiness",
    "quest_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
  ],
};

writeJson(reportPath, {
  ...optimizationHandoff,
  inputPath,
  outputPath,
  generatedAt: new Date().toISOString(),
});
updateRiggingReport(riggingReportPath, optimizationHandoff);
console.log(JSON.stringify({ outputPath, reportPath, beforeBytes, afterBytes, byteReductionRatio: optimizationHandoff.byteReductionRatio }));
