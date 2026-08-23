/**
 * #147 sleeve wrist boundary — hands as skin, forearm between cuff and wrist clothed.
 *
 * claimScope: exported glTF material regions on arm/hand relative to hand-bone landmarks;
 * #146 arm-to-garment colour match counterweight.
 * notEvidenceFor: clinical glove protocol, production readiness, fabric realism, role gloves.
 *
 * Measurements from EXPORTED glTF via NodeIO — never Blender authoring intent (#121).
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";
import { extractJointsFromDocument } from "./humanoid-proportions-probe.js";
import { maxOf, minMaxXyz, minOf } from "./min-max-bounds.js";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;
const ARM_MAT_RE = /openclinxr_role_mesh_clothing_.*_arm/i;
const BODY_CLOTHING_MAT_RE = /openclinxr_role_mesh_clothing_/i;
const NON_SKIN_MAT_RE =
  /openclinxr_role_mesh_clothing_|openclinxr_real_garment|openclinxr_role_marker|hair|scalp/i;

type Vec3 = { x: number; y: number; z: number };
type Rgb = [number, number, number];

export type WristBoundaryFacts = {
  assetPath: string;
  role: string;
  hasShortSleeve: boolean;
  /** Fraction of HAND vertices carrying a clothing material region. Should be ~0. */
  handClothedFraction: number;
  /** Fraction of forearm-between-cuff-and-wrist carrying clothing. #103's guarantee. */
  forearmBelowCuffClothedFraction: number;
  /** Distance from the clothing boundary to the hand bone head, in metres. */
  boundaryToHandBoneMeters: number;
  /** How the boundary was derived — a landmark or a height fraction. */
  boundarySource: string;
  /** #146's guarantee: arm clothing still matches the garment. */
  armToGarmentDistance: number;
};

export type SleeveWristBoundaryReport = {
  assets: WristBoundaryFacts[];
  measuredAt: string;
  humanoidDir: string;
};

/**
 * Enumerate every shipped humanoid GLB and measure wrist-boundary facts from the exported glTF.
 */
export async function inspectSleeveWristBoundary(
  opts: { humanoidDir?: string } = {},
): Promise<SleeveWristBoundaryReport> {
  const humanoidDir = opts.humanoidDir
    ? path.isAbsolute(opts.humanoidDir)
      ? opts.humanoidDir
      : path.resolve(process.cwd(), opts.humanoidDir)
    : path.resolve(process.cwd(), "apps/ui-xr/public/generated-humanoids");

  if (!existsSync(humanoidDir)) {
    throw new Error(`inspectSleeveWristBoundary: dir not found: ${humanoidDir}`);
  }

  const glbs = readdirSync(humanoidDir)
    .filter((f) => f.endsWith(".glb") && !f.includes("rigging"))
    .filter((f) => !f.endsWith(".anny_base.glb"))
    .sort();

  const assets: WristBoundaryFacts[] = [];
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
  triCount: number;
  isUnder: boolean;
  colour: Rgb | null;
};

type BodyVert = {
  x: number;
  y: number;
  z: number;
  mat: string;
};

type BodyTri = BodyVert;

async function measureOneAsset(
  absPath: string,
  assetPath: string,
): Promise<WristBoundaryFacts | null> {
  const document = await new NodeIO().read(absPath);
  const shells = collectShells(document);
  if (shells.length === 0) return null;

  const body = collectBody(document);
  if (body.verts.length === 0) return null;

  const armColour = findArmColour(document);
  if (!armColour) return null;

  const nonUnder = shells.filter((s) => !s.isUnder);
  const outer =
    nonUnder.sort((a, b) => b.triCount - a.triCount)[0] ??
    shells.sort((a, b) => b.triCount - a.triCount)[0]!;
  const garmentColour = outer.colour ?? firstNonNullColour(shells);
  if (!garmentColour) return null;

  const sleeve = detectShortSleeve(shells, body);
  const role = inferRole(assetPath);
  const joints = extractJointsFromDocument(document).joints.map((j) => ({
    name: j.name,
    x: Number(j.x ?? 0),
    y: Number(j.y ?? 0),
    z: Number(j.z ?? 0),
  }));
  const landmarks = resolveArmLandmarks(joints, body);

  if (!sleeve.hasShortSleeve) {
    return {
      assetPath,
      role,
      hasShortSleeve: false,
      handClothedFraction: 0,
      forearmBelowCuffClothedFraction: 1,
      boundaryToHandBoneMeters: 0,
      boundarySource: "n/a_long_or_no_sleeve",
      armToGarmentDistance: round4(rgbDist(armColour, garmentColour)),
    };
  }

  // Mesh arms often end well short of the hand bone (stump topology). "Hand" =
  // distal band of verts along the elbow→hand axis among lateral arm samples —
  // not a sphere around a bone that may sit outside the mesh.
  const armSamples = sampleArmSegmentVerts(body.verts, landmarks, sleeve.highestShortCuffY);
  // Match automate_blender.py DISTAL_HAND_FRACTION (0.32).
  const handVerts = distalBand(armSamples, /*distal fraction*/ 0.32);
  const forearmVerts = proximalBand(armSamples, /*keep distal out*/ 0.32);

  // Glove defect is specifically the *_arm clothing material (#146 colour match on the
  // sleeve-end region). Do NOT count *_lower paint — lateral thigh samples can project
  // onto the forearm axis and falsely inflate the hand fraction (child topology).
  const handClothed =
    handVerts.length === 0
      ? 0
      : handVerts.filter((v) => ARM_MAT_RE.test(v.mat)).length / handVerts.length;

  const forearmClothed =
    forearmVerts.length === 0
      ? 0
      : forearmVerts.filter((v) => ARM_MAT_RE.test(v.mat) || BODY_CLOTHING_MAT_RE.test(v.mat))
          .length / forearmVerts.length;

  const boundary = measureClothingBoundaryToHand(armSamples, landmarks);

  return {
    assetPath,
    role,
    hasShortSleeve: true,
    handClothedFraction: round4(handClothed),
    forearmBelowCuffClothedFraction: round4(forearmClothed),
    boundaryToHandBoneMeters: round4(boundary.distMeters),
    boundarySource: boundary.source,
    armToGarmentDistance: round4(rgbDist(armColour, garmentColour)),
  };
}

type ArmLandmarks = {
  hands: Vec3[];
  elbows: Vec3[];
  /** elbow → hand axes per side, same order as hands/elbows */
  axes: Vec3[];
  forearmLens: number[];
  halfW: number;
  height: number;
  minY: number;
  cx: number;
};

function resolveArmLandmarks(
  joints: readonly { name: string; x: number; y: number; z: number }[],
  body: ReturnType<typeof collectBody>,
): ArmLandmarks {
  const pick = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const j = joints.find((x) => p.test(x.name));
      if (j) return { x: j.x, y: j.y, z: j.z };
    }
    return null;
  };

  const handL = pick([/^hand\.l$/i, /^handl$/i, /hand\.l\b/i]);
  const handR = pick([/^hand\.r$/i, /^handr$/i, /hand\.r\b/i]);
  const elbowL = pick([/^forearm\.l$/i, /^forearml$/i, /forearm\.l\b/i]);
  const elbowR = pick([/^forearm\.r$/i, /^forearmr$/i, /forearm\.r\b/i]);

  // Fallback: bbox-derived limb factors matching create_canonical_armature (0.42 hand, 0.58 elbow).
  const halfSpan = Math.max(body.halfW * 0.88, body.height * 0.32);
  const fbHandL = { x: body.cx + halfSpan, y: body.minY + body.height * 0.42, z: body.cz };
  const fbHandR = { x: body.cx - halfSpan, y: body.minY + body.height * 0.42, z: body.cz };
  const fbElbowL = {
    x: body.cx + halfSpan * 0.75,
    y: body.minY + body.height * 0.58,
    z: body.cz,
  };
  const fbElbowR = {
    x: body.cx - halfSpan * 0.75,
    y: body.minY + body.height * 0.58,
    z: body.cz,
  };

  const hands = [handL ?? fbHandL, handR ?? fbHandR];
  const elbows = [elbowL ?? fbElbowL, elbowR ?? fbElbowR];
  const axes: Vec3[] = [];
  const forearmLens: number[] = [];
  for (let i = 0; i < 2; i++) {
    const e = elbows[i]!;
    const h = hands[i]!;
    const ax = { x: h.x - e.x, y: h.y - e.y, z: h.z - e.z };
    const len = Math.hypot(ax.x, ax.y, ax.z) || 0.2;
    axes.push({ x: ax.x / len, y: ax.y / len, z: ax.z / len });
    forearmLens.push(len);
  }

  return {
    hands,
    elbows,
    axes,
    forearmLens,
    halfW: body.halfW,
    height: body.height,
    minY: body.minY,
    cx: body.cx,
  };
}

type ArmSample = BodyVert & { s: number; side: number; dSeg: number };

/**
 * Lateral verts near either elbow→hand segment, at or below the short-sleeve cuff.
 * s is 0 at elbow, 1 at hand bone head (anatomical wrist). Mesh often ends at s≪1.
 */
function sampleArmSegmentVerts(
  verts: BodyVert[],
  lm: ArmLandmarks,
  cuffY: number,
): ArmSample[] {
  const armR = Math.max(lm.halfW * 0.32, 0.08);
  const out: ArmSample[] = [];
  for (const v of verts) {
    if (Math.abs(v.x - lm.cx) < lm.halfW * 0.32) continue;
    if (v.y > cuffY + lm.height * 0.04) continue;

    let best: ArmSample | null = null;
    for (let i = 0; i < lm.hands.length; i++) {
      const elbow = lm.elbows[i]!;
      const fl = lm.forearmLens[i]!;
      const axis = lm.axes[i]!;
      const toV = { x: v.x - elbow.x, y: v.y - elbow.y, z: v.z - elbow.z };
      const s = (toV.x * axis.x + toV.y * axis.y + toV.z * axis.z) / fl;
      // Allow slightly proximal of elbow (upper arm under cuff) and up past hand bone.
      if (s < -0.35 || s > 1.15) continue;
      const proj = {
        x: elbow.x + axis.x * s * fl,
        y: elbow.y + axis.y * s * fl,
        z: elbow.z + axis.z * s * fl,
      };
      const d = Math.hypot(v.x - proj.x, v.y - proj.y, v.z - proj.z);
      if (d > armR) continue;
      if (!best || d < best.dSeg) {
        best = { ...v, s, side: i, dSeg: d };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** Distal fraction of arm samples by s (mesh "hand" / stump tip). */
function distalBand(samples: ArmSample[], distalFraction: number): ArmSample[] {
  if (samples.length === 0) return [];
  const bySide = new Map<number, ArmSample[]>();
  for (const s of samples) {
    const list = bySide.get(s.side) ?? [];
    list.push(s);
    bySide.set(s.side, list);
  }
  const out: ArmSample[] = [];
  for (const list of bySide.values()) {
    // Arm-segment sample lists grow with body density — single-pass (#595).
    const sMin = minOf(list.map((x) => x.s));
    const sMax = maxOf(list.map((x) => x.s));
    const cut = sMax - Math.max((sMax - sMin) * distalFraction, 0.04);
    for (const x of list) {
      if (x.s >= cut) out.push(x);
    }
  }
  return out;
}

/** Proximal remainder of arm samples (forearm under cuff, not the distal hand band). */
function proximalBand(samples: ArmSample[], distalFraction: number): ArmSample[] {
  if (samples.length === 0) return [];
  const distal = new Set(distalBand(samples, distalFraction));
  return samples.filter((s) => !distal.has(s));
}

/**
 * Distal edge of arm clothing vs hand bone, using arm-segment samples.
 * landmark-aligned when clothing stops short of the mesh distal tip (skin hands);
 * global-height-plane class when clothing covers the distal band (gloves).
 */
function measureClothingBoundaryToHand(
  samples: ArmSample[],
  lm: ArmLandmarks,
): { distMeters: number; source: string } {
  const armClothed = samples.filter((v) => ARM_MAT_RE.test(v.mat));
  if (armClothed.length === 0) {
    return { distMeters: 999, source: "no_arm_clothing_material" };
  }

  const distal = distalBand(samples, 0.32);
  const distalClothed = distal.filter((v) => ARM_MAT_RE.test(v.mat));
  const distalClothedFrac =
    distal.length === 0 ? 0 : distalClothed.length / distal.length;

  // Mean distance from distal clothing to nearest hand bone head.
  let sumD = 0;
  let nD = 0;
  for (const v of distalClothed.length > 0 ? distalClothed : armClothed) {
    let best = Infinity;
    for (const hand of lm.hands) {
      best = Math.min(best, Math.hypot(v.x - hand.x, v.y - hand.y, v.z - hand.z));
    }
    sumD += best;
    nD += 1;
  }
  const meanD = nD > 0 ? sumD / nD : 999;

  // Max s of clothing along elbow→hand (0=elbow, 1=hand bone).
  const maxS = maxOf(armClothed.map((v) => v.s));
  const meshMaxS = maxOf(samples.map((v) => v.s));
  // How close clothing gets to the mesh distal tip (1 = gloves to tip).
  const tipCoverage = meshMaxS > 0.01 ? maxS / meshMaxS : 1;

  if (distalClothedFrac <= 0.15 && tipCoverage < 0.85) {
    return {
      distMeters: round4(meanD),
      source: "hand_bone_landmark_mesh_distal_skin",
    };
  }
  if (distalClothedFrac > 0.5 || tipCoverage >= 0.9) {
    return {
      distMeters: round4(meanD),
      source: "extends_to_mesh_distal_global_height_plane_class",
    };
  }
  return {
    distMeters: round4(meanD),
    source: "near_hand_bone_seam",
  };
}

function detectShortSleeve(
  shells: Shell[],
  body: ReturnType<typeof collectBody>,
): { hasShortSleeve: boolean; highestShortCuffY: number } {
  const latThresh = body.halfW * 0.45;
  const wristY = body.minY + body.height * 0.14;
  const shortCuffThreshold = wristY + body.height * 0.12;

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
  if (!anyLateral || !Number.isFinite(highestShortCuffY)) {
    return { hasShortSleeve: false, highestShortCuffY: 0 };
  }
  return { hasShortSleeve: true, highestShortCuffY };
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
      const arr = prim.getAttribute("POSITION")?.getArray();
      if (!arr || arr.length < 9) continue;
      const positions = positionsToVec3(arr);
      const idx = prim.getIndices()?.getArray();
      const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(positions.length / 3);
      shells.push({
        meshName,
        positions,
        triCount,
        isUnder: /__under_/i.test(meshName),
        colour: baseColor(prim.getMaterial()),
      });
      break;
    }
  }
  return shells;
}

function collectBody(document: Document): {
  verts: BodyVert[];
  tris: BodyTri[];
  minY: number;
  maxY: number;
  minX: number;
  maxX: number;
  cx: number;
  cz: number;
  height: number;
  halfW: number;
} {
  const verts: BodyVert[] = [];
  const tris: BodyTri[] = [];

  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (GARMENT_MESH_RE.test(name) || DECLARED_ANY_RE.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const matName = mat?.getName() || "";
      const arr = prim.getAttribute("POSITION")?.getArray();
      if (!arr) continue;
      // Per-vertex material from this primitive (body regions are split by material).
      const idx = prim.getIndices()?.getArray();
      const used = new Set<number>();
      if (idx) {
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const a = Number(idx[t]);
          const b = Number(idx[t + 1]);
          const c = Number(idx[t + 2]);
          used.add(a);
          used.add(b);
          used.add(c);
          tris.push({
            x: (Number(arr[a * 3]) + Number(arr[b * 3]) + Number(arr[c * 3])) / 3,
            y: (Number(arr[a * 3 + 1]) + Number(arr[b * 3 + 1]) + Number(arr[c * 3 + 1])) / 3,
            z: (Number(arr[a * 3 + 2]) + Number(arr[b * 3 + 2]) + Number(arr[c * 3 + 2])) / 3,
            mat: matName,
          });
        }
      }
      if (used.size === 0) {
        for (let i = 0; i + 2 < arr.length; i += 3) used.add(i / 3);
      }
      for (const vi of used) {
        verts.push({
          x: Number(arr[vi * 3]),
          y: Number(arr[vi * 3 + 1]),
          z: Number(arr[vi * 3 + 2]),
          mat: matName,
        });
      }
    }
  }

  if (verts.length === 0) {
    return {
      verts: [],
      tris: [],
      minY: 0,
      maxY: 1,
      minX: -0.3,
      maxX: 0.3,
      cx: 0,
      cz: 0.1,
      height: 1,
      halfW: 0.3,
    };
  }
  // Single-pass bounds (min-max-bounds) — body verts exceed spread arg limit (#595).
  const b = minMaxXyz(verts);
  return {
    verts,
    tris,
    minY: b.minY,
    maxY: b.maxY,
    minX: b.minX,
    maxX: b.maxX,
    cx: (b.minX + b.maxX) * 0.5,
    cz: (b.minZ + b.maxZ) * 0.5,
    height: Math.max(b.maxY - b.minY, 0.001),
    halfW: Math.max((b.maxX - b.minX) * 0.5, 0.001),
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
