/**
 * #46 garment role distinguishability — geometry features from shipped GLBs.
 *
 * Reads openclinxr_real_garment* meshes via glTF-Transform NodeIO.
 * claimScope: role→garment topology differs (opening / sleeve class / hem).
 * notEvidenceFor: clinical costume realism, production readiness, MakeClothes bake-off.
 *
 * ## FIXED (#210) — multi-shell awareness
 *
 * describeGarmentGeometry now collects all garment shells via collectGarmentShells() and
 * selects the OUTER (non-__under_) shell by policy for role distinguish comparisons.
 * Pre-#210 it picked the largest shell by vertex array length, which could silently
 * select an under-layer on a future asset. On the three current dual-layer assets
 * (street_casual, spouse, anxious_parent) the outer is already the larger shell,
 * so existing distinguish contracts retain the same shell — but the guarantee is now
 * intentional rather than accidental.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

export type GarmentFeatures = {
  meshName: string;
  vertexCount: number;
  hasAnteriorOpening: boolean;
  sleeveLengthClass: string;
  hemHeightRatio: number;
};

const GARMENT_NAME_RE = /openclinxr_real_garment/i;
const UNDER_RE = /__under_/i;

/** Structural features that count toward distinguishability (not name/colour alone). */
const STRUCTURAL_KEYS = ["hasAnteriorOpening", "sleeveLengthClass", "hemHeightRatio"] as const;

const HEM_RATIO_EPS = 0.04;

/**
 * True when two garments differ on ≥2 structural geometric features.
 * meshName and vertexCount alone never suffice (anti-cheat for rename / scale-only shells).
 */
export function garmentsDistinguishable(
  a: GarmentFeatures,
  b: GarmentFeatures,
): { distinguishable: boolean; features: string[] } {
  const features: string[] = [];

  if (a.hasAnteriorOpening !== b.hasAnteriorOpening) {
    features.push("hasAnteriorOpening");
  }
  if (a.sleeveLengthClass !== b.sleeveLengthClass) {
    features.push("sleeveLengthClass");
  }
  if (Math.abs(a.hemHeightRatio - b.hemHeightRatio) >= HEM_RATIO_EPS) {
    features.push("hemHeightRatio");
  }

  // vertexCount may corroborate but is never a distinguishing feature by itself —
  // scale-and-recolour would change it without changing structure.
  const distinguishable = features.length >= 2;
  return { distinguishable, features };
}

type Vec3 = { x: number; y: number; z: number };

type ShellGeom = {
  meshName: string;
  positions: ArrayLike<number>;
  vertexCount: number;
  isUnder: boolean;
};

/**
 * Collect all garment shells from a GLB document. Pattern shared with
 * garment-surface-derived.ts collectGarmentShells (#208).
 */
function collectGarmentShells(
  root: ReturnType<Awaited<ReturnType<NodeIO["read"]>>["getRoot"]>,
): ShellGeom[] {
  const shells: ShellGeom[] = [];
  for (const mesh of root.listMeshes()) {
    const meshName = mesh.getName() || "";
    if (!GARMENT_NAME_RE.test(meshName)) continue;
    if (/declared_upper_layers/i.test(meshName)) continue;

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const arr = pos?.getArray();
      if (!arr || arr.length < 9) continue;
      shells.push({
        meshName,
        positions: arr,
        vertexCount: Math.floor(arr.length / 3),
        isUnder: UNDER_RE.test(meshName),
      });
      break;
    }
  }
  return shells;
}

/**
 * Describe the outer (non-__under_) garment shell for role distinguishability.
 * On a dual-layer asset (open outer + closed under) the outer is the visible
 * silhouette that a viewer sees and compares across roles.
 *
 * Selection policy (#210): prefer the largest non-under shell (outer). Fall back
 * to the largest any shell if no outer exists (single-layer or under-only asset).
 * This replaces the pre-#210 largest-vertex-count-by-accident selection.
 */
export async function describeGarmentGeometry(input: {
  glbPath: string;
}): Promise<GarmentFeatures | null> {
  const abs = path.isAbsolute(input.glbPath)
    ? input.glbPath
    : path.resolve(process.cwd(), input.glbPath);
  if (!existsSync(abs)) {
    throw new Error(`describeGarmentGeometry: GLB not found: ${abs}`);
  }

  const document = await new NodeIO().read(abs);
  const root = document.getRoot();

  // Collect all garment shells, then select the outer (non-under) shell by policy.
  const shells = collectGarmentShells(root);
  if (shells.length === 0) return null;

  // Prefer the largest non-under shell (outer silhouette). On dual-layer assets
  // this is the open cardigan, not the closed under-layer that a single-shell
  // picker might return by accident.
  const nonUnder = shells.filter((s) => !s.isUnder);
  const selected =
    nonUnder.sort((a, b) => b.vertexCount - a.vertexCount)[0] ??
    shells.sort((a, b) => b.vertexCount - a.vertexCount)[0]!;

  const verts = positionsToVec3(selected.positions);
  const vertexCount = verts.length;
  if (vertexCount < 3) return null;

  const body = collectBodyAabb(root, selected.meshName);
  const gMinY = Math.min(...verts.map((v) => v.y));
  const gMaxY = Math.max(...verts.map((v) => v.y));
  const gMinX = Math.min(...verts.map((v) => v.x));
  const gMaxX = Math.max(...verts.map((v) => v.x));
  const gCx = (gMinX + gMaxX) * 0.5;
  const gCz =
    (Math.min(...verts.map((v) => v.z)) + Math.max(...verts.map((v) => v.z))) * 0.5;

  const bodyHeight = Math.max(body.maxY - body.minY, 0.001);
  // Hem height ratio: how high the garment hem sits as a fraction of body height
  // (higher ratio = shorter garment / higher hem). Scrub ~0.45+, cardigan lower.
  const hemHeightRatio = (gMinY - body.minY) / bodyHeight;

  const sleeveLengthClass = classifySleeveLength(verts, gCx, body.width);

  const hasAnteriorOpening = detectAnteriorOpening(verts, gCx, gCz, gMinY, gMaxY);

  return {
    meshName: selected.meshName,
    vertexCount,
    hasAnteriorOpening,
    sleeveLengthClass,
    hemHeightRatio: round4(hemHeightRatio),
  };
}

function positionsToVec3(arr: ArrayLike<number>): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < arr.length; i += 3) {
    out.push({ x: Number(arr[i]), y: Number(arr[i + 1]), z: Number(arr[i + 2]) });
  }
  return out;
}

function collectBodyAabb(
  root: ReturnType<Awaited<ReturnType<NodeIO["read"]>>["getRoot"]>,
  garmentMeshName: string,
): { minY: number; maxY: number; width: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let any = false;
  for (const mesh of root.listMeshes()) {
    const name = mesh.getName() || "";
    if (GARMENT_NAME_RE.test(name) || name === garmentMeshName) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const arr = pos?.getArray();
      if (!arr) continue;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const x = Number(arr[i]);
        const y = Number(arr[i + 1]);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        any = true;
      }
    }
  }
  if (!any) {
    return { minY: 0, maxY: 1.7, width: 0.5 };
  }
  return { minY, maxY, width: Math.max(maxX - minX, 0.001) };
}

/**
 * Anterior opening: largest angular gap in a mid-height torso slice, centered near +Z
 * (front of Anny body / nose). Closed rings have max gap ≈ one column step.
 */
function detectAnteriorOpening(
  verts: readonly Vec3[],
  cx: number,
  cz: number,
  minY: number,
  maxY: number,
): boolean {
  const h = Math.max(maxY - minY, 0.001);
  const yLo = minY + h * 0.25;
  const yHi = minY + h * 0.75;
  const mid = verts.filter((v) => v.y >= yLo && v.y <= yHi);
  if (mid.length < 12) return false;

  const angles = mid
    .map((v) => Math.atan2(v.z - cz, v.x - cx))
    .sort((a, b) => a - b);

  // Deduplicate near-identical angles
  const uniq: number[] = [];
  for (const a of angles) {
    if (uniq.length === 0 || Math.abs(a - uniq[uniq.length - 1]!) > 0.02) {
      uniq.push(a);
    }
  }
  if (uniq.length < 6) return false;

  let maxGap = 0;
  let maxGapMid = 0;
  for (let i = 0; i < uniq.length; i++) {
    const a = uniq[i]!;
    const b = uniq[(i + 1) % uniq.length]!;
    let gap = i + 1 < uniq.length ? b - a : b + Math.PI * 2 - a;
    if (gap < 0) gap += Math.PI * 2;
    const midAng = a + gap * 0.5;
    // normalize mid to [-pi, pi]
    let midN = midAng;
    while (midN > Math.PI) midN -= Math.PI * 2;
    while (midN < -Math.PI) midN += Math.PI * 2;
    if (gap > maxGap) {
      maxGap = gap;
      maxGapMid = midN;
    }
  }

  // Front is +Z → angle ≈ +π/2. Require a substantial gap (≥ ~35°) near the front.
  const FRONT = Math.PI * 0.5;
  const frontDist = Math.abs(angleDiff(maxGapMid, FRONT));
  const OPENING_MIN_RAD = 0.55; // ~31.5° — closed 12-col ring has ~30° steps; need larger
  // Prefer front-centered gap; also accept if gap is large enough that front sector is empty
  // (C-shell ~54° gap).
  if (maxGap >= OPENING_MIN_RAD && frontDist < 0.85) {
    return true;
  }
  // Secondary: front sector emptiness — few verts with z well forward of center.
  const frontBand = mid.filter((v) => v.z > cz + 0.01);
  if (frontBand.length === 0 && maxGap >= 0.45) return true;
  // Sternum gap: verts near front have a hole straddling x=cx
  const nearFront = mid.filter((v) => v.z >= cz);
  if (nearFront.length >= 4) {
    const left = nearFront.filter((v) => v.x < cx - 0.02);
    const right = nearFront.filter((v) => v.x > cx + 0.02);
    const center = nearFront.filter((v) => Math.abs(v.x - cx) <= 0.02);
    if (left.length >= 2 && right.length >= 2 && center.length === 0 && maxGap >= 0.4) {
      return true;
    }
  }
  return false;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Sleeve class from lateral extent of upper garment verts beyond torso core.
 * short ≈ scrub (0.42 along arm); long ≈ open cardigan (0.92 along arm).
 */
function classifySleeveLength(verts: readonly Vec3[], cx: number, bodyWidth: number): string {
  const minY = Math.min(...verts.map((v) => v.y));
  const maxY = Math.max(...verts.map((v) => v.y));
  const h = Math.max(maxY - minY, 0.001);
  // Upper half of garment — sleeves live laterally
  const upper = verts.filter((v) => v.y >= minY + h * 0.35);
  if (upper.length < 4) return "short";
  const maxAbsX = Math.max(...upper.map((v) => Math.abs(v.x - cx)));
  // Normalized by body width: short scrub ~0.28–0.38 body half-span; long ~0.40+
  const spanRatio = maxAbsX / Math.max(bodyWidth * 0.5, 0.05);
  if (spanRatio >= 0.72) return "long";
  if (spanRatio >= 0.55) return "three_quarter";
  return "short";
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Silence unused — kept for API clarity / future expansion of differ diagnostics.
void STRUCTURAL_KEYS;
