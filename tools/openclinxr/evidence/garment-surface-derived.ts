/**
 * #121 garment surface derivation — continuity + body-offset from exported glTF.
 *
 * Measures shipped humanoids under apps/ui-xr/public/generated-humanoids/ via NodeIO.
 * claimScope: garment mesh is one continuous surface over the shoulder AND vertices track
 * the body surface within a cloth offset band. Counterweight: body triangle count must
 * remain (no #73-style hide/delete to fake a fit).
 * notEvidenceFor: "looks worn", fabric realism, production readiness, clinical costume.
 *
 * Continuity is measured from EXPORTED indices (shared vertex indices), never Blender intent.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;

/** Cloth offset band: skin-hugging to baggy sleeve (meters). Cage verts sit far outside this. */
const OFFSET_BAND_MIN_M = 0.002;
const OFFSET_BAND_MAX_M = 0.08;

type Vec3 = { x: number; y: number; z: number };

export type GarmentDerivation = {
  assetPath: string;
  garmentMeshName: string;
  connectedComponentCount: number;
  shoulderSpannedByOneComponent: boolean;
  offsetMinMeters: number;
  offsetMaxMeters: number;
  fractionWithinOffsetBand: number;
  bodyTriangleCount: number;
};

export type GarmentSurfaceDerivationReport = {
  assets: GarmentDerivation[];
  measuredAt: string;
  humanoidDir: string;
};

/**
 * Enumerate every shipped humanoid GLB (dynamic — not a hardcoded list) and measure
 * garment surface derivation facts from the exported glTF.
 */
export async function inspectGarmentSurfaceDerivation(
  opts: { humanoidDir?: string } = {},
): Promise<GarmentSurfaceDerivationReport> {
  const humanoidDir = opts.humanoidDir
    ? path.isAbsolute(opts.humanoidDir)
      ? opts.humanoidDir
      : path.resolve(process.cwd(), opts.humanoidDir)
    : path.resolve(process.cwd(), "apps/ui-xr/public/generated-humanoids");

  if (!existsSync(humanoidDir)) {
    throw new Error(`inspectGarmentSurfaceDerivation: dir not found: ${humanoidDir}`);
  }

  const glbs = readdirSync(humanoidDir)
    .filter((f) => f.endsWith(".glb") && !f.includes("rigging"))
    .filter((f) => !f.endsWith(".anny_base.glb"))
    .sort();

  const assets: GarmentDerivation[] = [];
  for (const file of glbs) {
    const abs = path.join(humanoidDir, file);
    const rel = path.relative(process.cwd(), abs);
    const one = await measureOneAsset(abs, rel);
    if (one) assets.push(one);
  }

  return {
    assets,
    measuredAt: new Date().toISOString(),
    humanoidDir: path.relative(process.cwd(), humanoidDir) || humanoidDir,
  };
}

async function measureOneAsset(
  absPath: string,
  assetPath: string,
): Promise<GarmentDerivation | null> {
  const document = await new NodeIO().read(absPath);
  const shells = collectGarmentShells(document);
  if (shells.length === 0) return null;

  // Primary = largest non-under shell (outer silhouette). Under = any __under_ shell.
  // Aggregation policy (#208): wardrobe-stack, not min/max of independent meshes.
  // Open-front outers deliberately lack centerline anterior fabric; closed under-layers
  // supply front enclosure (#103). Measuring only the largest mesh mis-labelled that as
  // "lost #121 shoulder coverage" while deltoids/back/1-comp still held on the outer.
  const nonUnder = shells.filter((s) => !s.isUnder);
  const garment =
    nonUnder.sort((a, b) => b.vertexCount - a.vertexCount)[0] ??
    shells.sort((a, b) => b.vertexCount - a.vertexCount)[0]!;
  const under =
    shells
      .filter((s) => s.isUnder)
      .sort((a, b) => b.vertexCount - a.vertexCount)[0] ?? null;

  const body = collectBodyMesh(document, garment.meshName);
  const components = connectedComponents(garment.indices, garment.vertexCount);
  // Ignore glTF export micro-debris (≤ few verts): exporter splits barely-attached
  // hem triangles even when Blender topology is a single component. Continuity of
  // the covering surface is about the meaningful shell, not 4-vert export dust.
  const minMeaningful = Math.max(24, Math.floor(garment.vertexCount * 0.01));
  const meaningful = components.filter((c) => c.length >= minMeaningful);
  const outerComps = meaningful.length > 0 ? meaningful : components;
  const shoulderSpannedByOneComponent = shoulderSpannedWardrobe(
    garment.positions,
    outerComps,
    under,
    body,
  );
  const offsets = nearestBodyOffsets(garment.positions, body.positions);
  let inBand = 0;
  let offsetMin = Infinity;
  let offsetMax = -Infinity;
  for (const d of offsets) {
    offsetMin = Math.min(offsetMin, d);
    offsetMax = Math.max(offsetMax, d);
    if (d >= OFFSET_BAND_MIN_M && d <= OFFSET_BAND_MAX_M) inBand += 1;
  }
  const n = offsets.length || 1;
  if (!Number.isFinite(offsetMin)) {
    offsetMin = 0;
    offsetMax = 0;
  }

  return {
    assetPath,
    garmentMeshName: garment.meshName,
    // Meaningful components only (export micro-islands excluded — see above).
    connectedComponentCount: meaningful.length > 0 ? meaningful.length : components.length,
    shoulderSpannedByOneComponent,
    offsetMinMeters: round4(offsetMin),
    offsetMaxMeters: round4(offsetMax),
    fractionWithinOffsetBand: round4(inBand / n),
    bodyTriangleCount: body.triangleCount,
  };
}

type MeshGeom = {
  meshName: string;
  positions: Vec3[];
  indices: number[];
  vertexCount: number;
  isUnder: boolean;
};

function collectGarmentShells(document: Document): MeshGeom[] {
  const shells: MeshGeom[] = [];
  for (const mesh of document.getRoot().listMeshes()) {
    const meshName = mesh.getName() || "";
    if (!GARMENT_MESH_RE.test(meshName)) continue;
    if (DECLARED_ANY_RE.test(meshName)) continue;

    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute("POSITION");
      const arr = posAttr?.getArray();
      if (!arr || arr.length < 9) continue;
      const positions = positionsToVec3(arr);
      const idxAttr = prim.getIndices();
      const idxArr = idxAttr?.getArray();
      const indices: number[] = [];
      if (idxArr) {
        for (let i = 0; i < idxArr.length; i++) indices.push(Number(idxArr[i]));
      } else {
        for (let i = 0; i < positions.length; i++) indices.push(i);
      }
      shells.push({
        meshName,
        positions,
        indices,
        vertexCount: positions.length,
        isUnder: /__under_/i.test(meshName),
      });
      break;
    }
  }
  return shells;
}

function collectBodyMesh(
  document: Document,
  garmentMeshName: string,
): { positions: Vec3[]; triangleCount: number; minY: number; maxY: number; cx: number; cz: number; halfW: number } {
  const positions: Vec3[] = [];
  let triangleCount = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(name) || DECLARED_ANY_RE.test(name) || name === garmentMeshName) {
      continue;
    }
    for (const prim of mesh.listPrimitives()) {
      const arr = prim.getAttribute("POSITION")?.getArray();
      if (!arr) continue;
      const base = positions.length;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        positions.push({
          x: Number(arr[i]),
          y: Number(arr[i + 1]),
          z: Number(arr[i + 2]),
        });
      }
      const idx = prim.getIndices()?.getArray();
      if (idx) {
        triangleCount += Math.floor(idx.length / 3);
      } else {
        triangleCount += Math.floor((arr.length / 3) / 3);
      }
      void base;
    }
  }
  if (positions.length === 0) {
    return {
      positions: [],
      triangleCount: 0,
      minY: 0,
      maxY: 1,
      cx: 0,
      cz: 0,
      halfW: 0.25,
    };
  }
  const minY = Math.min(...positions.map((v) => v.y));
  const maxY = Math.max(...positions.map((v) => v.y));
  const minX = Math.min(...positions.map((v) => v.x));
  const maxX = Math.max(...positions.map((v) => v.x));
  const minZ = Math.min(...positions.map((v) => v.z));
  const maxZ = Math.max(...positions.map((v) => v.z));
  return {
    positions,
    triangleCount,
    minY,
    maxY,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    halfW: Math.max((maxX - minX) * 0.5, 0.001),
  };
}

/** Union-find connected components over triangle edges (exported shared indices). */
function connectedComponents(indices: number[], vertexCount: number): number[][] {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (a: number): number => {
    let x = a;
    while (parent[x] !== x) x = parent[x]!;
    let y = a;
    while (parent[y] !== y) {
      const p = parent[y]!;
      parent[y] = x;
      y = p;
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    if (a < vertexCount && b < vertexCount) unite(a, b);
    if (b < vertexCount && c < vertexCount) unite(b, c);
    if (c < vertexCount && a < vertexCount) unite(c, a);
  }
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < vertexCount; i++) {
    const r = find(i);
    let list = buckets.get(r);
    if (!list) {
      list = [];
      buckets.set(r, list);
    }
    list.push(i);
  }
  // Drop isolated verts with no faces (components of size 1 that never appear in indices)
  const used = new Set(indices);
  return [...buckets.values()].filter((comp) => comp.some((vi) => used.has(vi)));
}

type SpanFlags = {
  oneComponent: boolean;
  front: boolean;
  back: boolean;
  leftDeltoidTop: boolean;
  rightDeltoidTop: boolean;
};

/**
 * Region flags for one shell: ONE connected component that reaches front torso,
 * both deltoid tops, and back. Continuity of the covering surface is the point of
 * #121 / §6t — not mere presence of nearby verts.
 */
function spanFlags(
  positions: Vec3[],
  components: number[][],
  body: { minY: number; maxY: number; cx: number; cz: number; halfW: number },
): SpanFlags {
  const empty: SpanFlags = {
    oneComponent: false,
    front: false,
    back: false,
    leftDeltoidTop: false,
    rightDeltoidTop: false,
  };
  if (components.length !== 1 || positions.length === 0) return empty;
  const comp = components[0]!;
  const height = Math.max(body.maxY - body.minY, 0.001);
  // Torso band for front/back (chest, not hem/collar only).
  const yChestLo = body.minY + height * 0.5;
  const yChestHi = body.minY + height * 0.78;
  // Deltoid TOP: upper lateral — a torso ring's mid-height side verts do not qualify.
  const yDeltoidLo = body.minY + height * 0.78;
  const yDeltoidHi = body.minY + height * 0.96;
  const lat = body.halfW * 0.32;

  // Front/back from the garment's own Z range (body AABB cz is unreliable when depth is thin).
  const zs = comp.map((vi) => positions[vi]?.z).filter((z): z is number => z !== undefined);
  if (zs.length < 8) return empty;
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const zSpan = Math.max(zMax - zMin, 0.001);
  const frontZ = zMin + zSpan * 0.65; // anterior third of garment depth
  const backZ = zMin + zSpan * 0.35; // posterior third

  let front = false;
  let leftDeltoidTop = false;
  let rightDeltoidTop = false;
  let back = false;
  for (const vi of comp) {
    const v = positions[vi];
    if (!v) continue;
    const lateral = Math.abs(v.x - body.cx) >= lat;
    if (v.y >= yChestLo && v.y <= yChestHi) {
      if (v.z >= frontZ && !lateral) front = true;
      if (v.z <= backZ && !lateral) back = true;
    }
    if (v.y >= yDeltoidLo && v.y <= yDeltoidHi && lateral) {
      if (v.x >= body.cx) leftDeltoidTop = true;
      if (v.x < body.cx) rightDeltoidTop = true;
    }
  }
  return {
    oneComponent: true,
    front,
    back,
    leftDeltoidTop,
    rightDeltoidTop,
  };
}

/**
 * Wardrobe-stack shoulder span (#208 aggregation):
 * - Closed / single shell: one component must itself carry front + back + both deltoids.
 * - Open outer + closed under: outer must carry 1-comp + back + both deltoids; front may
 *   come from the under-layer (open placket has no centerline anterior fabric by design).
 *
 * Rejected: min-across-meshes (outer always fails front alone); max-across-meshes (any
 * closed under alone would pass even if outer lost deltoids); counting lateral front
 * panels as "front" on the open shell without an under-layer (would green a bare open
 * cardigan and undo #103).
 */
function shoulderSpannedWardrobe(
  outerPositions: Vec3[],
  outerComponents: number[][],
  under: MeshGeom | null,
  body: { minY: number; maxY: number; cx: number; cz: number; halfW: number },
): boolean {
  const outer = spanFlags(outerPositions, outerComponents, body);
  if (!outer.oneComponent) return false;
  if (!outer.back || !outer.leftDeltoidTop || !outer.rightDeltoidTop) return false;
  if (outer.front) return true;
  if (!under) return false;
  const underComps = connectedComponents(under.indices, under.vertexCount);
  const minMeaningful = Math.max(24, Math.floor(under.vertexCount * 0.01));
  const meaningful = underComps.filter((c) => c.length >= minMeaningful);
  const underFlags = spanFlags(
    under.positions,
    meaningful.length > 0 ? meaningful : underComps,
    body,
  );
  return underFlags.oneComponent && underFlags.front;
}

/**
 * Per-garment-vertex distance to nearest body vertex (proxy for surface offset).
 * Dense body meshes make nearest-vertex ≈ surface distance for cloth-offset scales.
 */
function nearestBodyOffsets(garment: Vec3[], body: Vec3[]): number[] {
  if (garment.length === 0 || body.length === 0) return garment.map(() => 1);
  // Spatial hash for O(n) nearest
  const cell = 0.04;
  const grid = new Map<string, Vec3[]>();
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const b of body) {
    const k = key(b.x, b.y, b.z);
    let list = grid.get(k);
    if (!list) {
      list = [];
      grid.set(k, list);
    }
    list.push(b);
  }
  const out: number[] = [];
  for (const g of garment) {
    let best = Infinity;
    const ix = Math.floor(g.x / cell);
    const iy = Math.floor(g.y / cell);
    const iz = Math.floor(g.z / cell);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const list = grid.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!list) continue;
          for (const b of list) {
            const d = Math.hypot(g.x - b.x, g.y - b.y, g.z - b.z);
            if (d < best) best = d;
          }
        }
      }
    }
    // Fallback full scan if hash miss (rare)
    if (!Number.isFinite(best) || best === Infinity) {
      for (const b of body) {
        const d = Math.hypot(g.x - b.x, g.y - b.y, g.z - b.z);
        if (d < best) best = d;
      }
    }
    out.push(best);
  }
  return out;
}

function positionsToVec3(arr: ArrayLike<number>): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < arr.length; i += 3) {
    out.push({ x: Number(arr[i]), y: Number(arr[i + 1]), z: Number(arr[i + 2]) });
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
