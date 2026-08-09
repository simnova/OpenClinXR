// #247 offline GLB inspection: bind-pose facts for the three ED-stroke cast assets.
// Node script (not a product edit) — prints mesh structure, lowest vertex, bind matrices.
import { NodeIO } from "@gltf-transform/core";
import { readFileSync } from "node:fs";

const io = new NodeIO();
const files = process.argv.slice(2);
for (const file of files) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  console.log(`\n=== ${file} ===`);
  console.log(`meshes: ${meshes.length}, nodes: ${root.listNodes().length}, skins: ${root.listSkins().length}, bones: ${root.listNodes().filter(n => n.getSkin() || n.getName().includes('_')).length}`);
  const skins = root.listSkins();
  for (const skin of skins) {
    console.log(`skin "${skin.getName()}" joints=${skin.listJoints().length}`);
    const ibm = skin.getInverseBindMatrices();
    if (ibm) {
      const arr = ibm.getArray();
      // Print joint 0 inverse bind matrix translation
      if (arr) {
        console.log(`  IBM[0] translation = ${arr[12].toFixed(4)}, ${arr[13].toFixed(4)}, ${arr[14].toFixed(4)}`);
      }
    }
  }
  for (const mesh of meshes) {
    const prims = mesh.listPrimitives();
    for (const prim of prims) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const count = pos.getCount();
      let minY = Infinity, minX = Infinity, minZ = Infinity, maxY = -Infinity, maxX = -Infinity, maxZ = -Infinity;
      let minYIdx = -1;
      for (let i = 0; i < count; i++) {
        const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
        if (y < minY) { minY = y; minYIdx = i; }
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const minPos = minYIdx >= 0 ? `(${arr[minYIdx*3].toFixed(3)}, ${arr[minYIdx*3+1].toFixed(3)}, ${arr[minYIdx*3+2].toFixed(3)})` : "";
      console.log(`  prim "${prim.getName() || mesh.getName()}" tris=${(prim.getIndices()?.getCount() ?? 0) / 3} verts=${count} localAABB x[${minX.toFixed(3)},${maxX.toFixed(3)}] y[${minY.toFixed(3)},${maxY.toFixed(3)}] z[${minZ.toFixed(3)},${maxZ.toFixed(3)}] minYIdx=${minYIdx} @${minPos}`);
    }
  }
  // Node hierarchy with translations
  const printNode = (n, depth, seen) => {
    if (seen.has(n)) return;
    seen.add(n);
    const t = n.getTranslation();
    const s = n.getScale();
    const skin = n.getSkin();
    const mesh = n.getMesh();
    console.log(`${"  ".repeat(depth)}node "${n.getName()}" t=(${t[0].toFixed(3)},${t[1].toFixed(3)},${t[2].toFixed(3)}) s=(${s[0].toFixed(3)},${s[1].toFixed(3)},${s[2].toFixed(3)})${skin ? " SKIN" : ""}${mesh ? " MESH" : ""}`);
    for (const child of n.listChildren()) printNode(child, depth + 1, seen);
  };
  for (const n of root.listNodes()) {
    if (n.listParents().length === 0) printNode(n, 0, new Set());
  }
}
