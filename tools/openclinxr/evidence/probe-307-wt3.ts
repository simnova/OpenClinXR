import { NodeIO } from "@gltf-transform/core";
async function main() {
  const io = new NodeIO();
  const doc = await io.read("apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb");
  const root = doc.getRoot();
  const arm = root.listNodes().find((n) => n.getName() === "hm08_basemesh_adult_lean_female.rig");
  if (arm) {
    const t = arm.getTranslation(), r = arm.getRotation(), s = arm.getScale();
    console.log("armature node TRS:", t.map(v=>v.toFixed(4)).join(","), "| rot", r.map(v=>v.toFixed(3)).join(","), "| scale", s.map(v=>v.toFixed(4)).join(","));
    console.log("armature world:", arm.getWorldTranslation().map(v=>v.toFixed(4)).join(","));
  }
  // mesh bounds
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
    console.log("mesh", mesh.getName(), "bounds min", min.map(v=>v.toFixed(3)).join(","), "max", max.map(v=>v.toFixed(3)).join(","));
    break;
  }
}
main();
