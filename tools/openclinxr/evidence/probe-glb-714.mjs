import { NodeIO } from "@gltf-transform/core";
const io = new NodeIO();
for (const p of process.argv.slice(2)) {
  try {
    const doc = await io.read(p);
    let gown = 0, skin = 0, skinMat = "", bodyYmin = 1e9, bodyYmax = -1e9;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial()?.getName() ?? "";
        const pos = prim.getAttribute("POSITION")?.getArray();
        if (!pos) continue;
        const tris = (prim.getIndices()?.getArray()?.length ?? 0) / 3;
        if (mesh.getName().startsWith("openclinxr_real_garment_peds_upper_v1")) gown += tris;
        if (mat.includes("mpfb_skin")) { skin += tris; skinMat = mat; }
      }
    }
    console.log(`${p}: gownTris=${gown} skinTris=${skin} skinMat=${skinMat}`);
  } catch (e) { console.log(`${p}: ERR ${String(e).slice(0,120)}`); }
}
