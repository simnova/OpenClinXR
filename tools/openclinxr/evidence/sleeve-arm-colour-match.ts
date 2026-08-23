/**
 * #146 sleeve-end arm colour vs garment — structural facts from exported glTF.
 *
 * claimScope: arm clothing material linear RGB tracks torso garment mesh colour within a
 * loose under-layer band; arm remains clothing (not skin); #103 arm-below-cuff coverage.
 * notEvidenceFor: clinical costume realism, production readiness, fabric appearance.
 *
 * Measurements from EXPORTED glTF via NodeIO — never Blender authoring intent (#121).
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";
import { maxOf, minMaxXyz, minOf } from "./min-max-bounds.js";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;
const ARM_MAT_RE = /openclinxr_role_mesh_clothing_.*_arm/i;
const BODY_CLOTHING_MAT_RE = /openclinxr_role_mesh_clothing_/i;
const NON_SKIN_MAT_RE =
  /openclinxr_role_mesh_clothing_|openclinxr_real_garment|openclinxr_role_marker|hair|scalp/i;

// #146 counterweight: arm material must still exist under the short cuff after colour work.
// #147 moved the wrist to a hand-bone landmark — do not re-demand ankle-plane coverage.

type Vec3 = { x: number; y: number; z: number };
type Rgb = [number, number, number];

export type ArmColourFacts = {
  assetPath: string;
  role: string;
  /** True when the garment stops above the wrist, so an arm clothing region exists at all. */
  hasShortSleeve: boolean;
  /** Linear RGB of the arm clothing material, from the exported glTF. */
  armColour: Rgb;
  /** Linear RGB of the torso garment — mesh material when a real garment owns the torso, else paint. */
  garmentColour: Rgb;
  /** Linear RGB of the body skin region, so the counterweight can see the arm turned into skin. */
  skinColour: Rgb;
  /** Euclidean distance in linear RGB between arm and garment. */
  armToGarmentDistance: number;
  /** Euclidean distance between arm and skin. */
  armToSkinDistance: number;
  /** #103's guarantee, for the counterweight. */
  armBelowCuffClothedFraction: number;
};

export type SleeveArmColourMatchReport = {
  assets: ArmColourFacts[];
  measuredAt: string;
  humanoidDir: string;
};

/**
 * Enumerate every shipped humanoid GLB and measure arm clothing colour vs garment / skin.
 */
export async function inspectSleeveArmColourMatch(
  opts: { humanoidDir?: string } = {},
): Promise<SleeveArmColourMatchReport> {
  const humanoidDir = opts.humanoidDir
    ? path.isAbsolute(opts.humanoidDir)
      ? opts.humanoidDir
      : path.resolve(process.cwd(), opts.humanoidDir)
    : path.resolve(process.cwd(), "apps/ui-xr/public/generated-humanoids");

  if (!existsSync(humanoidDir)) {
    throw new Error(`inspectSleeveArmColourMatch: dir not found: ${humanoidDir}`);
  }

  const glbs = readdirSync(humanoidDir)
    .filter((f) => f.endsWith(".glb") && !f.includes("rigging"))
    .filter((f) => !f.endsWith(".anny_base.glb"))
    .sort();

  const assets: ArmColourFacts[] = [];
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
  colour: Rgb | null;
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
): Promise<ArmColourFacts | null> {
  const document = await new NodeIO().read(absPath);
  const shells = collectShells(document);
  if (shells.length === 0) return null;

  const body = collectBody(document);
  if (body.positions.length === 0) return null;

  const armColour = findArmColour(document);
  if (!armColour) return null;

  // Outer = largest non-under shell (primary silhouette colour a learner sees).
  // Aggregation: outermost non-under colour (exact-match policy for #146), not min-across-layers.
  const nonUnder = shells.filter((s) => !s.isUnder);
  const outer =
    nonUnder.sort((a, b) => b.triCount - a.triCount)[0] ??
    shells.sort((a, b) => b.triCount - a.triCount)[0]!;
  const garmentColour = outer.colour ?? firstNonNullColour(shells);
  if (!garmentColour) return null;

  const skinColour = body.skinColour;
  if (!skinColour) return null;

  // Short-sleeve detection must see UNDER-layers too: open cardigan outer is long while
  // casual_top under ends mid-arm — that is exactly where #103 arm paint shows and #146
  // colour mismatch is visible (blue forearms against a pink top).
  const sleeve = measureArmBelowCuffAcrossShells(shells, body);
  const role = inferRole(assetPath);

  return {
    assetPath,
    role,
    hasShortSleeve: sleeve.hasShortSleeve,
    armColour,
    garmentColour,
    skinColour,
    armToGarmentDistance: round4(rgbDist(armColour, garmentColour)),
    armToSkinDistance: round4(rgbDist(armColour, skinColour)),
    armBelowCuffClothedFraction: round4(sleeve.clothedFraction),
  };
}

function findArmColour(document: Document): Rgb | null {
  for (const mat of document.getRoot().listMaterials()) {
    const name = mat.getName() || "";
    if (!ARM_MAT_RE.test(name)) continue;
    const c = baseColor(mat);
    if (c) return c;
  }
  return null;
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
      // Single-pass bounds — garment shell POSITION arrays exceed spread arg limit (#595).
      const b = minMaxXyz(positions);
      shells.push({
        meshName,
        positions,
        indices,
        triCount: Math.floor(indices.length / 3),
        isUnder: /__under_/i.test(meshName),
        colour: baseColor(prim.getMaterial()),
        minY: b.minY,
        maxY: b.maxY,
        cx: (b.minX + b.maxX) * 0.5,
        cz: (b.minZ + b.maxZ) * 0.5,
      });
      break;
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
  skinColour: Rgb | null;
} {
  const positions: Vec3[] = [];
  const tris: BodyTri[] = [];
  let skinColour: Rgb | null = null;

  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(name) || DECLARED_ANY_RE.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const matName = mat?.getName() || "";
      const arr = prim.getAttribute("POSITION")?.getArray();
      if (!arr) continue;
      if (!NON_SKIN_MAT_RE.test(matName) && !skinColour) {
        const c = baseColor(mat);
        if (c) skinColour = c;
      }
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
            mat: matName,
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
      skinColour: null,
    };
  }
  // Single-pass bounds (min-max-bounds) — body POSITION arrays exceed spread arg limit (#595).
  const b = minMaxXyz(positions);
  return {
    positions,
    tris,
    minY: b.minY,
    maxY: b.maxY,
    minX: b.minX,
    maxX: b.maxX,
    minZ: b.minZ,
    maxZ: b.maxZ,
    cx: (b.minX + b.maxX) * 0.5,
    cz: (b.minZ + b.maxZ) * 0.5,
    height: Math.max(b.maxY - b.minY, 0.001),
    halfW: Math.max((b.maxX - b.minX) * 0.5, 0.001),
    skinColour,
  };
}

/**
 * Short sleeve: any shell whose lateral cuff sits well above the wrist (includes under-layers).
 * Coverage fraction: body tris on the forearm segment between the mesh distal hand band and the
 * short cuff that carry clothing — #103/#147. NOT a global height plane at 0.14×height (that was
 * the ankle-plane bug #147 fixed; using it here would demand glove paint on the hands again).
 */
function measureArmBelowCuffAcrossShells(
  shells: Shell[],
  body: ReturnType<typeof collectBody>,
): { hasShortSleeve: boolean; clothedFraction: number } {
  const latThresh = body.halfW * 0.45;
  // Provisional short-cuff threshold only (not the wrist). Hand-bone Y is the anatomical lower bound.
  const provisionalWristY = body.minY + body.height * 0.35;
  const shortCuffThreshold = provisionalWristY + body.height * 0.08;

  let highestShortCuffY = -Infinity;
  let anyLateral = false;
  for (const shell of shells) {
    const lateral = shell.positions.filter((v) => Math.abs(v.x - body.cx) >= latThresh);
    if (lateral.length < 16) continue;
    anyLateral = true;
    const cuffY = minOf(lateral.map((v) => v.y));
    if (cuffY > shortCuffThreshold) {
      highestShortCuffY = Math.max(highestShortCuffY, cuffY);
    }
  }

  if (!anyLateral) {
    return { hasShortSleeve: false, clothedFraction: 1 };
  }
  const hasShortSleeve = Number.isFinite(highestShortCuffY);
  if (!hasShortSleeve) {
    return { hasShortSleeve: false, clothedFraction: 1 };
  }

  // #103/#147 coverage: arm *_arm material must still paint the sleeve-end under the cuff.
  // Fraction of arm-material tris that sit in a cuff-adjacent lateral band (not ankle→cuff).
  // Zero arm material ⇒ 0 (would mean colour-match bought by un-painting the arm).
  const yHi = highestShortCuffY + body.height * 0.04;
  const yLo = highestShortCuffY - Math.max(body.height * 0.14, 0.16);
  const armMatTris = body.tris.filter((t) => ARM_MAT_RE.test(t.mat));
  if (armMatTris.length < 4) {
    return { hasShortSleeve: true, clothedFraction: 0 };
  }
  const underCuff = armMatTris.filter(
    (t) =>
      Math.abs(t.x - body.cx) >= latThresh * 0.7 &&
      t.y >= yLo &&
      t.y <= yHi,
  );
  return {
    hasShortSleeve: true,
    clothedFraction: underCuff.length / armMatTris.length,
  };
}

function baseColor(mat: { getBaseColorFactor?: () => number[] } | null | undefined): Rgb | null {
  if (!mat?.getBaseColorFactor) return null;
  const f = mat.getBaseColorFactor();
  if (!f || f.length < 3) return null;
  return [Number(f[0]), Number(f[1]), Number(f[2])];
}

function firstNonNullColour(shells: Shell[]): Rgb | null {
  for (const s of shells) {
    if (s.colour) return s.colour;
  }
  return null;
}

function rgbDist(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function inferRole(assetPath: string): string {
  const p = assetPath.toLowerCase();
  if (p.includes("nurse")) return "nurse";
  if (p.includes("parent") || p.includes("spouse")) return "parent";
  if (p.includes("patient") || p.includes("cast") || p.includes("child")) return "patient";
  return "unknown";
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
