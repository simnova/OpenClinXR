/**
 * #124 garment hem boundary — regularity of the cut edge + midriff gap vs painted lower.
 *
 * Measures shipped humanoids under apps/ui-xr/public/generated-humanoids/ via NodeIO.
 * claimScope: topological hem regularity + mesh-vs-paint waistline relationship only.
 * notEvidenceFor: sewn-hem appearance, fabric realism, production readiness, clinical costume.
 *
 * Measurements come from EXPORTED glTF indices/positions — never Blender intent.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;
const LOWER_PAINT_MAT_RE = /openclinxr_role_mesh_clothing_.*_lower/i;

type Vec3 = { x: number; y: number; z: number };

export type HemBoundary = {
  assetPath: string;
  garmentMeshName: string;
  garmentKind: string;
  hemLoopCount: number;
  hemLoopVertexCount: number;
  hemPerimeterRatio: number;
  hemMaxTurnDegrees: number;
  hemLowestY: number;
  paintedLowerTopY: number;
  shoulderSpannedByOneComponent: boolean;
  hasPaintedLowerRegion: boolean;
};

export type HemBoundaryReport = {
  assets: HemBoundary[];
  measuredAt: string;
  humanoidDir: string;
};

/**
 * Enumerate every shipped humanoid GLB and measure hem-boundary facts from the exported glTF.
 */
export async function inspectGarmentHemBoundary(
  opts: { humanoidDir?: string } = {},
): Promise<HemBoundaryReport> {
  const humanoidDir = opts.humanoidDir
    ? path.isAbsolute(opts.humanoidDir)
      ? opts.humanoidDir
      : path.resolve(process.cwd(), opts.humanoidDir)
    : path.resolve(process.cwd(), "apps/ui-xr/public/generated-humanoids");

  if (!existsSync(humanoidDir)) {
    throw new Error(`inspectGarmentHemBoundary: dir not found: ${humanoidDir}`);
  }

  const glbs = readdirSync(humanoidDir)
    .filter((f) => f.endsWith(".glb") && !f.includes("rigging"))
    .filter((f) => !f.endsWith(".anny_base.glb"))
    .sort();

  const assets: HemBoundary[] = [];
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
): Promise<HemBoundary | null> {
  const document = await new NodeIO().read(absPath);
  const shells = collectGarmentShells(document);
  if (shells.length === 0) return null;

  // Primary = largest non-under shell. Aggregation: wardrobe-stack (#208) — see surface-derived.
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
  const minMeaningful = Math.max(24, Math.floor(garment.vertexCount * 0.01));
  const meaningful = components.filter((c) => c.length >= minMeaningful);
  const shoulderSpannedByOneComponent = shoulderSpannedWardrobe(
    garment.positions,
    meaningful.length > 0 ? meaningful : components,
    under,
    body,
  );

  const paint = measurePaintedLower(document, garment.meshName);
  const hem = measureHemLoop(garment.positions, garment.indices);
  const kind = inferGarmentKind(garment.meshName, assetPath);

  return {
    assetPath,
    garmentMeshName: garment.meshName,
    garmentKind: kind,
    hemLoopCount: hem.loopCount,
    hemLoopVertexCount: hem.vertexCount,
    hemPerimeterRatio: round4(hem.perimeterRatio),
    hemMaxTurnDegrees: round4(hem.maxTurnDegrees),
    hemLowestY: round4(hem.lowestY),
    paintedLowerTopY: round4(paint.topY),
    shoulderSpannedByOneComponent,
    hasPaintedLowerRegion: paint.hasPaint,
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

function measurePaintedLower(
  document: Document,
  garmentMeshName: string,
): { hasPaint: boolean; topY: number } {
  let maxY = -Infinity;
  let triCount = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(name) || DECLARED_ANY_RE.test(name) || name === garmentMeshName) {
      continue;
    }
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() || "";
      if (!LOWER_PAINT_MAT_RE.test(matName)) continue;
      const pos = prim.getAttribute("POSITION")?.getArray();
      const idx = prim.getIndices()?.getArray();
      if (!pos) continue;
      if (idx) {
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const a = Number(idx[t]);
          const b = Number(idx[t + 1]);
          const c = Number(idx[t + 2]);
          const y =
            (Number(pos[a * 3 + 1]) + Number(pos[b * 3 + 1]) + Number(pos[c * 3 + 1])) / 3;
          if (y > maxY) maxY = y;
          triCount += 1;
        }
      } else {
        for (let i = 1; i < pos.length; i += 3) {
          const y = Number(pos[i]);
          if (y > maxY) maxY = y;
          triCount += 1;
        }
      }
    }
  }
  if (triCount === 0 || !Number.isFinite(maxY)) {
    return { hasPaint: false, topY: 0 };
  }
  return { hasPaint: true, topY: maxY };
}

/**
 * Hem = lowest boundary loop (or lowest open chain for open-front).
 * Perimeter ratio = path length / convex-hull perimeter in the loop's best plane (XZ for horizontal hems).
 * Max turn = largest consecutive-edge direction change in degrees.
 */
function measureHemLoop(
  positions: Vec3[],
  indices: number[],
): {
  loopCount: number;
  vertexCount: number;
  perimeterRatio: number;
  maxTurnDegrees: number;
  lowestY: number;
} {
  if (positions.length === 0 || indices.length < 3) {
    return {
      loopCount: 0,
      vertexCount: 0,
      perimeterRatio: 99,
      maxTurnDegrees: 180,
      lowestY: 0,
    };
  }

  const edgeCount = new Map<string, number>();
  const edgeEnds = new Map<string, [number, number]>();
  const addEdge = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const k = `${lo},${hi}`;
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    edgeEnds.set(k, [lo, hi]);
  };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const boundaryAdj = new Map<number, number[]>();
  for (const [k, count] of edgeCount) {
    if (count !== 1) continue;
    const ends = edgeEnds.get(k)!;
    const [a, b] = ends;
    let la = boundaryAdj.get(a);
    if (!la) {
      la = [];
      boundaryAdj.set(a, la);
    }
    la.push(b);
    let lb = boundaryAdj.get(b);
    if (!lb) {
      lb = [];
      boundaryAdj.set(b, lb);
    }
    lb.push(a);
  }

  // Walk all boundary loops / chains.
  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const start of boundaryAdj.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let prev = -1;
    let cur = start;
    while (!visited.has(cur)) {
      visited.add(cur);
      loop.push(cur);
      const nbrs = boundaryAdj.get(cur) || [];
      let next = -1;
      for (const n of nbrs) {
        if (n !== prev) {
          next = n;
          break;
        }
      }
      // Degree-2 preferred: if both unvisited, pick first not prev.
      if (next < 0) {
        for (const n of nbrs) {
          if (!visited.has(n)) {
            next = n;
            break;
          }
        }
      }
      if (next < 0 || next === start) {
        if (next === start && loop.length >= 3) {
          // closed
        }
        break;
      }
      prev = cur;
      cur = next;
      if (cur === start) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  // Prefer the loop with lowest mean Y among reasonably large ones (hem vs cuff dust).
  const minLoopVerts = 8;
  const candidates = loops.filter((l) => l.length >= minLoopVerts);
  const scored = (candidates.length > 0 ? candidates : loops).map((loop) => {
    const ys = loop.map((vi) => positions[vi]?.y ?? 0);
    const meanY = ys.reduce((s, y) => s + y, 0) / Math.max(ys.length, 1);
    return { loop, meanY, minY: Math.min(...ys) };
  });
  scored.sort((a, b) => a.meanY - b.meanY);

  // Open-front garments can fuse neck/front/hem into one loop. Extract the bottom band of that loop.
  let hemPath: number[] = scored[0]?.loop ?? [];
  if (hemPath.length > 0) {
    const allY = hemPath.map((vi) => positions[vi]!.y);
    const lo = Math.min(...allY);
    const hi = Math.max(...allY);
    const span = Math.max(hi - lo, 0.001);
    // Bottom 22% of the loop's own Y range — captures hem without climbing the front opening.
    const bandTop = lo + span * 0.22;
    const inBand = new Set(hemPath.filter((vi) => positions[vi]!.y <= bandTop));
    if (inBand.size >= 6) {
      // Walk only edges that stay in the band, produce the longest chain.
      const bandAdj = new Map<number, number[]>();
      for (const vi of inBand) {
        for (const n of boundaryAdj.get(vi) || []) {
          if (!inBand.has(n)) continue;
          let list = bandAdj.get(vi);
          if (!list) {
            list = [];
            bandAdj.set(vi, list);
          }
          list.push(n);
        }
      }
      const chain = longestPathInGraph(bandAdj);
      if (chain.length >= 6) hemPath = chain;
    }
  }

  const lowestY =
    hemPath.length > 0
      ? Math.min(...hemPath.map((vi) => positions[vi]!.y))
      : Math.min(...positions.map((p) => p.y));

  if (hemPath.length < 3) {
    return {
      loopCount: loops.length,
      vertexCount: hemPath.length,
      perimeterRatio: 99,
      maxTurnDegrees: 180,
      lowestY,
    };
  }

  // Ordered path length + turns.
  let pathLen = 0;
  let maxTurn = 0;
  const pts: Vec3[] = hemPath.map((vi) => positions[vi]!);
  // Close the loop if endpoints are adjacent on boundary.
  const closed =
    (boundaryAdj.get(hemPath[0]!) || []).includes(hemPath[hemPath.length - 1]!) &&
    hemPath.length >= 6;
  const seq = closed ? [...pts, pts[0]!] : pts;
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i]!;
    const b = seq[i + 1]!;
    pathLen += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  for (let i = 1; i + 1 < seq.length; i++) {
    const a = seq[i - 1]!;
    const b = seq[i]!;
    const c = seq[i + 1]!;
    const d1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const d2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const l1 = Math.hypot(d1.x, d1.y, d1.z) || 1e-9;
    const l2 = Math.hypot(d2.x, d2.y, d2.z) || 1e-9;
    const cos = (d1.x * d2.x + d1.y * d2.y + d1.z * d2.z) / (l1 * l2);
    const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (ang > maxTurn) maxTurn = ang;
  }

  // Convex hull of path projected to XZ (horizontal hem plane).
  const hull = convexHull2d(pts.map((p) => ({ x: p.x, y: p.z })));
  let hullLen = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    hullLen += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const perimeterRatio = hullLen > 1e-6 ? pathLen / hullLen : 99;

  return {
    loopCount: loops.length,
    vertexCount: hemPath.length,
    perimeterRatio,
    maxTurnDegrees: maxTurn,
    lowestY,
  };
}

function longestPathInGraph(adj: Map<number, number[]>): number[] {
  let best: number[] = [];
  for (const start of adj.keys()) {
    const path: number[] = [start];
    const seen = new Set<number>([start]);
    let cur = start;
    let prev = -1;
    while (true) {
      const nbrs = adj.get(cur) || [];
      let next = -1;
      for (const n of nbrs) {
        if (n !== prev && !seen.has(n)) {
          next = n;
          break;
        }
      }
      if (next < 0) break;
      seen.add(next);
      path.push(next);
      prev = cur;
      cur = next;
    }
    if (path.length > best.length) best = path;
  }
  return best;
}

/** Monotone-chain convex hull on 2D points. */
function convexHull2d(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const uniq = new Map<string, { x: number; y: number }>();
  for (const p of pts) uniq.set(`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p);
  const sorted = [...uniq.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
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
        triangleCount += Math.floor(arr.length / 9);
      }
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
  const yChestLo = body.minY + height * 0.5;
  const yChestHi = body.minY + height * 0.78;
  const yDeltoidLo = body.minY + height * 0.78;
  const yDeltoidHi = body.minY + height * 0.96;
  const lat = body.halfW * 0.32;
  const zs = comp.map((vi) => positions[vi]?.z).filter((z): z is number => z !== undefined);
  if (zs.length < 8) return empty;
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const zSpan = Math.max(zMax - zMin, 0.001);
  const frontZ = zMin + zSpan * 0.65;
  const backZ = zMin + zSpan * 0.35;
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

/** Wardrobe-stack shoulder span — same policy as garment-surface-derived (#208). */
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

function inferGarmentKind(meshName: string, assetPath: string): string {
  const s = `${meshName} ${assetPath}`.toLowerCase();
  if (s.includes("gown") || s.includes("adult_cast")) return "gown";
  if (s.includes("cardigan") || s.includes("open") || s.includes("parent") || s.includes("spouse")) {
    return "open_front";
  }
  if (s.includes("scrub") || s.includes("nurse")) return "scrub";
  if (s.includes("tshirt") || s.includes("patient_child")) return "tshirt";
  return "closed_default";
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
