/**
 * issue-341 round 6 — world-frame triangle dump (part 1 of the residual probe).
 *
 * Loads a shipped MPFB GLB with the SANCTIONED instrument (NodeIO + node world
 * matrices, the exact frame model-vetting-glb-grade-capture.ts uses) and dumps
 * per-layer WORLD-space triangles to JSON so the Python half
 * (.openclinxr/evidence/issue-341/probe_residuals.py) can run the PROVEN ray
 * intersector (garment_coverage._ray_tri_hits) in a body-relative frame.
 *
 * Layer classification mirrors figure-occlusion-gate.py classify().
 */
import { writeFile } from "node:fs/promises";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";

type Tri = [number, number, number, number, number, number, number, number, number];

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function classify(meshName: string, material: string): string {
  const n = meshName.toLowerCase();
  const m = material.toLowerCase();
  if (n.includes("eye") && (n.includes("low_poly") || n.includes("cornea") || n.includes("iris") || n.includes("sclera"))) return "eyes";
  if (m.includes("scalp_hair")) return "scalp";
  if (m.includes("hidden")) return "hidden";
  if (n.includes("boot") || n.includes("shoe") || n.includes("footwear")) return "boots";
  if (n.includes("t_shirt") || n.includes("tshirt") || n.includes("shirt")) return "tshirt";
  if (n.includes("pants") || n.includes("trouser")) return "pants";
  if (n.includes("hair")) return "hair";
  if (m.includes("skin")) return "skin";
  return "other";
}

const R = (v: number) => Math.round(v * 10000) / 10000;

async function main() {
  const glbPath = process.argv[2];
  const outPath = process.argv[3];
  if (!glbPath || !outPath) throw new Error("usage: issue-341-dump-tris.ts <glb> <out.json>");
  const doc = await new NodeIO().read(glbPath);
  const layers: Record<string, Tri[]> = {};
  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      const mName = mesh.getName();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        const idx = prim.getIndices();
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const matName = prim.getMaterial()?.getName() ?? "";
        const key = classify(mName, matName);
        const tris = layers[key] ?? (layers[key] = []);
        const count = pos.getCount();
        const pts: [number, number, number][] = [];
        for (let i = 0; i < count; i += 1) {
          const [x, y, z] = transformPoint(Number(arr[i * 3]), Number(arr[i * 3 + 1]), Number(arr[i * 3 + 2]), world);
          pts.push([R(x), R(y), R(z)]);
        }
        if (idx) {
          const ia = idx.getArray();
          if (!ia) continue;
          for (let i = 0; i + 2 < ia.length; i += 3) {
            const a = pts[ia[i]]!;
            const b = pts[ia[i + 1]]!;
            const c = pts[ia[i + 2]]!;
            tris.push([...a, ...b, ...c] as Tri);
          }
        } else {
          for (let i = 0; i + 2 < count; i += 3) {
            tris.push([...pts[i]!, ...pts[i + 1]!, ...pts[i + 2]!] as Tri);
          }
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) visit(root);
  }
  const summary: Record<string, number> = {};
  for (const [k, v] of Object.entries(layers)) summary[k] = v.length;
  await writeFile(outPath, JSON.stringify({ glb: glbPath, layers, summary }));
  console.log(`WROTE ${outPath} ${JSON.stringify(summary)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
