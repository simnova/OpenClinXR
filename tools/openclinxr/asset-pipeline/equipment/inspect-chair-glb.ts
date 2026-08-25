/**
 * Inspect Kenney furniture GLBs: AABB, triangle count, and horizontal-surface
 * distribution (to detect the SEAT plane, not the AABB maximum).
 *
 * Usage: pnpm exec tsx tools/openclinxr/asset-pipeline/equipment/inspect-chair-glb.ts chair.glb chairDesk.glb
 */
import { NodeIO } from "@gltf-transform/core";
import { join } from "node:path";

const KIT = join(process.cwd(), ".openclinxr/staging/equipment/kenney-furniture-kit/Models/GLTF format");
const io = new NodeIO();

type Mat4 = number[];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[r * 4 + k] * b[k * 4 + c];
    o[r * 4 + c] = v;
  }
  return o;
}

function trs(t: number[], q: number[], s: number[]): Mat4 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  const rot: Mat4 = [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ];
  const rs = rot.map((v, i) => (i % 4 === 3 || i >= 12 ? v : v * s[Math.floor(i / 4)]));
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    o[r * 4 + c] = rs[r * 4 + c] + (c === 3 ? t[r] : 0);
  }
  return o;
}

function apply(m: Mat4, p: number[]): number[] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

async function inspect(file: string): Promise<void> {
  const resolved = file.includes("/") ? file : join(KIT, file);
  const doc = await io.read(resolved);
  const root = doc.getRoot();
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  const horizontalBins = new Map<number, number>();
  const processNode = (node: any, m: Mat4): void => {
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const size = pos.getElementSize();
        const idx = prim.getIndices();
        const idxArr = idx?.getArray() ?? null;
        const n = idxArr ? idxArr.length : arr.length / size;
        const at = (i: number): number[] => {
          const base = idxArr ? idxArr[i] * size : i * size;
          return [arr[base], arr[base + 1], arr[base + 2]];
        };
        for (let i = 0; i + 2 < n; i += 3) {
          const a = apply(m, at(i));
          const b = apply(m, at(i + 1));
          const c = apply(m, at(i + 2));
          for (const p of [a, b, c]) {
            min = [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])];
            max = [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])];
          }
          tris++;
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
          if (len === 0) continue;
          if (Math.abs(nrm[1]) / len > 0.85) {
            const area = 0.5 * len;
            const yCm = Math.round(((a[1] + b[1] + c[1]) / 3) * 100);
            horizontalBins.set(yCm, (horizontalBins.get(yCm) ?? 0) + area);
          }
        }
      }
    }
    for (const child of node.listChildren()) {
      const t = child.getTranslation() ?? [0, 0, 0];
      const q = child.getRotation() ?? [0, 0, 0, 1];
      const s = child.getScale() ?? [1, 1, 1];
      processNode(child, mul(m, trs(t, q, s)));
    }
  };
  for (const scene of root.listScenes()) {
    for (const child of scene.listChildren()) {
      const t = child.getTranslation() ?? [0, 0, 0];
      const q = child.getRotation() ?? [0, 0, 0, 1];
      const s = child.getScale() ?? [1, 1, 1];
      processNode(child, trs(t, q, s));
    }
  }
  const sorted = [...horizontalBins.entries()].sort((x, y2) => y2[1] - x[1]).slice(0, 10);
  console.log(`\n=== ${file} ===`);
  console.log(`AABB min ${min.map((v) => v.toFixed(3)).join(", ")} max ${max.map((v) => v.toFixed(3)).join(", ")}`);
  console.log(`size W ${(max[0] - min[0]).toFixed(3)} H ${(max[1] - min[1]).toFixed(3)} D ${(max[2] - min[2]).toFixed(3)} tris ${tris}`);
  console.log("horizontal (|ny|>0.85) area by y(m):");
  for (const [y, area] of sorted) console.log(`  y=${(y / 100).toFixed(2)}m area=${area.toFixed(4)}`);
}

const files = process.argv.slice(2);
for (const f of files) await inspect(f);
