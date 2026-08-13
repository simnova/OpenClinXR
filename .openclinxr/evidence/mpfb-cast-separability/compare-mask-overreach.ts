// Replicate mpfb2-lower-garment-and-mask-footprint.test.ts's overreach measurement
// against BOTH the HEAD (pre-change) aisha GLB and the re-baked one, to decide
// whether the clause (2) red is pre-existing or introduced by this slice.
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

const io = new NodeIO();
const UPPER = /shirt|top|tshirt|toigo/i;
const LOWER = /pants|trouser|cargo/i;
const HIDDEN = /hidden/i;
const FOOTWEAR = /footwear|shoe|boot|flat/i;
const MAX_OVERREACH_M = 0.002;

async function measure(path: string) {
  const doc = await io.read(path);
  let upper = null, lower = null;
  const masks = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const name = prim.getMaterial()?.getName() ?? "";
      const box = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], verts: 0 };
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        for (let a = 0; a < 3; a++) {
          if (el[a] < box.min[a]) box.min[a] = el[a];
          if (el[a] > box.max[a]) box.max[a] = el[a];
        }
      }
      box.verts = pos.getCount();
      if (HIDDEN.test(name)) masks.push({ name, box });
      else if (LOWER.test(name)) lower = { name, box };
      else if (UPPER.test(name)) upper = { name, box };
    }
  }
  const garments = [upper, lower].filter(Boolean);
  const gmin = [0, 1, 2].map((a) => Math.min(...garments.map((g) => g.box.min[a])));
  const gmax = [0, 1, 2].map((a) => Math.max(...garments.map((g) => g.box.max[a])));
  const detail = [];
  for (const m of masks) {
    for (let a = 0; a < 3; a++) {
      for (const [label, v] of [["min", gmin[a] - m.box.min[a]], ["max", m.box.max[a] - gmax[a]]]) {
        if (v > MAX_OVERREACH_M) detail.push(`${m.name} axis${a} ${label}: ${(v * 1000).toFixed(1)}mm`);
      }
    }
  }
  return { upper: upper?.name, lower: lower?.name, maskCount: masks.length, detail };
}

const oldP = "/tmp/aisha-old.glb";
readFileSync(oldP); // ensure present
const oldR = await measure(oldP);
const newR = await measure("apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb");
console.log("OLD (HEAD):", JSON.stringify(oldR, null, 1));
console.log("NEW (rebaked):", JSON.stringify(newR, null, 1));
