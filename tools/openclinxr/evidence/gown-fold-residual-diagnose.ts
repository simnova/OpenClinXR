#!/usr/bin/env node
/**
 * #714 — diagnose the post-clamp residual: 411 gown vertices still report +X-inside in the
 * upper half after the trough clamp (baseline was 463). The clamp keeps every fold vertex at
 * radius >= its pre-fold shell radius, so a residual that is REAL penetration cannot be fold
 * valleys — it would be the shell itself overlapping the body hull. A residual that is only
 * +X-inside while the +Z ray and the nearest-surface signed distance say outside is a parity
 * artifact of the non-watertight body hull (boundary edges near the armpit/waist), not
 * penetration at all.
 *
 * This script classifies each +X-inside upper-half gown vertex by the agreement of the three
 * instruments and dumps the geometry, locates the body's boundary edges, and records the
 * actual triangle crossings for a sample of artifact candidates so the mechanism is visible
 * rather than asserted. It writes a JSON report and changes no asset bytes.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/gown-fold-residual-diagnose.ts
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const GLB_PATH = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
const OUT_PATH = join(HERE, "issue-714/gown-fold-residual-diagnose.json");

const GOWN_MESH = "openclinxr_real_garment_peds_upper_v1_mesh";
const BODY_PRIM = "mpfb_skin_robert_reference";
const CELL = 0.06;
/** Nearest-surface inside threshold, same as the measurement instrument. */
const SURFACE_EPS = 2e-3;

type V3 = [number, number, number];

const io = new NodeIO();

function vAt(pos: Float32Array, i: number): V3 {
  return [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection) — same as instrument. */
function closestOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
  const abx = b[0]! - a[0]!, aby = b[1]! - a[1]!, abz = b[2]! - a[2]!;
  const acx = c[0]! - a[0]!, acy = c[1]! - a[1]!, acz = c[2]! - a[2]!;
  const apx = p[0]! - a[0]!, apy = p[1]! - a[1]!, apz = p[2]! - a[2]!;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return a;
  const bpx = p[0]! - b[0]!, bpy = p[1]! - b[1]!, bpz = p[2]! - b[2]!;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0]! + abx * v, a[1]! + aby * v, a[2]! + abz * v];
  }
  const cpx = p[0]! - c[0]!, cpy = p[1]! - c[1]!, cpz = p[2]! - c[2]!;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0]! + acx * w, a[1]! + acy * w, a[2]! + acz * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return [b[0]! + (c[0]! - b[0]!) * w, b[1]! + (c[1]! - b[1]!) * w, b[2]! + (c[2]! - b[2]!) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0]! + abx * v + acx * w, a[1]! + aby * v + acy * w, a[2]! + abz * v + acz * w];
}

/** Möller–Trumbore along +X or +Z, returning every hit t and triangle index (instrument form). */
function rayHits(p: V3, tIdx: number, axis: "x" | "z"): number | null {
  const { a, b, c } = bodyTris[tIdx]!;
  const e1x = b[0]! - a[0]!, e1y = b[1]! - a[1]!, e1z = b[2]! - a[2]!;
  const e2x = c[0]! - a[0]!, e2y = c[1]! - a[1]!, e2z = c[2]! - a[2]!;
  const px = axis === "x" ? 0 : -e2y;
  const py = axis === "x" ? -e2z : e2x;
  const pz = axis === "x" ? e2y : 0;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const sx = p[0]! - a[0]!, sy = p[1]! - a[1]!, sz = p[2]! - a[2]!;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (axis === "x" ? qx : qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t <= 1e-9) return null;
  return t;
}

let bodyTris: Array<{ a: V3; b: V3; c: V3; n: V3 }> = [];
let bMin: V3 = [Infinity, Infinity, Infinity];
let bMax: V3 = [-Infinity, -Infinity, -Infinity];
let gy = 1, gz = 1, gx = 1;
let gridYZ: number[][] = [];
let gridXY: number[][] = [];
let axisX = 0, axisZ = 0;

function crossingHits(p: V3, axis: "x" | "z"): Array<{ t: number; tri: number }> {
  const hits: Array<{ t: number; tri: number }> = [];
  if (axis === "x") {
    const i = Math.max(0, Math.min(gy - 1, Math.floor((p[1]! - bMin[1]!) / CELL)));
    const j = Math.max(0, Math.min(gz - 1, Math.floor((p[2]! - bMin[2]!) / CELL)));
    for (const tIdx of gridYZ[i * gz + j]!) {
      const t = rayHits(p, tIdx, "x");
      if (t !== null) hits.push({ t, tri: tIdx });
    }
  } else {
    const k = Math.max(0, Math.min(gx - 1, Math.floor((p[0]! - bMin[0]!) / CELL)));
    const i = Math.max(0, Math.min(gy - 1, Math.floor((p[1]! - bMin[1]!) / CELL)));
    for (const tIdx of gridXY[k * gy + i]!) {
      const t = rayHits(p, tIdx, "z");
      if (t !== null) hits.push({ t, tri: tIdx });
    }
  }
  return hits.sort((a, b) => a.t - b.t);
}

function nearestBodyInfo(p: V3): { dist: number; sign: number } {
  const ci = Math.max(0, Math.min(gy - 1, Math.floor((p[1]! - bMin[1]!) / CELL)));
  const cj = Math.max(0, Math.min(gz - 1, Math.floor((p[2]! - bMin[2]!) / CELL)));
  const ck = Math.max(0, Math.min(gx - 1, Math.floor((p[0]! - bMin[0]!) / CELL)));
  let best = Infinity;
  let bestSign = 0;
  const seen = new Set<number>();
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let dk = -1; dk <= 1; dk++) {
        const i = ci + di, j = cj + dj, k = ck + dk;
        if (i < 0 || i >= gy || j < 0 || j >= gz || k < 0 || k >= gx) continue;
        for (const tIdx of gridYZ[i * gz + j]!) {
          if (seen.has(tIdx)) continue;
          seen.add(tIdx);
          const { a, b, c, n } = bodyTris[tIdx]!;
          const q = closestOnTri(p, a, b, c);
          const dx = p[0]! - q[0]!, dy = p[1]! - q[1]!, dz = p[2]! - q[2]!;
          const d = Math.hypot(dx, dy, dz);
          if (d < best) {
            best = d;
            bestSign = dx * n[0]! + dy * n[1]! + dz * n[2]!;
          }
        }
      }
    }
  }
  return { dist: best, sign: bestSign };
}

async function main(): Promise<void> {
  const doc = await io.read(GLB_PATH);
  let gownPos: Float32Array | null = null;
  let gownIdx: Uint16Array | Uint32Array | null = null;
  let bodyPos: Float32Array | null = null;
  let bodyIdx: Uint16Array | Uint32Array | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? "";
      if (mesh.getName() === GOWN_MESH) {
        const p = prim.getAttribute("POSITION")?.getArray();
        const i = prim.getIndices()?.getArray();
        if (p) gownPos = p as Float32Array;
        if (i) gownIdx = i as Uint16Array | Uint32Array;
      }
      if (matName === BODY_PRIM) {
        const p = prim.getAttribute("POSITION")?.getArray();
        const i = prim.getIndices()?.getArray();
        if (p) bodyPos = p as Float32Array;
        if (i) bodyIdx = i as Uint16Array | Uint32Array;
      }
    }
  }
  if (!gownPos || !gownIdx || !bodyPos || !bodyIdx) {
    throw new Error(`missing primitives: gown=${!!gownPos} gownIdx=${!!gownIdx} body=${!!bodyPos} bodyIdx=${!!bodyIdx}`);
  }

  const bodyVerts: V3[] = [];
  for (let i = 0; i < bodyPos.length / 3; i++) bodyVerts.push(vAt(bodyPos, i));
  bodyTris = [];
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const a = bodyVerts[bodyIdx[t]!]!, b = bodyVerts[bodyIdx[t + 1]!]!, c = bodyVerts[bodyIdx[t + 2]!]!;
    const ax = b[0]! - a[0]!, ay = b[1]! - a[1]!, az = b[2]! - a[2]!;
    const bx = c[0]! - a[0]!, by = c[1]! - a[1]!, bz = c[2]! - a[2]!;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    bodyTris.push({ a, b, c, n: [nx / len, ny / len, nz / len] });
  }
  bMin = [Infinity, Infinity, Infinity];
  bMax = [-Infinity, -Infinity, -Infinity];
  for (const t of bodyTris) {
    for (const p of [t.a, t.b, t.c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k]! < bMin[k]!) bMin[k] = p[k]!;
        if (p[k]! > bMax[k]!) bMax[k] = p[k]!;
      }
    }
  }
  axisX = 0; axisZ = 0;
  for (const p of bodyVerts) {
    axisX += p[0]!;
    axisZ += p[2]!;
  }
  axisX /= bodyVerts.length;
  axisZ /= bodyVerts.length;

  gy = Math.max(1, Math.ceil((bMax[1]! - bMin[1]!) / CELL));
  gz = Math.max(1, Math.ceil((bMax[2]! - bMin[2]!) / CELL));
  gx = Math.max(1, Math.ceil((bMax[0]! - bMin[0]!) / CELL));
  gridYZ = Array.from({ length: gy * gz }, () => []);
  gridXY = Array.from({ length: gx * gy }, () => []);
  for (let t = 0; t < bodyTris.length; t++) {
    const { a, b, c } = bodyTris[t]!;
    const yLo = Math.min(a[1]!, b[1]!, c[1]!), yHi = Math.max(a[1]!, b[1]!, c[1]!);
    const zLo = Math.min(a[2]!, b[2]!, c[2]!), zHi = Math.max(a[2]!, b[2]!, c[2]!);
    const xLo = Math.min(a[0]!, b[0]!, c[0]!), xHi = Math.max(a[0]!, b[0]!, c[0]!);
    const i0 = Math.max(0, Math.floor((yLo - bMin[1]!) / CELL));
    const i1 = Math.min(gy - 1, Math.floor((yHi - bMin[1]!) / CELL));
    const j0 = Math.max(0, Math.floor((zLo - bMin[2]!) / CELL));
    const j1 = Math.min(gz - 1, Math.floor((zHi - bMin[2]!) / CELL));
    const k0 = Math.max(0, Math.floor((xLo - bMin[0]!) / CELL));
    const k1 = Math.min(gx - 1, Math.floor((xHi - bMin[0]!) / CELL));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) gridYZ[i * gz + j]!.push(t);
      for (let k = k0; k <= k1; k++) gridXY[k * gy + i]!.push(t);
    }
  }

  // --- Fold band replication (from automate_blender.py:2585-2632) ---
  // skirt_top_y = body_min_y + 0.55*height, neck_y = body_min_y + 0.84*height, so
  // _h686 = (neck_y - skirt_top_y)/0.29 = height, _floor686 = body_min_y, and
  // f = (y - body_min_y)/height. Trunk branch when |x| < ~0.258 (wx > 0.001); sleeve
  // branch when |x| >= 0.26 and 0.60 <= f <= 0.84; the 0.258..0.26 sliver and f outside
  // the sleeve band are untouched by the fold pass.
  const bodyMinY = bMin[1]!, bodyMaxY = bMax[1]!;
  const bodyHeight = Math.max(bodyMaxY - bodyMinY, 0.001);
  const cx = (bMin[0]! + bMax[0]!) * 0.5;
  const cz = (bMin[2]! + bMax[2]!) * 0.5;

  function smoothstep(e0: number, e1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(e1 - e0, 1e-9)));
    return t * t * (3 - 2 * t);
  }

  function foldBranch(y: number, x: number): string {
    const f = (y - bodyMinY) / bodyHeight;
    if (f <= 0.55 || f >= 0.86) return "outside_band";
    const wx = 1 - smoothstep(0.15, 0.26, Math.abs(x));
    if (wx > 0.001) return "trunk";
    if (Math.abs(x) >= 0.26 && 0.6 <= f && f <= 0.84) return "sleeve";
    return "untouched_gap";
  }

  // --- Boundary edges of the body (open seams) ---
  const edgeCount = new Map<string, number>();
  const edgeY: number[] = [];
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const ia = bodyIdx[t]!, ib = bodyIdx[t + 1]!, ic = bodyIdx[t + 2]!;
    for (const [i, j] of [[ia, ib], [ib, ic], [ic, ia]] as Array<[number, number]>) {
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      const midY = (bodyVerts[i]![1]! + bodyVerts[j]![1]!) / 2;
      edgeY.push(midY);
    }
  }
  const boundaryEdges: Array<{ i: number; j: number; mid: V3 }> = [];
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const [i, j] = key.split("|").map(Number) as [number, number];
    boundaryEdges.push({
      i, j,
      mid: [
        (bodyVerts[i]![0]! + bodyVerts[j]![0]!) / 2,
        (bodyVerts[i]![1]! + bodyVerts[j]![1]!) / 2,
        (bodyVerts[i]![2]! + bodyVerts[j]![2]!) / 2,
      ],
    });
  }
  const beYs = boundaryEdges.map((e) => e.mid[1]!);
  const bandCount = boundaryEdges.filter((e) => e.mid[1]! >= bodyMinY + 0.55 * bodyHeight && e.mid[1]! <= bodyMinY + 0.86 * bodyHeight).length;

  // --- Classify gown vertices ---
  const gownVerts: V3[] = [];
  for (let i = 0; i < gownPos.length / 3; i++) gownVerts.push(vAt(gownPos, i));
  let gMinY = Infinity, gMaxY = -Infinity;
  for (const q of gownVerts) {
    if (q[1]! < gMinY) gMinY = q[1]!;
    if (q[1]! > gMaxY) gMaxY = q[1]!;
  }
  const midY = (gMinY + gMaxY) / 2;

  type Row = {
    i: number;
    x: number; y: number; z: number;
    angDeg: number;
    rad: number;
    branch: string;
    crossingsX: number;
    crossingsZ: number;
    nearestDist: number;
    nearestSign: number;
    cls: string;
  };

  const rows: Row[] = [];
  const clsCount = new Map<string, number>();
  const clsNearestNeg = new Map<string, number>();
  const clsNearestBelow5mm = new Map<string, number>();
  const crossingsDist: Record<string, number> = {};
  const perDecile: Record<string, Record<string, number>> = {};
  const decileWidth = (gMaxY - gMinY) / 10;

  for (let i = 0; i < gownVerts.length; i++) {
    const q = gownVerts[i]!;
    if (q[1]! <= midY) continue; // upper half only
    const hx = crossingHits(q, "x");
    const hz = crossingHits(q, "z");
    const nX = hx.length;
    const nZ = hz.length;
    const insideX = nX % 2 === 1;
    if (!insideX) continue;
    const { dist, sign } = nearestBodyInfo(q);
    const insideN = sign < -SURFACE_EPS;
    const insideZ = nZ % 2 === 1;
    let cls: string;
    if (insideZ && insideN) cls = "ALL_IN";
    else if (insideZ) cls = "XZ_ONLY";
    else if (insideN) cls = "X_N_AGREE";
    else cls = "X_ONLY";
    clsCount.set(cls, (clsCount.get(cls) ?? 0) + 1);
    if (sign < 0) clsNearestNeg.set(cls, (clsNearestNeg.get(cls) ?? 0) + 1);
    if (sign < -5e-3) clsNearestBelow5mm.set(cls, (clsNearestBelow5mm.get(cls) ?? 0) + 1);
    crossingsDist[`${cls}_nX=${nX}`] = (crossingsDist[`${cls}_nX=${nX}`] ?? 0) + 1;
    const decile = Math.min(9, Math.max(0, Math.floor((q[1]! - gMinY) / decileWidth)));
    perDecile[decile] ??= {};
    perDecile[decile]![cls] = (perDecile[decile]![cls] ?? 0) + 1;
    rows.push({
      i,
      x: q[0]!, y: q[1]!, z: q[2]!,
      angDeg: (Math.atan2(q[2]! - cz, q[0]! - cx) * 180) / Math.PI,
      rad: Math.hypot(q[0]! - cx, q[2]! - cz),
      branch: foldBranch(q[1]!, q[0]!),
      crossingsX: nX,
      crossingsZ: nZ,
      nearestDist: dist,
      nearestSign: sign,
      cls,
    });
  }

  // --- Sample ray-hit dumps for X_ONLY vertices (what did the +X ray actually cross?) ---
  const xOnlySample = rows.filter((r) => r.cls === "X_ONLY").slice(0, 12).map((r) => {
    const q = gownVerts[r.i]!;
    const hits = crossingHits(q, "x");
    return {
      row: { x: r.x, y: r.y, z: r.z, angDeg: r.angDeg, nearestSign: r.nearestSign, nearestDist: r.nearestDist },
      crossings: hits.length,
      hitTriangles: hits.map((h) => {
        const tri = bodyTris[h.tri]!;
        const c: V3 = [
          (tri.a[0]! + tri.b[0]! + tri.c[0]!) / 3,
          (tri.a[1]! + tri.b[1]! + tri.c[1]!) / 3,
          (tri.a[2]! + tri.b[2]! + tri.c[2]!) / 3,
        ];
        const isBoundary = boundaryEdges.some(
          (e) => e.i === bodyIdx[h.tri * 3] || e.i === bodyIdx[h.tri * 3 + 1] || e.i === bodyIdx[h.tri * 3 + 2]
            || e.j === bodyIdx[h.tri * 3] || e.j === bodyIdx[h.tri * 3 + 1] || e.j === bodyIdx[h.tri * 3 + 2],
        );
        return {
          t: Number(h.t.toFixed(4)),
          centroid: c.map((v) => Number(v.toFixed(3))),
          normal: tri.n.map((v) => Number(v.toFixed(3))),
          touchesBoundaryEdge: isBoundary,
        };
      }),
    };
  });

  // --- For the genuinely-inside class: nearest body triangle + radial ray crossing ---
  function nearestTri(p: V3): { q: V3; n: V3; dist: number; sign: number } | null {
    const ci = Math.max(0, Math.min(gy - 1, Math.floor((p[1]! - bMin[1]!) / CELL)));
    const cj = Math.max(0, Math.min(gz - 1, Math.floor((p[2]! - bMin[2]!) / CELL)));
    const ck = Math.max(0, Math.min(gx - 1, Math.floor((p[0]! - bMin[0]!) / CELL)));
    let best = Infinity;
    let bestQ: V3 | null = null;
    let bestN: V3 = [1, 0, 0];
    let bestSign = 0;
    const seen = new Set<number>();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          const i = ci + di, j = cj + dj, k = ck + dk;
          if (i < 0 || i >= gy || j < 0 || j >= gz || k < 0 || k >= gx) continue;
          for (const tIdx of gridYZ[i * gz + j]!) {
            if (seen.has(tIdx)) continue;
            seen.add(tIdx);
            const { a, b, c, n } = bodyTris[tIdx]!;
            const q = closestOnTri(p, a, b, c);
            const dx = p[0]! - q[0]!, dy = p[1]! - q[1]!, dz = p[2]! - q[2]!;
            const d = Math.hypot(dx, dy, dz);
            if (d < best) {
              best = d;
              bestQ = q;
              bestN = n;
              bestSign = dx * n[0]! + dy * n[1]! + dz * n[2]!;
            }
          }
        }
      }
    }
    return bestQ ? { q: bestQ, n: bestN, dist: best, sign: bestSign } : null;
  }

  /** First body-surface crossing radius along the radial ray (cx,cz)->(angle) at height y. */
  function radialFirstCrossing(y: number, angRad: number, maxR: number): number | null {
    const dirX = Math.cos(angRad), dirZ = Math.sin(angRad);
    let first: number | null = null;
    for (let tIdx = 0; tIdx < bodyTris.length; tIdx++) {
      const { a, b, c } = bodyTris[tIdx]!;
      // triangle bbox quick reject
      if (y < Math.min(a[1]!, b[1]!, c[1]!) - 1e-6 || y > Math.max(a[1]!, b[1]!, c[1]!) + 1e-6) continue;
      const e1x = b[0]! - a[0]!, e1y = b[1]! - a[1]!, e1z = b[2]! - a[2]!;
      const e2x = c[0]! - a[0]!, e2y = c[1]! - a[1]!, e2z = c[2]! - a[2]!;
      // ray origin = (cx + t*dirX, y, cz + t*dirZ), origin at t=0 is the axis
      // solve in the plane y: standard MT with origin O=(cx,y,cz), D=(dirX,0,dirZ)
      const dx = dirX, dy = 0, dz = dirZ;
      const p0x = dy * e2z - dz * e2y;
      const p0y = dz * e2x - dx * e2z;
      const p0z = dx * e2y - dy * e2x;
      const det = e1x * p0x + e1y * p0y + e1z * p0z;
      if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det;
      const sx = cx - a[0]!, sy = y - a[1]!, sz = cz - a[2]!;
      const u = (sx * p0x + sy * p0y + sz * p0z) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t < 1e-6) continue;
      if (first === null || t < first) first = t;
    }
    if (first === null || first > maxR) return null;
    return first;
  }

  const realRows = rows.filter((r) => r.cls === "X_N_AGREE" || r.cls === "ALL_IN");
  const realDetail = realRows.map((r) => {
    const q = gownVerts[r.i]!;
    const nt = nearestTri(q);
    const angRad = (r.angDeg * Math.PI) / 180;
    const bodyR = radialFirstCrossing(q[1]!, angRad, r.rad + 0.05);
    const xHits = crossingHits(q, "x");
    return {
      x: Number(q[0]!.toFixed(3)), y: Number(q[1]!.toFixed(3)), z: Number(q[2]!.toFixed(3)),
      cls: r.cls,
      radius: Number(r.rad.toFixed(3)),
      bodyRadiusAlongRay: bodyR !== null ? Number(bodyR.toFixed(3)) : null,
      radiallyInside: bodyR !== null && r.rad < bodyR,
      nearest: nt
        ? {
            dist: Number(nt.dist.toFixed(4)),
            sign: Number(nt.sign.toFixed(4)),
            q: nt.q.map((v) => Number(v.toFixed(3))),
            n: nt.n.map((v) => Number(v.toFixed(3))),
          }
        : null,
      xRayHits: xHits.slice(0, 3).map((h) => {
        const tri = bodyTris[h.tri]!;
        const c: V3 = [
          (tri.a[0]! + tri.b[0]! + tri.c[0]!) / 3,
          (tri.a[1]! + tri.b[1]! + tri.c[1]!) / 3,
          (tri.a[2]! + tri.b[2]! + tri.c[2]!) / 3,
        ];
        return { t: Number(h.t.toFixed(4)), centroid: c.map((v) => Number(v.toFixed(3))) };
      }),
    };
  });

  const report = {
    slice: "issue-714",
    title: "gown fold residual diagnosis — classification of post-clamp +X-inside upper vertices",
    glbSha256: createHash("sha256").update(readFileSync(GLB_PATH)).digest("hex"),
    body: { minY: bodyMinY, maxY: bodyMaxY, height: bodyHeight, cx, cz, axisMean: { axisX, axisZ } },
    gown: { minY: gMinY, maxY: gMaxY, verts: gownVerts.length, upperMidY: midY },
    foldBand: { fLo: 0.55, fHi: 0.86, yLo: bodyMinY + 0.55 * bodyHeight, yHi: bodyMinY + 0.86 * bodyHeight },
    boundaryEdges: {
      total: boundaryEdges.length,
      inFoldBand: bandCount,
      yMin: beYs.length ? Math.min(...beYs) : null,
      yMax: beYs.length ? Math.max(...beYs) : null,
    },
    upperPlusXInside: {
      total: rows.length,
      byClass: Object.fromEntries(clsCount),
      byClassNearestNegative: Object.fromEntries(clsNearestNeg),
      byClassNearestBelow5mm: Object.fromEntries(clsNearestBelow5mm),
      byClassCrossings: crossingsDist,
      perDecile: (() => {
        const out: Record<string, Record<string, number>> = {};
        for (const [d, m] of Object.entries(perDecile)) {
          out[d] = {};
          for (const [k, v] of Object.entries(m)) out[d]![k] = v;
        }
        return out;
      })(),
      byBranch: rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.branch] = (acc[r.branch] ?? 0) + 1;
        return acc;
      }, {}),
    },
    xOnlyRayDumps: xOnlySample,
    realPenetrationDetail: realDetail,
    rows: rows.map((r) => ({
      i: r.i, x: Number(r.x.toFixed(3)), y: Number(r.y.toFixed(3)), z: Number(r.z.toFixed(3)),
      angDeg: Number(r.angDeg.toFixed(1)), rad: Number(r.rad.toFixed(3)),
      branch: r.branch, nX: r.crossingsX, nZ: r.crossingsZ,
      nearest: Number(r.nearestSign.toFixed(4)), cls: r.cls,
    })),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${OUT_PATH}\n`);
  process.stdout.write(
    `upper +X-inside total=${rows.length} | ` +
      Object.entries(clsCount).map(([k, v]) => `${k}=${v}`).join(" ") +
      ` | byBranch=${JSON.stringify(report.upperPlusXInside.byBranch)} | ` +
      `boundaryEdges=${boundaryEdges.length} (band ${bandCount})\n`,
  );
}

await main();
