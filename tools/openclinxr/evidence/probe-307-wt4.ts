import { NodeIO } from "@gltf-transform/core";
async function main() {
  const io = new NodeIO();
  const doc = await io.read("apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb");
  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) {
    const prim = mesh.listPrimitives()[0];
    const P = prim.getAttribute("POSITION");
    if (!P) continue;
    let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
    const el: number[] = [];
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, el);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], el[k]); max[k] = Math.max(max[k], el[k]); }
    }
    const size = [max[0]-min[0], max[1]-min[1], max[2]-min[2]];
    console.log(mesh.getName().slice(0,50).padEnd(52), "size", size.map(v=>v.toFixed(3)).join(","), "min", min.map(v=>v.toFixed(3)).join(","));
  }
}
main();
