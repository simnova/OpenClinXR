/**
 * MPFB eye inspection station (#354) — file-side measurement for the eye-crop harness.
 *
 * factory_step: instrument. Builds the repeatable, deterministic eye-evidence surface for
 * every MPFB actor: eye-cluster geometry, IPD, mirror symmetry, eye-bone coincidence, iris
 * texture substance, and the projected on-screen size an eye occupies in the CURRENT
 * full-body framing (the number that establishes why the eye-crop station exists).
 *
 * The crop RENDERING lives in isolated-subject-harness.ts (the existing product-path
 * harness, extended with an eye-focus frame); this module is the file-side before-column.
 * The verdict on how eyes LOOK is the orchestrator's pixel grade — nothing here asserts
 * appearance.
 *
 * claimScope: deterministic file-side eye configuration properties + the pre-fix before-column.
 * notEvidenceFor: how eyes render (pixel grade), clinical eye realism, gaze correctness,
 * iris appearance.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { NodeIO, type Document, type Node } from "@gltf-transform/core";

export const MPFB_EYES_EVIDENCE_ROOT = ".openclinxr/evidence/mpfb-eyes";

export const MPFB_EYE_ACTORS = [
  {
    id: "aisha",
    role: "adult_female",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
  },
  {
    id: "kevin",
    role: "adult_male",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
  },
  {
    id: "child",
    role: "child",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
  },
] as const;

export type MpfbEyeActorId = (typeof MPFB_EYE_ACTORS)[number]["id"];

/** Matches the MakeClothes low-poly eye mesh the #337 fit exports. */
const EYE_MESH_RE = /eyes|iris|cornea|sclera/i;
const EYE_BONE_RE = /^eye\.(L|R)$/i;

export type Vec3 = { x: number; y: number; z: number };

export type EyeCluster = {
  side: "L" | "R";
  vertexCount: number;
  centroid: Vec3;
};

export type MpfbEyeFileReport = {
  actorId: MpfbEyeActorId;
  role: string;
  glb: string;
  bodyHeightMeters: number;
  eyeMesh: {
    name: string;
    vertexCount: number;
    aabb: { min: Vec3; max: Vec3 };
    clusters: [EyeCluster, EyeCluster];
    ipdMeters: number;
    mirrorSymmetryMaxErrMeters: number;
    mirrorSymmetryMeanErrMeters: number;
  };
  eyeBones: Array<{
    name: string;
    worldPosition: Vec3;
    localTranslation: Vec3;
    /** Distance from this bone's world position to the cluster whose vertices bind it. */
    clusterDistanceMeters: number;
    clusterSide: "L" | "R";
  }>;
  irisTexture: {
    materialName: string;
    textureName: string;
    bytes: number;
    pngWidth: number | null;
    pngHeight: number | null;
    luminanceSd: number | null;
  };
  /** FACS eye morph targets present on the body mesh. */
  eyeMorphTargets: string[];
  /** Projected pixel extent of the eye mesh under the CURRENT full-body lab framing (1280×960). */
  projectedFullBodyPixels: {
    eyeMeshSpanPx: number;
    oneEyeClusterSpanPx: number;
    irisEstimatePx: number;
    derivation: string;
  };
};

export type MpfbEyesPreFix = {
  schemaVersion: "openclinxr.mpfb-eyes.pre-fix.v1";
  issue: "354";
  factoryStep: "instrument";
  measuredAt: string;
  generator: {
    tool: "inspectMpfbEyeFile";
    file: "tools/openclinxr/evidence/mpfb-eyes-inspection.ts";
    deterministic: true;
    llmInvolved: false;
  };
  framing: {
    viewportPx: { width: number; height: number };
    camera: {
      fovDegrees: number;
      distanceFactor: number;
      elevationFactor: number;
      note: string;
    };
  };
  actors: MpfbEyeFileReport[];
  claimScope: string[];
  notEvidenceFor: string[];
};

function resolveRepoPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function meshTriangleCount(mesh: import("@gltf-transform/core").Mesh): number {
  let tris = 0;
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    if (idx) {
      tris += idx.getCount() / 3;
    } else {
      const pos = prim.getAttribute("POSITION");
      if (pos) tris += pos.getCount() / 3;
    }
  }
  return tris;
}

function meshVertexCount(mesh: import("@gltf-transform/core").Mesh): number {
  let verts = 0;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (pos) verts += pos.getCount();
  }
  return verts;
}

/** Raw mesh-space vertex positions of a mesh (no world transform — bind pose, mesh node identity on this rail). */
function meshPositions(mesh: import("@gltf-transform/core").Mesh): Vec3[] {
  const out: Vec3[] = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")?.getArray();
    if (!pos) continue;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      out.push({ x: Number(pos[i]), y: Number(pos[i + 1]), z: Number(pos[i + 2]) });
    }
  }
  return out;
}

function aabbOf(verts: Vec3[]): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of verts) {
    if (v.x < min.x) min.x = v.x;
    if (v.y < min.y) min.y = v.y;
    if (v.z < min.z) min.z = v.z;
    if (v.x > max.x) max.x = v.x;
    if (v.y > max.y) max.y = v.y;
    if (v.z > max.z) max.z = v.z;
  }
  return { min, max };
}

function centroid(verts: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  return { x: x / verts.length, y: y / verts.length, z: z / verts.length };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Mirror symmetry: for every left vert, the nearest right vert's mirror (x -> -x)
 * distance. Exact for MakeHuman's mirrored low-poly eye (measured 0.0000 m).
 */
function mirrorSymmetry(left: Vec3[], right: Vec3[]): { maxErr: number; meanErr: number } {
  let maxErr = 0;
  let sumErr = 0;
  for (const lv of left) {
    let best = Infinity;
    for (const rv of right) {
      const e = Math.abs(lv.x + rv.x) + Math.abs(lv.y - rv.y) + Math.abs(lv.z - rv.z);
      if (e < best) best = e;
    }
    if (best > maxErr) maxErr = best;
    sumErr += best;
  }
  return { maxErr, meanErr: sumErr / left.length };
}

/**
 * Dominant skin joint per vertex — the joint with the highest WEIGHTS_0 entry.
 * Returns counts per joint name per side (x<0 = L side of the geometry).
 */
function dominantJointCounts(
  doc: Document,
  mesh: import("@gltf-transform/core").Mesh,
): { L: Record<string, number>; R: Record<string, number> } {
  const sk = doc.getRoot().listSkins()[0];
  if (!sk) return { L: {}, R: {} };
  const jointNames = sk.listJoints().map((j) => j.getName() ?? "");
  const counts: { L: Record<string, number>; R: Record<string, number> } = { L: {}, R: {} };
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")?.getArray();
    const jl = prim.getAttribute("JOINTS_0")?.getArray();
    const wl = prim.getAttribute("WEIGHTS_0")?.getArray();
    if (!pos || !jl || !wl) continue;
    const count = jl.length / 4;
    for (let i = 0; i < count; i += 1) {
      const x = Number(pos[i * 3]);
      let bestJ = -1;
      let bestW = -1;
      for (let k = 0; k < 4; k += 1) {
        const w = Number(wl[i * 4 + k]);
        if (w > bestW) {
          bestW = w;
          bestJ = jl[i * 4 + k]!;
        }
      }
      const side = x < 0 ? "L" : "R";
      const name = jointNames[bestJ] ?? `#${bestJ}`;
      counts[side][name] = (counts[side][name] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Minimal PNG reader: returns width/height and luminance sd over a subsample,
 * or nulls when not a decodable 8-bit PNG. Same shape as the reader in
 * a-room-has-contact-shadows.test.ts (no pngjs dependency).
 */
export function pngLuminanceSd(bytes: Uint8Array): { width: number; height: number; sd: number } | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || w === 0 || h === 0) return null;
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (chans === 0) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;

  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (filter === 0) v = rawByte;
      else if (filter === 1) v = rawByte + a;
      else if (filter === 2) v = rawByte + b;
      else if (filter === 3) v = rawByte + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    for (let x = 0; x < w; x += 4) {
      const i = x * chans;
      const lum = chans >= 3 ? 0.299 * cur[i]! + 0.587 * cur[i + 1]! + 0.114 * cur[i + 2]! : cur[i]!;
      n += 1;
      sum += lum;
      sumSq += lum * lum;
    }
    prev.set(cur);
  }
  if (n === 0) return null;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return { width: w, height: h, sd };
}

/** All meshes in bind pose — a world AABB of every skinned mesh (mesh nodes are identity on this rail). */
function wholeBodyAabb(doc: Document): { min: Vec3; max: Vec3; heightMeters: number } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const mesh of doc.getRoot().listMeshes()) {
    const box = aabbOf(meshPositions(mesh));
    if (box.min.x < min.x) min.x = box.min.x;
    if (box.min.y < min.y) min.y = box.min.y;
    if (box.min.z < min.z) min.z = box.min.z;
    if (box.max.x > max.x) max.x = box.max.x;
    if (box.max.y > max.y) max.y = box.max.y;
    if (box.max.z > max.z) max.z = box.max.z;
  }
  return { min, max, heightMeters: max.y - min.y };
}

/**
 * Projected on-screen pixel extent of the eye mesh under the CURRENT full-body lab
 * framing (isolated-subject-lab legacy path: distance = radius*2.4, camera offset
 * (0.55/0.35/0.85) * (distance/radius), fov 35, 1280×960). Pure perspective math —
 * the same projection the product's three.js camera performs; documented here so the
 * before-column is auditable without a browser.
 */
export function projectPixelSpan(input: {
  subject: { min: Vec3; max: Vec3 };
  cameraPosition: Vec3;
  lookAt: Vec3;
  fovDegrees: number;
  viewport: { width: number; height: number };
}): number {
  const { subject, cameraPosition, lookAt, fovDegrees, viewport } = input;
  const fwd = normalize({
    x: lookAt.x - cameraPosition.x,
    y: lookAt.y - cameraPosition.y,
    z: lookAt.z - cameraPosition.z,
  });
  const upGuess = { x: 0, y: 1, z: 0 };
  const right = normalize(cross(fwd, upGuess));
  const up = cross(right, fwd);
  const tanHalf = Math.tan((fovDegrees * Math.PI) / 360);
  let minSx = Infinity;
  let maxSx = -Infinity;
  let minSy = Infinity;
  let maxSy = -Infinity;
  const corners: Vec3[] = [];
  for (const mx of [subject.min.x, subject.max.x]) {
    for (const my of [subject.min.y, subject.max.y]) {
      for (const mz of [subject.min.z, subject.max.z]) {
        corners.push({ x: mx, y: my, z: mz });
      }
    }
  }
  for (const c of corners) {
    const v = { x: c.x - cameraPosition.x, y: c.y - cameraPosition.y, z: c.z - cameraPosition.z };
    const depth = dot(v, fwd);
    if (depth < 1e-6) continue;
    const sx = dot(v, right) / depth;
    const sy = dot(v, up) / depth;
    if (sx < minSx) minSx = sx;
    if (sx > maxSx) maxSx = sx;
    if (sy < minSy) minSy = sy;
    if (sy > maxSy) maxSy = sy;
  }
  // NDC: x spans [-tanHalf*aspect, +tanHalf*aspect], y spans [-tanHalf, +tanHalf].
  const pxPerUnitX = viewport.width / (2 * tanHalf * (viewport.width / viewport.height));
  const pxPerUnitY = viewport.height / (2 * tanHalf);
  return Math.max((maxSx - minSx) * pxPerUnitX, (maxSy - minSy) * pxPerUnitY);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function legacyFullBodyProjection(subject: { min: Vec3; max: Vec3 }): {
  cameraPosition: Vec3;
  lookAt: Vec3;
} {
  const size = {
    x: subject.max.x - subject.min.x,
    y: subject.max.y - subject.min.y,
    z: subject.max.z - subject.min.z,
  };
  const radius = Math.max(size.x, size.y, size.z, 0.4);
  const distance = radius * 2.4;
  const center = {
    x: subject.min.x + size.x / 2,
    y: subject.min.y + size.y / 2,
    z: subject.min.z + size.z / 2,
  };
  return {
    cameraPosition: {
      x: center.x + distance * 0.55,
      y: center.y + radius * 0.35,
      z: center.z + distance * 0.85,
    },
    lookAt: { x: center.x, y: center.y + size.y * 0.05, z: center.z },
  };
}

/** Inspect ONE shipped MPFB actor's file for eye configuration properties. */
export async function inspectMpfbEyeFile(
  glb: string,
  actorId: MpfbEyeActorId,
  role: string,
): Promise<MpfbEyeFileReport> {
  const io = new NodeIO();
  const doc = await io.read(resolveRepoPath(glb));

  const body = wholeBodyAabb(doc);

  const eyeMesh = doc.getRoot().listMeshes().find((m) => EYE_MESH_RE.test(m.getName() ?? ""));
  if (!eyeMesh) {
    throw new Error(`${glb}: no mesh matching ${EYE_MESH_RE} — the eye channel is missing from the shipped asset`);
  }
  const verts = meshPositions(eyeMesh);
  const left = verts.filter((v) => v.x < 0);
  const right = verts.filter((v) => v.x >= 0);
  const cL = centroid(left);
  const cR = centroid(right);
  const symmetry = mirrorSymmetry(left, right);
  const aabb = aabbOf(verts);

  // Eye bones + per-cluster dominant joint (coincidence checked per cluster — the
  // MPFB armature names .L joints at world +x, so name-to-side matching is NOT the
  // check; which bone each cluster's vertices bind to IS).
  const dominant = dominantJointCounts(doc, eyeMesh);
  const dominantBone = (side: "L" | "R"): string => {
    const entries = Object.entries(dominant[side]).sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] ?? "";
  };
  const clusterForBone = new Map<string, "L" | "R">();
  for (const side of ["L", "R"] as const) {
    const bone = dominantBone(side);
    if (bone) clusterForBone.set(bone, side);
  }

  const eyeBones: MpfbEyeFileReport["eyeBones"] = [];
  for (const sk of doc.getRoot().listSkins()) {
    for (const joint of sk.listJoints()) {
      const jn = joint.getName() ?? "";
      if (!EYE_BONE_RE.test(jn)) continue;
      const wm = joint.getWorldMatrix();
      const worldPosition = { x: wm[12], y: wm[13], z: wm[14] };
      const lt = joint.getTranslation();
      const clusterSide = clusterForBone.get(jn);
      const clusterCentroid = clusterSide === "L" ? cL : clusterSide === "R" ? cR : null;
      eyeBones.push({
        name: jn,
        worldPosition,
        localTranslation: { x: lt[0], y: lt[1], z: lt[2] },
        clusterDistanceMeters: clusterCentroid ? dist(worldPosition, clusterCentroid) : -1,
        clusterSide: clusterSide ?? "L",
      });
    }
  }

  // Iris texture: the eye mesh's base-color texture.
  let irisTexture: MpfbEyeFileReport["irisTexture"] | null = null;
  for (const material of doc.getRoot().listMaterials()) {
    const bc = material.getBaseColorTexture();
    if (!bc) continue;
    const image = bc.getImage();
    const png = image ? pngLuminanceSd(image) : null;
    irisTexture = {
      materialName: material.getName() ?? "",
      textureName: bc.getName() ?? "",
      bytes: image?.byteLength ?? 0,
      pngWidth: png?.width ?? null,
      pngHeight: png?.height ?? null,
      luminanceSd: png?.sd ?? null,
    };
  }
  if (!irisTexture) {
    throw new Error(`${glb}: the eye mesh material has no base-color texture — the iris is untextured`);
  }

  // Eye-touching FACS morph targets on the body mesh.
  const eyeMorphTargets: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!/body$/.test(mesh.getName() ?? "")) continue;
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) {
        const tn = target.getName() ?? "";
        if (/eye/.test(tn) && !eyeMorphTargets.includes(tn)) eyeMorphTargets.push(tn);
      }
    }
  }

  // Projected on-screen size under the CURRENT full-body framing.
  const projection = legacyFullBodyProjection(body);
  const eyeSpanPx = projectPixelSpan({
    subject: aabb,
    cameraPosition: projection.cameraPosition,
    lookAt: projection.lookAt,
    fovDegrees: 35,
    viewport: { width: 1280, height: 960 },
  });
  const oneEyeAabb = aabbOf(left);
  const oneEyeSpanPx = projectPixelSpan({
    subject: oneEyeAabb,
    cameraPosition: projection.cameraPosition,
    lookAt: projection.lookAt,
    fovDegrees: 35,
    viewport: { width: 1280, height: 960 },
  });
  // Iris estimate: ~12 mm typical iris diameter at the same px/mm scale as the eye mesh span.
  const oneEyeWidth = oneEyeAabb.max.x - oneEyeAabb.min.x;
  const pxPerMeter = oneEyeSpanPx / Math.max(oneEyeWidth, 1e-6);
  const irisEstimatePx = pxPerMeter * 0.012;

  return {
    actorId,
    role,
    glb,
    bodyHeightMeters: Math.round(body.heightMeters * 10000) / 10000,
    eyeMesh: {
      name: eyeMesh.getName() ?? "",
      vertexCount: meshVertexCount(eyeMesh),
      aabb,
      clusters: [
        { side: "L", vertexCount: left.length, centroid: cL },
        { side: "R", vertexCount: right.length, centroid: cR },
      ],
      ipdMeters: cR.x - cL.x,
      mirrorSymmetryMaxErrMeters: symmetry.maxErr,
      mirrorSymmetryMeanErrMeters: symmetry.meanErr,
    },
    eyeBones,
    irisTexture,
    eyeMorphTargets,
    projectedFullBodyPixels: {
      eyeMeshSpanPx: Math.round(eyeSpanPx * 10) / 10,
      oneEyeClusterSpanPx: Math.round(oneEyeSpanPx * 10) / 10,
      irisEstimatePx: Math.round(irisEstimatePx * 10) / 10,
      derivation:
        "legacy isolated-lab full-body framing (distance = radius*2.4, camera offset 0.55/0.35/0.85, "
        + "fov 35, 1280x960) projecting the eye-mesh / one-eye-cluster AABB corners; iris estimate = "
        + "12 mm at the same px/m scale",
    },
  };
}

/** Write the pre-fix before-column for the eye inspection station. */
export async function writeMpfbEyesPreFix(options?: { cwd?: string; outputRoot?: string }): Promise<MpfbEyesPreFix> {
  const cwd = options?.cwd ?? process.cwd();
  const outputRoot = options?.outputRoot ?? MPFB_EYES_EVIDENCE_ROOT;
  const actors: MpfbEyeFileReport[] = [];
  for (const actor of MPFB_EYE_ACTORS) {
    actors.push(await inspectMpfbEyeFile(actor.glb, actor.id, actor.role));
  }
  const preFix: MpfbEyesPreFix = {
    schemaVersion: "openclinxr.mpfb-eyes.pre-fix.v1",
    issue: "354",
    factoryStep: "instrument",
    measuredAt: new Date().toISOString(),
    generator: {
      tool: "inspectMpfbEyeFile",
      file: "tools/openclinxr/evidence/mpfb-eyes-inspection.ts",
      deterministic: true,
      llmInvolved: false,
    },
    framing: {
      viewportPx: { width: 1280, height: 960 },
      camera: {
        fovDegrees: 35,
        distanceFactor: 2.4,
        elevationFactor: 0.35,
        note: "replicates isolated-subject-lab.ts legacy full-body framing (pre-eye-focus)",
      },
    },
    actors,
    claimScope: [
      "deterministic_file_side_eye_configuration_properties",
      "projected_on_screen_eye_size_in_the_current_full_body_framing",
      "pre_fix_before_column_for_the_eye_inspection_station",
    ],
    notEvidenceFor: [
      "how_eyes_render_in_a_crop_pixel_grade_required",
      "clinical_eye_realism",
      "gaze_correctness",
      "iris_appearance",
    ],
  };
  const outDir = path.join(cwd, outputRoot);
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "pre-fix.json");
  writeFileSync(outPath, `${JSON.stringify(preFix, null, 2)}\n`, "utf8");
  return preFix;
}

/** Read the pre-fix artifact (throws when absent). */
export function readMpfbEyesPreFix(cwd = process.cwd()): MpfbEyesPreFix {
  const p = path.join(cwd, MPFB_EYES_EVIDENCE_ROOT, "pre-fix.json");
  return JSON.parse(readFileSync(p, "utf8")) as MpfbEyesPreFix;
}

/** PNG dimensions from the IHDR of a file (null when not a decodable PNG). */
export function pngDimensionsFromFile(filePath: string): { width: number; height: number } | null {
  const bytes = readFileSync(filePath);
  const info = pngLuminanceSd(bytes);
  return info ? { width: info.width, height: info.height } : null;
}

// CLI — only when this file is the entrypoint.
const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  writeMpfbEyesPreFix()
    .then((preFix) => {
      const summary = preFix.actors.map((a) => ({
        actorId: a.actorId,
        bodyHeightMeters: a.bodyHeightMeters,
        ipdMeters: a.eyeMesh.ipdMeters,
        mirrorMaxErrMeters: a.eyeMesh.mirrorSymmetryMaxErrMeters,
        eyeBones: a.eyeBones.map((b) => ({ name: b.name, clusterDistanceMeters: b.clusterDistanceMeters })),
        irisBytes: a.irisTexture.bytes,
        irisLuminanceSd: a.irisTexture.luminanceSd,
        projectedFullBodyPixels: a.projectedFullBodyPixels,
        eyeMorphTargets: a.eyeMorphTargets,
      }));
      console.log(JSON.stringify({ path: path.join(MPFB_EYES_EVIDENCE_ROOT, "pre-fix.json"), actors: summary }, null, 2));
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
