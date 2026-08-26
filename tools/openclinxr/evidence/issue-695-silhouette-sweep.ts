#!/usr/bin/env tsx
/**
 * #695 silhouette sweep — the ONE analysis script for the decimation slice.
 *
 * Decimates the four ED actors with @gltf-transform simplify + meshoptimizer at pinned
 * (ratio, error) rungs, renders original vs rungs through the PRODUCT renderer (apps/ui-xr
 * isolated-subject lab), and computes quantitative silhouette + surface metrics so a
 * TEXT-ONLY worker can record a graded verdict per reduced actor. The final pixel grade is
 * owed to the orchestrator: this script writes PNGs and numbers, never a visual claim.
 *
 * Outputs (issue-695 evidence root):
 *   silhouette-verdicts.json   — the done_when proof artifact
 *   front/<actor>-<label>.png  — renders for the orchestrator's grade
 *   sweep-glbs/                — decimated rungs (served from the gitignored cagematch dir)
 *
 * Rungs are pinned as (ratio, error) PAIRS everywhere — a ratio without its error bound is
 * not reproducible (#695).
 */
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { chromium, type Browser, type Page } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { computeMeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";

const CWD = process.cwd();
const GENERATED = "apps/ui-xr/public/generated-humanoids";
/** Server-root-relative path under the ui-xr dev server (public/ is served at /). */
const GENERATED_SERVE = "generated-humanoids";
/** Gitignored but served by the ui-xr dev server — intermediate rung GLBs never enter git. */
const SWEEP_SERVE = "apps/ui-xr/public/cagematch/issue-695-sweep";
/** Server-root-relative path of the gitignored sweep dir. */
const SWEEP_SERVE_URL = "cagematch/issue-695-sweep";
const EVIDENCE = ".openclinxr/evidence/issue-695";
const VERDICTS_PATH = path.join(EVIDENCE, "silhouette-verdicts.json");
const STATION_BUDGET_TRIS = 180_000;

/** The four actors an ED-shaped station casts (the-station-fits-its-budget contract). */
const ED_STATION = [
  "mpfb-gown-adult-patient",
  "mpfb-clinical-nurse-adult",
  "mpfb-family-partner-adult",
  "mpfb-clinical-physician-adult",
] as const;

/** Pinned (ratio, error) rungs. Error 0.001 ladder is the adoption space; 0.01 records the bound's effect. */
const RUNGS: ReadonlyArray<{ id: string; ratio: number; error: number }> = [
  { id: "r0.5e0.001", ratio: 0.5, error: 0.001 },
  { id: "r0.4e0.001", ratio: 0.4, error: 0.001 },
  { id: "r0.34e0.001", ratio: 0.34, error: 0.001 },
  { id: "r0.34e0.01", ratio: 0.34, error: 0.01 },
];

/** The mask background is the lab's clear colour (#18211d) — inlined in the page.evaluate below. */
const MASK_W = 640;
const MASK_H = 480;

type TrisShape = { triangles: number; uvPrimitives: number; meshes: number };

async function readShape(glbPath: string): Promise<TrisShape> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
  return shapeOf(doc);
}

function shapeOf(doc: Document): TrisShape {
  let triangles = 0;
  let uvPrimitives = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      triangles += (idx?.getCount() ?? pos?.getCount() ?? 0) / 3;
      if (prim.getAttribute("TEXCOORD_0")) uvPrimitives += 1;
    }
  }
  return { triangles: Math.round(triangles), uvPrimitives, meshes: doc.getRoot().listMeshes().length };
}

async function writeSimplified(input: string, output: string, ratio: number, error: number): Promise<void> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(input);
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }),
  );
  await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(output, doc);
}

// ---------------------------------------------------------------------------
// World-space surface deviation (mesh-based surface-detail instrument)
// ---------------------------------------------------------------------------

type WorldVertex = { x: number; y: number; z: number };

function collectWorldVertices(doc: Document): WorldVertex[] {
  const out: WorldVertex[] = [];
  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        for (let i = 0; i + 2 < arr.length; i += 3) {
          const x = Number(arr[i]);
          const y = Number(arr[i + 1]);
          const z = Number(arr[i + 2]);
          out.push({
            x: world[0] * x + world[4] * y + world[8] * z + world[12],
            y: world[1] * x + world[5] * y + world[9] * z + world[13],
            z: world[2] * x + world[6] * y + world[10] * z + world[14],
          });
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) visit(root);
  }
  if (out.length === 0) {
    for (const node of doc.getRoot().listNodes()) visit(node);
  }
  return out;
}

const CELL_M = 0.008;

function distSq(a: WorldVertex, b: WorldVertex): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

/**
 * Point-to-triangle squared distance (Ericson, Real-Time Collision Detection).
 * meshopt simplify only REMOVES vertices — a nearest-vertex metric is degenerate (0 everywhere).
 * Surface-detail loss ("angular wedges") shows up as distance to the original SURFACE.
 */
function pointTriDistSq(p: WorldVertex, a: WorldVertex, b: WorldVertex, c: WorldVertex): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const ap = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
  const d1 = ab.x * ap.x + ab.y * ap.y + ab.z * ap.z;
  const d2 = ac.x * ap.x + ac.y * ap.y + ac.z * ap.z;
  if (d1 <= 0 && d2 <= 0) return distSq(p, a);
  const bp = { x: p.x - b.x, y: p.y - b.y, z: p.z - b.z };
  const d3 = ab.x * bp.x + ab.y * bp.y + ab.z * bp.z;
  const d4 = ac.x * bp.x + ac.y * bp.y + ac.z * bp.z;
  if (d3 >= 0 && d4 <= d3) return distSq(p, b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const q = { x: a.x + t * ab.x, y: a.y + t * ab.y, z: a.z + t * ab.z };
    return distSq(p, q);
  }
  const cp = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
  const d5 = ab.x * cp.x + ab.y * cp.y + ab.z * cp.z;
  const d6 = ac.x * cp.x + ac.y * cp.y + ac.z * cp.z;
  if (d6 >= 0 && d5 <= d6) return distSq(p, c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const q = { x: a.x + t * ac.x, y: a.y + t * ac.y, z: a.z + t * ac.z };
    return distSq(p, q);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const q = { x: b.x + t * (c.x - b.x), y: b.y + t * (c.y - b.y), z: b.z + t * (c.z - b.z) };
    return distSq(p, q);
  }
  const denom = 1 / (va + vb + vc);
  const t = vb * denom;
  const u = vc * denom;
  const q = { x: a.x + t * ab.x + u * ac.x, y: a.y + t * ab.y + u * ac.y, z: a.z + t * ab.z + u * ac.z };
  return distSq(p, q);
}

type Tri = { a: WorldVertex; b: WorldVertex; c: WorldVertex };

function buildTriangleHash(tris: Tri[]): Map<string, number[]> {
  const hash = new Map<string, number[]>();
  const add = (key: string, i: number) => {
    const bucket = hash.get(key);
    if (bucket) bucket.push(i);
    else hash.set(key, [i]);
  };
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]!;
    const minX = Math.min(t.a.x, t.b.x, t.c.x);
    const maxX = Math.max(t.a.x, t.b.x, t.c.x);
    const minY = Math.min(t.a.y, t.b.y, t.c.y);
    const maxY = Math.max(t.a.y, t.b.y, t.c.y);
    const minZ = Math.min(t.a.z, t.b.z, t.c.z);
    const maxZ = Math.max(t.a.z, t.b.z, t.c.z);
    const cx0 = Math.floor(minX / CELL_M);
    const cx1 = Math.floor(maxX / CELL_M);
    const cy0 = Math.floor(minY / CELL_M);
    const cy1 = Math.floor(maxY / CELL_M);
    const cz0 = Math.floor(minZ / CELL_M);
    const cz1 = Math.floor(maxZ / CELL_M);
    // Cap bbox span so a pathological large triangle cannot flood the hash.
    const kx = Math.min(cx1, cx0 + 2);
    const ky = Math.min(cy1, cy0 + 2);
    const kz = Math.min(cz1, cz0 + 2);
    for (let cx = cx0; cx <= kx; cx++) {
      for (let cy = cy0; cy <= ky; cy++) {
        for (let cz = cz0; cz <= kz; cz++) {
          add(`${cx},${cy},${cz}`, i);
        }
      }
    }
  }
  return hash;
}

function nearestSurfaceSq(hash: Map<string, number[]>, tris: Tri[], q: WorldVertex): number | null {
  const cx = Math.floor(q.x / CELL_M);
  const cy = Math.floor(q.y / CELL_M);
  const cz = Math.floor(q.z / CELL_M);
  let best = Number.POSITIVE_INFINITY;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = hash.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!bucket) continue;
        for (const i of bucket) {
          const t = tris[i]!;
          const d = pointTriDistSq(q, t.a, t.b, t.c);
          if (d < best) best = d;
        }
      }
    }
  }
  return Number.isFinite(best) ? Math.sqrt(best) : null;
}

/** Original mesh vertices -> world triangles (stride 2 per mesh, so the index stays bounded). */
function collectWorldTriangles(verts: WorldVertex[]): Tri[] {
  const tris: Tri[] = [];
  for (let i = 0; i + 2 < verts.length; i += 6) {
    tris.push({ a: verts[i]!, b: verts[i + 1]!, c: verts[i + 2]! });
  }
  return tris;
}

function p90(sorted: number[]): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
}

/**
 * Per-vertical-decile and per-region mean/p90 deviation of the DECIMATED surface from the
 * ORIGINAL SURFACE (point-to-triangle distance to the original triangle soup, world space,
 * stride 2 on both sides). Deciles run bottom-up (0 = feet). The lateral-arm band isolates
 * the hands/forearms (outer 20% of x-extent between 55% and 80% of height) — the region the
 * #695 card says degrades first.
 */
function surfaceDeviation(original: WorldVertex[], decimated: WorldVertex[]) {
  const tris = collectWorldTriangles(original);
  const hash = buildTriangleHash(tris);
  const ys = original.map((v) => v.y);
  const minY = Math.min(...ys);
  const height = Math.max(...ys) - minY;
  const xs = original.map((v) => v.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const armHalf = (maxX - minX) * 0.1; // outer 20% total (10% each side)

  const deciles: number[][] = Array.from({ length: 10 }, () => []);
  const armLateral: number[] = [];
  const noLocalNeighbor: number[] = [];

  for (let i = 0; i < decimated.length; i += 2) {
    const q = decimated[i]!;
    const d = nearestSurfaceSq(hash, tris, q);
    if (d === null) {
      noLocalNeighbor.push(i);
      continue;
    }
    const f = (q.y - minY) / height;
    const decile = Math.min(9, Math.max(0, Math.floor(f * 10)));
    deciles[decile]!.push(d);
    const armF = (q.y - minY) / height;
    if (armF >= 0.55 && armF <= 0.8 && (q.x < minX + armHalf || q.x > maxX - armHalf)) {
      armLateral.push(d);
    }
  }

  const summarize = (vals: number[]): { n: number; meanMm: number; p90Mm: number } => {
    if (vals.length === 0) return { n: 0, meanMm: Number.NaN, p90Mm: Number.NaN };
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    return { n: sorted.length, meanMm: mean * 1000, p90Mm: p90(sorted) * 1000 };
  };

  return {
    body: summarize(deciles.flat()),
    armLateral: summarize(armLateral),
    headDecile: summarize(deciles[9]!),
    shinDeciles: summarize([...deciles[1]!, ...deciles[2]!]),
    worstDecile: deciles
      .map((d, i) => ({ decile: i, ...summarize(d) }))
      .filter((d) => Number.isFinite(d.p90Mm))
      .sort((a, b) => b.p90Mm - a.p90Mm)[0],
    noLocalNeighborCount: noLocalNeighbor.length,
  };
}

// ---------------------------------------------------------------------------
// Gown contract replication on DECIMATED gown rungs (#686 must survive decimation)
// ---------------------------------------------------------------------------

const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;
const SLAB_METRES = 0.01;
const STRIDE = 3;
const BODICE: readonly [number, number] = [0.62, 0.82];
const SKIRT: readonly [number, number] = [0.34, 0.5];
const MIN_BODICE_FRACTION_OF_SKIRT = 0.5;
const MAX_BODICE_NORMAL_DOT = 0.891;
const SKIRT_NORMAL_DOT_FLOOR = 0.85;
const SKIRT_CLEARANCE_FLOOR_MM = 62;
const BODICE_N_FLOOR = 470;

type Vertex = { p: readonly [number, number, number]; n: readonly [number, number, number] };

function loadGownVertices(doc: Document): { gown: Vertex[]; body: Vertex[] } {
  const gown: Vertex[] = [];
  const body: Vertex[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isGown = GOWN.test(name);
      const isBody = !isGown && BODY.test(name);
      if (!isGown && !isBody) continue;
      const pos = prim.getAttribute("POSITION");
      const nrm = prim.getAttribute("NORMAL");
      if (!pos || !nrm) continue;
      const v = [0, 0, 0];
      const w = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        nrm.getElement(i, w);
        (isGown ? gown : body).push({ p: [v[0]!, v[1]!, v[2]!], n: [w[0]!, w[1]!, w[2]!] });
      }
    }
  }
  return { gown, body };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
}

function gownBandMetrics(
  gown: Vertex[], body: Vertex[], floorY: number, height: number, band: readonly [number, number],
): { n: number; medianMm: number; medianNormalDot: number } {
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
  return { n: distances.length, medianMm: median(distances) * 1000, medianNormalDot: median(dots) };
}

async function gownContractOnGlb(glbPath: string): Promise<{
  bodice: { n: number; medianMm: number; medianNormalDot: number };
  skirt: { n: number; medianMm: number; medianNormalDot: number };
  passes: boolean;
  failures: string[];
}> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
  return gownContractOnDocument(doc);
}

function gownContractOnDocument(doc: Document): {
  bodice: { n: number; medianMm: number; medianNormalDot: number };
  skirt: { n: number; medianMm: number; medianNormalDot: number };
  passes: boolean;
  failures: string[];
} {
  const { gown, body } = loadGownVertices(doc);
  const ys = body.map((v) => v.p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  const bodice = gownBandMetrics(gown, body, floorY, height, BODICE);
  const skirt = gownBandMetrics(gown, body, floorY, height, SKIRT);
  const fraction = bodice.medianMm / skirt.medianMm;
  const failures: string[] = [];
  if (bodice.medianNormalDot > MAX_BODICE_NORMAL_DOT) {
    failures.push(`SHAPE: bodice normal-dot ${bodice.medianNormalDot.toFixed(3)} > ${MAX_BODICE_NORMAL_DOT}`);
  }
  if (fraction < MIN_BODICE_FRACTION_OF_SKIRT) {
    failures.push(`LEVEL: ratio ${fraction.toFixed(3)} < ${MIN_BODICE_FRACTION_OF_SKIRT}`);
  }
  if (skirt.medianNormalDot > SKIRT_NORMAL_DOT_FLOOR) {
    failures.push(`SKIRT-DOT: ${skirt.medianNormalDot.toFixed(3)} > ${SKIRT_NORMAL_DOT_FLOOR}`);
  }
  if (skirt.medianMm < SKIRT_CLEARANCE_FLOOR_MM) {
    failures.push(`SKIRT-CLEAR: ${skirt.medianMm.toFixed(1)}mm < ${SKIRT_CLEARANCE_FLOOR_MM}`);
  }
  if (bodice.n < BODICE_N_FLOOR) {
    failures.push(`BODICE-N: ${bodice.n} < ${BODICE_N_FLOOR}`);
  }
  return { bodice, skirt, passes: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Silhouette metrics (render-based structural instrument)
// ---------------------------------------------------------------------------

type Mask = { w: number; h: number; px: Uint8Array };

function silhouetteStats(mask: Mask): {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  holes: number;
  fragments: number;
} {
  const { w, h, px } = mask;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y * w + x] === 1) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, holes: 0, fragments: 0 };

  // 4-connected flood fill from the border over BACKGROUND pixels; anything unreached is a hole.
  const visitedBg = new Uint8Array(w * h);
  const stack: number[] = [];
  const pushBg = (x: number, y: number) => {
    const i = y * w + x;
    if (visitedBg[i] === 1 || px[i] === 1) return;
    visitedBg[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) { pushBg(x, 0); pushBg(x, h - 1); }
  for (let y = 0; y < h; y++) { pushBg(0, y); pushBg(w - 1, y); }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x > 0) pushBg(x - 1, y);
    if (x < w - 1) pushBg(x + 1, y);
    if (y > 0) pushBg(x, y - 1);
    if (y < h - 1) pushBg(x, y + 1);
  }
  let holes = 0;
  for (let i = 0; i < w * h; i++) {
    if (px[i] === 0 && visitedBg[i] === 0) holes += 1;
  }

  // Foreground connected components (4-connected); fragments = components other than the largest.
  const fgSeen = new Uint8Array(w * h);
  const sizes: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (px[i] !== 1 || fgSeen[i] === 1) continue;
      const comp: number[] = [i];
      fgSeen[i] = 1;
      let head = 0;
      while (head < comp.length) {
        const c = comp[head++]!;
        const cx = c % w;
        const cy = Math.floor(c / w);
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (px[ni] === 1 && fgSeen[ni] === 0) { fgSeen[ni] = 1; comp.push(ni); }
        }
      }
      sizes.push(comp.length);
    }
  }
  const largest = Math.max(...sizes, 0);
  const fragments = sizes.filter((s) => s >= 8 && s < largest).length;

  return { bbox: { x0, y0, x1, y1 }, holes, fragments };
}

function regionIoU(a: Mask, b: Mask, rx: [number, number], ry: [number, number]): number | null {
  let inter = 0;
  let union = 0;
  for (let y = ry[0]; y < ry[1]; y++) {
    for (let x = rx[0]; x < rx[1]; x++) {
      const ai = a.px[y * a.w + x] === 1 ? 1 : 0;
      const bi = b.px[y * b.w + x] === 1 ? 1 : 0;
      if (ai || bi) union += 1;
      if (ai && bi) inter += 1;
    }
  }
  return union === 0 ? null : inter / union;
}

/**
 * Whole-frame + per-strip + lateral-extreme-per-strip IoU of the rung mask against the
 * original. 8 horizontal strips inside the union bbox; the lateral variant restricts each
 * strip to the outer 12% of columns — the hands/forearms read there first (#695).
 */
function silhouetteCompare(original: Mask, rung: Mask): {
  totalIoU: number | null;
  stripIoUs: Array<number | null>;
  lateralStripIoUs: Array<number | null>;
  holesOriginal: number;
  holesRung: number;
  fragmentsOriginal: number;
  fragmentsRung: number;
} {
  const statsO = silhouetteStats(original);
  const statsR = silhouetteStats(rung);
  const x0 = Math.min(statsO.bbox.x0, statsR.bbox.x0);
  const x1 = Math.max(statsO.bbox.x1, statsR.bbox.x1);
  const y0 = Math.min(statsO.bbox.y0, statsR.bbox.y0);
  const y1 = Math.max(statsO.bbox.y1, statsR.bbox.y1);
  if (x1 <= x0 || y1 <= y0) {
    return {
      totalIoU: null, stripIoUs: [], lateralStripIoUs: [],
      holesOriginal: statsO.holes, holesRung: statsR.holes,
      fragmentsOriginal: statsO.fragments, fragmentsRung: statsR.fragments,
    };
  }
  const totalIoU = regionIoU(original, rung, [x0, x1], [y0, y1]);
  const NSTRIPS = 8;
  const stripIoUs: Array<number | null> = [];
  const lateralStripIoUs: Array<number | null> = [];
  const stripH = (y1 - y0) / NSTRIPS;
  const lat = Math.max(2, Math.floor((x1 - x0) * 0.12));
  for (let s = 0; s < NSTRIPS; s++) {
    const sy0 = Math.floor(y0 + s * stripH);
    const sy1 = Math.max(sy0 + 1, Math.floor(y0 + (s + 1) * stripH));
    stripIoUs.push(regionIoU(original, rung, [x0, x1], [sy0, sy1]));
    lateralStripIoUs.push(regionIoU(original, rung, [x0, x0 + lat], [sy0, sy1]) ?? regionIoU(original, rung, [x1 - lat, x1], [sy0, sy1]));
  }
  return {
    totalIoU, stripIoUs, lateralStripIoUs,
    holesOriginal: statsO.holes, holesRung: statsR.holes,
    fragmentsOriginal: statsO.fragments, fragmentsRung: statsR.fragments,
  };
}

// ---------------------------------------------------------------------------
// Rendering via the product renderer (isolated-subject lab)
// ---------------------------------------------------------------------------

async function renderMask(page: Page, baseUrl: string, subject: {
  subjectId: string;
  bodyGlb: string;
  label: string;
}): Promise<{ mask: Mask; imagePath: string }> {
  const spec = {
    subjectId: subject.subjectId,
    subjectKind: "glb",
    bodyGlb: subject.bodyGlb,
    subjectOnly: true,
    label: subject.label,
  };
  const url = `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __openClinXrIsolatedSubjectEvidence?: unknown };
      if (w.__openClinXrIsolatedSubjectEvidence !== undefined) return true;
      const app = document.querySelector<HTMLDivElement>("#app");
      if (app?.textContent?.includes("Isolated subject lab error")) return true;
      return false;
    },
    null,
    { timeout: 120_000 },
  );
  const labError = await page.evaluate(() =>
    document.querySelector<HTMLDivElement>("#app")?.textContent?.includes("Isolated subject lab error") ?? false,
  );
  if (labError) {
    const text = await page.evaluate(
      () => document.querySelector<HTMLDivElement>("#app")?.textContent?.slice(0, 500) ?? "",
    );
    throw new Error(`isolated subject lab refused: ${text}`);
  }
  const raw = await page.evaluate((): number[] => {
    const canvas = document.querySelector("#isolated-subject-capture-canvas") as HTMLCanvasElement;
    const gl = (canvas.getContext("webgl2")
      ?? canvas.getContext("webgl")
      ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | WebGL2RenderingContext;
    const w = canvas.width;
    const h = canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const MW = 640;
    const MH = 480;
    const out = new Uint8Array(MW * MH);
    const bw = Math.ceil(w / MW);
    const bh = Math.ceil(h / MH);
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        let nonBg = 0;
        let n = 0;
        for (let dy = 0; dy < bh; dy++) {
          const sy = y * bh + dy;
          if (sy >= h) break;
          for (let dx = 0; dx < bw; dx++) {
            const sx = x * bw + dx;
            if (sx >= w) break;
            const i = (sy * w + sx) * 4;
            const r = px[i]!;
            const g = px[i + 1]!;
            const b = px[i + 2]!;
            // Lab background is #18211d — same predicate as measureCanvasCoverage.
            if (Math.abs(r - 0x18) + Math.abs(g - 0x21) + Math.abs(b - 0x1d) > 36) nonBg += 1;
            n += 1;
          }
        }
        out[y * MW + x] = n > 0 && nonBg / n > 0.5 ? 1 : 0;
      }
    }
    return Array.from(out);
  });
  return {
    mask: { w: MASK_W, h: MASK_H, px: Uint8Array.from(raw) },
    imagePath: "",
  };
}

// ---------------------------------------------------------------------------
// Adoption decision: quality-first greedy under the station budget
// ---------------------------------------------------------------------------

/**
 * The gown patient is the EXAM SUBJECT — its hands are what a learner watches during a
 * physical exam (#695), so it stays at the GENTLEST rung the budget allows. Supporting
 * actors (nurse, family, physician) step down one rung each before the patient does.
 * Only if the station is still over budget with all three supporting actors at the
 * bottom of the error-0.001 ladder does the patient step down.
 */
function chooseAdoption(counts: Record<string, Record<string, number>>): {
  chosen: Record<string, string>;
  total: number;
} | null {
  const ladder = RUNGS.filter((r) => r.error === 0.001).map((r) => r.id);
  const supportOrder = [
    "mpfb-clinical-nurse-adult",
    "mpfb-family-partner-adult",
    "mpfb-clinical-physician-adult",
  ];
  const chosen: Record<string, string> = {};
  for (const actor of ED_STATION) chosen[actor] = ladder[0]!;
  const totalOf = () => ED_STATION.reduce((sum, a) => sum + counts[a]![chosen[a]!]!, 0);
  let total = totalOf();
  let cursor = 0;
  for (let round = 0; round < 64 && total > STATION_BUDGET_TRIS; round++) {
    // Round-robin over the supporting actors: each steps down ONE rung per full pass, so
    // no single actor is hollowed out while another stays untouched.
    let stepped = false;
    for (let k = 0; k < supportOrder.length; k++) {
      const actor = supportOrder[(cursor + k) % supportOrder.length]!;
      if (ladder.indexOf(chosen[actor]!) < ladder.length - 1) {
        chosen[actor] = ladder[ladder.indexOf(chosen[actor]!) + 1]!;
        stepped = true;
        cursor = (cursor + k + 1) % supportOrder.length;
        break;
      }
    }
    if (!stepped) {
      // All supporting actors at the bottom: only the gown patient can step down further.
      const patient = "mpfb-gown-adult-patient";
      if (ladder.indexOf(chosen[patient]!) >= ladder.length - 1) return null; // infeasible
      chosen[patient] = ladder[ladder.indexOf(chosen[patient]!) + 1]!;
    }
    total = totalOf();
  }
  return total <= STATION_BUDGET_TRIS ? { chosen, total } : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  await MeshoptSimplifier.ready;
  const treeStamp = computeMeasurementTreeStamp(CWD);
  await mkdir(path.join(CWD, EVIDENCE, "front"), { recursive: true });
  await mkdir(path.join(CWD, SWEEP_SERVE), { recursive: true });

  // 1. Decimate every rung (intermediate GLBs live in the gitignored cagematch dir).
  const counts: Record<string, Record<string, number>> = {};
  const uvCounts: Record<string, Record<string, number>> = {};
  const beforeShapes: Record<string, TrisShape> = {};
  for (const actor of ED_STATION) {
    const src = path.join(CWD, GENERATED, `${actor}.glb`);
    beforeShapes[actor] = await readShape(src);
    counts[actor] = {};
    uvCounts[actor] = {};
    for (const rung of RUNGS) {
      const dest = path.join(CWD, SWEEP_SERVE, actor, `${rung.id}.glb`);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeSimplified(src, dest, rung.ratio, rung.error);
      const shape = await readShape(dest);
      counts[actor]![rung.id] = shape.triangles;
      uvCounts[actor]![rung.id] = shape.uvPrimitives;
      console.log(`${actor} ${rung.id}: ${shape.triangles} tris (uv ${shape.uvPrimitives}/${shape.meshes} meshes)`);
    }
  }

  // 2. Mesh-based surface deviation per rung vs original; gown-contract replication on the gown.
  const surface: Record<string, Record<string, unknown>> = {};
  const gownContract: Record<string, Record<string, unknown>> = {};
  for (const actor of ED_STATION) {
    const src = path.join(CWD, GENERATED, `${actor}.glb`);
    const originalVerts = collectWorldVertices(await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(src));
    surface[actor] = {};
    gownContract[actor] = {};
    for (const rung of RUNGS) {
      const rungPath = path.join(CWD, SWEEP_SERVE, actor, `${rung.id}.glb`);
      const decimated = collectWorldVertices(await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(rungPath));
      surface[actor]![rung.id] = surfaceDeviation(originalVerts, decimated);
      if (actor === "mpfb-gown-adult-patient") {
        gownContract[actor]![rung.id] = await gownContractOnGlb(rungPath);
      }
    }
  }

  // 3. Render original + every rung through the product renderer and compare silhouettes.
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: CWD, readyTimeoutMs: 180_000 });
  let browser: Browser | null = null;
  const silhouettes: Record<string, Record<string, unknown>> = {};
  const imagePaths: Record<string, Record<string, string>> = {};
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });

    for (const actor of ED_STATION) {
      silhouettes[actor] = {};
      imagePaths[actor] = {};
      const original: Mask | null = await renderMask(page, server.url, {
        subjectId: `${actor}_original`,
        bodyGlb: `${GENERATED_SERVE}/${actor}.glb`,
        label: `${actor} original`,
      }).then((r) => r.mask).catch((err) => {
        console.error(`render original ${actor} failed: ${String(err).slice(0, 200)}`);
        return null;
      });
      if (original) {
        const imgPath = path.join(CWD, EVIDENCE, "front", `${actor}-original.png`);
        await page.locator("#isolated-subject-capture-canvas").screenshot({ path: imgPath });
        imagePaths[actor]!.original = path.relative(CWD, imgPath).replaceAll("\\", "/");
      }
      for (const rung of RUNGS) {
        try {
          const { mask } = await renderMask(page, server.url, {
            subjectId: `${actor}_${rung.id}`,
            bodyGlb: `${SWEEP_SERVE_URL}/${actor}/${rung.id}.glb`,
            label: `${actor} ${rung.id}`,
          });
          const imgPath = path.join(CWD, EVIDENCE, "front", `${actor}-${rung.id}.png`);
          await page.locator("#isolated-subject-capture-canvas").screenshot({ path: imgPath });
          imagePaths[actor]![rung.id] = path.relative(CWD, imgPath).replaceAll("\\", "/");
          silhouettes[actor]![rung.id] = original
            ? silhouetteCompare(original, mask)
            : { error: "original render failed; comparison skipped" };
          console.log(`${actor} ${rung.id}: silhouette compare done`);
        } catch (err) {
          silhouettes[actor]![rung.id] = { error: String(err).slice(0, 300) };
          console.error(`${actor} ${rung.id} render failed: ${String(err).slice(0, 200)}`);
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await stopPortlessDevServer(server.proc);
  }

  // 4. Budget math + adoption.
  const adopted = chooseAdoption(counts);
  const stationBefore = ED_STATION.reduce((s, a) => s + beforeShapes[a]!.triangles, 0);
  const pedsBefore = await (async () => {
    let total = 0;
    for (const name of ["mpfb-peds-nurse-kevin", "mpfb-peds-parent-aisha", "mpfb-peds-patient-child"]) {
      const p = path.join(CWD, GENERATED, `${name}.glb`);
      if (existsSync(p)) total += (await readShape(p)).triangles;
    }
    return total;
  })();

  const actorsOut: Record<string, unknown> = {};
  for (const actor of ED_STATION) {
    const rungOut: Record<string, unknown> = {};
    for (const rung of RUNGS) {
      const label = rung.id;
      const shapeAfter = counts[actor]![label]!;
      rungOut[label] = {
        ratio: rung.ratio,
        error: rung.error,
        beforeTris: beforeShapes[actor]!.triangles,
        afterTris: shapeAfter,
        reductionX: Number((beforeShapes[actor]!.triangles / shapeAfter).toFixed(2)),
        uvPrimitivesBefore: beforeShapes[actor]!.uvPrimitives,
        uvPrimitivesAfter: uvCounts[actor]![label],
        silhouette: silhouettes[actor]![label],
        surfaceDeviation: surface[actor]![label],
        ...(actor === "mpfb-gown-adult-patient"
          ? { gownContract: gownContract[actor]![label] }
          : {}),
        renderPath: imagePaths[actor]![label] ?? null,
      };
    }
    actorsOut[actor] = {
      beforeTris: beforeShapes[actor]!.triangles,
      rungs: rungOut,
      adoptedRung: adopted?.chosen[actor] ?? null,
      renderOriginalPath: imagePaths[actor]!.original ?? null,
    };
  }

  const verdicts = {
    schemaVersion: "openclinxr.silhouette-verdicts.v1",
    issue: "695",
    factoryStep: "body_param",
    generatedAt: new Date().toISOString(),
    measuredAgainstCommit: treeStamp.head,
    treeStamp,
    method: {
      decimation: "@gltf-transform/functions simplify + meshoptimizer (MeshoptSimplifier), per-primitive, lockBorder=false",
      renderer: "apps/ui-xr isolated-subject lab — product three.js WebGLRenderer, subject-only front 3/4 legacy framing, 1280x960",
      silhouetteInstrument: "per-frame non-background mask (bg #18211d), whole-frame IoU + 8-strip IoU + lateral-extreme per-strip IoU + holes + fragments vs the original render",
      surfaceInstrument: "per-vertical-decile + lateral-arm-band nearest-surface deviation (mm) of the decimated world mesh from the original, stride 2",
      gownContractInstrument: "exact replication of the-gown-hangs-off-the-torso contract constants on the decimated gown GLB",
      visualGrade: "OWED TO THE ORCHESTRATOR — text-only worker records quantitative metrics and renders; no pixel claim made here",
    },
    actors: actorsOut,
    station: {
      budgetTris: STATION_BUDGET_TRIS,
      beforeTris: stationBefore,
      adoptedTotalTris: adopted?.total ?? null,
      underBudget: adopted !== null && adopted.total <= STATION_BUDGET_TRIS,
      adoptedSet: adopted?.chosen ?? null,
      adoptionPolicy:
        "quality-first: the gown patient (the exam subject whose hands a learner watches) stays at "
        + "the gentlest error-0.001 rung the budget allows; nurse/family/physician step down before "
        + "the patient does",
      uniformRungTotals: Object.fromEntries(
        RUNGS.map((r) => [r.id, ED_STATION.reduce((s, a) => s + counts[a]![r.id]!, 0)]),
      ),
    },
    pedsStation: {
      beforeTris: pedsBefore,
      note: "Peds three-actor station is outside this slice's write scope; its own rung must be decided separately (the out-of-scope slot).",
    },
    refused: adopted === null,
    claimScope: [
      "pinned (ratio, error) meshopt decimation rungs for the four ED actors",
      "per-actor triangle counts with ratio AND error bound recorded together",
      "quantitative silhouette + surface-deviation instruments and renders for the orchestrator's grade",
      "no actor's triangles reduced without a recorded graded verdict entry",
    ],
    notEvidenceFor: [
      "visual realism grade (that is the orchestrator's pixel grade of the renders)",
      "how decimation reads at room framing rather than isolated capture",
      "runtime skinning of decimated meshes under animation",
      "whether decimation interacts with #686 subdivision or #691 gathers beyond the gown-contract replication measured here",
      "Quest 3 readiness",
    ],
  };

  await writeFile(path.join(CWD, VERDICTS_PATH), `${JSON.stringify(verdicts, null, 2)}\n`);
  console.log(`\nverdicts written: ${VERDICTS_PATH}`);
  console.log(`station before=${stationBefore} adoptedTotal=${adopted?.total ?? "REFUSED"} underBudget=${adopted !== null && adopted.total <= STATION_BUDGET_TRIS}`);
  console.log(`peds before=${pedsBefore}`);
  console.log(`wall clock: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
