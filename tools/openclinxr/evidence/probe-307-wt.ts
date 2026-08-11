import { NodeIO } from "@gltf-transform/core";
async function main() {
  const io = new NodeIO();
  const doc = await io.read("apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb");
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  console.log("joint count:", joints.length);
  for (const name of ["mixamorig:Root", "mixamorig:Hips", "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand", "mixamorig:Head"]) {
    const j = joints.find((x) => x.getName() === name);
    if (!j) { console.log(name, "MISSING"); continue; }
    const w = j.getWorldTranslation();
    const t = j.getTranslation();
    const parent = j.listParents()[0];
    console.log(name.padEnd(24), "world:", w.map(v=>v.toFixed(4)).join(","), "local:", t.map(v=>v.toFixed(4)).join(","), "parent:", parent?.getName() ?? "—");
  }
}
main();
