import { NodeIO } from "@gltf-transform/core";
async function main() {
  const io = new NodeIO();
  const doc = await io.read("apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb");
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const mesh = root.listMeshes().find((m) => m.getName() === "hm08_basemesh_adult_lean_female");
  const prim = mesh.listPrimitives()[0];
  const P = prim.getAttribute("POSITION");
  // sample mesh AABB per bone: verts whose dominant joint is that bone
  const J = prim.getAttribute("JOINTS_0");
  const W = prim.getAttribute("WEIGHTS_0");
  const je: number[] = [], we: number[] = [], el: number[] = [];
  const nameOf = joints.map((j) => j.getName());
  const centroid = new Map<string, [number, number, number]>();
  const counts = new Map<string, number>();
  for (let i = 0; i < J.getCount(); i++) {
    J.getElement(i, je); W.getElement(i, we); P.getElement(i, el);
    let best = 0;
    for (let k = 1; k < 4; k++) if ((we[k] ?? 0) > (we[best] ?? 0)) best = k;
    if ((we[best] ?? 0) <= 0) continue;
    const n = nameOf[je[best]!] ?? "?";
    const c = centroid.get(n) ?? [0, 0, 0];
    c[0] += el[0]; c[1] += el[1]; c[2] += el[2];
    centroid.set(n, c);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const report: Record<string, unknown> = {};
  for (const name of ["mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand", "mixamorig:Head", "mixamorig:Hips", "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot"]) {
    const j = joints.find((x) => x.getName() === name);
    const w = j ? j.getWorldTranslation() : null;
    const c = centroid.get(name);
    const cnt = counts.get(name) ?? 0;
    report[name] = {
      boneWorld: w ? w.map((v) => +v.toFixed(4)) : null,
      meshCentroid: c ? c.map((v) => +v.toFixed(4)) : null,
      dominantVerts: cnt,
      dx: w && c ? +(Math.abs(w[0] - c[0] / cnt)).toFixed(4) : null,
      dy: w && c ? +(Math.abs(w[1] - c[1] / cnt)).toFixed(4) : null,
      dz: w && c ? +(Math.abs(w[2] - c[2] / cnt)).toFixed(4) : null,
    };
  }
  console.log(JSON.stringify(report, null, 2));
}
main();
