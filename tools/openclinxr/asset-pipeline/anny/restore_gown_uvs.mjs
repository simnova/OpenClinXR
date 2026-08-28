#!/usr/bin/env node
/**
 * Restore the UVs the #714 gown re-bake dropped (#737 / #748).
 *
 * The c66c012c re-bake shipped mpfb-gown-adult-patient with 4 UV-bearing primitives
 * where every committed bake path (measured: stage-2 import->export on decimated and
 * full-res inputs, and the #695 meshopt rung) preserves all 16. The drop is not
 * reproducible from any committed script — it was a one-off artifact of the #714
 * session's on-disk state. This restores the exact dropped data: the #740-era GLB
 * (a55067d1) has byte-identical POSITION arrays on every non-garment primitive, so
 * its TEXCOORD_0 attributes map 1:1 onto the shipped topology.
 *
 * The garment primitive is deliberately NOT touched: it differs between the two
 * states (the #714 fold clamp) and carries no UVs in either.
 *
 * Run:
 *   node tools/openclinxr/asset-pipeline/anny/restore_gown_uvs.mjs \
 *     --input <shipped.glb> --reference <740-era.glb> --output <out.glb> [--report <json>]
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

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

function hashOf(accessor) {
  const arr = accessor.getArray();
  return createHash("sha256").update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "input");
const referencePath = requireArg(args, "reference");
const outputPath = requireArg(args, "output");
const reportPath = args.get("report");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inputPath);
const refDoc = await io.read(referencePath);

const refByMesh = new Map();
for (const mesh of refDoc.getRoot().listMeshes()) {
  refByMesh.set(mesh.getName(), mesh);
}

const restored = [];
const skipped = [];
let uvPrims = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  const refMesh = refByMesh.get(mesh.getName());
  for (let i = 0; i < mesh.listPrimitives().length; i++) {
    const prim = mesh.listPrimitives()[i];
    const pos = prim.getAttribute("POSITION");
    if (prim.getAttribute("TEXCOORD_0")) { uvPrims += 1; continue; }
    if (!refMesh || i >= refMesh.listPrimitives().length) {
      skipped.push(`${mesh.getName()}[${i}]: no reference primitive`);
      continue;
    }
    const refPrim = refMesh.listPrimitives()[i];
    const refUv = refPrim.getAttribute("TEXCOORD_0");
    if (!refUv) {
      skipped.push(`${mesh.getName()}[${i}]: reference has no UV either`);
      continue;
    }
    const refPos = refPrim.getAttribute("POSITION");
    if (refPos.getCount() !== pos.getCount() || hashOf(refPos) !== hashOf(pos)) {
      throw new Error(
        `${mesh.getName()}[${i}]: topology mismatch with reference `
          + `(pos ${pos.getCount()} vs ${refPos.getCount()}) — refusing a misaligned UV copy`,
      );
    }
    const uv = doc.createAccessor()
      .setType(refUv.getType())
      .setNormalized(refUv.getNormalized())
      .setArray(refUv.getArray().slice());
    prim.setAttribute("TEXCOORD_0", uv);
    restored.push(`${mesh.getName()}[${i}] ${refUv.getArray().constructor.name} x${refUv.getCount()}`);
    uvPrims += 1;
  }
}

await io.write(outputPath, doc);
const outDoc = await io.read(outputPath);
let finalUvPrims = 0;
let total = 0;
for (const mesh of outDoc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    const pos = prim.getAttribute("POSITION");
    total += (idx?.getCount() ?? pos?.getCount() ?? 0) / 3;
    if (prim.getAttribute("TEXCOORD_0")) finalUvPrims += 1;
  }
}

const report = {
  schemaVersion: "openclinxr.gown-uv-restore.v1",
  inputPath,
  referencePath,
  outputPath,
  restoredPrimitives: restored,
  skipped,
  uvPrimitivesAfter: finalUvPrims,
  totalTrianglesAfter: Math.round(total),
  claimScope: "restores the TEXCOORD_0 attributes the #714 re-bake dropped, from byte-identical topology",
  notEvidenceFor: ["garment quality", "lash legibility", "readiness"],
};
if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ outputPath, restored: restored.length, uvPrimsBefore: uvPrims - restored.length, uvPrimsAfter: finalUvPrims, totalTrianglesAfter: Math.round(total) }));
