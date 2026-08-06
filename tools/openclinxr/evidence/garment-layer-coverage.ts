/**
 * #75 garment layer coverage — blueprint layers → shells + body-sample coverage.
 *
 * Reads shipped GLBs via glTF-Transform NodeIO.
 * claimScope: multi-layer upper garment shells + coverage of body samples (not height gate).
 * notEvidenceFor: clinical costume realism, drape quality, production readiness, lower-body garments.
 *
 * Coverage is measured on the BODY mesh: sample regions, then ask whether any garment shell
 * vertex is near those samples. Threshold is derived from measured body height, not from the
 * generator's placement constants (that is how the old max-Y neckline gate lied).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";

export type GarmentShell = {
  meshName: string;
  hasAnteriorOpening: boolean;
  meanRadius: number;
};

export type BodySample = {
  region: string;
  covered: boolean;
};

export type GarmentLayerCoverage = {
  declaredUpperLayerCount: number;
  garmentShells: GarmentShell[];
  bodySamples: BodySample[];
};

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_NAME_RE = /openclinxr_declared_upper_layers__(.+?)(?:_mesh)?$/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;

type Vec3 = { x: number; y: number; z: number };

/**
 * Inspect a shipped humanoid GLB for multi-layer garment shells and body coverage.
 */
export async function inspectGarmentLayerCoverage(input: {
  glbPath: string;
}): Promise<GarmentLayerCoverage> {
  const abs = path.isAbsolute(input.glbPath)
    ? input.glbPath
    : path.resolve(process.cwd(), input.glbPath);
  if (!existsSync(abs)) {
    throw new Error(`inspectGarmentLayerCoverage: GLB not found: ${abs}`);
  }

  const document = await new NodeIO().read(abs);
  const root = document.getRoot();

  const declaredUpperLayerCount = readDeclaredUpperLayerCount(document);
  const shells = collectGarmentShells(document);
  const body = collectBodyVerts(document);
  const bodySamples = sampleBodyCoverage(body, shells);

  return {
    declaredUpperLayerCount:
      declaredUpperLayerCount > 0 ? declaredUpperLayerCount : shells.length,
    garmentShells: shells.map((s) => ({
      meshName: s.meshName,
      hasAnteriorOpening: s.hasAnteriorOpening,
      meanRadius: round4(s.meanRadius),
    })),
    bodySamples,
  };
}

function readDeclaredUpperLayerCount(document: Document): number {
  const names: string[] = [];
  for (const node of document.getRoot().listNodes()) {
    names.push(node.getName() || "");
  }
  for (const mesh of document.getRoot().listMeshes()) {
    names.push(mesh.getName() || "");
  }
  for (const name of names) {
    const m = DECLARED_NAME_RE.exec(name);
    if (!m) continue;
    const payload = (m[1] || "").replace(/_mesh$/i, "");
    const parts = payload.split("+").filter((p) => p.length > 0);
    if (parts.length > 0) return parts.length;
  }
  return 0;
}

type ShellInternal = {
  meshName: string;
  verts: Vec3[];
  hasAnteriorOpening: boolean;
  meanRadius: number;
  cx: number;
  cz: number;
};

function collectGarmentShells(document: Document): ShellInternal[] {
  const root = document.getRoot();
  const shells: ShellInternal[] = [];
  const seen = new Set<string>();

  for (const mesh of root.listMeshes()) {
    const meshName = mesh.getName() || "";
    if (!GARMENT_MESH_RE.test(meshName)) continue;
    if (DECLARED_ANY_RE.test(meshName)) continue;
    if (seen.has(meshName)) continue;
    seen.add(meshName);

    const verts: Vec3[] = [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        verts.push({
          x: Number(pos[i]),
          y: Number(pos[i + 1]),
          z: Number(pos[i + 2]),
        });
      }
    }
    if (verts.length < 12) continue;

    const gMinX = Math.min(...verts.map((v) => v.x));
    const gMaxX = Math.max(...verts.map((v) => v.x));
    const gMinY = Math.min(...verts.map((v) => v.y));
    const gMaxY = Math.max(...verts.map((v) => v.y));
    const gMinZ = Math.min(...verts.map((v) => v.z));
    const gMaxZ = Math.max(...verts.map((v) => v.z));
    const cx = (gMinX + gMaxX) * 0.5;
    const cz = (gMinZ + gMaxZ) * 0.5;
    const halfW = Math.max((gMaxX - gMinX) * 0.5, 0.001);
    const coreRads = verts
      .filter((v) => Math.abs(v.x - cx) <= halfW * 0.55)
      .map((v) => Math.hypot(v.x - cx, v.z - cz));
    const meanRadius =
      coreRads.length > 0
        ? coreRads.reduce((a, b) => a + b, 0) / coreRads.length
        : halfW * 0.5;

    shells.push({
      meshName,
      verts,
      hasAnteriorOpening: detectAnteriorOpening(verts, cx, cz, gMinY, gMaxY),
      meanRadius,
      cx,
      cz,
    });
  }

  // Prefer stable order: under-layers first (smaller meanRadius), then outer.
  shells.sort((a, b) => a.meanRadius - b.meanRadius);
  return shells;
}

function collectBodyVerts(document: Document): {
  verts: Vec3[];
  minY: number;
  maxY: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  height: number;
} {
  const verts: Vec3[] = [];
  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(name) || DECLARED_ANY_RE.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        verts.push({
          x: Number(pos[i]),
          y: Number(pos[i + 1]),
          z: Number(pos[i + 2]),
        });
      }
    }
  }
  if (verts.length === 0) {
    return {
      verts: [],
      minY: 0,
      maxY: 1.7,
      minX: -0.3,
      maxX: 0.3,
      minZ: -0.1,
      maxZ: 0.3,
      cx: 0,
      cz: 0.1,
      height: 1.7,
    };
  }
  const minY = Math.min(...verts.map((v) => v.y));
  const maxY = Math.max(...verts.map((v) => v.y));
  const minX = Math.min(...verts.map((v) => v.x));
  const maxX = Math.max(...verts.map((v) => v.x));
  const minZ = Math.min(...verts.map((v) => v.z));
  const maxZ = Math.max(...verts.map((v) => v.z));
  return {
    verts,
    minY,
    maxY,
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    height: Math.max(maxY - minY, 0.001),
  };
}

/**
 * Body-sample coverage (replaces max-Y neckline gate).
 *
 * Regions are anatomical bands derived from measured body AABB only:
 * - upper_chest: mid-torso height, near sternum, front half
 * - deltoid_left / deltoid_right: shoulder height, lateral half-width
 *
 * A sample is covered when the nearest garment vertex is within a tolerance derived
 * from body height (0.065 * height ≈ 10–11 cm on adult figures). That number is
 * measured-scale, not a copy of the generator's r_base / top_y constants.
 */
function sampleBodyCoverage(
  body: ReturnType<typeof collectBodyVerts>,
  shells: ShellInternal[],
): BodySample[] {
  const garmentVerts = shells.flatMap((s) => s.verts);
  if (body.verts.length === 0 || garmentVerts.length === 0) {
    return [
      { region: "upper_chest", covered: false },
      { region: "deltoid_left", covered: false },
      { region: "deltoid_right", covered: false },
    ];
  }

  const h = body.height;
  const halfW = Math.max((body.maxX - body.minX) * 0.5, 0.001);
  // Coverage radius from body scale only (not generator placement constants).
  const coverTol = Math.max(0.055, h * 0.065);

  const regions: { region: string; pick: (v: Vec3) => boolean }[] = [
    {
      region: "upper_chest",
      pick: (v) => {
        const yn = (v.y - body.minY) / h;
        // Upper sternum / upper chest — above mid-torso, below neck
        if (yn < 0.70 || yn > 0.80) return false;
        if (Math.abs(v.x - body.cx) > halfW * 0.22) return false;
        // Prefer front half (Anny anterior +Z)
        return v.z >= body.cz - 0.02;
      },
    },
    {
      region: "deltoid_left",
      pick: (v) => {
        const yn = (v.y - body.minY) / h;
        if (yn < 0.68 || yn > 0.80) return false;
        // Left is +X in Anny rewrite
        return v.x >= body.cx + halfW * 0.28 && v.x <= body.cx + halfW * 0.55;
      },
    },
    {
      region: "deltoid_right",
      pick: (v) => {
        const yn = (v.y - body.minY) / h;
        if (yn < 0.68 || yn > 0.80) return false;
        return v.x <= body.cx - halfW * 0.28 && v.x >= body.cx - halfW * 0.55;
      },
    },
  ];

  return regions.map(({ region, pick }) => {
    const candidates = body.verts.filter(pick);
    if (candidates.length === 0) {
      // No body verts in band — report uncovered (fail closed) rather than invent points.
      return { region, covered: false };
    }
    // Sample up to 24 body verts distributed in the region.
    const step = Math.max(1, Math.floor(candidates.length / 24));
    const samples: Vec3[] = [];
    for (let i = 0; i < candidates.length && samples.length < 24; i += step) {
      samples.push(candidates[i]!);
    }
    let coveredCount = 0;
    for (const s of samples) {
      if (nearestGarmentDist(s, garmentVerts) <= coverTol) coveredCount += 1;
    }
    // Majority of region samples must be near a garment shell.
    const covered = coveredCount / samples.length >= 0.55;
    return { region, covered };
  });
}

function nearestGarmentDist(p: Vec3, garmentVerts: Vec3[]): number {
  let best = Infinity;
  // Coarse: every 3rd vert for speed on dense shells; still dense enough for ~cm accuracy.
  const step = garmentVerts.length > 2000 ? 3 : 1;
  for (let i = 0; i < garmentVerts.length; i += step) {
    const g = garmentVerts[i]!;
    const d = Math.hypot(g.x - p.x, g.y - p.y, g.z - p.z);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Anterior opening detection (same geometric idea as garment-role-distinguish).
 * Mid-height angular gap near +Z front.
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
  // Only a FRONT-centered gap counts as an anterior opening. A large gap at the
  // back (common on dense closed rings after solidify / ellipse squash) must not
  // flip a closed under-layer open.
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

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
