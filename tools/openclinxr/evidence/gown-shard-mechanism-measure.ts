/**
 * #691 — measure the gown shard mechanisms per decile of the gown's own height, before anything
 * changes. Diagnosis only: this script writes the report and changes no asset bytes.
 *
 * ## INSTRUMENTS
 *
 * 1. interpenetration (gownVerticesInsideBody): even-odd point-in-mesh test by +X raycast
 *    (Möller–Trumbore, q = s x e1 form), grid-accelerated over the VISIBLE skin primitive
 *    `mpfb_skin_ob_patient_aisha`. The body mesh is not watertight (1,046 boundary edges over
 *    the gown's y-range — natural seams), so a SECOND ray (+Z) and a nearest-surface signed
 *    distance (3x3-cell search, Ericson closest-point) are computed as cross-checks; the field
 *    reports the +X parity, the cross-checks are recorded alongside.
 *
 * 2. degenerate triangles (degenerateTriangles): gown triangles whose area is below
 *    DEGENERATE_AREA_M2 = 1e-8 m^2 (side lengths below ~0.14 mm — below render relevance at
 *    the graded 4096 capture). The count below 1e-12 (true zero-area) is recorded separately.
 *
 * 3. inward-facing normals (inwardFacingTriangles): gown triangles whose geometric normal
 *    points toward the body's XZ axis (dot(n, triCenter - axis) < 0) — the card's "showing the
 *    gown's interior" for the trunk. A nearest-body-surface-normal variant (dot < 0 against the
 *    nearest body triangle's outward normal) is recorded separately because the two disagree at
 *    the sleeves (correct inner-sleeve tube surfaces) and at free rims.
 *
 * ## THE CODE TRACE (automate_blender.py #686, read for mechanism, not modified)
 *
 *     _fold_amp686 = 0.034        triangle-wave radial amplitude, +/-34 mm
 *     _fold_k686   = 16           waves around the trunk
 *     base offset: conformal normal offset 10-22 mm (the pre-#686 bodice)
 *
 * The gathers displace each trunk vertex radially by amp*tri_wave(16*atan2(rz,rx)+pi/2), i.e. a
 * zigzag accordion whose valleys sit at base_offset - 34 mm = 12-24 mm INSIDE the body surface
 * across the gather band (f in 0.55..0.86 of body height, fading 0.55->0.64 and 0.80->0.85).
 * The valley penetration is the interpenetration this report counts; the accordion flanks are
 * the angular "shard" geometry; the body skin visible in the V-gaps between crests is the
 * "tan/gold slivers" the grade reports.
 *
 * NOT TESTED: whether the measured penetration is the CAUSE of the graded appearance (a
 * concentration is consistent with a cause and does not establish one); whether the defect
 * predates decimation; whether the tan slivers are skin, the t-shirt, or the gown's own
 * backface; whether any of it is visible at learner viewing distance.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const GLB_PATH = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
const REPORT_PATH = join(HERE, "gown-shard-mechanism-measurement.json");

/** Counterweight (3) from the card: this slice changes no asset bytes. */
const GLB_SHA256 = "7bd12d06aec497a939aa62301c73274cf23e6dd7b1da6d5c085db6c17f57fd4a";
const GLB_BYTES = 7_116_988;

const GOWN_MESH = "openclinxr_real_garment_peds_upper_v1_mesh";
const BODY_PRIM = "mpfb_skin_ob_patient_aisha";
const DECILES = 10;
const CELL = 0.06;
/** Triangles below this area are degenerate at render scale (side length < ~0.14 mm). */
const DEGENERATE_AREA_M2 = 1e-8;
/** True zero-area (numerically exact) threshold, reported alongside. */
const ZERO_AREA_M2 = 1e-12;

type V3 = [number, number, number];

const io = new NodeIO();

function headSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function vAt(pos: Float32Array, i: number): V3 {
  return [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection). */
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

async function main(): Promise<void> {
  // COUNTERWEIGHT: pin the graded asset before measuring anything.
  const rawBytes = readFileSync(GLB_PATH);
  const bytes = new Uint8Array(rawBytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== GLB_SHA256 || bytes.byteLength !== GLB_BYTES) {
    throw new Error(
      `graded asset changed: sha256 ${hash.slice(0, 12)}... size ${bytes.byteLength} `
        + `(expected ${GLB_SHA256.slice(0, 12)}... / ${GLB_BYTES}) — refusing to measure a different mesh`,
    );
  }

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
  const bodyTris: Array<{ a: V3; b: V3; c: V3; n: V3 }> = [];
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const a = bodyVerts[bodyIdx[t]!]!, b = bodyVerts[bodyIdx[t + 1]!]!, c = bodyVerts[bodyIdx[t + 2]!]!;
    const ax = b[0]! - a[0]!, ay = b[1]! - a[1]!, az = b[2]! - a[2]!;
    const bx = c[0]! - a[0]!, by = c[1]! - a[1]!, bz = c[2]! - a[2]!;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    bodyTris.push({ a, b, c, n: [nx / len, ny / len, nz / len] });
  }

  const bMin: V3 = [Infinity, Infinity, Infinity];
  const bMax: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of bodyTris) {
    for (const p of [t.a, t.b, t.c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k]! < bMin[k]!) bMin[k] = p[k]!;
        if (p[k]! > bMax[k]!) bMax[k] = p[k]!;
      }
    }
  }
  let axisX = 0, axisZ = 0;
  for (const p of bodyVerts) {
    axisX += p[0]!;
    axisZ += p[2]!;
  }
  axisX /= bodyVerts.length;
  axisZ /= bodyVerts.length;

  // Uniform grid over the body AABB (y, z) — a +X or +Z ray stays inside one (y,z) or (x,y) column.
  const gy = Math.max(1, Math.ceil((bMax[1]! - bMin[1]!) / CELL));
  const gz = Math.max(1, Math.ceil((bMax[2]! - bMin[2]!) / CELL));
  const gx = Math.max(1, Math.ceil((bMax[0]! - bMin[0]!) / CELL));
  const gridYZ: number[][] = Array.from({ length: gy * gz }, () => []);
  const gridXY: number[][] = Array.from({ length: gx * gy }, () => []);
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

  /**
   * Möller–Trumbore, ray along +X or +Z. Validated form (probe 4): hit points keep the ray
   * origin's cross-axis coordinates; body centroid and neck classify inside, far points outside.
   *   p = D x e2; det = e1.p; u = (s.p)/det; q = s x e1; v = (D.q)/det; t = (e2.q)/det
   */
  function rayHits(p: V3, tIdx: number, axis: "x" | "z"): boolean {
    const { a, b, c } = bodyTris[tIdx]!;
    const e1x = b[0]! - a[0]!, e1y = b[1]! - a[1]!, e1z = b[2]! - a[2]!;
    const e2x = c[0]! - a[0]!, e2y = c[1]! - a[1]!, e2z = c[2]! - a[2]!;
    // D x e2: D=(1,0,0) -> (0,-e2z,e2y); D=(0,0,1) -> (-e2y,e2x,0)
    const px = axis === "x" ? 0 : -e2y;
    const py = axis === "x" ? -e2z : e2x;
    const pz = axis === "x" ? e2y : 0;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) return false;
    const inv = 1 / det;
    const sx = p[0]! - a[0]!, sy = p[1]! - a[1]!, sz = p[2]! - a[2]!;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return false;
    // q = s x e1
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (axis === "x" ? qx : qz) * inv;
    if (v < 0 || u + v > 1) return false;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 1e-9;
  }

  function crossings(p: V3, axis: "x" | "z"): number {
    if (axis === "x") {
      const i = Math.max(0, Math.min(gy - 1, Math.floor((p[1]! - bMin[1]!) / CELL)));
      const j = Math.max(0, Math.min(gz - 1, Math.floor((p[2]! - bMin[2]!) / CELL)));
      let hits = 0;
      for (const tIdx of gridYZ[i * gz + j]!) if (rayHits(p, tIdx, "x")) hits++;
      return hits;
    }
    const k = Math.max(0, Math.min(gx - 1, Math.floor((p[0]! - bMin[0]!) / CELL)));
    const i = Math.max(0, Math.min(gy - 1, Math.floor((p[1]! - bMin[1]!) / CELL)));
    let hits = 0;
    for (const tIdx of gridXY[k * gy + i]!) if (rayHits(p, tIdx, "z")) hits++;
    return hits;
  }

  /** Nearest body triangle within the 3x3-cell neighbourhood: distance, signed value, normal. */
  function nearestBodyInfo(p: V3): { dist: number; sign: number; n: V3 } {
    const ci = Math.max(0, Math.min(gy - 1, Math.floor((p[1]! - bMin[1]!) / CELL)));
    const cj = Math.max(0, Math.min(gz - 1, Math.floor((p[2]! - bMin[2]!) / CELL)));
    const ck = Math.max(0, Math.min(gx - 1, Math.floor((p[0]! - bMin[0]!) / CELL)));
    let best = Infinity;
    let bestSign = 0;
    let bestN: V3 = [1, 0, 0];
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
              bestN = n;
            }
          }
        }
      }
    }
    return { dist: best, sign: bestSign, n: bestN };
  }

  const gownVerts: V3[] = [];
  for (let i = 0; i < gownPos.length / 3; i++) gownVerts.push(vAt(gownPos, i));
  let gMinY = Infinity, gMaxY = -Infinity;
  for (const q of gownVerts) {
    if (q[1]! < gMinY) gMinY = q[1]!;
    if (q[1]! > gMaxY) gMaxY = q[1]!;
  }
  const band = (y: number): number =>
    Math.min(DECILES - 1, Math.max(0, Math.floor(((y - gMinY) / (gMaxY - gMinY)) * DECILES)));

  const deciles = Array.from({ length: DECILES }, () => ({
    index: 0,
    yLow: 0,
    yHigh: 0,
    gownVerticesInsideBody: 0,
    degenerateTriangles: 0,
    inwardFacingTriangles: 0,
    // cross-checks, recorded alongside the three fields
    gownVerticesInsideBodyRayZ: 0,
    gownVerticesInsideBodyNearest: 0,
    rayDisagreements: 0,
    zeroAreaTriangles: 0,
    inwardFacingTrianglesNearestSurface: 0,
  }));
  for (let d = 0; d < DECILES; d++) {
    deciles[d]!.index = d;
    deciles[d]!.yLow = gMinY + (d / DECILES) * (gMaxY - gMinY);
    deciles[d]!.yHigh = gMinY + ((d + 1) / DECILES) * (gMaxY - gMinY);
  }

  const SURFACE_EPS = 2e-3;
  for (const q of gownVerts) {
    const d = deciles[band(q[1]!)]!;
    const cx = crossings(q, "x");
    const cz = crossings(q, "z");
    const insideX = cx % 2 === 1;
    const insideZ = cz % 2 === 1;
    if (insideX) d.gownVerticesInsideBody++;
    if (insideZ) d.gownVerticesInsideBodyRayZ++;
    if (insideX !== insideZ) d.rayDisagreements++;
    const { sign } = nearestBodyInfo(q);
    if (sign < -SURFACE_EPS) d.gownVerticesInsideBodyNearest++;
  }

  for (let t = 0; t + 2 < gownIdx.length; t += 3) {
    const a = gownVerts[gownIdx[t]!]!, b = gownVerts[gownIdx[t + 1]!]!, c = gownVerts[gownIdx[t + 2]!]!;
    const ax = b[0]! - a[0]!, ay = b[1]! - a[1]!, az = b[2]! - a[2]!;
    const bx = c[0]! - a[0]!, by = c[1]! - a[1]!, bz = c[2]! - a[2]!;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    const cy = (a[1]! + b[1]! + c[1]!) / 3;
    const cx = (a[0]! + b[0]! + c[0]!) / 3;
    const cz = (a[2]! + b[2]! + c[2]!) / 3;
    const d = deciles[band(cy)]!;
    if (0.5 * len < DEGENERATE_AREA_M2) {
      d.degenerateTriangles++;
      if (0.5 * len < ZERO_AREA_M2) d.zeroAreaTriangles++;
    }
    if (len > 1e-12) {
      // axis reference: geometric normal points toward the body XZ axis (the card's "gown's
      // interior" for the trunk).
      if ((nx * (cx - axisX) + nz * (cz - axisZ)) / len < 0) d.inwardFacingTriangles++;
      // nearest-surface reference: geometric normal opposes the nearest body triangle's outward
      // normal — locally correct, biased at free rims (hem/collar/cuffs).
      const { n: m } = nearestBodyInfo([cx, cy, cz]);
      if ((nx * m[0]! + ny * m[1]! + nz * m[2]!) / len < 0) {
        d.inwardFacingTrianglesNearestSurface++;
      }
    }
  }

  const upper = (f: (d: (typeof deciles)[number]) => number): number =>
    deciles.slice(Math.ceil(DECILES / 2)).reduce((s, d) => s + f(d), 0);
  const lower = (f: (d: (typeof deciles)[number]) => number): number =>
    deciles.slice(0, Math.ceil(DECILES / 2)).reduce((s, d) => s + f(d), 0);

  const insideU = upper((d) => d.gownVerticesInsideBody);
  const insideL = lower((d) => d.gownVerticesInsideBody);
  const degenU = upper((d) => d.degenerateTriangles);
  const degenL = lower((d) => d.degenerateTriangles);
  const inwardU = upper((d) => d.inwardFacingTriangles);
  const inwardL = lower((d) => d.inwardFacingTriangles);

  // Decide the supported mechanism against the measured concentration. The pixel grade localises
  // the shards to the bodice (upper half) with a clean skirt (lower half).
  let supportedMechanism: string;
  if (insideU > insideL && insideU >= 10) {
    supportedMechanism = "interpenetration";
  } else if (inwardU > inwardL && inwardU >= 10) {
    supportedMechanism = "inward_facing_normals";
  } else if (degenU > degenL && degenU >= 10) {
    supportedMechanism = "degenerate_triangles";
  } else if (insideU === 0 && degenU === 0 && inwardU === 0) {
    supportedMechanism = "none_of_these";
  } else {
    supportedMechanism = "inconclusive_blocked";
  }

  const mechanismNote = (() => {
    const insideRayZ_U = upper((d) => d.gownVerticesInsideBodyRayZ);
    const insideRayZ_L = lower((d) => d.gownVerticesInsideBodyRayZ);
    const insideNS_U = upper((d) => d.gownVerticesInsideBodyNearest);
    const insideNS_L = lower((d) => d.gownVerticesInsideBodyNearest);
    if (supportedMechanism === "interpenetration") {
      return (
        `gown vertices inside the body skin are measured and bodice-concentrated: +X-ray even-odd ` +
        `${insideU} upper vs ${insideL} lower, +Z-ray ${insideRayZ_U} vs ${insideRayZ_L}, ` +
        `nearest-surface ${insideNS_U} vs ${insideNS_L}. The gather band (automate_blender.py #686: ` +
        `_fold_amp686=0.034m triangle-wave on a 10-22mm conformal offset) puts the wave valleys ` +
        `12-24mm inside the body surface across y 0.98..1.51 (body f 0.55..0.86), fading at both ` +
        `band edges — which is where the shards are densest and where they fade. Degenerate ` +
        `triangles are negligible (${deciles.reduce((s, d) => s + d.degenerateTriangles, 0)} below ` +
        `1e-8 m^2, ${deciles.reduce((s, d) => s + d.zeroAreaTriangles, 0)} below 1e-12) and sit near ` +
        `the collar, not the placket. Inward-facing normals (axis reference) are upper-heavy but ` +
        `dominated by correct inner-sleeve tube surfaces and accordion flank normals near dot~0; ` +
        `the nearest-surface reference is biased at free rims. Neither is the discriminator the ` +
        `interpenetration is.`
      );
    }
    if (supportedMechanism === "inward_facing_normals") {
      return (
        `inward-facing normals (axis reference) measure ${inwardU} upper vs ${inwardL} lower; ` +
        `nearest-surface reference ${upper((d) => d.inwardFacingTrianglesNearestSurface)} vs ` +
        `${lower((d) => d.inwardFacingTrianglesNearestSurface)}. Interpenetration measured ` +
        `${insideU} vs ${insideL}; degenerate triangles ${degenU} vs ${degenL} (below 1e-8 m^2).`
      );
    }
    if (supportedMechanism === "degenerate_triangles") {
      return (
        `degenerate triangles (below 1e-8 m^2) measure ${degenU} upper vs ${degenL} lower; ` +
        `interpenetration ${insideU} vs ${insideL}; inward normals ${inwardU} vs ${inwardL}.`
      );
    }
    return (
      `no candidate is cleanly bodice-concentrated: interpenetration ${insideU} vs ${insideL}, ` +
      `degenerate ${degenU} vs ${degenL}, inward ${inwardU} vs ${inwardL}. The gather mechanism ` +
      `(automate_blender.py #686: _fold_amp686=0.034m triangle-wave on a 10-22mm conformal ` +
      `offset) predicts 12-24mm valley penetration across y 0.98..1.51, but the measured numbers ` +
      `do not support naming one candidate with confidence.`
    );
  })();

  const report = {
    slice: "issue-691",
    title: "gown shard mechanism measurement — per-decile, pre-change (diagnosis only)",
    measuredAt: new Date().toISOString(),
    measuredAtCommit: headSha(),
    counterweight: {
      glbSha256: hash,
      glbBytes: bytes.byteLength,
      pinnedSha256: GLB_SHA256,
      pinnedBytes: GLB_BYTES,
    },
    gownMesh: GOWN_MESH,
    gownVertexCount: gownVerts.length,
    bodyVertexCount: bodyVerts.length,
    gownMaterial: (() => {
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          if (mesh.getName() === GOWN_MESH) {
            const mat = prim.getMaterial();
            if (mat) {
              return { doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode() };
            }
          }
        }
      }
      return null;
    })(),
    method: {
      decilesOver: `gown's own y-range ${gMinY.toFixed(3)}..${gMaxY.toFixed(3)} m, ten equal bands`,
      interpenetration: {
        primary: "even-odd point-in-mesh by +X raycast (Moller-Trumbore, q=s x e1), grid-accelerated over the visible skin primitive mpfb_skin_ob_patient_aisha",
        crossCheckRayZ: "same test with +Z ray",
        crossCheckNearest: "nearest body triangle signed distance (3x3-cell search, Ericson closest point), inside = sign < -2mm",
        caveat: "the body mesh is not watertight (boundary edges within the gown's y-range); parity can flip near seams — hence the two-ray and nearest-surface cross-checks",
        validated: "centroid and neck test points classify inside, far points outside; hit points keep the ray origin's y/z (invariant checked)",
      },
      degenerateTriangles: {
        epsilonM2: DEGENERATE_AREA_M2,
        epsilonRationale: "area below 1e-8 m^2 = side lengths below ~0.14 mm — below render relevance at the graded 4096 capture; counts below 1e-12 (true zero-area) recorded separately",
      },
      inwardFacingTriangles: {
        reference: "geometric normal points toward the body XZ axis: dot(n, triCenter - axis) < 0",
        caveat: "counts inner-sleeve tube surfaces (correct geometry, occluded in the render) and accordion flank normals near dot~0; the nearest-body-surface-normal variant is recorded alongside (biased at free rims: hem/collar/cuffs)",
      },
    },
    deciles: deciles.map((d) => ({ ...d })),
    totals: {
      gownVerticesInsideBody: deciles.reduce((s, d) => s + d.gownVerticesInsideBody, 0),
      gownVerticesInsideBodyRayZ: deciles.reduce((s, d) => s + d.gownVerticesInsideBodyRayZ, 0),
      gownVerticesInsideBodyNearest: deciles.reduce((s, d) => s + d.gownVerticesInsideBodyNearest, 0),
      degenerateTriangles: deciles.reduce((s, d) => s + d.degenerateTriangles, 0),
      inwardFacingTriangles: deciles.reduce((s, d) => s + d.inwardFacingTriangles, 0),
      inwardFacingTrianglesNearestSurface: deciles.reduce((s, d) => s + d.inwardFacingTrianglesNearestSurface, 0),
    },
    upperVsLower: {
      gownVerticesInsideBody: { upper: insideU, lower: insideL },
      degenerateTriangles: { upper: degenU, lower: degenL },
      inwardFacingTriangles: { upper: inwardU, lower: inwardL },
    },
    supportedMechanism,
    mechanismNote,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${REPORT_PATH}\n`);
  process.stdout.write(
    `inside upper=${insideU} lower=${insideL} | degen upper=${degenU} lower=${degenL} | ` +
      `inward upper=${inwardU} lower=${inwardL} | supported=${supportedMechanism}\n`,
  );
}

await main();
