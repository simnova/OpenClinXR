/**
 * #73 / #137 material-region hygiene — body is clothed twice; hairline cuts the face;
 * neckline metric must measure the neck *opening*, not the shoulder yoke.
 *
 * Reads shipped GLBs via glTF-Transform NodeIO (§6v — loader the runtime path uses).
 * claimScope: material region + garment coverage geometry only.
 * notEvidenceFor: clinical costume realism, drape quality, production readiness.
 *
 * ## FIXED (#137)
 * Pre-#121 ring-and-tube authoring made torsoShellMaxY ≈ neckline (ring top).
 * Post-#121 body-surface shells carry a deliberate shoulder yoke (automate_blender
 * yoke_peak_y = body_shoulder_top_y + 0.045). torsoShellMaxY therefore read the
 * yoke peak (~1.416 parent, ~1.507 nurse) and failed the anti-scarf ceiling
 * (clavicle + 0.12) while the true centerline neck opening sat inside the band.
 * garmentNecklineY now measures mid-X centerline min(frontMax, backMax); yoke
 * coverage is a separate field pair measured from the exported glTF.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";

export type RegionFacts = {
  hasRealGarmentMesh: boolean;
  /** Top + soft_trim role clothing material tris on the body mesh (not lower/pants). */
  paintedTorsoClothingTriangles: number;
  /** Scalp-hair material tris whose centroid sits in the nose/mouth front band. */
  hairTrianglesInFaceBand: number;
  /**
   * True neck *opening* Y: min over garment meshes of min(front, back) max-Y
   * in a narrow mid-X centerline band. Not the shoulder yoke peak.
   */
  garmentNecklineY: number;
  /**
   * Max Y of garment verts in lateral shoulder bands (exported glTF).
   * Deliberate yoke coverage surface; distinct from garmentNecklineY.
   */
  yokePeakY: number;
  /**
   * Max Y of body mesh verts in lateral upper bands (exported glTF).
   * Pair with yokePeakY for shoulder-coverage assertions.
   */
  bodyShoulderTopY: number;
  /** World Y of the clavicle joint (mean L/R), or body-height fallback. */
  clavicleY: number;
};

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const TORSO_CLOTHING_MAT_RE = /openclinxr_role_mesh_clothing_.*_(top|soft_trim)/i;
const HAIR_MAT_RE = /openclinxr_mesh_native_scalp_hair/i;

/** Nose/mouth height band as fractions of body height (eyes ~0.90, mouth ~0.85). */
const FACE_BAND_Y0 = 0.84;
const FACE_BAND_Y1 = 0.92;

/** Default shipped humanoid GLB directory (ui-xr public). */
export const SHIPPED_HUMANOID_GLB_DIR = "apps/ui-xr/public/generated-humanoids";

/**
 * Enumerate shipped humanoid GLBs from the tree (not a hardcoded pair).
 * #137: subject set must track what ships (#102 / §7j).
 */
export function listShippedHumanoidGlbs(
  dir: string = SHIPPED_HUMANOID_GLB_DIR,
): string[] {
  const abs = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  if (!existsSync(abs)) {
    throw new Error(`listShippedHumanoidGlbs: directory not found: ${abs}`);
  }
  return readdirSync(abs)
    .filter((f) => f.endsWith(".glb"))
    .sort()
    .map((f) => path.join(dir, f).replace(/\\/g, "/"));
}

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
  const neckOpeningCandidates: number[] = [];
  let yokePeakY = 0;

  for (const mesh of root.listMeshes()) {
    const meshName = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(meshName)) {
      hasRealGarmentMesh = true;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION")?.getArray();
        if (!pos || pos.length < 9) continue;
        const opening = centerlineNeckOpeningY(pos);
        if (opening > 0) neckOpeningCandidates.push(opening);
        yokePeakY = Math.max(yokePeakY, lateralYokePeakY(pos));
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
  const bodyShoulderTopY = lateralBodyShoulderTopY(document);

  // Multi-layer garments: lowest centerline opening still must clear the clavicle
  // and stay under the anti-scarf ceiling. Max would re-select under-layer yoke.
  const garmentNecklineY =
    neckOpeningCandidates.length > 0 ? Math.min(...neckOpeningCandidates) : 0;

  return {
    hasRealGarmentMesh,
    paintedTorsoClothingTriangles,
    hairTrianglesInFaceBand,
    garmentNecklineY,
    yokePeakY,
    bodyShoulderTopY,
    clavicleY,
  };
}

function countTriangles(pos: ArrayLike<number>, idx: ArrayLike<number> | null | undefined): number {
  if (idx && idx.length >= 3) return Math.floor(idx.length / 3);
  return Math.floor(pos.length / 9);
}

/**
 * True neck opening Y on one garment prim.
 *
 * In a narrow mid-X band, take max Y on the front half and max Y on the back half;
 * the neck opening height is the lower of those two (front crew dips below the back
 * collar; lateral yoke peaks are outside the band entirely).
 *
 * Rejected alternatives (see issue-137 calibration):
 * - torsoShellMaxY / main-shell max Y — reads deliberate yoke peak post-#121
 * - boundary-loop mean Y — highest-scoring loop still rode the yoke rim
 * - small-radius "neckish" boundary filter — unstable across closed vs open fronts
 */
function centerlineNeckOpeningY(pos: ArrayLike<number>): number {
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
  // ~6 cm absolute, or 18% of half-width — stays on the sternum line, off the deltoid.
  const band = Math.min(0.06, halfW * 0.18);

  let frontMax = -Infinity;
  let backMax = -Infinity;
  let frontN = 0;
  let backN = 0;
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i]! - cx) > band) continue;
    if (zs[i]! >= cz) {
      frontMax = Math.max(frontMax, ys[i]!);
      frontN += 1;
    } else {
      backMax = Math.max(backMax, ys[i]!);
      backN += 1;
    }
  }
  if (frontN === 0 && backN === 0) return 0;
  if (frontN === 0) return backMax;
  if (backN === 0) return frontMax;
  return Math.min(frontMax, backMax);
}

/**
 * Shoulder yoke peak from exported garment mesh: max Y in lateral upper bands.
 * Distinct from the neck opening; used for shoulder-coverage assertions.
 */
function lateralYokePeakY(pos: ArrayLike<number>): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 2 < pos.length; i += 3) {
    xs.push(Number(pos[i]));
    ys.push(Number(pos[i + 1]));
  }
  if (ys.length === 0) return 0;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const cx = (minX + maxX) * 0.5;
  const halfW = Math.max((maxX - minX) * 0.5, 0.001);
  const midY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
  let maxY = -Infinity;
  let any = false;
  for (let i = 0; i < xs.length; i++) {
    const ax = Math.abs(xs[i]! - cx);
    if (ax < halfW * 0.35 || ax > halfW * 0.9) continue;
    if (ys[i]! < midY) continue;
    maxY = Math.max(maxY, ys[i]!);
    any = true;
  }
  return any ? maxY : Math.max(...ys);
}

/**
 * Body shoulder top from exported body mesh (lateral upper half).
 * Measured through NodeIO on the shipped GLB — not the authoring-time rigging report.
 */
function lateralBodyShoulderTopY(document: Document): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const mesh of document.getRoot().listMeshes()) {
    if (GARMENT_MESH_RE.test(mesh.getName() || "")) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        xs.push(Number(pos[i]));
        ys.push(Number(pos[i + 1]));
      }
    }
  }
  if (ys.length === 0) return 0;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const cx = (minX + maxX) * 0.5;
  const halfW = Math.max((maxX - minX) * 0.5, 0.001);
  const midY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
  let maxY = -Infinity;
  let any = false;
  for (let i = 0; i < xs.length; i++) {
    const ax = Math.abs(xs[i]! - cx);
    if (ax < halfW * 0.45 || ax > halfW * 0.95) continue;
    if (ys[i]! < midY) continue;
    maxY = Math.max(maxY, ys[i]!);
    any = true;
  }
  return any ? maxY : 0;
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
