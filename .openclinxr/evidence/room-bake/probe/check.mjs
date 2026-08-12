import { NodeIO } from "@gltf-transform/core";
const io = new NodeIO();
const doc = await io.read(".openclinxr/evidence/room-bake/probe/probe-out.glb");
const root = doc.getRoot();
let tris = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
console.log(`probe-out.glb: tris=${tris} materials=${root.listMaterials().length} textures=${root.listTextures().length}`);
for (const m of root.listMaterials()) {
  const t = m.getBaseColorTexture();
  console.log(`  mat "${m.getName()}" tex=${t ? t.getName() + " bytes=" + (t.getImage()?.byteLength ?? 0) : "NONE"}`);
}
