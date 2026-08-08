/**
 * #103 open-front under-layer + short-sleeve arm clothing — structural facts from exported glTF.
 *
 * claimScope: closed surface behind an open front (mesh under-layer or body clothing material at
 * chest midline) + clothing material on the arm distal to a short cuff. Counterweight: outer keeps
 * anterior opening; #121 shoulder span; #124 hem-over-paint; #73 painted lower.
 * notEvidenceFor: "looks dressed", fabric realism, production readiness, clinical costume.
 *
 * Measurements come from EXPORTED glTF via NodeIO — never Blender authoring intent.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;
const LOWER_PAINT_MAT_RE = /openclinxr_role_mesh_clothing_.*_lower/i;
const TOP_PAINT_MAT_RE = /openclinxr_role_mesh_clothing_.*_(top|soft_trim)/i;
/** Any body clothing material region (top / lower / arm / soft_trim). */
const BODY_CLOTHING_MAT_RE = /openclinxr_role_mesh_clothing_/i;

type Vec3 = { x: number; y: number; z: number };

export type AssetLayering = {
  assetPath: string;
  garmentKind: string;
  hasClosedUnderLayerAcrossMidline: boolean;
  underLayerTriangleCount: number;
  outerRetainsAnteriorOpening: boolean;
  armBelowCuffClothedFraction: number;
  hasShortSleeve: boolean;
  shoulderSpannedByOneComponent: boolean;
  hemOverlapsPaintedLower: boolean;
  hasPaintedLowerRegion: boolean;
};

export type OpenFrontUnderLayerReport = {
  assets: AssetLayering[];
  measuredAt: string;
  humanoidDir: string;
};

/**
 * Enumerate every shipped humanoid GLB and measure open-front under-layer + sleeve-end facts.
 */
export async function inspectOpenFrontUnderLayer(
  opts: { humanoidDir?: string } = {},
): Promise<OpenFrontUnderLayerReport> {
  const humanoidDir = opts.humanoidDir
    ? path.isAbsolute(opts.humanoidDir)
      ? opts.humanoidDir
      : path.resolve(process.cwd(), opts.humanoidDir)
    : path.resolve(process.cwd(), "apps/ui-xr/public/generated-humanoids");

  if (!existsSync(humanoidDir)) {
    throw new Error(`inspectOpenFrontUnderLayer: dir not found: ${humanoidDir}`);
  }

  const glbs = readdirSync(humanoidDir)
    .filter((f) => f.endsWith(".glb") && !f.includes("rigging"))
    .filter((f) => !f.endsWith(".anny_base.glb"))
    .sort();

  const assets: AssetLayering[] = [];
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

type Shell = {
  meshName: string;
  positions: Vec3[];
  indices: number[];
  triCount: number;
  isUnder: boolean;
  hasAnteriorOpening: boolean;
  minY: number;
  maxY: number;
  cx: number;
  cz: number;
};

type BodyTri = {
  x: number;
  y: number;
  z: number;
  mat: string;
};

async function measureOneAsset(
  absPath: string,
  assetPath: string,
): Promise<AssetLayering | null> {
  const document = await new NodeIO().read(absPath);
  const shells = collectShells(document);
  if (shells.length === 0) return null;

  const body = collectBody(document);
  if (body.positions.length === 0) return null;

  // Outer = largest non-under shell (primary silhouette); under = any __under_ or non-open shell.
  const nonUnder = shells.filter((s) => !s.isUnder);
  const outer =
    nonUnder.sort((a, b) => b.triCount - a.triCount)[0] ??
    shells.sort((a, b) => b.triCount - a.triCount)[0]!;

  const garmentKind = inferGarmentKind(outer, assetPath, shells);
  const outerRetainsAnteriorOpening = outer.hasAnteriorOpening;

  const midline = measureClosedAcrossMidline(shells, body);
  const sleeve = measureArmBelowCuff(outer, body);
  const paint = measurePaintedLower(body);
  const hemLowestY = measureHemLowestY(outer);
  const hemOverlapsPaintedLower =
    paint.hasPaint && hemLowestY <= paint.topY + 1e-4;

  const components = connectedComponents(outer.indices, outer.positions.length);
  const minMeaningful = Math.max(24, Math.floor(outer.positions.length * 0.01));
  const meaningful = components.filter((c) => c.length >= minMeaningful);
  // Wardrobe-stack (#208): open outer may lack centerline front; closed under supplies it.
  const underShell =
    shells
      .filter((s) => s.isUnder)
      .sort((a, b) => b.triCount - a.triCount)[0] ?? null;
  const shoulderSpannedByOneComponent = shoulderSpannedWardrobe(
    outer.positions,
    meaningful.length > 0 ? meaningful : components,
    underShell,
    body,
  );

  return {
    assetPath,
    garmentKind,
    hasClosedUnderLayerAcrossMidline: midline.hasClosed,
    underLayerTriangleCount: midline.triCount,
    outerRetainsAnteriorOpening,
    armBelowCuffClothedFraction: round4(sleeve.clothedFraction),
    hasShortSleeve: sleeve.hasShortSleeve,
    shoulderSpannedByOneComponent,
    hemOverlapsPaintedLower,
    hasPaintedLowerRegion: paint.hasPaint,
  };
}

function collectShells(document: Document): Shell[] {
  const shells: Shell[] = [];
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
      const ys = positions.map((p) => p.y);
      const xs = positions.map((p) => p.x);
      const zs = positions.map((p) => p.z);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const cx = (Math.min(...xs) + Math.max(...xs)) * 0.5;
      const cz = (Math.min(...zs) + Math.max(...zs)) * 0.5;
      shells.push({
        meshName,
        positions,
        indices,
        triCount: Math.floor(indices.length / 3),
        isUnder: /__under_/i.test(meshName),
        hasAnteriorOpening: detectAnteriorOpening(positions, cx, cz, minY, maxY),
        minY,
        maxY,
        cx,
        cz,
      });
      break; // one prim per mesh is enough for these shells
    }
  }
  return shells;
}

function collectBody(document: Document): {
  positions: Vec3[];
  tris: BodyTri[];
  minY: number;
  maxY: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  height: number;
  halfW: number;
} {
  const positions: Vec3[] = [];
  const tris: BodyTri[] = [];
  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(name) || DECLARED_ANY_RE.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()?.getName() || "";
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
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const a = Number(idx[t]);
          const b = Number(idx[t + 1]);
          const c = Number(idx[t + 2]);
          tris.push({
            x: (Number(arr[a * 3]) + Number(arr[b * 3]) + Number(arr[c * 3])) / 3,
            y: (Number(arr[a * 3 + 1]) + Number(arr[b * 3 + 1]) + Number(arr[c * 3 + 1])) / 3,
            z: (Number(arr[a * 3 + 2]) + Number(arr[b * 3 + 2]) + Number(arr[c * 3 + 2])) / 3,
            mat,
          });
        }
      }
    }
  }
  if (positions.length === 0) {
    return {
      positions: [],
      tris: [],
      minY: 0,
      maxY: 1,
      minX: -0.3,
      maxX: 0.3,
      minZ: -0.1,
      maxZ: 0.3,
      cx: 0,
      cz: 0.1,
      height: 1,
      halfW: 0.3,
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
    tris,
    minY,
    maxY,
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    height: Math.max(maxY - minY, 0.001),
    halfW: Math.max((maxX - minX) * 0.5, 0.001),
  };
}

/**
 * A closed surface spans the anterior midline at chest height when either:
 * - a CLOSED garment shell (under-layer or closed outer) has verts on the front midline, or
 * - body faces with a clothing material (top paint) sit on that midline band.
 * Aggregation: max tris among qualifying closed shells (or paint tri count).
 */
function measureClosedAcrossMidline(
  shells: Shell[],
  body: ReturnType<typeof collectBody>,
): { hasClosed: boolean; triCount: number } {
  const chestY = body.minY + body.height * 0.62;
  const band = body.height * 0.05;
  const midHalfW = body.halfW * 0.12;

  let bestShellTris = 0;
  for (const s of shells) {
    // Open shells do not close the midline by definition.
    if (s.hasAnteriorOpening && !s.isUnder) continue;
    // Under-layers are closed by authoring; outer closed shells also qualify.
    if (s.hasAnteriorOpening && s.isUnder) continue;
    const midFront = s.positions.filter(
      (v) =>
        Math.abs(v.x - body.cx) <= midHalfW &&
        Math.abs(v.y - chestY) <= band &&
        v.z >= body.cz - 0.02,
    );
    if (midFront.length >= 4) {
      bestShellTris = Math.max(bestShellTris, s.triCount);
    }
  }

  // Body top paint across the same band (scoped restore for open gap).
  const paintTris = body.tris.filter(
    (t) =>
      TOP_PAINT_MAT_RE.test(t.mat) &&
      Math.abs(t.x - body.cx) <= midHalfW &&
      Math.abs(t.y - chestY) <= band &&
      t.z >= body.cz - 0.02,
  );
  const paintCount = paintTris.length;

  if (bestShellTris > 0) {
    return { hasClosed: true, triCount: bestShellTris };
  }
  if (paintCount >= 8) {
    return { hasClosed: true, triCount: paintCount };
  }
  return { hasClosed: false, triCount: 0 };
}

/**
 * Short sleeve: garment lateral min-Y (cuff) sits well above the wrist band.
 * Arm below cuff clothed fraction: body triangles on the arm between wrist and cuff
 * that carry a clothing material region (not skin / hair).
 */
function measureArmBelowCuff(
  outer: Shell,
  body: ReturnType<typeof collectBody>,
): { hasShortSleeve: boolean; clothedFraction: number } {
  const latThresh = body.halfW * 0.45;
  const lateral = outer.positions.filter((v) => Math.abs(v.x - body.cx) >= latThresh);
  if (lateral.length < 16) {
    // No distinct sleeve volume — treat as long / n/a (not short exposure).
    return { hasShortSleeve: false, clothedFraction: 1 };
  }
  const cuffY = Math.min(...lateral.map((v) => v.y));
  // Wrist / hand band roughly lower 12–18% of body height.
  const wristY = body.minY + body.height * 0.14;
  // Short when cuff is substantially above the wrist (upper arm / mid forearm).
  const hasShortSleeve = cuffY > wristY + body.height * 0.12;
  if (!hasShortSleeve) {
    return { hasShortSleeve: false, clothedFraction: 1 };
  }

  // Arm body tris: lateral, between wrist and just below cuff.
  const yLo = wristY;
  const yHi = cuffY + body.height * 0.02;
  const armTris = body.tris.filter(
    (t) =>
      Math.abs(t.x - body.cx) >= latThresh * 0.85 &&
      t.y >= yLo &&
      t.y <= yHi,
  );
  if (armTris.length < 8) {
    // No arm body samples in band — fail closed (exposed).
    return { hasShortSleeve: true, clothedFraction: 0 };
  }
  const clothed = armTris.filter((t) => BODY_CLOTHING_MAT_RE.test(t.mat));
  return {
    hasShortSleeve: true,
    clothedFraction: clothed.length / armTris.length,
  };
}

function measurePaintedLower(body: ReturnType<typeof collectBody>): {
  hasPaint: boolean;
  topY: number;
} {
  let maxY = -Infinity;
  let n = 0;
  for (const t of body.tris) {
    if (!LOWER_PAINT_MAT_RE.test(t.mat)) continue;
    if (t.y > maxY) maxY = t.y;
    n += 1;
  }
  if (n === 0 || !Number.isFinite(maxY)) return { hasPaint: false, topY: 0 };
  return { hasPaint: true, topY: maxY };
}

/** Lowest Y of the outer shell (hem approximation; sufficient for overlap vs paint top). */
function measureHemLowestY(outer: Shell): number {
  if (outer.positions.length === 0) return 0;
  return Math.min(...outer.positions.map((p) => p.y));
}

/**
 * Kind vocabulary aligned with garment-hem-boundary intent, but does NOT treat the
 * "openclinxr_" mesh-name prefix as open_front (that was a false positive on every asset).
 * Geometry anterior-opening on the outer shell is authoritative for open_front.
 */
function inferGarmentKind(outer: Shell, assetPath: string, shells: Shell[]): string {
  const pathL = assetPath.toLowerCase();
  const matBlob = shells.map((s) => s.meshName.toLowerCase()).join(" ");
  // Drop the openclinxr_ real_garment boilerplate before token checks.
  const tokenBlob = `${pathL} ${matBlob}`
    .replace(/openclinxr_real_garment/gi, " ")
    .replace(/openclinxr_/gi, " ");

  if (
    /gown|adult_cast|hospital_gown/.test(tokenBlob) ||
    pathL.includes("adult_cast")
  ) {
    return "gown";
  }
  // Geometry first: outer with a real anterior opening is open_front.
  if (outer.hasAnteriorOpening) return "open_front";
  if (
    /cardigan|open_front|open_jacket|lab_coat_open|parent|spouse/.test(tokenBlob) ||
    pathL.includes("parent") ||
    pathL.includes("spouse")
  ) {
    // Path says cardigan/parent even if opening detector missed — still open_front class.
    if (/cardigan|open_front|open_jacket|parent|spouse/.test(tokenBlob + pathL)) {
      return "open_front";
    }
  }
  if (/scrub|nurse/.test(tokenBlob) || pathL.includes("nurse")) return "scrub";
  if (/tshirt|exam_tshirt|patient_child/.test(tokenBlob) || pathL.includes("patient_child")) {
    return "tshirt";
  }
  return "closed_default";
}

/** Same geometric idea as garment-layer-coverage / garment-role-distinguish. */
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
    let midN = midAng;
    while (midN > Math.PI) midN -= Math.PI * 2;
    while (midN < -Math.PI) midN += Math.PI * 2;
    if (gap > maxGap) {
      maxGap = gap;
      maxGapMid = midN;
    }
  }

  const FRONT = Math.PI * 0.5;
  let d = maxGapMid - FRONT;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const frontDist = Math.abs(d);
  if (maxGap >= 0.55 && frontDist < 0.85) return true;

  const frontBand = mid.filter((v) => v.z > cz + 0.01);
  if (frontBand.length === 0 && maxGap >= 0.45 && frontDist < 0.85) return true;

  const nearFront = mid.filter((v) => v.z >= cz);
  if (nearFront.length >= 4) {
    const left = nearFront.filter((v) => v.x < cx - 0.02);
    const right = nearFront.filter((v) => v.x > cx + 0.02);
    const center = nearFront.filter((v) => Math.abs(v.x - cx) <= 0.02);
    if (
      left.length >= 2 &&
      right.length >= 2 &&
      center.length === 0 &&
      maxGap >= 0.4 &&
      frontDist < 0.85
    ) {
      return true;
    }
  }
  return false;
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
  under: Shell | null,
  body: { minY: number; maxY: number; cx: number; cz: number; halfW: number },
): boolean {
  const outer = spanFlags(outerPositions, outerComponents, body);
  if (!outer.oneComponent) return false;
  if (!outer.back || !outer.leftDeltoidTop || !outer.rightDeltoidTop) return false;
  if (outer.front) return true;
  if (!under) return false;
  const underComps = connectedComponents(under.indices, under.positions.length);
  const minMeaningful = Math.max(24, Math.floor(under.positions.length * 0.01));
  const meaningful = underComps.filter((c) => c.length >= minMeaningful);
  const underFlags = spanFlags(
    under.positions,
    meaningful.length > 0 ? meaningful : underComps,
    body,
  );
  return underFlags.oneComponent && underFlags.front;
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
