/**
 * #686 — parameter grid over the full candidate: trunk folds (sinusoidal, with a
 * valley floor so the level survives) + radial lift, and sleeve gathers (folds about
 * the ARM axis) + sleeve lift. Recomputed vertex normals feed the contract instrument.
 * Prints shape sub-0.891 counts, median dot, and the clearance percentiles the level
 * clause needs.
 *
 * claimScope: which parameter set clears both clauses on the real pre-fix geometry.
 * notEvidenceFor: appearance (orchestrator's pixel grade), Blender implementability.
 */
import { NodeIO } from "@gltf-transform/core";

const DIR = "apps/ui-xr/public/generated-humanoids";
const ASSET = "mpfb-gown-adult-patient.glb";
const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;
const SLAB_METRES = 0.01;
const STRIDE = 3;
const TRUNK_X_BLEND_LO = 0.15;
const TRUNK_X_BLEND_HI = 0.26;
const TRUNK_X_MAX = 0.22;
const BAND: readonly [number, number] = [0.62, 0.82];
const SKIRT_BAND: readonly [number, number] = [0.34, 0.5];
const NEED_SUB891 = 294;
const NEED_LEVEL_MM = 38.8;

type V3 = [number, number, number];
type Vertex = { readonly p: V3; readonly n: V3 };

interface Params {
  S: number;        // trunk radial lift
  A: number;        // trunk fold amplitude
  k: number;        // trunk fold count
  V: number;        // trunk fold valley floor (max inward displacement)
  SA: number;       // sleeve gather amplitude (about arm axis)
  SK: number;       // sleeve gather count
  SL: number;       // sleeve radial lift about arm axis
  WAVE: "sin" | "tri"; // fold cross-section shape
}

function triWave(x: number): number {
  // triangle wave: crest at +1, valley at -1, period 2π, crest at x = π/2 + 2πn
  const u = ((x + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return u < Math.PI ? 1 - (2 * u) / Math.PI : -1 + (2 * (u - Math.PI)) / Math.PI;
}

async function loadDoc() {
  const doc = await new NodeIO().read(`${DIR}/${ASSET}`);
  const gownPrims: { pos: Float32Array; nrm: Float32Array; idx: number[] }[] = [];
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
        for (let i = 0; i < n; i++) {
          body.push({ p: [pa[i * 3]!, pa[i * 3 + 1]!, pa[i * 3 + 2]!], n: [na[i * 3]!, na[i * 3 + 1]!, na[i * 3 + 2]!] });
        }
      }
    }
  }
  return { gownPrims, body };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : Number.NaN;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function bandMetrics(gown: Vertex[], body: Vertex[], floorY: number, height: number, band: readonly [number, number]) {
  const inBand = (v: Vertex) => {
    const f = (v.p[1] - floorY) / height;
    return f >= band[0] && f < band[1];
  };
  const g = gown.filter((_, i) => i % STRIDE === 0).filter(inBand);
  const b = body.filter((_, i) => i % STRIDE === 0);
  const distances: number[] = [];
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
    distances.push(best);
    const dot = v.n[0] * nearest.n[0] + v.n[1] * nearest.n[1] + v.n[2] * nearest.n[2];
    const scale = Math.hypot(v.n[0], v.n[1], v.n[2]) * Math.hypot(nearest.n[0], nearest.n[1], nearest.n[2]);
    if (scale > 0) dots.push(dot / scale);
  }
  return { n: distances.length, medianMm: median(distances) * 1000, medianNormalDot: median(dots), dots, dists: distances };
}

function subdivide(prims: { pos: Float32Array; nrm: Float32Array; idx: number[] }[]): { pos: Float32Array; nrm: Float32Array; idx: number[] }[] {
  // 2 levels of 1-to-4 triangle subdivision (16x) on all gown primitives, so the fold
  // pattern is resolved by the mesh (the shipped 16-column torso cannot carry folds).
  let cur = prims;
  for (let level = 0; level < 2; level++) {
    const next: { pos: Float32Array; nrm: Float32Array; idx: number[] }[] = [];
    for (const gp of cur) {
      const P = gp.pos;
      const nv = P.length / 3;
      const idx = gp.idx;
      const mid: Map<string, number> = new Map();
      const newPos: number[] = [];
      for (let i = 0; i < nv; i++) newPos.push(P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!);
      const newIdx: number[] = [];
      const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
      const midOf = (a: number, b: number): number => {
        const k = key(a, b);
        const hit = mid.get(k);
        if (hit !== undefined) return hit;
        const m = newPos.length / 3;
        newPos.push(
          (newPos[a * 3]! + newPos[b * 3]!) / 2,
          (newPos[a * 3 + 1]! + newPos[b * 3 + 1]!) / 2,
          (newPos[a * 3 + 2]! + newPos[b * 3 + 2]!) / 2,
        );
        mid.set(k, m);
        return m;
      };
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const i0 = idx[t]!, i1 = idx[t + 1]!, i2 = idx[t + 2]!;
        const m01 = midOf(i0, i1);
        const m12 = midOf(i1, i2);
        const m20 = midOf(i2, i0);
        newIdx.push(i0, m01, m20, m01, i1, m12, m20, m12, i2, m01, m12, m20);
      }
      next.push({ pos: new Float32Array(newPos), nrm: new Float32Array(newPos.length), idx: newIdx });
    }
    cur = next;
  }
  return cur;
}

function displace(gownPrims: { pos: Float32Array; nrm: Float32Array; idx: number[] }[], body: Vertex[], floorY: number, height: number, p: Params): Vertex[] {
  const trunkBody = body.filter((v) => Math.abs(v.p[0]) < TRUNK_X_MAX && (v.p[1] - floorY) / height >= 0.55 && (v.p[1] - floorY) / height <= 0.84);
  const cx = trunkBody.map((v) => v.p[0]).reduce((a, c) => a + c, 0) / trunkBody.length;
  const cz = trunkBody.map((v) => v.p[2]).reduce((a, c) => a + c, 0) / trunkBody.length;
  const hipY = floorY + height * 0.55;
  const neckY = floorY + height * 0.84;

  const pos2 = gownPrims.map((gp) => new Float32Array(gp.pos));
  for (let pi = 0; pi < gownPrims.length; pi++) {
    const gp = gownPrims[pi]!;
    const P = pos2[pi]!;
    const nv = gp.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      const x = P[i * 3]!, y = P[i * 3 + 1]!, z = P[i * 3 + 2]!;
      const f = (y - floorY) / height;
      if (f <= 0.55 || f >= 0.86) continue;
      // ---- trunk: lift + folds about the torso centerline ----
      const wx = 1 - smoothstep(TRUNK_X_BLEND_LO, TRUNK_X_BLEND_HI, Math.abs(x));
      if (wx > 0.001) {
        const wy = Math.min(smoothstep(0.55, 0.64, f), 1 - smoothstep(0.80, 0.85, f));
        const rx = x - cx;
        const rz = z - cz;
        const rr = Math.hypot(rx, rz) || 1e-9;
        const s = 1 + p.S * wy * wx;
        const wfold = wx * Math.min(1, smoothstep(0.55, 0.62, f)) * (1 - smoothstep(0.80, 0.85, f));
        const theta = Math.atan2(rz, rx);
        // fold cross-section: sinusoid or gathered triangle wave, with a valley floor
        // (bumps out fully; valleys floored at -V so the level clause survives)
        const raw = p.WAVE === "tri" ? triWave(p.k * theta) : Math.cos(p.k * theta);
        const fold = raw > -p.V / Math.max(p.A, 1e-9) ? p.A * raw : -p.V;
        const d = fold * wfold;
        const nx = rx / rr;
        const nz = rz / rr;
        P[i * 3] = cx + rx * s + nx * d;
        P[i * 3 + 2] = cz + rz * s + nz * d;
        continue;
      }
      // ---- sleeve: gathers about the arm axis + lift ----
      const axBlend = 1 - (1 - smoothstep(TRUNK_X_BLEND_HI, TRUNK_X_BLEND_LO + 0.03, Math.abs(x)));
      void axBlend;
      if (Math.abs(x) >= TRUNK_X_BLEND_HI && p.SA > 0) {
        // arm axis: approximate as the vertical line through the arm's centroid at this height
        const arm = body.filter((q) => Math.abs(q.p[1] - y) < 0.05 && Math.abs(q.p[0]) >= TRUNK_X_MAX);
        if (arm.length > 8) {
          const acx = arm.map((q) => q.p[0]).reduce((a2, c) => a2 + c, 0) / arm.length;
          const acz = arm.map((q) => q.p[2]).reduce((a2, c) => a2 + c, 0) / arm.length;
          const rx = x - acx;
          const rz = z - acz;
          const rr = Math.hypot(rx, rz) || 1e-9;
          const s = 1 + p.SL;
          const theta = Math.atan2(rz, rx);
          const d = p.SA * Math.cos(p.SK * theta);
          const nx = rx / rr;
          const nz = rz / rr;
          P[i * 3] = acx + rx * s + nx * d;
          P[i * 3 + 2] = acz + rz * s + nz * d;
        }
      }
    }
  }
  // recompute vertex normals (angle-weighted)
  const out: Vertex[] = [];
  for (let pi = 0; pi < gownPrims.length; pi++) {
    const gp = gownPrims[pi]!;
    const P = pos2[pi]!;
    const nv = gp.pos.length / 3;
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
      out.push({
        p: [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!],
        n: l > 1e-9 ? [acc[i * 3]! / l, acc[i * 3 + 1]! / l, acc[i * 3 + 2]! / l] : [0, 1, 0],
      });
    }
  }
  return out;
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
  const { gownPrims, body } = await loadDoc();
  const ys = body.map((v) => v.p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  const baseGown: Vertex[] = [];
  for (const gp of gownPrims) {
    const nv = gp.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      baseGown.push({ p: [gp.pos[i * 3]!, gp.pos[i * 3 + 1]!, gp.pos[i * 3 + 2]!], n: [gp.nrm[i * 3]!, gp.nrm[i * 3 + 1]!, gp.nrm[i * 3 + 2]!] });
    }
  }
  console.log(`height=${height.toFixed(4)} gownVerts=${baseGown.length} bodyVerts=${body.length}`);

  const grid: Array<[string, Params]> = [
    ["FINAL S.24 A30 k12 + sleeve", { S: 0.24, A: 0.030, k: 12, V: 0.030, SA: 0.020, SK: 5, SL: 0.08, WAVE: "tri" }],
    ["S.24 A26 k14 + sleeve", { S: 0.24, A: 0.026, k: 14, V: 0.026, SA: 0.020, SK: 5, SL: 0.08, WAVE: "tri" }],
    ["S.24 A22 k16 + sleeve", { S: 0.24, A: 0.022, k: 16, V: 0.022, SA: 0.020, SK: 5, SL: 0.08, WAVE: "tri" }],
    ["S.24 A24 k16 + sleeve", { S: 0.24, A: 0.024, k: 16, V: 0.024, SA: 0.020, SK: 5, SL: 0.08, WAVE: "tri" }],
    ["S.24 A20 k18 + sleeve", { S: 0.24, A: 0.020, k: 18, V: 0.020, SA: 0.020, SK: 5, SL: 0.08, WAVE: "tri" }],
  ];
  const subPrims = subdivide(gownPrims);
  console.log(`subdivided gown verts: ${subPrims.reduce((a, gp) => a + gp.pos.length / 3, 0)}`);
  for (const [name, p] of grid) {
    const gown = displace(subPrims, body, floorY, height, p);
    const bodice = bandMetrics(gown, body, floorY, height, BAND);
    const skirt = bandMetrics(gown, body, floorY, height, SKIRT_BAND);
    const sub = bodice.dots.filter((d) => d <= 0.891).length;
    const ratio = bodice.medianMm / skirt.medianMm;
    const clevel = percentile(bodice.dists, 294 / 587) * 1000;
    console.log(
      `\n=== ${name} ===\n` +
      `bodice: n=${bodice.n} medianMm=${bodice.medianMm.toFixed(1)} p(294/587)clear=${clevel.toFixed(1)} medianDot=${bodice.medianNormalDot.toFixed(3)} sub891=${sub}\n` +
      `skirt:  n=${skirt.n} medianMm=${skirt.medianMm.toFixed(1)} medianDot=${skirt.medianNormalDot.toFixed(3)}\n` +
      `LEVEL: ratio=${ratio.toFixed(3)} (need >=0.5, i.e. median >= ${NEED_LEVEL_MM})  clevel294=${clevel.toFixed(1)} need>=${NEED_LEVEL_MM}\n` +
      `SHAPE: sub891=${sub} need>=${NEED_SUB891}  medianDot=${bodice.medianNormalDot.toFixed(3)} need<=0.891`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
