/**
 * Orphan-skin-sliver instrument (extracted verbatim from
 * `garment-surface-stale/no-orphan-skin-slivers.test.ts`; the test imports
 * from here, no copy remains there).
 *
 * Two modes over the same predicate, same `toFixed(5)` key, no tolerance:
 * - `"per-prim"`: one {@link componentVertexGroups} call per visible skin
 *   primitive (the clause-(1) discriminator as filed).
 * - `"merged"`: per mesh, concatenate all VISIBLE skin primitives (same
 *   isSkin + hidden predicate) with offset indices, then ONE
 *   {@link componentVertexGroups} call. Exported because the count-joins
 *   test needs both paths (single-prim identity, plant+revert).
 *
 * Bounds live here so fixtures size themselves against the real instrument:
 * {@link MAX_ORPHAN_EXTENT_MM} (8 mm, ~5 px at full-body capture) and
 * {@link ORPHAN_MAX_VERTS} (12 unique vertices).
 */
import { join, resolve as pathResolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, Primitive } from "@gltf-transform/core";
import type { Document } from "@gltf-transform/core";
import {
  classifyGarmentMeshName,
  isTrouserMeshName,
  isUpperMeshName,
} from "./garment-mesh-class.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");

/** 1 px is ~1.53 mm in a full-body capture. 8 mm is ~5 px — below any reasonable "visible" bar. */
export const MAX_ORPHAN_EXTENT_MM = 8;

/** A component this small in vertex count is an orphan, not a legitimate separate body part. */
export const ORPHAN_MAX_VERTS = 12;

/** Which discriminator path to run: per-primitive (as filed) or per-mesh merged. */
type OrphanSliverMode = "per-prim" | "merged";

export interface OrphanSliverDetail {
  /** Triangles in the component. */
  faces: number;
  /** Position-merged unique vertices. */
  verts: number;
  /** Max axis range in mm, rounded to 2 decimals. */
  extentMm: number;
  /** Mean of the unique-vertex positions in metres, rounded to 5 decimals. */
  centroid: [number, number, number];
  /** Origin primitive indices contributing faces (length 1 in per-prim mode). */
  prims: number[];
}

interface OrphanMeasureRow {
  file: string;
  skinTris: number;
  orphanSlivers: string[];
  sliverDetail: OrphanSliverDetail[];
  garmentOrphans: number;
  overlapMm: number;
  /** Mesh-local `meshName#primIndex` of skipped non-triangle primitives (S5). */
  skippedNonTriangles: string[];
}

const io = new NodeIO();

/** Connected components over position-merged vertices. */
function componentVertexGroups(pos: number[][], idx: number[]): number[][] {
  const key = new Map<string, number>();
  const rep: number[] = [];
  for (let i = 0; i < pos.length; i++) {
    const k = pos[i]!.map((v) => v.toFixed(5)).join(",");
    if (!key.has(k)) key.set(k, key.size);
    rep[i] = key.get(k)!;
  }
  const parent = Array.from({ length: key.size }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(rep[idx[t]!]!);
    const b = find(rep[idx[t + 1]!]!);
    if (a !== b) parent[a] = b;
    const b2 = find(rep[idx[t + 1]!]!);
    const c = find(rep[idx[t + 2]!]!);
    if (b2 !== c) parent[b2] = c;
  }
  const members = new Map<number, number[]>();
  for (let i = 0; i < pos.length; i++) {
    const r = find(rep[i]!);
    const list = members.get(r) ?? [];
    if (list.length === 0) members.set(r, list);
    list.push(i);
  }
  return [...members.values()];
}

function posKey(v: number[]): string {
  return v.map((x) => x.toFixed(5)).join(",");
}

function isSkinPrim(meshName: string, materialName: string): boolean {
  return (
    classifyGarmentMeshName(meshName) === "body" ||
    classifyGarmentMeshName(materialName) === "body"
  );
}

function isHiddenPrim(alphaMode: string, baseAlpha: number, alphaCutoff: number): boolean {
  // alpha == cutoff is visible (glTF). NOT TESTED: baseColorTexture alpha hiding texels under MASK.
  return alphaMode === "MASK" && baseAlpha < alphaCutoff;
}

/**
 * Total visible skin primitives in the document (same isSkin + hidden
 * predicate {@link measureDocument} runs). The count-joins test uses it to
 * discover single-prim bodies.
 */
export function countVisibleSkinPrims(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!prim.getAttribute("POSITION") || !prim.getIndices()) continue;
      if (prim.getMode() !== Primitive.Mode["TRIANGLES"]) continue;
      if (isSkinPrim(mesh.getName() ?? "", mat?.getName() ?? "") &&
        !isHiddenPrim(mat?.getAlphaMode() ?? "OPAQUE", mat?.getBaseColorFactor()[3] ?? 1, mat?.getAlphaCutoff() ?? 0.5)) {
        n++;
      }
    }
  }
  return n;
}

interface ScannedPool {
  strings: string[];
  detail: OrphanSliverDetail[];
  garmentOrphans: number;
}

/**
 * Run the orphan scan over one position/index pool. `triPrim[t]` is the
 * origin primitive index of triangle t (constant in per-prim mode).
 */
function scanPool(
  pos: number[][],
  idx: number[],
  triPrim: number[],
  isSkin: boolean,
): ScannedPool {
  const strings: string[] = [];
  const detail: OrphanSliverDetail[] = [];
  let garmentOrphans = 0;
  for (const group of componentVertexGroups(pos, idx)) {
    const unique = new Set(group.map((i) => posKey(pos[i]!)));
    if (unique.size > ORPHAN_MAX_VERTS) continue;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (const i of group) {
      const v = pos[i]!;
      mnX = Math.min(mnX, v[0]!); mxX = Math.max(mxX, v[0]!);
      mnY = Math.min(mnY, v[1]!); mxY = Math.max(mxY, v[1]!);
      mnZ = Math.min(mnZ, v[2]!); mxZ = Math.max(mxZ, v[2]!);
    }
    const extentMm = Math.max(mxX - mnX, mxY - mnY, mxZ - mnZ) * 1000;
    if (extentMm <= MAX_ORPHAN_EXTENT_MM) continue;
    if (!isSkin) {
      garmentOrphans++;
      continue;
    }
    const keySet = new Set(unique);
    let faces = 0;
    const prims = new Set<number>();
    for (let t = 0; t < idx.length; t += 3) {
      if (
        keySet.has(posKey(pos[idx[t]!]!)) &&
        keySet.has(posKey(pos[idx[t + 1]!]!)) &&
        keySet.has(posKey(pos[idx[t + 2]!]!))
      ) {
        faces++;
        prims.add(triPrim[t / 3]!);
      }
    }
    const n = unique.size;
    let sx = 0, sy = 0, sz = 0;
    for (const k of keySet) {
      const [x, y, z] = k.split(",").map(Number) as [number, number, number];
      sx += x!; sy += y!; sz += z!;
    }
    strings.push(`${extentMm.toFixed(0)}mm/${n}v`);
    detail.push({
      faces,
      verts: n,
      extentMm: Math.round(extentMm * 100) / 100,
      centroid: [
        Math.round((sx / n) * 100000) / 100000,
        Math.round((sy / n) * 100000) / 100000,
        Math.round((sz / n) * 100000) / 100000,
      ],
      prims: [...prims].sort((a, b) => a - b),
    });
  }
  return { strings, detail, garmentOrphans };
}

/** Run the discriminator over an already-open document. */
export function measureDocument(
  doc: Document,
  fileLabel: string,
  mode: OrphanSliverMode = "per-prim",
): OrphanMeasureRow {
  let skinTris = 0;
  let garmentOrphans = 0;
  const orphanSlivers: string[] = [];
  const sliverDetail: OrphanSliverDetail[] = [];
  const skippedNonTriangles: string[] = [];
  let pantsTop = -Infinity;
  let shirtBot = Infinity;

  for (const mesh of doc.getRoot().listMeshes()) {
    // Merged mode pools the visible skin primitives of this mesh.
    let poolPos: number[][] = [];
    let poolIdx: number[] = [];
    let poolTriPrim: number[] = [];
    const flushPool = () => {
      if (poolPos.length === 0) return;
      const scanned = scanPool(poolPos, poolIdx, poolTriPrim, true);
      orphanSlivers.push(...scanned.strings);
      sliverDetail.push(...scanned.detail);
      poolPos = [];
      poolIdx = [];
      poolTriPrim = [];
    };

    const prims = mesh.listPrimitives();
    for (let primIndex = 0; primIndex < prims.length; primIndex++) {
      const prim = prims[primIndex]!;
      const mat = prim.getMaterial();
      const a = prim.getAttribute("POSITION");
      const ix = prim.getIndices();
      if (!a || !ix) continue;
      // S5: only indexed triangles carry faces. Skip anything else (LINES,
      // POINTS, strips, fans) BEFORE allocating per-prim arrays: an indexed
      // LINES skin prim with 2 vertices threw RangeError on the fractional
      // `new Array(indexCount / 3)` allocation.
      if (prim.getMode() !== Primitive.Mode["TRIANGLES"]) {
        skippedNonTriangles.push(`${mesh.getName() ?? ""}#${primIndex}`);
        continue;
      }
      const meshName = mesh.getName() ?? "";
      const materialName = mat?.getName() ?? "";
      const isSkin = isSkinPrim(meshName, materialName);
      const hidden = isHiddenPrim(
        mat?.getAlphaMode() ?? "OPAQUE",
        mat?.getBaseColorFactor()[3] ?? 1,
        mat?.getAlphaCutoff() ?? 0.5,
      );
      // Hiding exposed skin is the gutting clause (3) refuses. Visible skin only.
      if (isSkin && !hidden) {
        skinTris += ix.getCount() / 3;
      }
      if (hidden) continue;

      const isPants = isTrouserMeshName(meshName);
      // The makeclothes_library_fisherman_sweater mesh is Kevin's upper slot.
      const isShirt = isUpperMeshName(meshName);

      if (isSkin && mode === "merged") {
        const base = poolPos.length;
        for (let i = 0; i < a.getCount(); i++) poolPos.push(a.getElement(i, [0, 0, 0]) as number[]);
        for (let i = 0; i < ix.getCount(); i++) poolIdx.push(ix.getScalar(i) + base);
        for (let i = 0; i < ix.getCount(); i += 3) poolTriPrim.push(primIndex);
        // Overlap bookkeeping still runs per prim (positions are positions).
        for (let i = base; i < poolPos.length; i++) {
          const v = poolPos[i]!;
          if (isPants && v[1]! > pantsTop) pantsTop = v[1]!;
          if (isShirt && v[1]! < shirtBot) shirtBot = v[1]!;
        }
        continue;
      }

      const pos: number[][] = [];
      for (let i = 0; i < a.getCount(); i++) pos.push(a.getElement(i, [0, 0, 0]) as number[]);
      for (const v of pos) {
        if (isPants && v[1]! > pantsTop) pantsTop = v[1]!;
        if (isShirt && v[1]! < shirtBot) shirtBot = v[1]!;
      }
      if (!isSkin && !isPants && !isShirt) continue;

      const idx: number[] = [];
      for (let i = 0; i < ix.getCount(); i++) idx.push(ix.getScalar(i));
      const triPrim = new Array<number>(idx.length / 3).fill(primIndex);

      const scanned = scanPool(pos, idx, triPrim, isSkin);
      orphanSlivers.push(...scanned.strings);
      sliverDetail.push(...scanned.detail);
      garmentOrphans += scanned.garmentOrphans;
    }
    flushPool();
  }
  return {
    file: fileLabel,
    skinTris,
    orphanSlivers,
    sliverDetail,
    garmentOrphans,
    overlapMm: Number.isFinite(pantsTop) && Number.isFinite(shirtBot) ? (pantsTop - shirtBot) * 1000 : 0,
    skippedNonTriangles,
  };
}

export async function measure(
  rel: string,
  mode: OrphanSliverMode = "per-prim",
): Promise<OrphanMeasureRow> {
  const doc = await io.read(join(REPO_ROOT, rel));
  return measureDocument(doc, rel.split("/").pop()!, mode);
}
