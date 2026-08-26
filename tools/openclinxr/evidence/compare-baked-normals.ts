/**
 * #686 — compare the baked asset's STORED normals against angle-weighted recomputed
 * normals under the contract instrument. Determines whether the export's normal
 * computation (not the geometry) explains the 0.893 vs 0.802 gap.
 */
import { NodeIO } from "@gltf-transform/core";

const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;
const SLAB_METRES = 0.01;
const STRIDE = 3;
const BAND: readonly [number, number] = [0.62, 0.82];

type V3 = [number, number, number];
type Vertex = { readonly p: V3; readonly n: V3 };

async function load() {
  const doc = await new NodeIO().read("apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
  let gownPrims: { pos: Float32Array; nrm: Float32Array; idx: number[] }[] = [];
  let body: Vertex[] = [];
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
        gownPrims.push({ pos: pa, nrm: na, idx });
      } else {
        for (let i = 0; i < n; i++) body.push({ p: [pa[i * 3]!, pa[i * 3 + 1]!, pa[i * 3 + 2]!], n: [na[i * 3]!, na[i * 3 + 1]!, na[i * 3 + 2]!] });
      }
    }
  }
  return { gownPrims, body };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
}

function bandMetrics(gown: Vertex[], body: Vertex[], floorY: number, height: number) {
  const inBand = (v: Vertex) => {
    const f = (v.p[1] - floorY) / height;
    return f >= BAND[0] && f < BAND[1];
  };
  const g = gown.filter((_, i) => i % STRIDE === 0).filter(inBand);
  const b = body.filter((_, i) => i % STRIDE === 0);
  const dots: number[] = [];
  for (const v of g) {
    let best = Number.POSITIVE_INFINITY;
    let nearest: Vertex | null = null;
    for (const q of b) {
      if (Math.abs(q.p[1] - v.p[1]) > SLAB_METRES) continue;
      const d = Math.hypot(q.p[0] - v.p[0], q.p[2] - v.p[2]);
      if (d < best) { best = d; nearest = q; }
    }
    if (!Number.isFinite(best) || nearest === null) continue;
    const dot = v.n[0] * nearest.n[0] + v.n[1] * nearest.n[1] + v.n[2] * nearest.n[2];
    const scale = Math.hypot(v.n[0], v.n[1], v.n[2]) * Math.hypot(nearest.n[0], nearest.n[1], nearest.n[2]);
    if (scale > 0) dots.push(dot / scale);
  }
  return { n: dots.length, medianDot: median(dots) };
}

function angleAt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cxx: number, cy: number, czz: number): number {
  const ux = ax - bx, uy = ay - by, uz = az - bz;
  const vx = ax - cxx, vy = ay - cy, vz = az - czz;
  const ul = Math.hypot(ux, uy, uz) || 1e-9;
  const vl = Math.hypot(vx, vy, vz) || 1e-9;
  const c = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (ul * vl)));
  return Math.acos(c);
}

async function main() {
  const { gownPrims, body } = await load();
  const ys = body.map((v) => v.p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;

  // stored normals
  const stored: Vertex[] = [];
  for (const gp of gownPrims) {
    const nv = gp.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      stored.push({ p: [gp.pos[i * 3]!, gp.pos[i * 3 + 1]!, gp.pos[i * 3 + 2]!], n: [gp.nrm[i * 3]!, gp.nrm[i * 3 + 1]!, gp.nrm[i * 3 + 2]!] });
    }
  }
  // angle-weighted recomputed normals
  const recomputed: Vertex[] = [];
  for (const gp of gownPrims) {
    const P = gp.pos;
    const nv = P.length / 3;
    const acc = new Float32Array(nv * 3);
    const idx = gp.idx;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const i0 = idx[t]!, i1 = idx[t + 1]!, i2 = idx[t + 2]!;
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
    for (let i = 0; i < nv; i++) {
      const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]);
      recomputed.push({
        p: [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!],
        n: l > 1e-9 ? [acc[i * 3]! / l, acc[i * 3 + 1]! / l, acc[i * 3 + 2]! / l] : [0, 1, 0],
      });
    }
  }
  const a = bandMetrics(stored, body, floorY, height);
  const bm = bandMetrics(recomputed, body, floorY, height);
  console.log(`stored-normals medianDot:   ${a.medianDot.toFixed(4)} (n=${a.n})`);
  console.log(`recomputed medianDot:       ${bm.medianDot.toFixed(4)} (n=${bm.n})`);
  console.log(`difference: ${(a.medianDot - bm.medianDot).toFixed(4)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
