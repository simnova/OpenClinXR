// #180 environment repair: re-stage brown_eye.png (recorded CC0, ledger row
// makehuman-default eyes, git blob bda1b4b0) from the SHIPPED GLB bytes — the same
// texture is embedded in every tracked mpfb GLB's eye baseColorTexture, so no
// network is needed and the bytes are the ledger-verified file.
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = resolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";
const TARGET = resolve(
  REPO_ROOT,
  ".openclinxr-local/provider-cache/eyes/makehuman-default/brown_eye.png",
);

const io = new NodeIO();
const doc = await io.read(join(REPO_ROOT, GENERATED, "mpfb-ob-patient-aisha.glb"));

let found = null;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (!mat) continue;
    const tex = mat.getBaseColorTexture();
    const bytes = tex?.getImage();
    if (!bytes) continue;
    found = { name: tex.getName() ?? "?", bytes, mime: tex.getMimeType() ?? "?" };
  }
}

if (!found) {
  console.error("no texture found on aisha eye material");
  process.exit(1);
}
const hash = createHash("sha256").update(found.bytes).digest("hex");
console.log(`extracted ${found.name} mime=${found.mime} bytes=${found.bytes.length} sha256=${hash}`);
mkdirSync(resolve(TARGET, ".."), { recursive: true });
writeFileSync(TARGET, found.bytes);
console.log(`staged -> ${TARGET}`);
