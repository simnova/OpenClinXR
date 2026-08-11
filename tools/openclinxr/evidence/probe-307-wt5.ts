import { NodeIO } from "@gltf-transform/core";
async function main() {
  const io = new NodeIO();
  const doc = await io.read("apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb");
  const root = doc.getRoot();
  const nodes = root.listNodes();
  for (const name of ["mixamorig:Root", "mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand", "mixamorig:Neck", "mixamorig:Head", "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot"]) {
    const n = nodes.find((x) => x.getName() === name);
    if (!n) { console.log(name, "MISSING"); continue; }
    const t = n.getTranslation(), r = n.getRotation(), s = n.getScale();
    const kids = n.listChildren().map(c => c.getName());
    console.log(name.padEnd(24), "T", t.map(v=>v.toFixed(4)).join(","), "Q", r.map(v=>v.toFixed(4)).join(","), "S", s.map(v=>v.toFixed(3)).join(","), "kids", kids.slice(0,4).join(","));
  }
}
main();
