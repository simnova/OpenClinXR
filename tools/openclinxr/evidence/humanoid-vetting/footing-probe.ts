import { NodeIO } from "@gltf-transform/core";

/**
 * HB-04 footing probe (HB-01 method): per-primitive world minY via node world
 * matrices; footwear mesh minimum vs global minimum. Prints one JSON line:
 * { globalMinY, footwearMinY, globalIsFootwear }.
 *
 * Usage: tsx tools/openclinxr/evidence/humanoid-vetting/footing-probe.ts <glbPath>
 */
const file = process.argv[2];
if (file === undefined || file === "") {
  console.error("usage: footing-probe.ts <glbPath>");
  process.exit(2);
}

const doc = await new NodeIO().read(file);
const root = doc.getRoot();
type SceneNode = ReturnType<typeof root.listNodes>[number];

function findParent(child: SceneNode): SceneNode | null {
  for (const node of root.listNodes()) {
    const kids = node.listChildren() as unknown[];
    if (kids.includes(child)) return node;
  }
  return null;
}

function multiply(a: number[], b: number[]): number[] {
  const out: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        const av = a[k * 4 + row] ?? 0;
        const bv = b[col * 4 + k] ?? 0;
        sum += av * bv;
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function worldMatrix(node: SceneNode): number[] {
  const local = [...node.getMatrix()];
  const parent = findParent(node);
  if (parent === null) return local;
  return multiply(worldMatrix(parent), local);
}

function applyY(m: number[], x: number, y: number, z: number): number {
  const m1 = m[1] ?? 0;
  const m5 = m[5] ?? 0;
  const m9 = m[9] ?? 0;
  const m13 = m[13] ?? 0;
  return m1 * x + m5 * y + m9 * z + m13;
}

const isFootwear = (name: string): boolean => /footwear|shoe|boot|slipper/i.test(name);

let globalMinY = Infinity;
let footwearMinY = Infinity;
let bestIsFootwear = false;

for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (mesh === null) continue;
  const world = worldMatrix(node);
  const meshName = mesh.getName();
  const foot = isFootwear(meshName) || isFootwear(node.getName());
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const arr = pos === null ? null : pos.getArray();
    if (arr === null || arr === undefined) continue;
    let primMin = Infinity;
    for (let i = 1; i < arr.length; i += 3) {
      const x = Number(arr[i - 1]);
      const y = Number(arr[i]);
      const z = Number(arr[i + 1]);
      const wy = applyY(world, x, y, z);
      if (wy < primMin) primMin = wy;
    }
    if (foot && primMin < footwearMinY) footwearMinY = primMin;
    if (primMin < globalMinY) {
      globalMinY = primMin;
      bestIsFootwear = foot;
    }
  }
}

const globalIsFootwear = bestIsFootwear && Math.abs(globalMinY - footwearMinY) < 1e-6;
console.log(JSON.stringify({ globalMinY, footwearMinY, globalIsFootwear }));
