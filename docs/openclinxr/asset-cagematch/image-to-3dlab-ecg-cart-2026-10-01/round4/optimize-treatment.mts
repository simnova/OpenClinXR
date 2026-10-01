import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, textureCompress, TextureResizeFilter } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

function option(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0 || at + 1 >= process.argv.length) throw new Error(`missing --${name}`);
  return process.argv[at + 1];
}

const input = option("input");
const output = option("output");
const reportPath = option("report");
const uvWeight = Number(option("uv-weight"));
const textureSize = Number(option("texture-size"));
const targetTriangles = Number(option("target-triangles"));
assert.ok(Number.isFinite(uvWeight) && uvWeight > 0);
assert.ok([512, 1024].includes(textureSize));
assert.equal(targetTriangles, 40_000);

const started = performance.now();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
await MeshoptSimplifier.ready;
const primitives = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
assert.equal(primitives.length, 1, "bounded ECG-cart treatment expects one primitive");
const primitive = primitives[0];
const position = primitive.getAttribute("POSITION");
const normal = primitive.getAttribute("NORMAL");
const uv = primitive.getAttribute("TEXCOORD_0");
const indexAccessor = primitive.getIndices();
assert.ok(position && normal && uv && indexAccessor);

const positions = new Float32Array(position.getCount() * 3);
const attributes = new Float32Array(position.getCount() * 5);
for (let index = 0; index < position.getCount(); index += 1) {
  positions.set(position.getElement(index, []), index * 3);
  attributes.set([...normal.getElement(index, []), ...uv.getElement(index, [])], index * 5);
}
const inputIndices = new Uint32Array(indexAccessor.getArray());
const [simplifiedIndices, reportedError] = MeshoptSimplifier.simplifyWithAttributes(
  inputIndices,
  positions,
  3,
  attributes,
  5,
  [1, 1, 1, uvWeight, uvWeight],
  null,
  targetTriangles * 3,
  1,
  ["Permissive"],
);
assert.ok(simplifiedIndices.length / 3 <= targetTriangles);
primitive.getIndices()?.setArray(simplifiedIndices);
const [remap, vertexCount] = MeshoptSimplifier.compactMesh(simplifiedIndices);
const missing = 2 ** 32 - 1;
for (const semantic of primitive.listSemantics()) {
  const accessor = primitive.getAttribute(semantic);
  assert.ok(accessor);
  const oldArray = accessor.getArray();
  assert.ok(oldArray);
  const width = accessor.getElementSize();
  const ArrayType = oldArray.constructor as new (length: number) => typeof oldArray;
  const nextArray = new ArrayType(vertexCount * width);
  for (let oldIndex = 0; oldIndex < remap.length; oldIndex += 1) {
    const newIndex = remap[oldIndex];
    if (newIndex === missing) continue;
    nextArray.set(oldArray.subarray(oldIndex * width, (oldIndex + 1) * width), newIndex * width);
  }
  accessor.setArray(nextArray);
}
await doc.transform(
  prune(),
  textureCompress({
    targetFormat: "webp",
    resize: [textureSize, textureSize],
    resizeFilter: TextureResizeFilter.LANCZOS3,
  }),
);
await io.write(output, doc);

const texturePixels = doc.getRoot().listTextures().map((texture) => texture.getSize());
const decodedTextureBytes = texturePixels.reduce(
  (sum, size) => sum + (size?.[0] ?? 0) * (size?.[1] ?? 0) * 4,
  0,
);
const outputBytes = await readFile(output);
const report = {
  method: "meshoptimizer simplifyWithAttributes",
  diagnosis: "Round-3 corruption is introduced by Permissive UV-seam relaxation, not raw geometry or raw texture generation",
  input,
  output,
  inputTriangles: inputIndices.length / 3,
  targetTriangles,
  triangles: simplifiedIndices.length / 3,
  vertices: vertexCount,
  flags: ["Permissive"],
  targetError: 1,
  reportedError,
  attributeWeights: { normal: [1, 1, 1], uv: [uvWeight, uvWeight] },
  textureResize: { width: textureSize, height: textureSize, filter: "Lanczos3", format: "WebP" },
  decodedTextureBytes,
  decodedTextureMiB: decodedTextureBytes / 1024 / 1024,
  outputBytes: outputBytes.byteLength,
  outputSha256: createHash("sha256").update(outputBytes).digest("hex"),
  wallSeconds: (performance.now() - started) / 1000,
  materialChanges: false,
  claimScope: "one ECG-cart optimizer treatment under the round-4 common budget",
  notEvidenceFor: ["Quest readiness", "clinical accuracy", "runtime adoption"],
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
