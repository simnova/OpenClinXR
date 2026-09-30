/** Read encoded bytes and unique decoded images without changing the candidate. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const file = process.argv[2];
if (!file) throw new Error("usage: ship-ward-budget.ts <candidate.glb>");
const bytes = readFileSync(file);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
const images = doc.getRoot().listTextures().map((texture) => {
  const size = texture.getSize();
  if (!size) throw new Error(`Unknown image size: ${texture.getName()}`);
  return {
    name: texture.getName(),
    encodedBytes: texture.getImage()!.byteLength,
    width: size[0], height: size[1],
    decodedRgbaBytes: size[0] * size[1] * 4,
  };
}).sort((a, b) => b.encodedBytes - a.encodedBytes);
const decodedMiBWithMips = images.reduce((sum, image) => sum + image.decodedRgbaBytes, 0) * 1.33 / 1024 ** 2;
console.log(JSON.stringify({
  file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
  byteCeiling: 200 * 1024 ** 2,
  byteCeilingSource: "tools/openclinxr/evidence/infinigen-empty-shell.ts:WEBXR_GLB_SOFT_CAP_BYTES",
  decodedWardCeilingMiB: 56,
  decodedCeilingSource: "packages/openclinxr/factory-stations/src/room_generate/the-shell-bake-runs-before-the-extract.test.ts",
  decodedMiBWithMips, images,
  meshCount: doc.getRoot().listMeshes().length,
  materiallessPrimitives: doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives()).filter((primitive) => !primitive.getMaterial()).length,
}, null, 2));
