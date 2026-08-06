/**
 * #73 material-region hygiene — body is clothed twice; hairline cuts the face; neckline low.
 *
 * Reads shipped GLBs via glTF-Transform NodeIO.
 * claimScope: material region + garment coverage geometry only.
 * notEvidenceFor: clinical costume realism, drape quality, production readiness.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";

export type RegionFacts = {
  hasRealGarmentMesh: boolean;
  /** Top + soft_trim role clothing material tris on the body mesh (not lower/pants). */
  paintedTorsoClothingTriangles: number;
  /** Scalp-hair material tris whose centroid sits in the nose/mouth front band. */
  hairTrianglesInFaceBand: number;
  /** Max Y of the real garment torso shell (collar/torso, not sleeve tips). */
  garmentNecklineY: number;
  /** World Y of the clavicle joint (mean L/R), or body-height fallback. */
  clavicleY: number;
};

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const TORSO_CLOTHING_MAT_RE = /openclinxr_role_mesh_clothing_.*_(top|soft_trim)/i;
const HAIR_MAT_RE = /openclinxr_mesh_native_scalp_hair/i;

/** Nose/mouth height band as fractions of body height (eyes ~0.90, mouth ~0.85). */
const FACE_BAND_Y0 = 0.84;
const FACE_BAND_Y1 = 0.92;

export async function inspectMaterialRegionHygiene(input: {
  glbPath: string;
}): Promise<RegionFacts> {
  const abs = path.isAbsolute(input.glbPath)
    ? input.glbPath
    : path.resolve(process.cwd(), input.glbPath);
  if (!existsSync(abs)) {
    throw new Error(`inspectMaterialRegionHygiene: GLB not found: ${abs}`);
  }

  const document = await new NodeIO().read(abs);
  const root = document.getRoot();

  const body = bodyAabb(document);
  const bodyH = Math.max(body.maxY - body.minY, 0.001);
  const bodyCz = (body.minZ + body.maxZ) * 0.5;

  let hasRealGarmentMesh = false;
  let paintedTorsoClothingTriangles = 0;
  let hairTrianglesInFaceBand = 0;
  let garmentNecklineY = 0;

  for (const mesh of root.listMeshes()) {
    const meshName = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(meshName)) {
      hasRealGarmentMesh = true;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION")?.getArray();
        if (!pos || pos.length < 9) continue;
        const neckline = torsoShellMaxY(pos);
        garmentNecklineY = Math.max(garmentNecklineY, neckline);
      }
      continue;
    }

    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() || "";
      const pos = prim.getAttribute("POSITION")?.getArray();
      const idx = prim.getIndices()?.getArray();
      if (!pos) continue;

      const triCount = countTriangles(pos, idx);

      if (TORSO_CLOTHING_MAT_RE.test(matName)) {
        paintedTorsoClothingTriangles += triCount;
      }

      if (HAIR_MAT_RE.test(matName) && idx) {
        const y0 = body.minY + bodyH * FACE_BAND_Y0;
        const y1 = body.minY + bodyH * FACE_BAND_Y1;
        // Front half of the head (Anny anterior is +Z).
        const zFront = bodyCz;
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const a = Number(idx[t]);
          const b = Number(idx[t + 1]);
          const c = Number(idx[t + 2]);
          const y =
            (Number(pos[a * 3 + 1]) + Number(pos[b * 3 + 1]) + Number(pos[c * 3 + 1])) / 3;
          const z =
            (Number(pos[a * 3 + 2]) + Number(pos[b * 3 + 2]) + Number(pos[c * 3 + 2])) / 3;
          if (y >= y0 && y <= y1 && z >= zFront) {
            hairTrianglesInFaceBand += 1;
          }
        }
      }
    }
  }

  // Fallback: some exports put garment under a renamed node mesh.
  if (!hasRealGarmentMesh) {
    for (const node of root.listNodes()) {
      if (GARMENT_MESH_RE.test(node.getName() || "")) {
        hasRealGarmentMesh = true;
        break;
      }
    }
  }

  const clavicleY = readClavicleY(document, body.minY, bodyH);

  return {
    hasRealGarmentMesh,
    paintedTorsoClothingTriangles,
    hairTrianglesInFaceBand,
    garmentNecklineY,
    clavicleY,
  };
}

function countTriangles(pos: ArrayLike<number>, idx: ArrayLike<number> | null | undefined): number {
  if (idx && idx.length >= 3) return Math.floor(idx.length / 3);
  return Math.floor(pos.length / 9);
}

/**
 * Max Y of the torso shell: verts near the body center X (exclude wide sleeve tips)
 * with radial xz extent of the main shell (exclude tiny collar ring if present).
 */
function torsoShellMaxY(pos: ArrayLike<number>): number {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i + 2 < pos.length; i += 3) {
    xs.push(Number(pos[i]));
    ys.push(Number(pos[i + 1]));
    zs.push(Number(pos[i + 2]));
  }
  if (ys.length === 0) return 0;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const cx = (minX + maxX) * 0.5;
  const halfW = Math.max((maxX - minX) * 0.5, 0.001);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const cz = (minZ + maxZ) * 0.5;

  // Radial distances for torso-core verts only.
  const rads: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i]! - cx) > halfW * 0.55) continue; // sleeve-ish
    const r = Math.hypot(xs[i]! - cx, zs[i]! - cz);
    rads.push(r);
  }
  if (rads.length === 0) return Math.max(...ys);
  rads.sort((a, b) => a - b);
  const medianR = rads[Math.floor(rads.length * 0.5)]!;
  // Collar ring uses ~0.42 * r_base; keep verts near main shell radius.
  const rMin = medianR * 0.7;

  let maxY = -Infinity;
  let any = false;
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i]! - cx) > halfW * 0.55) continue;
    const r = Math.hypot(xs[i]! - cx, zs[i]! - cz);
    if (r < rMin) continue;
    maxY = Math.max(maxY, ys[i]!);
    any = true;
  }
  return any ? maxY : Math.max(...ys);
}

function bodyAabb(document: Document): {
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let any = false;
  for (const mesh of document.getRoot().listMeshes()) {
    if (GARMENT_MESH_RE.test(mesh.getName() || "")) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        const y = Number(pos[i + 1]);
        const z = Number(pos[i + 2]);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        any = true;
      }
    }
  }
  if (!any) {
    return { minY: 0, maxY: 1.7, minZ: -0.1, maxZ: 0.3 };
  }
  return { minY, maxY, minZ, maxZ };
}

/**
 * Clavicle world Y from skeleton joints. Falls back to body_min + 0.80 * height
 * (true collarbone / suprasternal region — above the 0.76 top_y that sat under it).
 */
function readClavicleY(document: Document, bodyMinY: number, bodyH: number): number {
  const clavYs: number[] = [];

  const walk = (node: GltfNode, parentWorld: [number, number, number]) => {
    const t = node.getTranslation();
    const w: [number, number, number] = [
      parentWorld[0] + t[0],
      parentWorld[1] + t[1],
      parentWorld[2] + t[2],
    ];
    const name = (node.getName() || "").toLowerCase();
    if (/clavicle/.test(name)) {
      clavYs.push(w[1]);
    }
    for (const child of node.listChildren()) {
      walk(child, w);
    }
  };

  for (const scene of document.getRoot().listScenes()) {
    for (const n of scene.listChildren()) {
      walk(n, [0, 0, 0]);
    }
  }

  // Also scan flat node list in case hierarchy is non-scene-rooted.
  if (clavYs.length === 0) {
    for (const node of document.getRoot().listNodes()) {
      const name = (node.getName() || "").toLowerCase();
      if (/clavicle/.test(name)) {
        // Without parent chain, translation alone is incomplete; use body fallback.
        break;
      }
    }
  }

  if (clavYs.length > 0) {
    return clavYs.reduce((a, b) => a + b, 0) / clavYs.length;
  }
  // Anatomical collarbone / base-of-neck region (above the old 0.76 under-collarbone top_y).
  return bodyMinY + bodyH * 0.8;
}
