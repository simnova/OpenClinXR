/**
 * Vertex-to-body point-triangle standoff (mm). Same instrument as
 * a-fitted-lower-keeps-its-own-standoff-spread.test.ts (0.05 m hash, identity
 * nodes). A snapped shell sits in a sub-millimetre band at CLOTH_STANDOFF_M;
 * a ClothesService fit keeps drape spread. Decimation does not invent a 15 mm
 * constant-offset band.
 */
import { NodeIO } from "@gltf-transform/core";

export type TriMesh = { verts: Float64Array; tris: number[] };

export async function readNamedMesh(glbPath: string, match: RegExp): Promise<TriMesh> {
  const doc = await new NodeIO().read(glbPath);
  const verts: number[] = [];
  const tris: number[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!match.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const base = verts.length / 3;
      const el: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        const [x, y, z] = pos.getElement(i, el);
        verts.push(x ?? 0, y ?? 0, z ?? 0);
      }
      const idx = prim.getIndices();
      if (idx) {
        const arr = idx.getArray();
        if (arr) for (let i = 0; i < arr.length; i += 1) tris.push(base + Number(arr[i]));
      } else {
        for (let i = 0; i < pos.getCount(); i += 1) tris.push(base + i);
      }
    }
  }
  return { verts: new Float64Array(verts), tris };
}

function pointTri(
  p: readonly number[],
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = p[0] - b[0];
  const bpy = p[1] - b[1];
  const bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + abz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(apx - abx * v, apy - aby * v, apz - abz * v);
  }
  const cpx = p[0] - c[0];
  const cpy = p[1] - c[1];
  const cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(apx - acx * w, apy - acy * w, apz - acz * w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return Math.hypot(bpx + (abx - acx) * w, bpy + (aby - acy) * w, bpz + (abz - acz) * w);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return Math.hypot(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

export function standoffMm(body: TriMesh, garment: TriMesh): number[] {
  const cell = 0.05;
  const grid = new Map<string, number[]>();
  const bv = body.verts;
  const bt = body.tris;
  for (let t = 0; t < bt.length; t += 3) {
    const ia = bt[t];
    const ib = bt[t + 1];
    const ic = bt[t + 2];
    if (ia === undefined || ib === undefined || ic === undefined) continue;
    const ax = bv[ia * 3];
    const ay = bv[ia * 3 + 1];
    const az = bv[ia * 3 + 2];
    const bx = bv[ib * 3];
    const by = bv[ib * 3 + 1];
    const bz = bv[ib * 3 + 2];
    const cx = bv[ic * 3];
    const cy = bv[ic * 3 + 1];
    const cz = bv[ic * 3 + 2];
    if (
      ax === undefined ||
      ay === undefined ||
      az === undefined ||
      bx === undefined ||
      by === undefined ||
      bz === undefined ||
      cx === undefined ||
      cy === undefined ||
      cz === undefined
    ) {
      continue;
    }
    const lox = Math.min(ax, bx, cx);
    const loy = Math.min(ay, by, cy);
    const loz = Math.min(az, bz, cz);
    const hix = Math.max(ax, bx, cx);
    const hiy = Math.max(ay, by, cy);
    const hiz = Math.max(az, bz, cz);
    for (let ix = Math.floor(lox / cell); ix <= Math.floor(hix / cell); ix += 1) {
      for (let iy = Math.floor(loy / cell); iy <= Math.floor(hiy / cell); iy += 1) {
        for (let iz = Math.floor(loz / cell); iz <= Math.floor(hiz / cell); iz += 1) {
          const key = `${ix},${iy},${iz}`;
          let arr = grid.get(key);
          if (!arr) {
            arr = [];
            grid.set(key, arr);
          }
          arr.push(t);
        }
      }
    }
  }
  const gv = garment.verts;
  const n = gv.length / 3;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const px = gv[i * 3];
    const py = gv[i * 3 + 1];
    const pz = gv[i * 3 + 2];
    if (px === undefined || py === undefined || pz === undefined) {
      out[i] = Number.POSITIVE_INFINITY;
      continue;
    }
    const p = [px, py, pz];
    const cellX = Math.floor(px / cell);
    const cellY = Math.floor(py / cell);
    const cellZ = Math.floor(pz / cell);
    let best = Infinity;
    for (let r = 0; r < 40; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dz = -r; dz <= r; dz += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const arr = grid.get(`${cellX + dx},${cellY + dy},${cellZ + dz}`);
            if (!arr) continue;
            for (const t of arr) {
              const ia = bt[t];
              const ib = bt[t + 1];
              const ic = bt[t + 2];
              if (ia === undefined || ib === undefined || ic === undefined) continue;
              const axv = bv[ia * 3];
              const ayv = bv[ia * 3 + 1];
              const azv = bv[ia * 3 + 2];
              const bxv = bv[ib * 3];
              const byv = bv[ib * 3 + 1];
              const bzv = bv[ib * 3 + 2];
              const cxv = bv[ic * 3];
              const cyv = bv[ic * 3 + 1];
              const czv = bv[ic * 3 + 2];
              if (
                axv === undefined ||
                ayv === undefined ||
                azv === undefined ||
                bxv === undefined ||
                byv === undefined ||
                bzv === undefined ||
                cxv === undefined ||
                cyv === undefined ||
                czv === undefined
              ) {
                continue;
              }
              const d = pointTri(p, [axv, ayv, azv], [bxv, byv, bzv], [cxv, cyv, czv]);
              if (d < best) best = d;
            }
          }
        }
      }
      if (best <= r * cell) break;
    }
    out[i] = best * 1000;
  }
  return out.sort((a, b) => a - b);
}

export function quantile(ds: number[], f: number): number {
  const i = Math.floor(f * (ds.length - 1));
  const v = ds[i];
  return v === undefined ? 0 : v;
}

export function standoffSpreadMm(ds: number[]): { p5: number; p95: number; spread: number; n: number } {
  const p5 = quantile(ds, 0.05);
  const p95 = quantile(ds, 0.95);
  return { n: ds.length, p5, p95, spread: p95 - p5 };
}
