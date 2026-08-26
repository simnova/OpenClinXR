#!/usr/bin/env node
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, resample, simplify, sparse } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    // Boolean flags carry no value; without this branch the flag swallows the NEXT arg.
    if (key === "--simplify-only") {
      args.set("simplify-only", "true");
      continue;
    }
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

function triangleCount(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      triangles += (idx?.getCount() ?? pos?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(triangles);
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

// #695: meshopt DECIMATION is now a first-class stage, not TRELLIS-only. Both numbers are
// required together — a ratio without its error bound is not reproducible (meshopt will not
// overshoot the error budget to reach a ratio). `--simplify-only` applies decimation and
// nothing else, so a shipped asset is perturbed by exactly the topology change and not by
// re-quantization or recompression.
const simplifyRatioRaw = args.get("simplify-ratio");
const simplifyErrorRaw = args.get("simplify-error");
const simplifyOnly = args.get("simplify-only") === "true";
const simplifyRatio = simplifyRatioRaw !== undefined ? Number(simplifyRatioRaw) : undefined;
const simplifyError = simplifyErrorRaw !== undefined ? Number(simplifyErrorRaw) : undefined;
if ((simplifyRatioRaw === undefined) !== (simplifyErrorRaw === undefined)) {
  throw new Error("--simplify-ratio and --simplify-error must be provided together");
}
if (simplifyRatio !== undefined && !(simplifyRatio > 0 && simplifyRatio <= 1)) {
  throw new Error(`--simplify-ratio must be in (0, 1], got ${simplifyRatio}`);
}
if (simplifyError !== undefined && !(simplifyError > 0)) {
  throw new Error(`--simplify-error must be > 0, got ${simplifyError}`);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
if (simplifyRatio !== undefined) await MeshoptSimplifier.ready;

const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });

const document = await io.read(inputPath);
const beforeMetrics = metrics(document);
const beforeTris = triangleCount(document);
const beforeBytes = statSync(inputPath).size;

const passes = [];
if (simplifyRatio !== undefined) {
  passes.push(simplify({
    simplifier: MeshoptSimplifier,
    ratio: simplifyRatio,
    error: simplifyError,
    lockBorder: false,
  }));
}
if (simplifyOnly) {
  if (simplifyRatio === undefined) {
    throw new Error("--simplify-only requires --simplify-ratio/--simplify-error");
  }
} else {
  passes.push(
    dedup(),
    prune(),
    resample(),
    sparse(),
    quantize(),
    meshopt({ encoder: MeshoptEncoder }),
  );
}
await document.transform(...passes);

await io.write(tempOutputPath, document);
if (tempOutputPath !== outputPath) {
  renameSync(tempOutputPath, outputPath);
}

const afterDocument = await io.read(outputPath);
const afterBytes = statSync(outputPath).size;
const afterMetrics = metrics(afterDocument);
const afterTris = triangleCount(afterDocument);
const optimizationHandoff = {
  schemaVersion: "openclinxr.generated-humanoid-glb-optimization.v1",
  optimizationApplied: true,
  simplificationApplied: simplifyRatio !== undefined,
  simplificationStage: simplifyRatio !== undefined ? "pre_" + (simplifyOnly ? "only" : "meshopt_passes") : "none",
  simplificationRatio: simplifyRatio ?? null,
  simplificationError: simplifyError ?? null,
  beforeTriangles: beforeTris,
  afterTriangles: afterTris,
  triangleReductionX: simplifyRatio !== undefined && afterTris > 0
    ? Number((beforeTris / afterTris).toFixed(2))
    : null,
  optimizationStage: "post_blender_glb",
  optimizationTool: "@gltf-transform/core+@gltf-transform/functions meshopt",
  optimizationPasses: simplifyOnly
    ? ["simplify"]
    : simplifyRatio !== undefined
      ? ["simplify", "dedup", "prune", "resample", "sparse", "quantize", "meshopt"]
      : ["dedup", "prune", "resample", "sparse", "quantize", "meshopt"],
  meshoptEnabled: !simplifyOnly,
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
