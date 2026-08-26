/**
 * #686 — inventory the shipped gown asset's meshes/materials/primitives and their
 * vertex counts, so the body surface (skin vs hidden regions) is understood.
 */
import { NodeIO } from "@gltf-transform/core";

async function main() {
  const doc = await new NodeIO().read("apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()?.getName() ?? "(none)";
      const pos = prim.getAttribute("POSITION");
      const nrm = prim.getAttribute("NORMAL");
      console.log(`${mesh.getName().padEnd(60)} mat=${mat.padEnd(50)} verts=${pos?.getCount()} nrm=${nrm ? "yes" : "no"}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
