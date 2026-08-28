#!/usr/bin/env node
/**
 * Selective meshopt decimation of fitted lash meshes only (#737).
 *
 * The ED four-actor station went over its 180,000 authored budget when #683 traded
 * 368-tri hm08 helper lashes for 16,632-tri fitted mindfront_eyelashes_01 lashes
 * (predicted in #683's own cost analysis). The lash allowance is derived, not chosen:
 * the measured non-lash ED total is 178,239, so all four lash meshes together may
 * carry at most 1,761 triangles (~440 each against ~3,600 today).
 *
 * Scoped like optimize_glb_meshopt.mjs --simplify-only, except the simplify pass is
 * filtered to primitives whose mesh name matches /lash/i. Nothing else in the GLB is
 * touched — bodies stay at their recorded counts (an-actor-wears clause 3), garments,
 * brows, teeth and tongue keep their shipped bytes.
 *
 * A ratio without its error bound is not reproducible (#695), so every rung is recorded
 * as (ratio, error) in the report, and the meshopt error is the quality lever: the
 * smallest error that clears the budget wins, because legibility is graded, not assumed.
 *
 * Run:
 *   node tools/openclinxr/asset-pipeline/anny/optimize_glb_lash_lod.mjs \
 *     --input <in.glb> --output <out.glb> --report <report.json> \
 *     --ratio 0.12 --error 0.05
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { simplifyPrimitive } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const LASH_RE = /lash/i;

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

function triangleCount(document, predicate) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    if (predicate && !predicate(mesh)) continue;
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

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "input");
const outputPath = requireArg(args, "output");
const reportPath = requireArg(args, "report");
const riggingReportPath = args.get("rigging-report");
const ratio = Number(requireArg(args, "ratio"));
const error = Number(requireArg(args, "error"));
if (!(ratio > 0 && ratio <= 1)) throw new Error(`--ratio must be in (0, 1], got ${ratio}`);
if (!(error > 0)) throw new Error(`--error must be > 0, got ${error}`);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;

const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });

const document = await io.read(inputPath);
const beforeTotal = triangleCount(document);
const beforeLash = triangleCount(document, (m) => LASH_RE.test(m.getName()));
const beforeBytes = statSync(inputPath).size;

const lashPrims = document.getRoot().listMeshes()
  .filter((m) => LASH_RE.test(m.getName()))
  .flatMap((m) => m.listPrimitives());
if (lashPrims.length === 0) {
  throw new Error(`no lash meshes (/${LASH_RE.source}/) found in ${inputPath}`);
}
const lashPrimCounts = document.getRoot().listMeshes()
  .filter((m) => LASH_RE.test(m.getName()))
  .map((m) => ({ mesh: m.getName(), prims: m.listPrimitives().length, tris: triangleCount(document, (x) => x === m) }));

await document.transform((doc) => {
  // @gltf-transform/functions v4 `simplify` has no primitives filter — it decimates every
  // primitive in the document. Scope it explicitly: meshopt per-primitive simplification
  // on the lash prims only, so bodies/garments/brows/teeth/tongue keep their shipped bytes.
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!LASH_RE.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      simplifyPrimitive(prim, {
        simplifier: MeshoptSimplifier,
        ratio,
        error,
        lockBorder: false,
      });
    }
  }
  return doc;
});

const tempOutputPath = inputPath === outputPath ? `${outputPath}.lashlod.tmp.glb` : outputPath;
await io.write(tempOutputPath, document);
if (tempOutputPath !== outputPath) renameSync(tempOutputPath, outputPath);

const afterTotal = triangleCount(document);
const afterLash = triangleCount(document, (m) => LASH_RE.test(m.getName()));
const afterBytes = statSync(outputPath).size;

const handoff = {
  schemaVersion: "openclinxr.generated-humanoid-lash-lod.v1",
  optimizationApplied: true,
  simplificationApplied: true,
  simplificationStage: "post_blender_glb_lash_only",
  simplificationRatio: ratio,
  simplificationError: error,
  lashPrimitives: lashPrimCounts,
  beforeTotalTriangles: beforeTotal,
  afterTotalTriangles: afterTotal,
  beforeLashTriangles: beforeLash,
  afterLashTriangles: afterLash,
  lashReductionX: afterLash > 0 ? Number((beforeLash / afterLash).toFixed(2)) : null,
  beforeBytes,
  afterBytes,
  claimScope: "ed_station_budget_recovery_via_lash_only_lod_not_legibility_grade",
  notEvidenceFor: [
    "lash_legibility_pixel_grade",
    "b_plus_visual_realism_gate",
    "quest_readiness",
    "clinical_validity",
  ],
};

writeJson(reportPath, { ...handoff, inputPath, outputPath, generatedAt: new Date().toISOString() });
if (riggingReportPath && existsSync(riggingReportPath)) {
  const value = JSON.parse(readFileSync(riggingReportPath, "utf8"));
  value.lashLodHandoff = handoff;
  writeJson(riggingReportPath, value);
}
console.log(JSON.stringify({ outputPath, beforeLash, afterLash, afterTotal, error, ratio }));
