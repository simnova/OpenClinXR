/**
 * #686 — debug: does the recomputed vertex normal capture the analytic fold tilt?
 * Apply a fold to the gown's bodice vertices, recompute normals, and compare the tilt
 * of each recomputed normal from its base (pre-fold) normal against the analytic
 * tilt = atan(A*k*sin(k*theta)/r).
 */
import { NodeIO } from "@gltf-transform/core";

const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;
const TRUNK_X_MAX = 0.22;
const A = 0.026;
const K = 8;
const CX = 0.0024;
const CZ = 0.0358;

async function main() {
  const doc = await new NodeIO().read("apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
  let prims: { pos: Float32Array; nrm: Float32Array; idx: number[] }[] = [];
  let body: number[][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isGown = GOWN.test(name);
      const isBody = !isGown && BODY.test(name);
      if (!isGown && !isBody) continue;
      const pos = prim.getAttribute("POSITION");
      const nrm = prim.getAttribute("NORMAL");
      if (!pos || !nrm) continue;
      const n = pos.getCount();
      const pa = new Float32Array(n * 3);
      const na = new Float32Array(n * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, v);
        pa.set(v, i * 3);
        nrm.getElement(i, v);
        na.set(v, i * 3);
      }
      if (isGown) {
        const idx: number[] = [];
        const ia = prim.getIndices();
        const tmp: number[] = [];
        if (ia) { for (let i = 0; i < ia.getCount(); i++) { ia.getElement(i, tmp); idx.push(tmp[0]!); } }
        else { for (let i = 0; i < n; i++) idx.push(i); }
        prims.push({ pos: pa, nrm: na, idx });
      } else {
        for (let i = 0; i < n; i++) body.push([pa[i * 3]!, pa[i * 3 + 1]!, pa[i * 3 + 2]!]);
      }
    }
  }
  const ys = body.map((v) => v[1]!);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;

  const pos2 = prims.map((gp) => new Float32Array(gp.pos));
  const baseN = prims.map((gp) => new Float32Array(gp.nrm));
  for (let pi = 0; pi < prims.length; pi++) {
    const gp = prims[pi]!;
    const P = pos2[pi]!;
    const nv = gp.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      const x = P[i * 3]!, y = P[i * 3 + 1]!, z = P[i * 3 + 2]!;
      const f = (y - floorY) / height;
      if (f <= 0.55 || f >= 0.86) continue;
      const wx = 1 - smoothstep(0.15, 0.26, Math.abs(x));
      if (wx <= 0.001) continue;
      const rx = x - CX;
      const rz = z - CZ;
      const rr = Math.hypot(rx, rz) || 1e-9;
      const theta = Math.atan2(rz, rx);
      const d = A * wx * Math.cos(K * theta);
      P[i * 3] = x + (rx / rr) * d;
      P[i * 3 + 2] = z + (rz / rr) * d;
    }
  }
  // recompute vertex normals
  const newN: Float32Array[] = [];
  for (let pi = 0; pi < prims.length; pi++) {
    const gp = prims[pi]!;
    const P = pos2[pi]!;
    const nv = gp.pos.length / 3;
    const acc = new Float32Array(nv * 3);
    for (let t = 0; t + 2 < gp.idx.length; t += 3) {
      const i0 = gp.idx[t]!, i1 = gp.idx[t + 1]!, i2 = gp.idx[t + 2]!;
      const ax = P[i0 * 3]!, ay = P[i0 * 3 + 1]!, az = P[i0 * 3 + 2]!;
      const bx = P[i1 * 3]!, by = P[i1 * 3 + 1]!, bz = P[i1 * 3 + 2]!;
      const cxx = P[i2 * 3]!, cy = P[i2 * 3 + 1]!, czz = P[i2 * 3 + 2]!;
      let fnx = (by - ay) * (czz - az) - (bz - az) * (cy - ay);
      let fny = (bz - az) * (cxx - ax) - (bx - ax) * (czz - az);
      let fnz = (bx - ax) * (cy - ay) - (by - ay) * (cxx - ax);
      const fnl = Math.hypot(fnx, fny, fnz) || 1e-9;
      fnx /= fnl; fny /= fnl; fnz /= fnl;
      const wa = angleAt(ax, ay, az, bx, by, bz, cxx, cy, czz);
      const wb = angleAt(bx, by, bz, cxx, cy, czz, ax, ay, az);
      const wc = angleAt(cxx, cy, czz, ax, ay, az, bx, by, bz);
      acc[i0 * 3] += fnx * wa; acc[i0 * 3 + 1] += fny * wa; acc[i0 * 3 + 2] += fnz * wa;
      acc[i1 * 3] += fnx * wb; acc[i1 * 3 + 1] += fny * wb; acc[i1 * 3 + 2] += fnz * wb;
      acc[i2 * 3] += fnx * wc; acc[i2 * 3 + 1] += fny * wc; acc[i2 * 3 + 2] += fnz * wc;
    }
    const nn = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]);
      nn[i * 3] = acc[i * 3]! / (l || 1e-9);
      nn[i * 3 + 1] = acc[i * 3 + 1]! / (l || 1e-9);
      nn[i * 3 + 2] = acc[i * 3 + 2]! / (l || 1e-9);
    }
    newN.push(nn);
  }
  // compare: for trunk bodice verts, recomputed tilt vs analytic tilt
  let printed = 0;
  const errs: number[] = [];
  for (let pi = 0; pi < prims.length; pi++) {
    const gp = prims[pi]!;
    const P = pos2[pi]!;
    const B = baseN[pi]!;
    const N = newN[pi]!;
    const nv = gp.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      const y = P[i * 3 + 1]!;
      const f = (y - floorY) / height;
      if (f < 0.66 || f >= 0.72) continue;
      const x = P[i * 3]!;
      if (Math.abs(x) >= TRUNK_X_MAX) continue;
      const rx = x - CX;
      const rz = P[i * 3 + 2]! - CZ;
      const rr = Math.hypot(rx, rz) || 1e-9;
      const theta = Math.atan2(rz, rx);
      const analyticTilt = Math.atan((A * K * Math.abs(Math.sin(K * theta))) / rr) * 180 / Math.PI;
      // recomputed tilt = angle between new normal and base normal
      const d = Math.max(-1, Math.min(1, (N[i * 3]! * B[i * 3]! + N[i * 3 + 1]! * B[i * 3 + 1]! + N[i * 3 + 2]! * B[i * 3 + 2]!)));
      const recTilt = Math.acos(d) * 180 / Math.PI;
      errs.push(recTilt - analyticTilt);
      if (printed < 12) {
        console.log(`theta=${(theta * 180 / Math.PI).toFixed(0)}° analytic=${analyticTilt.toFixed(1)}° recomputed=${recTilt.toFixed(1)}°`);
        printed++;
      }
    }
  }
  const sorted = [...errs].sort((a, b) => a - b);
  console.log(`\nrecomputed-analytic error: n=${errs.length} p10=${sorted[Math.floor(errs.length * 0.1)]?.toFixed(1)} p50=${sorted[Math.floor(errs.length * 0.5)]?.toFixed(1)} p90=${sorted[Math.floor(errs.length * 0.9)]?.toFixed(1)}`);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function angleAt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cxx: number, cy: number, czz: number): number {
  const ux = ax - bx, uy = ay - by, uz = az - bz;
  const vx = ax - cxx, vy = ay - cy, vz = az - czz;
  const ul = Math.hypot(ux, uy, uz) || 1e-9;
  const vl = Math.hypot(vx, vy, vz) || 1e-9;
  const c = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (ul * vl)));
  return Math.acos(c);
}

main().catch((e) => { console.error(e); process.exit(1); });
