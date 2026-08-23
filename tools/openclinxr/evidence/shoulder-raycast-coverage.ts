/**
 * #82 shoulder coverage — area-weighted outward-normal raycast fraction.
 *
 * claimScope: geometric shoulder coverage of real-garment shells on shipped GLBs.
 * notEvidenceFor: drape quality, fabric realism, poke-through, clinical costume
 * appropriateness, production readiness, Quest performance.
 *
 * Four scalar-over-extrema contracts passed on bare shoulders before this (#73 collar max,
 * #75 nearest proximity, #76 lateral-footprint max, plus a rejected hide-mask that answers a
 * different defect class). All were satisfied by a single well-placed vertex because each
 * reduced the region to ONE number taken at an extreme. This measure scores the whole
 * shoulder surface instead: every body face in the shoulder region casts a ray along its own
 * outward normal, and the score is the AREA-WEIGHTED fraction of ray length that finds
 * garment geometry. A collar cannot answer for the deltoid (wrong axis); a flap catches too
 * few area-weighted rays to move a fraction; a strip is a strip.
 *
 * Region and axes are geometric cuts from the body AABB, fixed before looking at any asset:
 *   - shoulder band: face centroid at 0.68–0.90 of body height (deltoid + acromion;
 *     excludes mid-torso below and neck/head above)
 *   - lateral: |x − cx| ≥ 0.32 × body half-width (torso core and head crown stay out)
 *
 * Stated failure modes carried from the research (#82 header): a dense lattice of thin strips
 * can still score high; baggy sleeves count as covering (correct for visibility);
 * double-sided meshes need no backface policy here because only intersection EXISTENCE is
 * scored; interpenetration is not detected. Any of these firing belongs in the FIXED block,
 * not in a tightened constant.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { Document, NodeIO, type Mesh as GltfMesh, type Node as GltfNode, type Primitive as GltfPrimitive } from "@gltf-transform/core";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
/** Exported declaration markers (1-triangle SSOT meshes) — neither body nor garment. */
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;
/** Aux meshes (eyes/scalp/hair/teeth) are not torso skin; never sampled as body surface. */
const AUX_BODY_RE = /eye|lash|brow|hair|scalp|teeth|tongue|gum|pupil|iris/i;

export type SideCoverage = {
  side: "left" | "right";
  coveredFraction: number;
  sampleCount: number;
};

/**
 * Coverage floor. Derived, not fitted: clause (2) of the planted contract pins the verdict
 * shape — 0.05 and 0.30 must refuse (a flap or a strip lands there), 0.95 must pass. The two
 * human-graded-bare blobs measure ≤ 0.25 on this metric (see ## FIXED (#82) table in
 * shoulder-raycast-coverage.test.ts) and regenerated capped figures measure ≥ 0.85. The floor
 * sits in the empty middle of that range, nearer the negatives than the positives.
 */
export const COVERAGE_FLOOR = 0.6;

/**
 * Pure verdict over the area-weighted fraction, so the threshold can be probed without an
 * asset (contract clause 2 probes exactly this).
 */
export function coverageFractionVerdict(input: { coveredFraction: number }): boolean {
  return input.coveredFraction >= COVERAGE_FLOOR;
}

type Vec3 = { x: number; y: number; z: number };

type Tri = { a: Vec3; b: Vec3; c: Vec3 };

type BodyFace = {
  centroid: Vec3;
  normal: Vec3;
  area: number;
};

/**
 * Median-split BVH over garment triangles. Shell sizes here are O(few k) triangles, so a
 * flat array bvh with leaf size 8 is plenty and keeps the evidence file dependency-free.
 */
class GarmentBvh {
  private readonly tris: Tri[];
  private readonly nodes: { min: Vec3; max: Vec3; left: number; right: number; start: number; count: number }[] = [];
  private readonly order: number[] = [];

  constructor(tris: Tri[]) {
    this.tris = tris;
    if (tris.length === 0) return;
    this.order.push(...tris.map((_, i) => i));
    const boundsOf = (ti: number) => {
      const t = tris[ti];
      return {
        min: {
          x: Math.min(t.a.x, t.b.x, t.c.x),
          y: Math.min(t.a.y, t.b.y, t.c.y),
          z: Math.min(t.a.z, t.b.z, t.c.z),
        },
        max: {
          x: Math.max(t.a.x, t.b.x, t.c.x),
          y: Math.max(t.a.y, t.b.y, t.c.y),
          z: Math.max(t.a.z, t.b.z, t.c.z),
        },
      };
    };
    const build = (start: number, count: number): number => {
      let min = { x: Infinity, y: Infinity, z: Infinity };
      let max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (let i = start; i < start + count; i++) {
        const b = boundsOf(this.order[i]);
        min = { x: Math.min(min.x, b.min.x), y: Math.min(min.y, b.min.y), z: Math.min(min.z, b.min.z) };
        max = { x: Math.max(max.x, b.max.x), y: Math.max(max.y, b.max.y), z: Math.max(max.z, b.max.z) };
      }
      const nodeIndex = this.nodes.length;
      this.nodes.push({ min, max, left: -1, right: -1, start, count });
      if (count <= 8) return nodeIndex;
      const ex = max.x - min.x;
      const ey = max.y - min.y;
      const ez = max.z - min.z;
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const keyOf = (ti: number): number => {
        const t = tris[ti];
        const c =
          axis === 0
            ? (t.a.x + t.b.x + t.c.x) / 3
            : axis === 1
              ? (t.a.y + t.b.y + t.c.y) / 3
              : (t.a.z + t.b.z + t.c.z) / 3;
        return c;
      };
      const slice = this.order.slice(start, start + count);
      slice.sort((p, q) => keyOf(p) - keyOf(q));
      for (let i = 0; i < count; i++) this.order[start + i] = slice[i];
      const half = count >> 1;
      const l = build(start, half);
      const r = build(start + half, count - half);
      this.nodes[nodeIndex].left = l;
      this.nodes[nodeIndex].right = r;
      return nodeIndex;
    };
    build(0, tris.length);
  }

  /** Möller–Trumbore against the garment set; true when ANY triangle is hit within maxDist. */
  hit(o: Vec3, d: Vec3, maxDist: number): boolean {
    if (this.tris.length === 0 || this.nodes.length === 0) return false;
    const inv = { x: 1 / d.x, y: 1 / d.y, z: 1 / d.z };
    const stack: number[] = [0];
    while (stack.length > 0) {
      const ni = stack.pop() as number;
      const n = this.nodes[ni];
      if (!slabHit(o, inv, n.min, n.max, maxDist)) continue;
      if (n.left < 0) {
        for (let i = n.start; i < n.start + n.count; i++) {
          const t = rayTri(o, d, this.tris[this.order[i]]);
          if (t !== null && t <= maxDist) return true;
        }
        continue;
      }
      stack.push(n.left, n.right);
    }
    return false;
  }
}

function slabHit(o: Vec3, inv: Vec3, min: Vec3, max: Vec3, maxDist: number): boolean {
  let t0 = 0;
  let t1 = maxDist;
  for (const ax of ["x", "y", "z"] as const) {
    let tn = (min[ax] - o[ax]) * inv[ax];
    let tf = (max[ax] - o[ax]) * inv[ax];
    if (tn > tf) [tn, tf] = [tf, tn];
    t0 = Math.max(t0, tn);
    t1 = Math.min(t1, tf);
    if (t0 > t1) return false;
  }
  return true;
}

function rayTri(o: Vec3, d: Vec3, t: Tri): number | null {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  const s = sub(o, t.a);
  const u = dot(s, p) * invDet;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(s, e1);
  const v = dot(d, q) * invDet;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const dist = dot(e2, q) * invDet;
  if (dist < 1e-9) return null;
  return dist;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

type LoadedGeometry = {
  garmentTris: Tri[];
  bodyFaces: BodyFace[];
  bodyMinY: number;
  bodyMaxY: number;
  bodyMinX: number;
  bodyMaxX: number;
};

function transformPos(m: number[], p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

function loadGeometry(abs: string): Promise<LoadedGeometry> {
  return new NodeIO().read(abs).then((document: Document) => {
    const garmentTris: Tri[] = [];
    const bodyFaces: BodyFace[] = [];
    let bodyMinX = Infinity;
    let bodyMaxX = -Infinity;
    let bodyMinY = Infinity;
    let bodyMaxY = -Infinity;

    const roots = document.getRoot().listScenes().flatMap((s) => s.listChildren());
    void roots;

    // Accumulate world transforms depth-first over every scene.
    const processNode = (node: GltfNode, parentM: number[] | null): void => {
      const m = parentM ? mul4(parentM, node.getWorldMatrix()) : node.getWorldMatrix();
      const mesh: GltfMesh | null = node.getMesh();
      if (mesh) {
        const name = mesh.getName() || "";
        if (!DECLARED_ANY_RE.test(name)) {
          const isGarment = GARMENT_MESH_RE.test(name);
          const isAux = !isGarment && AUX_BODY_RE.test(name);
          for (const prim of mesh.listPrimitives()) {
            collectPrim(prim as GltfPrimitive, m, isGarment, isAux, { garmentTris, bodyFaces });
          }
        }
      }
      for (const child of node.listChildren()) processNode(child, m);
    };
    for (const scene of document.getRoot().listScenes()) {
      for (const root of scene.listChildren()) processNode(root, null);
    }

    // Body AABB from sampled body faces (aux excluded already).
    for (const f of bodyFaces) {
      bodyMinX = Math.min(bodyMinX, f.centroid.x);
      bodyMaxX = Math.max(bodyMaxX, f.centroid.x);
      bodyMinY = Math.min(bodyMinY, f.centroid.y);
      bodyMaxY = Math.max(bodyMaxY, f.centroid.y);
    }
    return { garmentTris, bodyFaces, bodyMinX, bodyMaxX, bodyMinY, bodyMaxY };
  });
}

function collectPrim(
  prim: GltfPrimitive,
  m: number[],
  isGarment: boolean,
  isAux: boolean,
  out: { garmentTris: Tri[]; bodyFaces: BodyFace[] },
): void {
  const posAttr = prim.getAttribute("POSITION");
  if (!posAttr) return;
  const pos = posAttr.getArray() as ArrayLike<number>;
  const idxAttr = prim.getIndices();
  const idx = (idxAttr?.getArray() ?? null) as ArrayLike<number> | null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const at = (vi: number): Vec3 => transformPos(m, { x: Number(pos[vi * 3]), y: Number(pos[vi * 3 + 1]), z: Number(pos[vi * 3 + 2]) });  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? Number(idx[t * 3]) : t * 3;
    const i1 = idx ? Number(idx[t * 3 + 1]) : t * 3 + 1;
    const i2 = idx ? Number(idx[t * 3 + 2]) : t * 3 + 2;
    const a = at(i0);
    const b = at(i1);
    const c = at(i2);
    if (isGarment) {
      out.garmentTris.push({ a, b, c });
      continue;
    }
    if (isAux) continue;
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const nRaw = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(nRaw.x, nRaw.y, nRaw.z);
    if (len < 1e-12) continue;
    // glTF winding flips under negative-determinant node transforms.
    const flip = det4(m) < 0 ? -1 : 1;
    out.bodyFaces.push({
      centroid: { x: cx, y: cy, z: cz },
      normal: { x: (flip * nRaw.x) / len, y: (flip * nRaw.y) / len, z: (flip * nRaw.z) / len },
      area: len / 2,
    });
  }
}

function mul4(a: number[], b: number[]): number[] {
  const o = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] =
        a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}

function det4(m: number[]): number {
  return (
    m[3] * (m[14] * m[9] * m[7] - m[10] * m[13] * m[7] + m[10] * m[5] * m[15] - m[6] * m[13] * m[9] - m[14] * m[5] * m[11] + m[6] * m[9] * m[15]) -
    m[7] * (m[14] * m[9] * m[3] - m[10] * m[13] * m[3] + m[10] * m[1] * m[15] - m[2] * m[13] * m[9] - m[14] * m[1] * m[11] + m[2] * m[9] * m[15]) +
    m[11] * (m[14] * m[5] * m[3] - m[6] * m[13] * m[3] + m[6] * m[1] * m[15] - m[2] * m[13] * m[5] - m[14] * m[1] * m[7] + m[2] * m[5] * m[15]) -
    m[15] * (m[14] * m[5] * m[3] - m[6] * m[13] * m[3] + m[6] * m[1] * m[11] - m[2] * m[13] * m[5] - m[14] * m[1] * m[7] + m[2] * m[5] * m[11])
  );
}

// Shoulder-region cuts, fixed from the body AABB before any asset is inspected (see header).
const SHOULDER_YN_LO = 0.68;
const SHOULDER_YN_HI = 0.9;
const LATERAL_FRACTION = 0.32;
const RAY_MAX_DIST_FRACTION = 0.055; // × body height; baggy counts as covering (visibility-correct)
const RAY_ORIGIN_EPSILON_FRACTION = 0.003; // × body height; lift off the skin before casting

/**
 * Measure the area-weighted outward-normal raycast coverage fraction per side.
 */
export async function assessShoulderRaycastCoverage(input: {
  glbPath: string;
}): Promise<{ sides: SideCoverage[] }> {
  const abs = path.isAbsolute(input.glbPath) ? input.glbPath : path.resolve(process.cwd(), input.glbPath);
  if (!existsSync(abs)) {
    throw new Error(`assessShoulderRaycastCoverage: GLB not found: ${abs}`);
  }
  const geo = await loadGeometry(abs);
  if (geo.bodyFaces.length === 0 || geo.garmentTris.length === 0) {
    throw new Error(`assessShoulderRaycastCoverage: no body/garment geometry in ${abs}`);
  }
  const height = Math.max(geo.bodyMaxY - geo.bodyMinY, 0.001);
  const cx = (geo.bodyMinX + geo.bodyMaxX) * 0.5;
  const halfW = Math.max((geo.bodyMaxX - geo.bodyMinX) * 0.5, 0.001);
  const maxDist = height * RAY_MAX_DIST_FRACTION;
  const eps = height * RAY_ORIGIN_EPSILON_FRACTION;
  const bvh = new GarmentBvh(geo.garmentTris);

  const acc = {
    left: { hitArea: 0, totalArea: 0, samples: 0 },
    right: { hitArea: 0, totalArea: 0, samples: 0 },
  };
  for (const f of geo.bodyFaces) {
    const yn = (f.centroid.y - geo.bodyMinY) / height;
    if (yn < SHOULDER_YN_LO || yn > SHOULDER_YN_HI) continue;
    if (Math.abs(f.centroid.x - cx) < halfW * LATERAL_FRACTION) continue;
    const side = f.centroid.x > cx ? acc.left : acc.right;
    side.totalArea += f.area;
    side.samples += 1;
    const origin = {
      x: f.centroid.x + f.normal.x * eps,
      y: f.centroid.y + f.normal.y * eps,
      z: f.centroid.z + f.normal.z * eps,
    };
    if (bvh.hit(origin, f.normal, maxDist)) side.hitArea += f.area;
  }

  const sides: SideCoverage[] = (["left", "right"] as const).map((side) => {
    const a = acc[side];
    return {
      side,
      coveredFraction: round4(a.totalArea > 0 ? a.hitArea / a.totalArea : 0),
      sampleCount: a.samples,
    };
  });
  return { sides };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
