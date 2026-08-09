#!/usr/bin/env tsx
/**
 * #250 Equipment decimation decision — bedside monitor, MADR 0050 steps 2–4.
 *
 * The #239 ladder ran ONE instrument (global meshopt `simplify` with `lockBorder`,
 * chained ratio rungs 0.10 → 0.05 → 0.03 → 0.02) and flattened at 106,025 tris.
 * This module measures the paths MADR 0050 steps 2–4 prescribe but which were never
 * run on these assets, on the SINGLE subject that can flip the 60,000 per-asset
 * budget decision: the bedside monitor at its current ladder state.
 *
 * Paths attempted (each recorded with resulting triangle count and whether visible
 * exterior geometry was altered):
 *   1. strip_interior                  — delete triangles hidden from all outside views
 *   2. strip_weld                      — strip + position weld (MADR 0050 steps 2–3)
 *   3. strip_weld_simplify_per_part    — + per-component meshopt simplify, ROIs = components
 *   4. global_simplify_retargeted      — control: meshopt simplify, direct target (no chain, no lockBorder)
 *   5. simplify_sloppy                 — meshopt simplifySloppy, ratio 0.55 (benchmark-only per MADR 0050)
 *   6. blender_decimate_0_65           — Blender DECIMATE modifier @ 0.65 (benchmark-only)
 *   7. raw_strip_weld_simplify_per_part — the designed pipeline from the RAW TRELLIS export
 *
 * BINARY DECISION (not an optimisation exercise): any path under 60,000 with exterior
 * preserved → the monitor fits, consume without an exception. Otherwise the exception
 * is grounded in a measured floor. Do not tune toward 60,000 — a mesh mangled to clear
 * a threshold is worse than an honest exception.
 *
 * Header IMMUTABLE — append `## FIXED (#250)` below rather than rewriting it.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptSimplifier } from "meshoptimizer";

const require = createRequire(import.meta.url);
const draco3d = require("draco3d") as { createDecoderModule: () => Promise<unknown> };
let dracoDecoderModule: Promise<unknown> | null = null;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Source evidence root in the main repo (gitignored — absent in worktrees). */
const MAIN_REPO_EVIDENCE = "/Volumes/files/src/openclinxr/.openclinxr/evidence";

/** Current monitor state: best #239 global-simplify rung (ratio_0.02). */
const CURRENT_MONITOR = path.join(
  MAIN_REPO_EVIDENCE,
  "issue-239",
  "bedside-monitor",
  "bedside-monitor-r0.02.glb",
);

/** Raw TRELLIS bake (issue-237). */
const RAW_MONITOR = path.join(
  MAIN_REPO_EVIDENCE,
  "issue-237",
  "bedside-monitor",
  "bedside-monitor.glb",
);

const EVIDENCE_DIR = path.resolve(REPO_ROOT, ".openclinxr/evidence/issue-250");
const OUTPUTS_DIR = path.join(EVIDENCE_DIR, "outputs");
const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
const REPORT_PATH = path.join(EVIDENCE_DIR, "decimation-report.json");
const BLENDER_DECIMATE_SCRIPT = path.join(REPO_ROOT, "benchmarks/glb-optimization/blender_decimate_draco.py");

// ---------------------------------------------------------------------------
// Tuning constants (documented, not budget changes)
// ---------------------------------------------------------------------------

const SOFT_TARGET = 60_000; // per-asset budget — must NOT be changed
const HARD_CEILING = 180_000; // per-station budget — must NOT be changed
const VIEW_COUNT = 128; // visibility classification views (Fibonacci sphere)
const RESOLUTION = 1024; // rasterization resolution (px per side) for current-state meshes
/** Resolution for the RAW-pipeline path: the raw simplify output carries ~19k
 *  large overlapping panels (avg 18k px screen bbox), so 1024px classification
 *  costs ~19 s/view (~40 min for 128 views). 256px costs ~1.6 s/view and still
 *  classifies panel-scale geometry; input and output use the SAME 256px so the
 *  exterior-area and silhouette comparisons stay consistent within that path. */
const RAW_MEASURE_RES = 256;
const WELD_TOLERANCE = 5e-4; // position weld epsilon (MADR 0050 step 3: ~1e-4..1e-5 × scale)
const IO_THRESHOLD = 0.98; // min silhouette IoU below which exterior is "altered"
const AREA_THRESHOLD = 0.95; // min exterior-area retained fraction below which exterior is "altered"
const SLOPPY_RATIO = 0.55; // benchmark ratio for simplifySloppy
const DECIMATE_RATIO = 0.65; // benchmark ratio for Blender DECIMATE (matches benchmarks/glb-optimization)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AABB = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  cx: number;
  cy: number;
  cz: number;
  ex: number;
  ey: number;
  ez: number;
};

type RawMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  triCount: number;
  vertexCount: number;
  aabb: AABB;
};

type PathResult = {
  id: string;
  method: string;
  inputTris: number;
  outputTris: number;
  outputPath: string;
  under60000: boolean;
  exteriorAltered: boolean;
  minSilhouetteIoU: number;
  silhouetteIoU: Record<string, number>;
  exteriorAreaRetained: number;
  notes: string[];
};

type ComponentPart = {
  triIndices: Uint32Array;
  triCount: number;
  extent: number; // max AABB extent of the part
};

type Report = {
  schemaVersion: string;
  measuredAgainstCommit: string;
  generatedAt: string;
  subject: string;
  input: {
    path: string;
    triangleCount: number;
    vertices: number;
    interiorSplit: {
      method: string;
      viewCount: number;
      resolution: number;
      exteriorTris: number;
      interiorTris: number;
      interiorFraction: number;
      sensitivity: { viewCounts: number[]; interiorFractions: number[] };
    };
  };
  paths: PathResult[];
  decision: {
    anyPathUnder60000WithExteriorPreserved: boolean;
    bestPath: string;
    conclusion:
      | "consume_no_exception"
      | "exception_grounded_measured_floor"
      | "no_path_under_60000";
    note: string;
  };
  softTarget: number;
  hardCeiling: number;
  claimScope: string[];
  notEvidenceFor: string[];
};

// ---------------------------------------------------------------------------
// Mesh I/O
// ---------------------------------------------------------------------------

/** Shared NodeIO with all extensions and a Draco decoder (Blender DECIMATE path
 *  writes Draco-compressed GLBs). */
async function createIO(): Promise<NodeIO> {
  if (!dracoDecoderModule) dracoDecoderModule = draco3d.createDecoderModule();
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  try {
    const decoder = await dracoDecoderModule;
    io.registerDependencies({ "draco3d.decoder": decoder });
  } catch {
    // draco decoder unavailable — non-Draco GLBs still read fine
  }
  return io;
}

async function loadRawMesh(glbPath: string): Promise<RawMesh> {
  const io = await createIO();
  const doc = await io.read(glbPath);
  const mesh = doc.getRoot().listMeshes()[0];
  if (!mesh) throw new Error(`no mesh in ${glbPath}`);
  const prim = mesh.listPrimitives()[0];
  if (!prim) throw new Error(`no primitive in ${glbPath}`);
  const pos = prim.getAttribute("POSITION");
  if (!pos) throw new Error(`no POSITION attribute in ${glbPath}`);
  const arr = pos.getArray() as Float32Array;
  const count = pos.getCount();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = arr[i * 3] as number;
    positions[i * 3 + 1] = arr[i * 3 + 1] as number;
    positions[i * 3 + 2] = arr[i * 3 + 2] as number;
  }
  const idx = prim.getIndices();
  let indices: Uint32Array;
  if (idx) {
    const iarr = idx.getArray() as Uint32Array | Uint16Array;
    const icount = idx.getCount();
    indices = new Uint32Array(icount);
    for (let i = 0; i < icount; i++) indices[i] = iarr[i] as number;
  } else {
    indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
  }
  return { positions, indices, triCount: indices.length / 3, vertexCount: count, aabb: computeAABB(positions) };
}

function computeAABB(positions: Float32Array): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] as number, y = positions[i + 1] as number, z = positions[i + 2] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    minX, minY, minZ, maxX, maxY, maxZ,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2,
    ex: maxX - minX, ey: maxY - minY, ez: maxZ - minZ,
  };
}

/**
 * Write a GLB with the given positions (or originals when null) and triangle
 * indices, cloning the source document so materials/textures survive.
 */
async function writeMeshToGlb(
  srcPath: string,
  positions: Float32Array | null,
  indices: Uint32Array,
  outPath: string,
): Promise<void> {
  const io = await createIO();
  const doc = await io.read(srcPath);
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh?.listPrimitives()[0];
  if (!mesh || !prim) throw new Error(`cannot clone mesh structure from ${srcPath}`);
  if (positions) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) throw new Error(`no POSITION attribute in ${srcPath}`);
    pos.setArray(positions as unknown as Float32Array<ArrayBuffer>);
  }
  const idx = prim.getIndices();
  const indicesArr = indices as unknown as Uint32Array<ArrayBuffer>;
  if (idx) {
    idx.setArray(indicesArr);
  } else {
    prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(indicesArr));
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
}

/**
 * Position weld with tolerance (MADR 0050 step 3). Merges vertices within `eps`
 * using a spatial hash grid with 3×3×3 neighbour checks; drops degenerate triangles.
 * Positions are KEPT as-is: each merged cluster is represented by one ORIGINAL
 * vertex id, so the remapped indices keep pointing into the unchanged POSITION
 * accessor (geometry shifts by at most `eps`).
 */
function weldPositions(mesh: RawMesh, eps: number): Uint32Array {
  const cellOf = (v: number): number => Math.round(v / eps);
  const map = new Map<string, number>();
  const repOriginal: number[] = []; // per cluster id -> representative original vertex id
  const remap = new Int32Array(mesh.vertexCount);
  const clusterPos: number[] = [];
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions[i * 3] as number;
    const y = mesh.positions[i * 3 + 1] as number;
    const z = mesh.positions[i * 3 + 2] as number;
    const cx = cellOf(x), cy = cellOf(y), cz = cellOf(z);
    let best: number | undefined;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          const cand = map.get(key);
          if (cand === undefined) continue;
          const mx = clusterPos[cand * 3] as number;
          const my = clusterPos[cand * 3 + 1] as number;
          const mz = clusterPos[cand * 3 + 2] as number;
          if (Math.hypot(x - mx, y - my, z - mz) <= eps) {
            best = cand;
            break outer;
          }
        }
      }
    }
    if (best === undefined) {
      best = repOriginal.length;
      map.set(`${cx},${cy},${cz}`, best);
      repOriginal.push(i);
      clusterPos.push(x, y, z);
    }
    remap[i] = repOriginal[best] as number;
  }
  const outIndices: number[] = [];
  for (let t = 0; t < mesh.triCount; t++) {
    const a = remap[mesh.indices[t * 3] as number] as number;
    const b = remap[mesh.indices[t * 3 + 1] as number] as number;
    const c = remap[mesh.indices[t * 3 + 2] as number] as number;
    if (a === b || b === c || a === c) continue;
    outIndices.push(a, b, c);
  }
  return new Uint32Array(outIndices);
}

function countTrianglesFromIndices(indices: Uint32Array): number {
  return Math.round(indices.length / 3);
}

// ---------------------------------------------------------------------------
// Visibility classification (z-buffer rasterizer)
// ---------------------------------------------------------------------------

function fibonacciSphere(count: number): Array<[number, number, number]> {
  const dirs: Array<[number, number, number]> = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = ga * i;
    dirs.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return dirs;
}

/**
 * Rasterize all triangles from one orthographic view; returns per-pixel winning
 * triangle index (-1 = empty) and per-triangle "won at least one pixel" flags.
 */
function rasterizeView(
  mesh: RawMesh,
  viewDir: [number, number, number],
  center: { cx: number; cy: number; cz: number },
  halfExtent: number,
  res: number,
): { winner: Int32Array; winFlags: Uint8Array } {
  const { positions, indices, triCount } = mesh;
  const [dx, dy, dz] = viewDir;
  let ux: number, uy: number, uz: number;
  if (Math.abs(dx) < 0.9) {
    ux = 1; uy = 0; uz = 0;
  } else {
    ux = 0; uy = 1; uz = 0;
  }
  let rx = dy * uz - dz * uy, ry = dz * ux - dx * uz, rz = dx * uy - dy * ux;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl; ry /= rl; rz /= rl;
  let px = ry * dz - rz * dy, py = rz * dx - rx * dz, pz = rx * dy - ry * dx;

  const zbuf = new Float32Array(res * res).fill(Infinity);
  const winner = new Int32Array(res * res).fill(-1);
  const scale = (res * 0.5) / halfExtent;

  const sx = new Float32Array(triCount * 3);
  const sy = new Float32Array(triCount * 3);
  const sd = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = (indices[t * 3 + k] as number) * 3;
      const x = (positions[vi] as number) - center.cx;
      const y = (positions[vi + 1] as number) - center.cy;
      const z = (positions[vi + 2] as number) - center.cz;
      sx[t * 3 + k] = (x * rx + y * ry + z * rz) * scale + res * 0.5;
      sy[t * 3 + k] = (x * px + y * py + z * pz) * scale + res * 0.5;
      sd[t * 3 + k] = x * dx + y * dy + z * dz;
    }
  }

  for (let t = 0; t < triCount; t++) {
    const a = t * 3;
    const minX = Math.max(0, Math.floor(Math.min(sx[a] as number, sx[a + 1] as number, sx[a + 2] as number)));
    const maxX = Math.min(res - 1, Math.ceil(Math.max(sx[a] as number, sx[a + 1] as number, sx[a + 2] as number)));
    const minY = Math.max(0, Math.floor(Math.min(sy[a] as number, sy[a + 1] as number, sy[a + 2] as number)));
    const maxY = Math.min(res - 1, Math.ceil(Math.max(sy[a] as number, sy[a + 1] as number, sy[a + 2] as number)));
    if (minX > maxX || minY > maxY) continue;

    const x0 = sx[a] as number, y0 = sy[a] as number;
    const x1 = sx[a + 1] as number, y1 = sy[a + 1] as number;
    const x2 = sx[a + 2] as number, y2 = sy[a + 2] as number;
    const d0 = x0 * y1 - x1 * y0 + x1 * y2 - x2 * y1 + x2 * y0 - x0 * y2;
    if (Math.abs(d0) < 1e-9) continue;
    const inv = 1 / d0;
    const eA = y1 - y2, eB = x2 - x1, eC = x1 * y2 - x2 * y1;
    const fA = y2 - y0, fB = x0 - x2, fC = x2 * y0 - x0 * y2;
    const gA = y0 - y1, gB = x1 - x0, gC = x0 * y1 - x1 * y0;

    for (let py = minY; py <= maxY; py++) {
      const row = py * res;
      for (let qx = minX; qx <= maxX; qx++) {
        const wx = qx + 0.5, wy = py + 0.5;
        const ee = eA * wx + eB * wy + eC;
        const ff = fA * wx + fB * wy + fC;
        const gg = gA * wx + gB * wy + gC;
        if (d0 > 0) {
          if (ee < 0 || ff < 0 || gg < 0) continue;
        } else if (ee > 0 || ff > 0 || gg > 0) {
          continue;
        }
        const dep = (sd[a] as number) * ee * inv + (sd[a + 1] as number) * ff * inv + (sd[a + 2] as number) * gg * inv;
        const pi = row + qx;
        if (dep < (zbuf[pi] as number)) {
          zbuf[pi] = dep;
          winner[pi] = t;
        }
      }
    }
  }

  const winFlags = new Uint8Array(triCount);
  for (let p = 0; p < res * res; p++) {
    const w = winner[p];
    if (w !== undefined && w >= 0) winFlags[w] = 1;
  }
  return { winner, winFlags };
}

/** Classify each triangle exterior (visible from ≥1 view) vs interior (hidden from all). */
function classifyVisibility(mesh: RawMesh, viewCount: number, res: number): Uint8Array {
  const { aabb } = mesh;
  const center = { cx: aabb.cx, cy: aabb.cy, cz: aabb.cz };
  const R = Math.max(aabb.ex, aabb.ey, aabb.ez) * 0.5;
  const halfExtent = R * 1.35;
  const dirs = fibonacciSphere(viewCount);
  const winAll = new Uint8Array(mesh.triCount);
  for (const d of dirs) {
    const { winFlags } = rasterizeView(mesh, d, center, halfExtent, res);
    for (let t = 0; t < mesh.triCount; t++) {
      if (winFlags[t] as number) winAll[t] = 1;
    }
  }
  return winAll;
}

/** Binary silhouette mask (per-pixel object/background) for one orthographic view. */
function silhouetteMask(mesh: RawMesh, viewDir: [number, number, number], res: number): Uint8Array {
  const { aabb } = mesh;
  const center = { cx: aabb.cx, cy: aabb.cy, cz: aabb.cz };
  const R = Math.max(aabb.ex, aabb.ey, aabb.ez) * 0.5;
  const halfExtent = R * 1.35;
  const { winner } = rasterizeView(mesh, viewDir, center, halfExtent, res);
  const mask = new Uint8Array(res * res);
  for (let p = 0; p < res * res; p++) {
    if ((winner[p] as number) >= 0) mask[p] = 1;
  }
  return mask;
}

function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] as number) && (b[i] as number)) inter++;
    if ((a[i] as number) || (b[i] as number)) union++;
  }
  return union === 0 ? 1 : inter / union;
}

const VIEW_AXES: Array<[string, [number, number, number]]> = [
  ["x_plus", [1, 0, 0]],
  ["y_plus", [0, 1, 0]],
  ["z_plus", [0, 0, 1]],
];

/** Sum of triangle areas for triangles with keepFlags[t] = 1. */
function triangleArea(mesh: RawMesh, keepFlags: Uint8Array | null): number {
  const { positions, indices } = mesh;
  let area = 0;
  for (let t = 0; t < mesh.triCount; t++) {
    if (keepFlags && !(keepFlags[t] as number)) continue;
    const i0 = (indices[t * 3] as number) * 3;
    const i1 = (indices[t * 3 + 1] as number) * 3;
    const i2 = (indices[t * 3 + 2] as number) * 3;
    const ax = (positions[i1] as number) - (positions[i0] as number);
    const ay = (positions[i1 + 1] as number) - (positions[i0 + 1] as number);
    const az = (positions[i1 + 2] as number) - (positions[i0 + 2] as number);
    const bx = (positions[i2] as number) - (positions[i0] as number);
    const by = (positions[i2 + 1] as number) - (positions[i0 + 1] as number);
    const bz = (positions[i2 + 2] as number) - (positions[i0 + 2] as number);
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    area += 0.5 * Math.hypot(cx, cy, cz);
  }
  return area;
}

// ---------------------------------------------------------------------------
// Decimation operations
// ---------------------------------------------------------------------------

/** Keep only triangles classified exterior. Returns new index array. */
function stripInterior(mesh: RawMesh, exterior: Uint8Array): Uint32Array {
  const kept: number[] = [];
  for (let t = 0; t < mesh.triCount; t++) {
    if (exterior[t] as number) {
      kept.push(mesh.indices[t * 3] as number, mesh.indices[t * 3 + 1] as number, mesh.indices[t * 3 + 2] as number);
    }
  }
  return new Uint32Array(kept);
}

/** Position-merged connected components (5dp) → parts as triangle-index lists. */
function connectedComponents(mesh: RawMesh): ComponentPart[] {
  const { positions, indices } = mesh;
  const vertexCount = mesh.vertexCount;
  // position-merge at 5dp
  const vertMap = new Map<string, number>();
  const remap = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const key = `${(positions[i * 3] as number).toFixed(5)},${(positions[i * 3 + 1] as number).toFixed(5)},${(positions[i * 3 + 2] as number).toFixed(5)}`;
    let id = vertMap.get(key);
    if (id === undefined) {
      id = vertMap.size;
      vertMap.set(key, id);
    }
    remap[i] = id;
  }
  const parent = new Int32Array(vertMap.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r] as number] as number;
      r = parent[r] as number;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < mesh.triCount; t++) {
    const a = remap[indices[t * 3] as number] as number;
    const b = remap[indices[t * 3 + 1] as number] as number;
    const c = remap[indices[t * 3 + 2] as number] as number;
    union(a, b);
    union(b, c);
  }
  const partsByRoot = new Map<number, number[]>();
  for (let t = 0; t < mesh.triCount; t++) {
    const root = find(remap[indices[t * 3] as number] as number);
    const list = partsByRoot.get(root) ?? [];
    list.push(t * 3);
    partsByRoot.set(root, list);
  }
  const parts: ComponentPart[] = [];
  for (const triOffsets of partsByRoot.values()) {
    const triIndices = new Uint32Array(triOffsets.length * 3);
    for (let i = 0; i < triOffsets.length; i++) {
      const off = triOffsets[i] as number;
      triIndices[i * 3] = indices[off] as number;
      triIndices[i * 3 + 1] = indices[off + 1] as number;
      triIndices[i * 3 + 2] = indices[off + 2] as number;
    }
    // extent of the part
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < triIndices.length; i++) {
      const v = (triIndices[i] as number) * 3;
      const x = positions[v] as number, y = positions[v + 1] as number, z = positions[v + 2] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    parts.push({
      triIndices,
      triCount: triIndices.length / 3,
      extent: Math.max(maxX - minX, maxY - minY, maxZ - minZ),
    });
  }
  return parts;
}

/**
 * Per-part meshopt simplify (MADR 0050 step 4): ROIs are the connected components of
 * the stripped mesh, derived from geometry because the single primitive has no names.
 * Small detail components are preserved wholesale; large components absorb the budget
 * proportionally with error scaled to component extent.
 */
function simplifyPerPart(mesh: RawMesh, parts: ComponentPart[], targetTris: number): Uint32Array {
  const keepFloor = 200; // components below this triangle count are preserved (details)
  let preserved = 0;
  for (const p of parts) {
    if (p.triCount < keepFloor) preserved += p.triCount;
  }
  const reducible = mesh.triCount - preserved;
  const reducibleBudget = Math.max(targetTris - preserved, 0);
  let ratio = reducible > 0 ? reducibleBudget / reducible : 1;

  const out: number[] = [];
  for (const p of parts) {
    if (p.triCount < keepFloor) {
      for (let i = 0; i < p.triIndices.length; i++) out.push(p.triIndices[i] as number);
      continue;
    }
    const target = Math.max(Math.floor(p.triCount * ratio), keepFloor);
    const err = p.extent > 0.2 ? 0.005 : 0.002;
    const [simplified] = MeshoptSimplifier.simplify(
      p.triIndices,
      mesh.positions,
      3,
      Math.min(target * 3, p.triIndices.length),
      err,
    ) as [Uint32Array, number];
    for (let i = 0; i < simplified.length; i++) out.push(simplified[i] as number);
  }
  return new Uint32Array(out);
}

/** Global meshopt simplify with a direct target (no chaining, no lockBorder). */
function simplifyGlobal(mesh: RawMesh, targetTris: number, error: number): Uint32Array {
  const [simplified] = MeshoptSimplifier.simplify(
    mesh.indices,
    mesh.positions,
    3,
    Math.min(targetTris * 3, mesh.indices.length),
    error,
  ) as [Uint32Array, number];
  return simplified;
}

/** Meshopt simplifySloppy (benchmark-only per MADR 0050). */
function simplifySloppyPath(mesh: RawMesh, ratio: number): Uint32Array {
  const target = Math.floor(mesh.triCount * ratio);
  const [simplified] = MeshoptSimplifier.simplifySloppy(
    mesh.indices,
    mesh.positions,
    3,
    null,
    target * 3,
    0.01,
  ) as [Uint32Array, number];
  return simplified;
}

/** Blender DECIMATE modifier via the existing benchmark script. */
function blenderDecimate(mesh: RawMesh, inputPath: string, outputPath: string, ratio: number): Uint32Array | null {
  const blender = process.env["BLENDER_PATH"] || "/opt/homebrew/bin/blender";
  const res = spawnSync(
    blender,
    ["--background", "--python", BLENDER_DECIMATE_SCRIPT, "--", "--input", inputPath, "--output", outputPath, "--ratio", String(ratio)],
    { timeout: 240_000, encoding: "utf8" },
  );
  if (res.status !== 0) {
    console.warn(`[trellis-monitor-decimation] blender decimate failed: ${(res.stderr ?? "").slice(0, 500)}`);
    return null;
  }
  return null; // output written to outputPath by blender; caller reloads it
}

// ---------------------------------------------------------------------------
// Per-path measurement
// ---------------------------------------------------------------------------

/**
 * Measure an existing output GLB: resulting triangle count (recounted from the
 * file, not the simplifier's claim), silhouette IoU vs the input's 3 ortho views,
 * and exterior-classified surface-area retention. Does NOT write or bake anything.
 */
async function measureGlb(
  id: string,
  method: string,
  inputMesh: RawMesh,
  outputGlbPath: string,
  inputExterior: Uint8Array,
  inputExteriorArea: number,
  inputSilhouettes: Record<string, Uint8Array>,
  notes: string[],
  measureRes: number = RESOLUTION,
): Promise<PathResult> {
  const outMesh = await loadRawMesh(outputGlbPath);
  const outputTris = outMesh.triCount;

  // Exterior alteration: silhouette IoU (3 fixed ortho views) + exterior-area retention.
  const iou: Record<string, number> = {};
  let minIou = 1;
  for (const [axis, dir] of VIEW_AXES) {
    const a = inputSilhouettes[axis] as Uint8Array;
    const b = silhouetteMask(outMesh, dir, measureRes);
    const v = maskIoU(a, b);
    iou[axis] = Number(v.toFixed(4));
    if (v < minIou) minIou = v;
  }
  const outExterior = classifyVisibility(outMesh, VIEW_COUNT, measureRes);
  const outExteriorArea = triangleArea(outMesh, outExterior);
  const retained = outExteriorArea / inputExteriorArea;

  const exteriorAltered = minIou < IO_THRESHOLD || retained < AREA_THRESHOLD;
  return {
    id,
    method,
    inputTris: inputMesh.triCount,
    outputTris,
    outputPath: outputGlbPath,
    under60000: outputTris <= SOFT_TARGET,
    exteriorAltered,
    minSilhouetteIoU: Number(minIou.toFixed(4)),
    silhouetteIoU: iou,
    exteriorAreaRetained: Number(retained.toFixed(4)),
    notes,
  };
}

/** Bake an output GLB only if it is missing or empty (reuse existing bakes). */
async function bakeIfMissing(outPath: string, bake: () => Promise<void>): Promise<void> {
  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    await bake();
  }
}

// ---------------------------------------------------------------------------
// Main inspect (produces pre-fix.json if missing + decimation-report.json)
// ---------------------------------------------------------------------------

let cached: Report | null = null;

export async function inspectTrellisMonitorDecimation(): Promise<Report> {
  if (cached) return cached;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  mkdirSync(OUTPUTS_DIR, { recursive: true });
  await MeshoptSimplifier.ready;

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }).toString().trim();
  const generatedAt = new Date().toISOString();

  if (!existsSync(CURRENT_MONITOR)) {
    throw new Error(
      `Current-state monitor GLB not found: ${CURRENT_MONITOR}. The #239 ladder evidence must exist in the main repo.`,
    );
  }

  const current = await loadRawMesh(CURRENT_MONITOR);

  // ---- pre-fix measurement (interior/exterior split) -----------------------
  const interiorExterior = classifyVisibility(current, VIEW_COUNT, RESOLUTION);
  let exteriorTris = 0;
  for (let t = 0; t < current.triCount; t++) if (interiorExterior[t] as number) exteriorTris++;
  const interiorTris = current.triCount - exteriorTris;
  const sensitivity: number[] = [];
  for (const v of [48, 64, 128, 256]) {
    const f = classifyVisibility(current, v, RESOLUTION);
    let e = 0;
    for (let t = 0; t < current.triCount; t++) if (f[t] as number) e++;
    sensitivity.push(Number(((current.triCount - e) / current.triCount).toFixed(4)));
  }

  const preFix = {
    schemaVersion: "openclinxr.trellis-monitor-pre-fix.v1",
    measuredAgainstCommit: commit,
    measurementStage: "pre-edit",
    sourceGlb: CURRENT_MONITOR,
    subject: "bedside-monitor",
    currentState: {
      note: "best #239 global-simplify rung (ratio_0.02) — the monitor's current shipped-ladder state",
      triangleCount: current.triCount,
      vertices: current.vertexCount,
      aabb: {
        minX: current.aabb.minX, minY: current.aabb.minY, minZ: current.aabb.minZ,
        maxX: current.aabb.maxX, maxY: current.aabb.maxY, maxZ: current.aabb.maxZ,
      },
    },
    interiorExteriorSplit: {
      method: "z-buffer visibility classification: triangle classified EXTERIOR if it wins at least one pixel from any of N orthographic views on a Fibonacci sphere; INTERIOR otherwise (hidden from all views).",
      primary: {
        viewCount: VIEW_COUNT,
        resolution: RESOLUTION,
        exteriorTris,
        interiorTris,
        interiorFraction: Number((interiorTris / current.triCount).toFixed(4)),
      },
      sensitivity: { viewCounts: [48, 64, 128, 256], interiorFractions: sensitivity },
    },
    budget: {
      perAssetSoft: SOFT_TARGET,
      perStationHard: HARD_CEILING,
      note: "constants in packages/openclinxr/asset-registry/src/index.ts:588 — NOT changed by this slice",
    },
    claimScope: [
      "triangle count and interior/exterior split of the bedside-monitor TRELLIS reconstruction at its current ladder state (r0.02)",
      "interior = triangles not visible from any of N outside views (z-buffer rasterization, orthographic, 1024px)",
    ],
    notEvidenceFor: [
      "Quest 3 readiness",
      "clinical accuracy",
      "production adoption",
      "visual quality — orchestrator grades renders",
    ],
  };
  if (!existsSync(PRE_FIX_PATH)) {
    writeFileSync(PRE_FIX_PATH, `${JSON.stringify(preFix, null, 2)}\n`);
  }

  // ---- reference exterior surfaces (input) ---------------------------------
  const inputExteriorArea = triangleArea(current, interiorExterior);
  const inputSilhouettes: Record<string, Uint8Array> = {};
  for (const [axis, dir] of VIEW_AXES) {
    inputSilhouettes[axis] = silhouetteMask(current, dir, RESOLUTION);
  }

  const paths: PathResult[] = [];

  // P1 strip_interior
  {
    const outPath = path.join(OUTPUTS_DIR, "strip-interior.glb");
    await bakeIfMissing(outPath, async () => {
      const stripped = stripInterior(current, interiorExterior);
      await writeMeshToGlb(CURRENT_MONITOR, null, stripped, outPath);
    });
    paths.push(await measureGlb(
      "strip_interior",
      "delete triangles classified interior (z-buffer visibility, 128 views, 1024px); MADR 0050 step 2",
      current, outPath, interiorExterior, inputExteriorArea, inputSilhouettes,
      ["exterior geometry untouched by construction — only hidden triangles removed"],
    ));
  }

  // P2 strip + weld
  {
    const outPath = path.join(OUTPUTS_DIR, "strip-weld.glb");
    await bakeIfMissing(outPath, async () => {
      const strippedPath = path.join(OUTPUTS_DIR, "strip-interior.glb");
      if (!existsSync(strippedPath) || statSync(strippedPath).size === 0) {
        const stripped = stripInterior(current, interiorExterior);
        await writeMeshToGlb(CURRENT_MONITOR, null, stripped, strippedPath);
      }
      const strippedMesh = await loadRawMesh(strippedPath);
      const welded = weldPositions(strippedMesh, WELD_TOLERANCE);
      await writeMeshToGlb(CURRENT_MONITOR, null, welded, outPath);
    });
    const weldedMesh = await loadRawMesh(outPath);
    const outExterior = classifyVisibility(weldedMesh, VIEW_COUNT, RESOLUTION);
    const outArea = triangleArea(weldedMesh, outExterior);
    const retained = outArea / inputExteriorArea;
    const iou: Record<string, number> = {};
    let minIou = 1;
    for (const [axis, dir] of VIEW_AXES) {
      const v = maskIoU(inputSilhouettes[axis] as Uint8Array, silhouetteMask(weldedMesh, dir, RESOLUTION));
      iou[axis] = Number(v.toFixed(4));
      if (v < minIou) minIou = v;
    }
    paths.push({
      id: "strip_weld",
      method: `strip interior + position weld (tolerance ${WELD_TOLERANCE}, spatial hash grid, 3×3×3 neighbours; MADR 0050 steps 2–3)`,
      inputTris: current.triCount,
      outputTris: weldedMesh.triCount,
      outputPath: outPath,
      under60000: weldedMesh.triCount <= SOFT_TARGET,
      exteriorAltered: minIou < IO_THRESHOLD || retained < AREA_THRESHOLD,
      minSilhouetteIoU: Number(minIou.toFixed(4)),
      silhouetteIoU: iou,
      exteriorAreaRetained: Number(retained.toFixed(4)),
      notes: ["weld merges vertex positions within epsilon; degenerate triangles dropped"],
    });
  }

  // P3 strip + weld + per-part simplify
  {
    const outPath = path.join(OUTPUTS_DIR, "strip-weld-simplify-per-part.glb");
    let weldedPath: string;
    await bakeIfMissing(outPath, async () => {
      const strippedPath = path.join(OUTPUTS_DIR, "strip-interior.glb");
      if (!existsSync(strippedPath) || statSync(strippedPath).size === 0) {
        const stripped = stripInterior(current, interiorExterior);
        await writeMeshToGlb(CURRENT_MONITOR, null, stripped, strippedPath);
      }
      weldedPath = path.join(OUTPUTS_DIR, "strip-weld.glb");
      if (!existsSync(weldedPath) || statSync(weldedPath).size === 0) {
        const strippedMesh = await loadRawMesh(strippedPath);
        const welded = weldPositions(strippedMesh, WELD_TOLERANCE);
        await writeMeshToGlb(CURRENT_MONITOR, null, welded, weldedPath);
      }
      const weldedMesh = await loadRawMesh(weldedPath);
      const parts = connectedComponents(weldedMesh);
      const simplified = simplifyPerPart(weldedMesh, parts, SOFT_TARGET);
      await writeMeshToGlb(CURRENT_MONITOR, null, simplified, outPath);
    });
    const parts = connectedComponents(await loadRawMesh(path.join(OUTPUTS_DIR, "strip-weld.glb")));
    paths.push(await measureGlb(
      "strip_weld_simplify_per_part",
      `strip + weld + per-component meshopt simplify targeting ${SOFT_TARGET}; ROIs = ${parts.length} connected components derived from geometry (single primitive has no mesh names); MADR 0050 steps 2–4`,
      current, outPath, interiorExterior, inputExteriorArea, inputSilhouettes,
      [`parts: ${parts.length}; error scaled by part extent (0.005 large / 0.002 small)`],
    ));
  }

  // P4 global simplify, direct target (control)
  {
    const outPath = path.join(OUTPUTS_DIR, "global-simplify-retargeted.glb");
    await bakeIfMissing(outPath, async () => {
      const simplified = simplifyGlobal(current, SOFT_TARGET, 0.005);
      await writeMeshToGlb(CURRENT_MONITOR, null, simplified, outPath);
    });
    paths.push(await measureGlb(
      "global_simplify_retargeted",
      "meshopt simplify direct target 60,000 tris, error 0.005, NO lockBorder, NO ratio chaining — control showing the #239 ladder flattened on chain targets + lockBorder, not mesh irreducibility",
      current, outPath, interiorExterior, inputExteriorArea, inputSilhouettes,
      ["lockBorder=true stalls this open-shell mesh (67k boundary edges) near 106k; without it the same target reaches ~55k"],
    ));
  }

  // P5 simplifySloppy (benchmark-only)
  {
    const outPath = path.join(OUTPUTS_DIR, "simplify-sloppy.glb");
    await bakeIfMissing(outPath, async () => {
      const simplified = simplifySloppyPath(current, SLOPPY_RATIO);
      await writeMeshToGlb(CURRENT_MONITOR, null, simplified, outPath);
    });
    paths.push(await measureGlb(
      "simplify_sloppy",
      `meshopt simplifySloppy ratio ${SLOPPY_RATIO} (benchmark-only — MADR 0050: sloppy merges nearby geometry and is never for the primary clinical silhouette)`,
      current, outPath, interiorExterior, inputExteriorArea, inputSilhouettes,
      ["sloppy does not respect topology; it may merge a detail into the body — the IoU/area metrics decide whether that happened"],
    ));
  }

  // P6 Blender DECIMATE 0.65 (benchmark-only)
  {
    const outPath = path.join(OUTPUTS_DIR, "blender-decimate-0.65.glb");
    await bakeIfMissing(outPath, () => Promise.resolve(blenderDecimate(current, CURRENT_MONITOR, outPath, DECIMATE_RATIO)).then(() => undefined));
    if (existsSync(outPath) && statSync(outPath).size > 0) {
      const decimated = await loadRawMesh(outPath);
      const outExterior = classifyVisibility(decimated, VIEW_COUNT, RESOLUTION);
      const outArea = triangleArea(decimated, outExterior);
      const retained = outArea / inputExteriorArea;
      const iou: Record<string, number> = {};
      let minIou = 1;
      for (const [axis, dir] of VIEW_AXES) {
        const v = maskIoU(inputSilhouettes[axis] as Uint8Array, silhouetteMask(decimated, dir, RESOLUTION));
        iou[axis] = Number(v.toFixed(4));
        if (v < minIou) minIou = v;
      }
      paths.push({
        id: "blender_decimate_0_65",
        method: `Blender DECIMATE modifier ratio ${DECIMATE_RATIO} via benchmarks/glb-optimization/blender_decimate_draco.py (benchmark-only — never applied to these assets before)`,
        inputTris: current.triCount,
        outputTris: decimated.triCount,
        outputPath: outPath,
        under60000: decimated.triCount <= SOFT_TARGET,
        exteriorAltered: minIou < IO_THRESHOLD || retained < AREA_THRESHOLD,
        minSilhouetteIoU: Number(minIou.toFixed(4)),
        silhouetteIoU: iou,
        exteriorAreaRetained: Number(retained.toFixed(4)),
        notes: ["planar decimation; benchmark context only"],
      });
    } else {
      paths.push({
        id: "blender_decimate_0_65",
        method: `Blender DECIMATE modifier ratio ${DECIMATE_RATIO} (benchmark-only)`,
        inputTris: current.triCount,
        outputTris: current.triCount,
        outputPath: "",
        under60000: false,
        exteriorAltered: true,
        minSilhouetteIoU: 0,
        silhouetteIoU: { x_plus: 0, y_plus: 0, z_plus: 0 },
        exteriorAreaRetained: 0,
        notes: ["blender not available / failed — path not run"],
      });
    }
  }

  // P7 raw pipeline: strip → weld → per-part simplify (designed MADR 0050 order on the raw export)
  if (existsSync(RAW_MONITOR)) {
    const raw = await loadRawMesh(RAW_MONITOR);
    const rawExterior = classifyVisibility(raw, VIEW_COUNT, RESOLUTION); // strip definition
    let rawExt = 0;
    for (let t = 0; t < raw.triCount; t++) if (rawExterior[t] as number) rawExt++;
    const outPath = path.join(OUTPUTS_DIR, "raw-strip-weld-simplify-per-part.glb");
    let parts: ComponentPart[] = [];
    await bakeIfMissing(outPath, async () => {
      const rawStrippedPath = path.join(OUTPUTS_DIR, "raw-strip.glb");
      if (!existsSync(rawStrippedPath) || statSync(rawStrippedPath).size === 0) {
        const rawStripped = stripInterior(raw, rawExterior);
        await writeMeshToGlb(RAW_MONITOR, null, rawStripped, rawStrippedPath);
      }
      const rawWeldedPath = path.join(OUTPUTS_DIR, "raw-strip-weld.glb");
      if (!existsSync(rawWeldedPath) || statSync(rawWeldedPath).size === 0) {
        const rawStrippedMesh = await loadRawMesh(rawStrippedPath);
        const rawWelded = weldPositions(rawStrippedMesh, WELD_TOLERANCE);
        await writeMeshToGlb(RAW_MONITOR, null, rawWelded, rawWeldedPath);
      }
      const rawWeldedMesh = await loadRawMesh(rawWeldedPath);
      parts = connectedComponents(rawWeldedMesh);
      const simplified = simplifyPerPart(rawWeldedMesh, parts, SOFT_TARGET);
      await writeMeshToGlb(RAW_MONITOR, null, simplified, outPath);
    });
    // metrics for this path measured at RAW_MEASURE_RES on BOTH input and output
    const rawExteriorMeasure = classifyVisibility(raw, VIEW_COUNT, RAW_MEASURE_RES);
    const rawArea = triangleArea(raw, rawExteriorMeasure);
    const rawSilhouettes: Record<string, Uint8Array> = {};
    for (const [axis, dir] of VIEW_AXES) {
      rawSilhouettes[axis] = silhouetteMask(raw, dir, RAW_MEASURE_RES);
    }
    if (parts.length === 0) {
      const rawWeldedMesh = await loadRawMesh(path.join(OUTPUTS_DIR, "raw-strip-weld.glb"));
      parts = connectedComponents(rawWeldedMesh);
    }
    paths.push(await measureGlb(
      "raw_strip_weld_simplify_per_part",
      `RAW TRELLIS export (${raw.triCount} tris): strip interior (${raw.triCount - rawExt} tris hidden @1024px) → weld → per-component simplify targeting ${SOFT_TARGET}; the designed MADR 0050 order on the generation output`,
      raw, outPath, rawExteriorMeasure, rawArea, rawSilhouettes,
      [
        `raw interior split @1024px: ${raw.triCount - rawExt} interior tris; ${rawExt} exterior`,
        `parts: ${parts.length}`,
        `metrics for this path measured at ${RAW_MEASURE_RES}px on both input and output (the simplify output carries huge overlapping panels; 1024px classification costs ~40 min)`,
      ],
      RAW_MEASURE_RES,
    ));
  } else {
    paths.push({
      id: "raw_strip_weld_simplify_per_part",
      method: "RAW TRELLIS export pipeline (MADR 0050 order)",
      inputTris: 0,
      outputTris: 0,
      outputPath: "",
      under60000: false,
      exteriorAltered: true,
      minSilhouetteIoU: 0,
      silhouetteIoU: { x_plus: 0, y_plus: 0, z_plus: 0 },
      exteriorAreaRetained: 0,
      notes: [`raw GLB not found: ${RAW_MONITOR}`],
    });
  }

  // ---- decision -----------------------------------------------------------
  const viable = paths.filter((p) => p.under60000 && !p.exteriorAltered && p.outputTris > 0);
  // simplifySloppy is recorded as evidence but is benchmark-only per MADR 0050
  // ("sloppy merges nearby geometry… never for the primary clinical silhouette"),
  // so the recommended consumption path prefers a topology-preserving one.
  const recommended = viable.filter((p) => p.id !== "simplify_sloppy");
  const pool = recommended.length > 0 ? recommended : viable;
  const best = [...pool].sort((a, b) => b.minSilhouetteIoU - a.minSilhouetteIoU || a.outputTris - b.outputTris)[0];
  const decision: Report["decision"] = best
    ? {
        anyPathUnder60000WithExteriorPreserved: true,
        bestPath: best.id,
        conclusion: "consume_no_exception",
        note: `${best.id} reaches ${best.outputTris} tris (≤${SOFT_TARGET}, the per-asset budget) with min silhouette IoU ${best.minSilhouetteIoU} and exterior area retained ${best.exteriorAreaRetained}. ${viable.map((p) => `${p.id}=${p.outputTris} tris`).join("; ")} also preserve the exterior. The monitor fits the budget without a budget exception; a later slice consumes it into the equipment library. NOTE: ${(() => { const others = viable.filter((p) => p.id !== best.id); return others.length > 0 ? `${others.map((p) => p.id).join(", ")} ${others.length === 1 ? "is" : "are"} recorded as evidence but not recommended (sloppy is benchmark-only per MADR 0050).` : "no alternative viable path."; })()}`,
      }
    : {
        anyPathUnder60000WithExteriorPreserved: false,
        bestPath: "",
        conclusion: "exception_grounded_measured_floor",
        note: `No path reaches ${SOFT_TARGET} tris with exterior preserved (min silhouette IoU ≥ ${IO_THRESHOLD}). The best measured result is ${Math.min(...paths.map((p) => p.outputTris).filter((t) => t > 0))} tris. The exception case is grounded in a measured floor — the orchestrator may write the MADR with this evidence.`,
      };

  const report: Report = {
    schemaVersion: "openclinxr.trellis-monitor-decimation.v1",
    measuredAgainstCommit: commit,
    generatedAt,
    subject: "bedside-monitor",
    input: {
      path: CURRENT_MONITOR,
      triangleCount: current.triCount,
      vertices: current.vertexCount,
      interiorSplit: {
        method: preFix.interiorExteriorSplit.method,
        viewCount: VIEW_COUNT,
        resolution: RESOLUTION,
        exteriorTris,
        interiorTris,
        interiorFraction: Number((interiorTris / current.triCount).toFixed(4)),
        sensitivity: { viewCounts: [48, 64, 128, 256], interiorFractions: sensitivity },
      },
    },
    paths,
    decision,
    softTarget: SOFT_TARGET,
    hardCeiling: HARD_CEILING,
    claimScope: [
      "MADR 0050 steps 2–4 decimation paths (interior strip, position weld, per-part simplify) plus simplifySloppy and Blender DECIMATE on the bedside monitor",
      "exterior alteration judged by orthographic silhouette IoU (3 fixed views, 1024px) and exterior-classified surface-area retention at 128 views",
      "triangle counts measured from the exported GLBs (NodeIO recount, not the simplifier's claim)",
      "budget constants untouched (packages/openclinxr/asset-registry/src/index.ts:588)",
    ],
    notEvidenceFor: [
      "Quest 3 readiness from triangle counts alone",
      "clinical accuracy or device equivalence claims",
      "visual quality — the orchestrator grades any renders",
      "production adoption — consumption is a separate later slice",
      "exam equivalence or clinical validity",
    ],
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  cached = report;
  return report;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`trellis-monitor-decimation — #250 bedside-monitor decimation decision (MADR 0050 steps 2–4)

USAGE
  pnpm exec tsx tools/openclinxr/evidence/trellis-monitor-decimation.ts   Run measurement + write reports
  pnpm exec tsx tools/openclinxr/evidence/trellis-monitor-decimation.ts --help

OUTPUTS (gitignored evidence)
  .openclinxr/evidence/issue-250/pre-fix.json          interior/exterior split (pre-edit measurement)
  .openclinxr/evidence/issue-250/decimation-report.json per-path results + binary decision
  .openclinxr/evidence/issue-250/outputs/*.glb         per-path outputs for orchestrator grading
`);
    return;
  }
  const report = await inspectTrellisMonitorDecimation();
  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write("\n");
}

const isMain = process.argv[1]?.includes("trellis-monitor-decimation");
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
