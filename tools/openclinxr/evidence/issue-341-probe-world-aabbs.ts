/**
 * issue-341 round 6 — residual-defect probe (text-only worker, geometry measurement).
 *
 * Uses the SAME world frame as the sanctioned instrument
 * (model-vetting-glb-grade-capture.ts probeSceneGraphMeshAabb: node world matrices
 * applied to POSITION via @gltf-transform/core). trimesh (the occlusion gate's
 * loader) does NOT apply skinned-mesh node transforms, so its z-bands are not
 * body-relative — this probe fixes the frame and then asks, per body-relative
 * height band, three questions with the PROVEN ray intersector semantics:
 *
 *   1. SKIN-EXPOSURE by band: which skin triangles have NO garment triangle in
 *      front along +Z (the viewer). Bands are body-relative fractions of the
 *      body's own world z-extent.
 *   2. HIDDEN-SLIVER at shoulder/elbow: hidden-material (alpha-0, discarded)
 *      body triangles with no garment surface in front — discarded faces leave
 *      a hole through which the dark background reads as "dark slivers".
 *   3. SHELL-HEM: the lower cover-shell's bottom-ring z-spread (jaggedness) and
 *      the ring's triangle count.
 *
 * Ray intersector: garment_coverage._ray_tri_hits is Python — this probe reuses
 * the same hit-order semantics via a numpy port in Python would be ideal; here we
 * call the python probe AFTER normalising the frame. Simpler: this script only
 * emits per-mesh WORLD AABBs; probe_residuals.py is updated to consume them.
 */
import { readFile, writeFile } from "node:fs/promises";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import path from "node:path";

type Aabb = { min: [number, number, number]; max: [number, number, number] };

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function meshWorldAabbs(doc: Document): Map<string, Aabb> {
  const out = new Map<string, Aabb>();
  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const aabb: Aabb = {
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
        };
        for (let i = 0; i + 2 < arr.length; i += 3) {
          const [x, y, z] = transformPoint(Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2]), world);
          aabb.min[0] = Math.min(aabb.min[0], x);
          aabb.min[1] = Math.min(aabb.min[1], y);
          aabb.min[2] = Math.min(aabb.min[2], z);
          aabb.max[0] = Math.max(aabb.max[0], x);
          aabb.max[1] = Math.max(aabb.max[1], y);
          aabb.max[2] = Math.max(aabb.max[2], z);
        }
        const key = `${mesh.getName()}::${prim.getMaterial()?.getName() ?? ""}`;
        out.set(key, aabb);
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) visit(root);
  }
  return out;
}

async function main() {
  const glbPath = process.argv[2];
  if (!glbPath) throw new Error("usage: probe_world_aabbs.ts <glb>");
  const doc = await new NodeIO().read(glbPath);
  const aabbs = meshWorldAabbs(doc);
  const rows: Record<string, Aabb> = {};
  for (const [key, aabb] of aabbs) rows[key] = aabb;
  const outPath = process.argv[3];
  if (outPath) {
    await writeFile(outPath, JSON.stringify({ glb: glbPath, meshes: rows }, null, 2));
    console.log(`WROTE ${outPath}`);
  } else {
    console.log(JSON.stringify({ glb: glbPath, meshes: rows }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
