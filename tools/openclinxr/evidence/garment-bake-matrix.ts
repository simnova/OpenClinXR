/**
 * #195 — Blender garment coefficient bake-matrix harness.
 *
 * Clothing is a parameter of the human bake (automate_blender.py apply_role_clothing_material_regions
 * → _build_body_surface_derived_garment). This harness:
 *  1. Uses a FIXED tracked *.anny_base.obj (no anny regen → no stub trap)
 *  2. Sweeps hardcoded shell coefficients via rebake_role_wardrobe_blender_only.py matrix-variant
 *  3. Measures geometry from the EXPORTED glTF (NodeIO), not Blender
 *  4. Emits garment-ledger.json + labelled contact sheets for orchestrator grading
 *
 * Decisions (commit-named):
 *  - Body: peds_nurse_kevin.anny_base.obj (adult male tracked base used by ED/street rebakes)
 *  - Parametrisation: JSON coeff-overrides file on rebake CLI (reproducible; REJECTED env-only)
 *  - Render: export GLB then software orthographic PNG cells (REJECTED Blender-only stills —
 *    export path is the only way to see the continuity trap; REJECTED full ui-xr boot)
 *  - Sweeps: bot_y_fraction, sleeve_along_fraction, front_opening_rad @ 5 values each on
 *    open_cardigan (cardigan 0.31 is the fixture-artifact hem). Ranges are exploratory — not targets.
 *  - Shipping coefficients UNCHANGED (counterweight); overrides are bake-matrix only.
 *
 * claimScope: geometry ledger + contact sheets for garment coefficient parameter space.
 * notEvidenceFor: clinical validity, visual quality grade (orchestrator grades sheets),
 * Quest readiness, correct hem choice, production wardrobe.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { NodeIO, type Document } from "@gltf-transform/core";
import { chromium } from "playwright";
import { buildContactSheet } from "./isolated-subject-harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const ISSUE_EVIDENCE_DIR = ".openclinxr/evidence/issue-195";
export const PRE_FIX_PATH = path.join(ISSUE_EVIDENCE_DIR, "pre-fix.json");
export const LEDGER_PATH = path.join(ISSUE_EVIDENCE_DIR, "garment-ledger.json");
export const HEM_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "hem-sweep-sheet.png");
export const SLEEVE_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "sleeve-sweep-sheet.png");
export const OPENING_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "opening-sweep-sheet.png");

/** Fixed body — decision recorded in pre-fix + report. */
export const BODY_BASE = "peds_nurse_kevin.anny_base.obj";
export const GARMENT_LAYERS = ["open_cardigan"] as const;

/** Exploratory ranges — not design targets. Include shipping values. */
export const BOT_Y_SWEEP = [0.22, 0.28, 0.31, 0.36, 0.42] as const;
export const SLEEVE_ALONG_SWEEP = [0.55, 0.72, 0.85, 0.92, 1.0] as const;
export const FRONT_OPENING_SWEEP = [0.0, 0.35, 0.65, 0.95, 1.2] as const;

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_RE = /declared_upper_layers/i;
const REBAKE_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/anny/rebake_role_wardrobe_blender_only.py",
);

export type VariantRow = {
  variantId: string;
  param: string;
  value: number;
  garmentKind: string;
  triangles: number;
  worldAabb: { min: [number, number, number]; max: [number, number, number] };
  hemY: number;
  sleeveExtent: number;
  connectedComponents: number;
  enclosesBody: boolean;
  glbPath: string;
  cellImagePath?: string;
};

export type GarmentBakeMatrixReport = {
  bodyBase: string;
  shippedCoefficients: {
    name: string;
    value: number;
    producedHemY?: number;
    producedSleeveExtent?: number;
  }[];
  variants: VariantRow[];
  sweeps: { param: string; values: number[] }[];
  contactSheetPaths: string[];
  continuityRebakesSpent: number;
  claimScope: string;
  notEvidenceFor: string[];
  geometryMoved: "yes" | "no" | `partially:${string}`;
  shellEnclosesBody: "all" | `some:${string}`;
  bakePath: "blender_only_rebake" | `other:${string}`;
  coefficientsSwept: string[];
  valuesPerSweep: number;
  reportSummary: {
    coefficients_swept: string;
    values_per_sweep: number;
    geometry_moved: string;
    shell_encloses_body: string;
    continuity_rebakes_spent: string;
    bake_path: string;
  };
};

let cachedReport: GarmentBakeMatrixReport | null = null;

function absEvidence(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

function ensureDir(p: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readShippedCoefficientsFromSource(): {
  name: string;
  value: number;
}[] {
  const src = readFileSync(
    path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/anny/automate_blender.py"),
    "utf8",
  );
  const must = [
    { name: "cardigan_bot_y_fraction", re: /bot_y = body_min_y \+ body_height \* (0\.31)/ },
    { name: "gown_bot_y_fraction", re: /bot_y = body_min_y \+ body_height \* (0\.32)/ },
    { name: "cardigan_sleeve_along_fraction", re: /sleeve_along = arm_len \* (0\.92)/ },
    { name: "gown_sleeve_along_fraction", re: /sleeve_along = arm_len \* (0\.72)/ },
    { name: "cardigan_front_opening_rad", re: /front_opening_rad = (0\.95)/ },
    { name: "cloth_offset_base", re: /cloth_offset = \((0\.010)/ },
    { name: "neck_y_fraction", re: /neck_y = body_min_y \+ body_height \* (0\.84)/ },
  ] as const;
  const out: { name: string; value: number }[] = [];
  for (const row of must) {
    const m = row.re.exec(src);
    if (!m) {
      throw new Error(`shipping coefficient ${row.name} not found in automate_blender.py — counterweight cannot run`);
    }
    out.push({ name: row.name, value: Number(m[1]) });
  }
  return out;
}

type MeshStats = {
  name: string;
  triangles: number;
  positions: Float32Array;
  indices: Uint32Array | null;
};

function collectMeshes(document: Document): MeshStats[] {
  const out: MeshStats[] = [];
  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute("POSITION");
      const arr = posAttr?.getArray();
      if (!arr || arr.length < 9) continue;
      const idxAttr = prim.getIndices();
      const idxArr = idxAttr?.getArray();
      const indices = idxArr
        ? new Uint32Array(Array.from(idxArr, (v) => Number(v)))
        : null;
      const triangles = indices
        ? Math.floor(indices.length / 3)
        : Math.floor(arr.length / 9);
      out.push({
        name,
        triangles,
        positions: new Float32Array(Array.from(arr, (v) => Number(v))),
        indices,
      });
    }
  }
  return out;
}

function aabbOf(positions: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/** Position-merged connected components at 5dp across garment primitives only. */
function countPositionMergedComponents(meshes: MeshStats[]): number {
  const keyToIndex = new Map<string, number>();
  const parent: number[] = [];
  const quant = (v: number) => v.toFixed(5);
  const ensure = (x: number, y: number, z: number): number => {
    const key = `${quant(x)},${quant(y)},${quant(z)}`;
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = parent.length;
      parent.push(idx);
      keyToIndex.set(key, idx);
    }
    return idx;
  };
  const find = (a: number): number => {
    let x = a;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (const mesh of meshes) {
    const pos = mesh.positions;
    const triCount = mesh.indices
      ? Math.floor(mesh.indices.length / 3)
      : Math.floor(pos.length / 9);
    for (let t = 0; t < triCount; t += 1) {
      const i0 = mesh.indices ? mesh.indices[t * 3]! : t * 3;
      const i1 = mesh.indices ? mesh.indices[t * 3 + 1]! : t * 3 + 1;
      const i2 = mesh.indices ? mesh.indices[t * 3 + 2]! : t * 3 + 2;
      const a = ensure(pos[i0 * 3]!, pos[i0 * 3 + 1]!, pos[i0 * 3 + 2]!);
      const b = ensure(pos[i1 * 3]!, pos[i1 * 3 + 1]!, pos[i1 * 3 + 2]!);
      const c = ensure(pos[i2 * 3]!, pos[i2 * 3 + 1]!, pos[i2 * 3 + 2]!);
      unite(a, b);
      unite(a, c);
    }
  }
  if (parent.length === 0) return 0;
  const roots = new Set<number>();
  for (let i = 0; i < parent.length; i += 1) roots.add(find(i));
  return roots.size;
}

function sleeveExtentOf(positions: Float32Array, aabb: { min: [number, number, number]; max: [number, number, number] }): number {
  const midY = (aabb.min[1] + aabb.max[1]) / 2;
  const cx = (aabb.min[0] + aabb.max[0]) / 2;
  const cz = (aabb.min[2] + aabb.max[2]) / 2;
  let maxR = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const y = positions[i + 1]!;
    if (y < midY) continue;
    const dx = positions[i]! - cx;
    const dz = positions[i + 2]! - cz;
    maxR = Math.max(maxR, Math.hypot(dx, dz));
  }
  return maxR;
}

/**
 * Shell encloses body (exported glTF): not a floating band.
 * Open cardigans need not be watertight — require torso-band Y overlap, co-located centre,
 * and garment half-width covering most of body half-width.
 */
function shellEnclosesBody(
  garmentAabb: { min: [number, number, number]; max: [number, number, number] },
  bodyAabb: { min: [number, number, number]; max: [number, number, number] },
  triangles: number,
): boolean {
  if (triangles < 24) return false;
  const bodyH = bodyAabb.max[1] - bodyAabb.min[1];
  if (bodyH < 0.2) return false;
  const torsoLo = bodyAabb.min[1] + bodyH * 0.35;
  const torsoHi = bodyAabb.min[1] + bodyH * 0.85;
  const yOverlap = garmentAabb.max[1] > torsoLo && garmentAabb.min[1] < torsoHi;
  const bodyCx = (bodyAabb.min[0] + bodyAabb.max[0]) / 2;
  const bodyCz = (bodyAabb.min[2] + bodyAabb.max[2]) / 2;
  const gCx = (garmentAabb.min[0] + garmentAabb.max[0]) / 2;
  const gCz = (garmentAabb.min[2] + garmentAabb.max[2]) / 2;
  const centerOk = Math.hypot(gCx - bodyCx, gCz - bodyCz) < bodyH * 0.28;
  const gHalfW = (garmentAabb.max[0] - garmentAabb.min[0]) / 2;
  const bHalfW = Math.max((bodyAabb.max[0] - bodyAabb.min[0]) / 2, 0.05);
  const widthOk = gHalfW >= bHalfW * 0.50;
  const heightOk = (garmentAabb.max[1] - garmentAabb.min[1]) >= bodyH * 0.10;
  return yOverlap && centerOk && widthOk && heightOk;
}

export async function measureExportedGarmentGlb(glbPath: string): Promise<{
  triangles: number;
  worldAabb: { min: [number, number, number]; max: [number, number, number] };
  hemY: number;
  sleeveExtent: number;
  connectedComponents: number;
  enclosesBody: boolean;
  garmentMeshes: MeshStats[];
  bodyAabb: { min: [number, number, number]; max: [number, number, number] };
}> {
  const abs = path.isAbsolute(glbPath) ? glbPath : path.join(REPO_ROOT, glbPath);
  if (!existsSync(abs)) {
    throw new Error(`measureExportedGarmentGlb: missing ${abs}`);
  }
  const document = await new NodeIO().read(abs);
  const meshes = collectMeshes(document);
  const garments = meshes.filter(
    (m) => GARMENT_MESH_RE.test(m.name) && !DECLARED_RE.test(m.name),
  );
  const bodyish = meshes.filter(
    (m) =>
      !GARMENT_MESH_RE.test(m.name)
      && !DECLARED_RE.test(m.name)
      && !/hair|eye|tooth|lash|brow/i.test(m.name),
  );

  if (garments.length === 0) {
    throw new Error(`no openclinxr_real_garment* mesh in ${abs}`);
  }

  // Merge garment primitives into one position buffer for hem/sleeve.
  let totalTris = 0;
  const allPos: number[] = [];
  for (const g of garments) {
    totalTris += g.triangles;
    for (let i = 0; i < g.positions.length; i += 1) allPos.push(g.positions[i]!);
  }
  const gPos = new Float32Array(allPos);
  const worldAabb = aabbOf(gPos);
  const hemY = worldAabb.min[1];
  const sleeveExtent = sleeveExtentOf(gPos, worldAabb);
  const connectedComponents = countPositionMergedComponents(garments);

  let bodyAabb: { min: [number, number, number]; max: [number, number, number] };
  if (bodyish.length > 0) {
    const bPos: number[] = [];
    for (const b of bodyish) {
      for (let i = 0; i < b.positions.length; i += 1) bPos.push(b.positions[i]!);
    }
    bodyAabb = aabbOf(new Float32Array(bPos));
  } else {
    // Fallback: expand garment AABB slightly as body proxy (should not happen on full bake).
    bodyAabb = {
      min: [worldAabb.min[0] * 0.9, worldAabb.min[1] - 0.2, worldAabb.min[2] * 0.9],
      max: [worldAabb.max[0] * 0.9, worldAabb.max[1] + 0.2, worldAabb.max[2] * 0.9],
    };
  }

  return {
    triangles: totalTris,
    worldAabb,
    hemY,
    sleeveExtent,
    connectedComponents,
    enclosesBody: shellEnclosesBody(worldAabb, bodyAabb, totalTris),
    garmentMeshes: garments,
    bodyAabb,
  };
}

// ---------------------------------------------------------------------------
// Software orthographic PNG (no WebGL) — same genus as #194 generator-sweep
// ---------------------------------------------------------------------------

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function encodePngRgba(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderMeshesSoftware(
  meshes: MeshStats[],
  width: number,
  height: number,
  label: string,
): Buffer {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    const a = aabbOf(m.positions);
    minX = Math.min(minX, a.min[0]); minY = Math.min(minY, a.min[1]); minZ = Math.min(minZ, a.min[2]);
    maxX = Math.max(maxX, a.max[0]); maxY = Math.max(maxY, a.max[1]); maxZ = Math.max(maxZ, a.max[2]);
  }
  const spanX = Math.max(maxX - minX, 0.2) * 1.12;
  const spanY = Math.max(maxY - minY, 0.2) * 1.12;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.min(width / spanX, (height - 28) / spanY);

  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = 0x18;
    rgba[i * 4 + 1] = 0x21;
    rgba[i * 4 + 2] = 0x1d;
    rgba[i * 4 + 3] = 255;
  }
  const zbuf = new Float32Array(width * height);
  zbuf.fill(-Infinity);

  const put = (px: number, py: number, z: number, r: number, g: number, b: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const idx = py * width + px;
    if (z < zbuf[idx]!) return;
    zbuf[idx] = z;
    const o = idx * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  };

  const project = (wx: number, wy: number, wz: number) => {
    const sx = Math.round((wx - cx) * scale + width / 2);
    const sy = Math.round(height - 28 - ((wy - cy) * scale + (height - 28) / 2));
    return { sx, sy, z: -wz };
  };

  // Body: grey; garment: rose/teal by name
  for (const mesh of meshes) {
    const isGarment = GARMENT_MESH_RE.test(mesh.name) && !DECLARED_RE.test(mesh.name);
    const r = isGarment ? 0x9e : 0x9c;
    const g = isGarment ? 0x48 : 0xa3;
    const b = isGarment ? 0x61 : 0xaf;
    const pos = mesh.positions;
    const triCount = mesh.indices
      ? Math.floor(mesh.indices.length / 3)
      : Math.floor(pos.length / 9);
    // Subsample dense meshes for speed
    const step = triCount > 8000 ? 2 : 1;
    for (let t = 0; t < triCount; t += step) {
      const i0 = mesh.indices ? mesh.indices[t * 3]! : t * 3;
      const i1 = mesh.indices ? mesh.indices[t * 3 + 1]! : t * 3 + 1;
      const i2 = mesh.indices ? mesh.indices[t * 3 + 2]! : t * 3 + 2;
      const p0 = project(pos[i0 * 3]!, pos[i0 * 3 + 1]!, pos[i0 * 3 + 2]!);
      const p1 = project(pos[i1 * 3]!, pos[i1 * 3 + 1]!, pos[i1 * 3 + 2]!);
      const p2 = project(pos[i2 * 3]!, pos[i2 * 3 + 1]!, pos[i2 * 3 + 2]!);
      const minPx = Math.max(0, Math.min(p0.sx, p1.sx, p2.sx));
      const maxPx = Math.min(width - 1, Math.max(p0.sx, p1.sx, p2.sx));
      const minPy = Math.max(0, Math.min(p0.sy, p1.sy, p2.sy));
      const maxPy = Math.min(height - 1, Math.max(p0.sy, p1.sy, p2.sy));
      const area = (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p2.sx - p0.sx) * (p1.sy - p0.sy);
      if (area === 0) continue;
      for (let y = minPy; y <= maxPy; y += 1) {
        for (let x = minPx; x <= maxPx; x += 1) {
          const w0 = (p1.sx - x) * (p2.sy - y) - (p2.sx - x) * (p1.sy - y);
          const w1 = (p2.sx - x) * (p0.sy - y) - (p0.sx - x) * (p2.sy - y);
          const w2 = (p0.sx - x) * (p1.sy - y) - (p1.sx - x) * (p2.sy - y);
          if (w0 < 0 !== area < 0 && w0 !== 0) continue;
          if (w1 < 0 !== area < 0 && w1 !== 0) continue;
          if (w2 < 0 !== area < 0 && w2 !== 0) continue;
          const a = Math.abs(area);
          const z = (w0 * p0.z + w1 * p1.z + w2 * p2.z) / a;
          put(x, y, z, r, g, b);
        }
      }
    }
  }

  const labelBytes = Buffer.from(label.slice(0, 72), "utf8");
  for (let i = 0; i < Math.min(labelBytes.length, width); i += 1) {
    const o = i * 4;
    rgba[o] = 0xe8; rgba[o + 1] = 0xf5; rgba[o + 2] = 0xef; rgba[o + 3] = 255;
  }
  return encodePngRgba(width, height, rgba);
}

async function writeContactSheetFromCells(
  cells: Array<{ imagePath: string; label: string }>,
  outPath: string,
  columns: number,
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await buildContactSheet({ page, cells, outPath, columns, cellWidth: 480, cellHeight: 360 });
    return outPath;
  } finally {
    await browser.close();
  }
}

function bakeVariant(input: {
  variantId: string;
  param: string;
  value: number;
  overrides: Record<string, number>;
  outDir: string;
}): string {
  const glbPath = path.join(input.outDir, `${input.variantId}.glb`);
  if (existsSync(glbPath) && existsSync(glbPath.replace(/\.glb$/, ".measure.json"))) {
    // Cache hit from prior partial run
    return glbPath;
  }
  const workDir = path.join(input.outDir, `_work_${input.variantId}`);
  const relGlb = path.relative(REPO_ROOT, glbPath);
  const args = [
    REBAKE_SCRIPT,
    "matrix-variant",
    "--body-base",
    BODY_BASE,
    "--garment-layers",
    GARMENT_LAYERS.join(","),
    "--actor-role",
    "patient",
    "--output-glb",
    relGlb,
    "--coeff-overrides",
    JSON.stringify(input.overrides),
    "--work-dir",
    path.relative(REPO_ROOT, workDir),
  ];
  console.log(`[garment-bake-matrix] baking ${input.variantId}`, JSON.stringify(input.overrides));
  const result = spawnSync("python3", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 700_000,
    env: { ...process.env, OPENCLINXR_WORKER: "1" },
  });
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-4000);
    throw new Error(
      `matrix-variant failed for ${input.variantId} status=${result.status}\n${tail}`,
    );
  }
  if (!existsSync(glbPath)) {
    throw new Error(`matrix-variant did not write ${glbPath}`);
  }
  const bytes = readFileSync(glbPath).byteLength;
  if (bytes < 1_000_000) {
    throw new Error(`stub trap: ${glbPath} is ${bytes} B`);
  }
  return glbPath;
}

/** Ensure pre-fix exists. Does not overwrite an existing pre-fix (before-column). */
export function ensurePreFixArtifact(): string {
  const out = absEvidence(PRE_FIX_PATH);
  if (existsSync(out)) return out;
  // Reconstruct from source + any already-baked shipping GLB if pre-fix was deleted.
  const shipped = readShippedCoefficientsFromSource();
  const payload = {
    schemaVersion: "openclinxr.garment-bake-matrix.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    reconstructed: true,
    bodyBaseChosen: `apps/ui-xr/public/generated-humanoids/${BODY_BASE}`,
    shippedCoefficients: shipped,
    claimScope: "pre-fix shipped garment coefficients (#195)",
    notEvidenceFor: ["clinical_validity", "quest_readiness", "visual_quality_grade"],
  };
  writeJson(out, payload);
  return out;
}

export async function inspectGarmentBakeMatrix(): Promise<GarmentBakeMatrixReport> {
  if (cachedReport) return cachedReport;

  ensurePreFixArtifact();
  const preFix = JSON.parse(readFileSync(absEvidence(PRE_FIX_PATH), "utf8")) as {
    shippedCoefficients?: Array<{
      name: string;
      value: number;
      producedHemY?: number;
      producedSleeveExtent?: number;
    }>;
  };

  // Counterweight: re-read shipping source (must still match planted values).
  const fromSource = readShippedCoefficientsFromSource();
  const shippedCoefficients = fromSource.map((c) => {
    const pref = preFix.shippedCoefficients?.find((p) => p.name === c.name);
    return {
      name: c.name,
      value: c.value,
      producedHemY: pref?.producedHemY,
      producedSleeveExtent: pref?.producedSleeveExtent,
    };
  });

  const outDir = absEvidence(ISSUE_EVIDENCE_DIR, "variants");
  mkdirSync(outDir, { recursive: true });

  const sweeps: { param: string; values: number[] }[] = [
    { param: "bot_y_fraction", values: [...BOT_Y_SWEEP] },
    { param: "sleeve_along_fraction", values: [...SLEEVE_ALONG_SWEEP] },
    { param: "front_opening_rad", values: [...FRONT_OPENING_SWEEP] },
  ];

  const jobs: Array<{
    variantId: string;
    param: string;
    value: number;
    overrides: Record<string, number>;
  }> = [];
  for (const sweep of sweeps) {
    for (const value of sweep.values) {
      const tag = String(value).replace(".", "p");
      jobs.push({
        variantId: `${sweep.param}_${tag}`,
        param: sweep.param,
        value,
        overrides: { [sweep.param]: value },
      });
    }
  }

  // Sequential bakes (Blender is heavy; parallel would thrash M1 shared memory).
  // Continuity budget: we do not rebake on Blender-vs-export disagreement — measure export only.
  const continuityRebakesSpent = 0;
  const variants: VariantRow[] = [];

  for (const job of jobs) {
    const glbPath = bakeVariant({ ...job, outDir });
    const measure = await measureExportedGarmentGlb(glbPath);
    const cellPath = path.join(outDir, `${job.variantId}_cell.png`);
    // Render body+garment for visual context
    const document = await new NodeIO().read(glbPath);
    const allMeshes = collectMeshes(document);
    const png = renderMeshesSoftware(
      allMeshes,
      480,
      360,
      `${job.param}=${job.value}`,
    );
    writeFileSync(cellPath, png);
    // Cache measure for resume
    writeJson(path.join(outDir, `${job.variantId}.measure.json`), {
      triangles: measure.triangles,
      hemY: measure.hemY,
      sleeveExtent: measure.sleeveExtent,
      connectedComponents: measure.connectedComponents,
      enclosesBody: measure.enclosesBody,
      worldAabb: measure.worldAabb,
    });

    variants.push({
      variantId: job.variantId,
      param: job.param,
      value: job.value,
      garmentKind: "open_front",
      triangles: measure.triangles,
      worldAabb: measure.worldAabb,
      hemY: measure.hemY,
      sleeveExtent: measure.sleeveExtent,
      connectedComponents: measure.connectedComponents,
      enclosesBody: measure.enclosesBody,
      glbPath: path.relative(REPO_ROOT, glbPath),
      cellImagePath: path.relative(REPO_ROOT, cellPath),
    });
  }

  // Geometry moved?
  const movedParams: string[] = [];
  const stuckParams: string[] = [];
  for (const sweep of sweeps) {
    const rows = variants.filter((v) => v.param === sweep.param);
    const sig = new Set(
      rows.map((v) => `${v.triangles}|${v.hemY.toFixed(4)}|${v.sleeveExtent.toFixed(4)}`),
    );
    if (sig.size > 1) movedParams.push(sweep.param);
    else stuckParams.push(sweep.param);
  }
  const geometryMoved: GarmentBakeMatrixReport["geometryMoved"] =
    stuckParams.length === 0
      ? "yes"
      : movedParams.length === 0
        ? "no"
        : `partially:${stuckParams.join(",")}`;

  const detached = variants.filter((v) => !v.enclosesBody);
  const shellEnclosesBody: GarmentBakeMatrixReport["shellEnclosesBody"] =
    detached.length === 0
      ? "all"
      : `some:${detached.map((d) => d.variantId).join(",")}`;

  // Contact sheets
  const hemCells = variants
    .filter((v) => v.param === "bot_y_fraction")
    .map((v) => ({
      imagePath: absEvidence(v.cellImagePath!),
      label: `bot_y_frac=${v.value} hemY=${v.hemY.toFixed(3)} tris=${v.triangles}`,
    }));
  const sleeveCells = variants
    .filter((v) => v.param === "sleeve_along_fraction")
    .map((v) => ({
      imagePath: absEvidence(v.cellImagePath!),
      label: `sleeve_along=${v.value} ext=${v.sleeveExtent.toFixed(3)} tris=${v.triangles}`,
    }));
  const openingCells = variants
    .filter((v) => v.param === "front_opening_rad")
    .map((v) => ({
      imagePath: absEvidence(v.cellImagePath!),
      label: `opening=${v.value} hemY=${v.hemY.toFixed(3)} tris=${v.triangles}`,
    }));

  const hemSheet = absEvidence(HEM_SHEET_PATH);
  const sleeveSheet = absEvidence(SLEEVE_SHEET_PATH);
  const openingSheet = absEvidence(OPENING_SHEET_PATH);
  await writeContactSheetFromCells(hemCells, hemSheet, 3);
  await writeContactSheetFromCells(sleeveCells, sleeveSheet, 3);
  await writeContactSheetFromCells(openingCells, openingSheet, 3);

  const contactSheetPaths = [
    path.relative(REPO_ROOT, hemSheet),
    path.relative(REPO_ROOT, sleeveSheet),
    path.relative(REPO_ROOT, openingSheet),
  ];

  const report: GarmentBakeMatrixReport = {
    bodyBase: `apps/ui-xr/public/generated-humanoids/${BODY_BASE}`,
    shippedCoefficients,
    variants,
    sweeps,
    contactSheetPaths,
    continuityRebakesSpent,
    claimScope:
      "garment coefficient bake-matrix ledger + contact sheets on fixed Anny base (#195)",
    notEvidenceFor: [
      "clinical_validity",
      "quest_readiness",
      "visual_quality_grade",
      "correct_hem_length_choice",
      "production_wardrobe",
    ],
    geometryMoved,
    shellEnclosesBody,
    bakePath: "blender_only_rebake",
    coefficientsSwept: sweeps.map((s) => s.param),
    valuesPerSweep: BOT_Y_SWEEP.length,
    reportSummary: {
      coefficients_swept: sweeps.map((s) => s.param).join(","),
      values_per_sweep: BOT_Y_SWEEP.length,
      geometry_moved: geometryMoved,
      shell_encloses_body: shellEnclosesBody,
      continuity_rebakes_spent: `${continuityRebakesSpent} of 2`,
      bake_path: "blender_only_rebake",
    },
  };

  writeJson(absEvidence(LEDGER_PATH), {
    schemaVersion: "openclinxr.garment-bake-matrix.ledger.v1",
    ...report,
    contentHash: createHash("sha256")
      .update(JSON.stringify(variants.map((v) => [v.variantId, v.triangles, v.hemY, v.sleeveExtent])))
      .digest("hex")
      .slice(0, 16),
  });

  cachedReport = report;
  return report;
}

// CLI: pnpm exec tsx tools/openclinxr/evidence/garment-bake-matrix.ts
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectGarmentBakeMatrix()
    .then((r) => {
      console.log(JSON.stringify(r.reportSummary, null, 2));
      console.log("variants", r.variants.length);
      console.log("sheets", r.contactSheetPaths);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
