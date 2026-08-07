/**
 * #82 shoulder coverage — area-weighted outward-normal raycast fraction.
 *
 * Replaces four failed scalar proxies (#73 max-Y mid-X band, #75 nearest-garment
 * proximity, #76 max-Y over lateral footprint, proposed hide-mask) with a fraction:
 *
 *   for body faces in the shoulder region with outward normal n:
 *       hit   = raycast(p + eps*n, direction n, maxDist D) → garment
 *       score = area-weighted mean(hit exists)
 *
 * claimScope: geometric occupation of the shoulder silhouette by real-garment
 * shells on shipped GLBs (deltoid / acromion region), left and right sides.
 * notEvidenceFor: clinical costume appropriateness, drape quality, fabric
 * realism, poke-through / hide-mask, production readiness, lower-body garments,
 * Quest performance, interpenetration detection.
 *
 * Implementation: pure Möller–Trumbore ray–triangle against garment faces
 * (no three-mesh-bvh dep at tools root). Same semantics as BVH raycastFirst:
 * first hit along body outward normal within maxDist counts. Why not
 * three-mesh-bvh: package is only nested under iwsdk; adding it would couple
 * evidence tools to arena. Pure raycast is sufficient for shoulder face counts.
 *
 * Stated failure modes (do not paper over by tightening the threshold):
 * - dense lattice of thin strips can still score high
 * - baggy sleeves "cover" despite air gap (correct for visibility)
 * - double-sided / inward-facing meshes need a backface policy (we use two-sided)
 * - does not detect interpenetration
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;

/** Lateral cut of body half-width (deltoid/acromion, not sternum). Same spirit as #76. */
const LATERAL_FRAC = 0.32;
/**
 * Shoulder belt on normalized body height — the deltoid/acromion band.
 * Floor 0.68 excludes mid-rib lateral faces (not the shoulder silhouette).
 * Ceiling 0.90 excludes head crown. Fixed geometric belt, not asset-tuned.
 */
const SHOULDER_YN_LO = 0.68;
const SHOULDER_YN_HI = 0.90;
/**
 * Min upward component of the outward face normal. Keeps deltoid top/side faces;
 * drops pure-down armpit and pure-back faces that are not the shoulder silhouette.
 */
const MIN_NY = 0.15;
/** Offset along normal before casting (avoid self-hit). */
const EPS = 0.003;
/**
 * Max ray distance along outward normal. Cloth thickness + modest air gap.
 * Not tuned against product assets — fixed geometric allowance.
 */
const MAX_DIST = 0.12;
/**
 * Coverage floor: area-weighted hit fraction that counts as "occupies silhouette".
 * Chosen AFTER measuring three human-graded bare negatives (see FIXED block in
 * shoulder-raycast-coverage.test.ts). Must refuse fractions typical of flaps
 * (≤0.3) and accept a genuine cap (~0.95). Mid-band 0.5 is the pure verdict
 * boundary used by coverageFractionVerdict.
 */
export const COVERAGE_FRACTION_FLOOR = 0.5;

type Vec3 = { x: number; y: number; z: number };

export type SideCoverage = {
  side: "left" | "right";
  coveredFraction: number;
  sampleCount: number;
};

export type ShoulderRaycastCoverage = {
  sides: SideCoverage[];
};

/**
 * Pure verdict: covered iff fraction meets the floor.
 * Binds the instrument independent of assets (thin-flap probe).
 */
export function coverageFractionVerdict(input: {
  coveredFraction: number;
}): boolean {
  return input.coveredFraction >= COVERAGE_FRACTION_FLOOR;
}

/**
 * Area-weighted outward-normal raycast coverage of garment over body shoulders.
 */
export async function assessShoulderRaycastCoverage(input: {
  glbPath: string;
}): Promise<ShoulderRaycastCoverage> {
  const abs = path.isAbsolute(input.glbPath)
    ? input.glbPath
    : path.resolve(process.cwd(), input.glbPath);
  if (!existsSync(abs)) {
    throw new Error(`assessShoulderRaycastCoverage: GLB not found: ${abs}`);
  }

  const document = await new NodeIO().read(abs);
  const bodyTris: Triangle[] = [];
  const garmentTris: Triangle[] = [];

  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (DECLARED_ANY_RE.test(name)) continue;
    const isGarment = GARMENT_MESH_RE.test(name);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      const idx = prim.getIndices()?.getArray();
      const tris = extractTriangles(pos, idx ?? null);
      if (isGarment) garmentTris.push(...tris);
      else bodyTris.push(...tris);
    }
  }

  if (bodyTris.length === 0) {
    return {
      sides: [
        { side: "left", coveredFraction: 0, sampleCount: 0 },
        { side: "right", coveredFraction: 0, sampleCount: 0 },
      ],
    };
  }

  const bodyVerts = bodyTris.flatMap((t) => [t.a, t.b, t.c]);
  const minY = Math.min(...bodyVerts.map((v) => v.y));
  const maxY = Math.max(...bodyVerts.map((v) => v.y));
  const minX = Math.min(...bodyVerts.map((v) => v.x));
  const maxX = Math.max(...bodyVerts.map((v) => v.x));
  const cx = (minX + maxX) * 0.5;
  const height = Math.max(maxY - minY, 0.001);
  const halfW = Math.max((maxX - minX) * 0.5, 0.001);

  // Precompute garment AABB for early reject.
  const gAabb = aabbOfTriangles(garmentTris);

  const left = accumulateSide(
    bodyTris,
    garmentTris,
    gAabb,
    cx,
    halfW,
    minY,
    height,
    "left",
  );
  const right = accumulateSide(
    bodyTris,
    garmentTris,
    gAabb,
    cx,
    halfW,
    minY,
    height,
    "right",
  );

  return { sides: [left, right] };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type Triangle = { a: Vec3; b: Vec3; c: Vec3 };

type Aabb = { min: Vec3; max: Vec3 };

function extractTriangles(
  pos: ArrayLike<number>,
  indices: ArrayLike<number> | null,
): Triangle[] {
  const out: Triangle[] = [];
  const read = (i: number): Vec3 => ({
    x: Number(pos[i * 3]),
    y: Number(pos[i * 3 + 1]),
    z: Number(pos[i * 3 + 2]),
  });
  if (indices && indices.length >= 3) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      out.push({
        a: read(Number(indices[i])),
        b: read(Number(indices[i + 1])),
        c: read(Number(indices[i + 2])),
      });
    }
  } else {
    const n = Math.floor(pos.length / 9);
    for (let t = 0; t < n; t++) {
      const base = t * 3;
      out.push({ a: read(base), b: read(base + 1), c: read(base + 2) });
    }
  }
  return out;
}

function aabbOfTriangles(tris: Triangle[]): Aabb | null {
  if (tris.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const t of tris) {
    for (const v of [t.a, t.b, t.c]) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

function faceCentroid(t: Triangle): Vec3 {
  return {
    x: (t.a.x + t.b.x + t.c.x) / 3,
    y: (t.a.y + t.b.y + t.c.y) / 3,
    z: (t.a.z + t.b.z + t.c.z) / 3,
  };
}

function faceNormalArea(t: Triangle): { n: Vec3; area: number } {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const cr = cross(e1, e2);
  const len = Math.hypot(cr.x, cr.y, cr.z);
  if (len < 1e-12) return { n: { x: 0, y: 1, z: 0 }, area: 0 };
  return {
    n: { x: cr.x / len, y: cr.y / len, z: cr.z / len },
    area: 0.5 * len,
  };
}

function accumulateSide(
  bodyTris: Triangle[],
  garmentTris: Triangle[],
  gAabb: Aabb | null,
  cx: number,
  halfW: number,
  minY: number,
  height: number,
  side: "left" | "right",
): SideCoverage {
  let coveredArea = 0;
  let totalArea = 0;
  let sampleCount = 0;

  for (const t of bodyTris) {
    const p = faceCentroid(t);
    const yn = (p.y - minY) / height;
    if (yn < SHOULDER_YN_LO || yn > SHOULDER_YN_HI) continue;
    const lateral = Math.abs(p.x - cx) >= halfW * LATERAL_FRAC;
    if (!lateral) continue;
    if (side === "left" && p.x < cx) continue;
    if (side === "right" && p.x >= cx) continue;

    const { n, area } = faceNormalArea(t);
    if (area <= 0) continue;

    // Outward relative to body midline: flip if normal points toward cx.
    let nx = n.x;
    let ny = n.y;
    let nz = n.z;
    const outwardX = p.x >= cx ? 1 : -1;
    if (nx * outwardX < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }

    // Deltoid top/side: require upward component (shoulder silhouette, not armpit).
    if (ny < MIN_NY) continue;

    totalArea += area;
    sampleCount += 1;

    if (garmentTris.length === 0 || !gAabb) continue;

    const origin: Vec3 = {
      x: p.x + nx * EPS,
      y: p.y + ny * EPS,
      z: p.z + nz * EPS,
    };
    const dir: Vec3 = { x: nx, y: ny, z: nz };

    if (!rayHitsAabb(origin, dir, MAX_DIST, gAabb)) continue;

    if (rayHitsAnyTriangle(origin, dir, MAX_DIST, garmentTris)) {
      coveredArea += area;
    }
  }

  const coveredFraction =
    totalArea > 0 ? coveredArea / totalArea : 0;

  return {
    side,
    coveredFraction: round4(coveredFraction),
    sampleCount,
  };
}

function rayHitsAabb(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  box: Aabb,
): boolean {
  // Slab method; treat zero dir components carefully.
  let tmin = 0;
  let tmax = maxDist;
  for (const axis of ["x", "y", "z"] as const) {
    const o = origin[axis];
    const d = dir[axis];
    const bmin = box.min[axis];
    const bmax = box.max[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < bmin || o > bmax) return false;
      continue;
    }
    let t1 = (bmin - o) / d;
    let t2 = (bmax - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax >= 0 && tmin <= maxDist;
}

/**
 * Two-sided Möller–Trumbore: hit if any garment triangle intersects ray in (0, maxDist].
 */
function rayHitsAnyTriangle(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  tris: Triangle[],
): boolean {
  for (const t of tris) {
    const hitT = rayTriangleT(origin, dir, t.a, t.b, t.c);
    if (hitT !== null && hitT > 1e-6 && hitT <= maxDist) return true;
  }
  return false;
}

function rayTriangleT(
  orig: Vec3,
  dir: Vec3,
  v0: Vec3,
  v1: Vec3,
  v2: Vec3,
): number | null {
  const e1 = sub(v1, v0);
  const e2 = sub(v2, v0);
  const pvec = cross(dir, e2);
  const det = dot(e1, pvec);
  // Two-sided: do not cull back faces (procedural shells may face either way).
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  const tvec = sub(orig, v0);
  const u = dot(tvec, pvec) * invDet;
  if (u < 0 || u > 1) return null;
  const qvec = cross(tvec, e1);
  const v = dot(dir, qvec) * invDet;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qvec) * invDet;
  return t;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
