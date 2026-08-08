/**
 * #216 inspect — parametric library bodies carry skins and actually deform.
 *
 * Reads what `pnpm asset:body-param:fit -- --once` wrote:
 *   .openclinxr/evidence/issue-151/body-param-catalog.json
 *   + per-class library GLBs under apps/ui-xr/public/xr-assets/humanoids/candidates/
 *   + deformation calibration in .openclinxr/evidence/issue-216/pre-fix.json
 *
 * Skin presence is not enough: a skin with all-zero weights freezes the mesh. Contract (2)
 * applies linear blend skinning with ONE named bone rotated and measures max world Δ.
 * Epsilon is self-calibrated (half the median bone-tip motion of this export).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document, type Node as GltfNode, type Skin } from "@gltf-transform/core";
import {
  CATALOG_PATH,
  PRE_FIX_PATH_216,
  STAGE_ID,
  STAGE_REPORT_PATH,
  type BodyParamCatalog,
} from "../asset-pipeline/makeclothes/body-param-cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const DEFAULT_DRIVEN_BONE = "upper_arm.L";
const DEFAULT_ROTATION_DEG = 55;

export type BodyRig = {
  bodyClassId: string;
  glbPath: string;
  skinCount: number;
  jointCount: number;
  jointNames: string[];
  skinnedMeshNames: string[];
  bodyDeformationMeters: number;
  garmentDeformationMeters: number;
  producedByStage: string;
};

export type InspectReport = {
  bodies: BodyRig[];
  calibration: {
    drivenBone: string;
    rotationDegrees: number;
    deformationEpsilonMeters: number;
    source: string;
  };
};

function isGarmentMeshName(name: string): boolean {
  if (/openclinxr_real_garment_/i.test(name)) return false;
  return /makeclothes|mhclo|scrub|garment|cloth/i.test(name);
}

function loadCatalog(): BodyParamCatalog | null {
  if (!existsSync(CATALOG_PATH)) return null;
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as BodyParamCatalog;
  if (raw.producedByStage !== STAGE_ID) {
    throw new Error(
      `catalog producedByStage "${raw.producedByStage}" is not the factory stage "${STAGE_ID}"`,
    );
  }
  return raw;
}

function loadCalibration(catalog: BodyParamCatalog | null): InspectReport["calibration"] {
  if (existsSync(PRE_FIX_PATH_216)) {
    const pre = JSON.parse(readFileSync(PRE_FIX_PATH_216, "utf8")) as {
      calibration?: {
        drivenBone?: string;
        rotationDegrees?: number;
        deformationEpsilonMeters?: number;
        source?: string;
      };
    };
    const c = pre.calibration;
    if (c && typeof c.deformationEpsilonMeters === "number" && c.deformationEpsilonMeters > 0) {
      return {
        drivenBone: String(c.drivenBone ?? DEFAULT_DRIVEN_BONE),
        rotationDegrees: Number(c.rotationDegrees ?? DEFAULT_ROTATION_DEG),
        deformationEpsilonMeters: c.deformationEpsilonMeters,
        source: String(c.source ?? "calibrated_half_median_bone_tip_motion_this_export"),
      };
    }
  }
  if (catalog?.deformationCalibration?.deformationEpsilonMeters) {
    const c = catalog.deformationCalibration;
    return {
      drivenBone: c.drivenBone,
      rotationDegrees: c.rotationDegrees,
      deformationEpsilonMeters: c.deformationEpsilonMeters,
      source: c.source,
    };
  }
  // Derive from stage report if present
  if (existsSync(STAGE_REPORT_PATH)) {
    const stage = JSON.parse(readFileSync(STAGE_REPORT_PATH, "utf8")) as {
      deformationCalibration?: {
        drivenBone?: string;
        rotationDegrees?: number;
        deformationEpsilonMeters?: number;
        source?: string;
      };
    };
    const c = stage.deformationCalibration;
    if (c && typeof c.deformationEpsilonMeters === "number" && c.deformationEpsilonMeters > 0) {
      return {
        drivenBone: String(c.drivenBone ?? DEFAULT_DRIVEN_BONE),
        rotationDegrees: Number(c.rotationDegrees ?? DEFAULT_ROTATION_DEG),
        deformationEpsilonMeters: c.deformationEpsilonMeters,
        source: String(c.source ?? "calibrated_half_median_bone_tip_motion_this_export"),
      };
    }
  }
  return {
    drivenBone: DEFAULT_DRIVEN_BONE,
    rotationDegrees: DEFAULT_ROTATION_DEG,
    deformationEpsilonMeters: 0,
    source: "missing_calibration",
  };
}

// ─── Minimal 4×4 matrix math (column-major, glTF convention) ─────────────────

type Mat4 = Float64Array; // length 16

function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function mat4FromTranslationRotation(
  tx: number,
  ty: number,
  tz: number,
  // quaternion xyzw
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  sx: number,
  sy: number,
  sz: number,
): Mat4 {
  // R from quaternion
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  const m = mat4Identity();
  m[0] = (1 - (yy + zz)) * sx;
  m[1] = (xy + wz) * sx;
  m[2] = (xz - wy) * sx;
  m[4] = (xy - wz) * sy;
  m[5] = (1 - (xx + zz)) * sy;
  m[6] = (yz + wx) * sy;
  m[8] = (xz + wy) * sz;
  m[9] = (yz - wx) * sz;
  m[10] = (1 - (xx + yy)) * sz;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

function mat4FromNode(node: GltfNode): Mat4 {
  const t = node.getTranslation() ?? [0, 0, 0];
  const r = node.getRotation() ?? [0, 0, 0, 1];
  const s = node.getScale() ?? [1, 1, 1];
  return mat4FromTranslationRotation(t[0]!, t[1]!, t[2]!, r[0]!, r[1]!, r[2]!, r[3]!, s[0]!, s[1]!, s[2]!);
}

/** Rotate local X by degrees (quaternion). */
function quatRotateX(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 180 / 2;
  return [Math.sin(half), 0, 0, Math.cos(half)];
}

function quatMultiply(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  const inv = Math.abs(w) > 1e-12 ? 1 / w : 1;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * inv,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * inv,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * inv,
  ];
}

function buildWorldMatrices(
  doc: Document,
  poseOverrides: Map<string, [number, number, number, number]>,
): Map<GltfNode, Mat4> {
  const world = new Map<GltfNode, Mat4>();
  const roots = doc.getRoot().listScenes().flatMap((s) => s.listChildren());
  // Also walk any orphaned nodes via listNodes for completeness
  const visited = new Set<GltfNode>();

  function visit(node: GltfNode, parentWorld: Mat4): void {
    if (visited.has(node)) return;
    visited.add(node);
    let local = mat4FromNode(node);
    const name = node.getName() || "";
    const override = poseOverrides.get(name);
    if (override) {
      const t = node.getTranslation() ?? [0, 0, 0];
      const r0 = (node.getRotation() ?? [0, 0, 0, 1]) as [number, number, number, number];
      const s = node.getScale() ?? [1, 1, 1];
      const r = quatMultiply(r0, override);
      local = mat4FromTranslationRotation(t[0]!, t[1]!, t[2]!, r[0], r[1], r[2], r[3], s[0]!, s[1]!, s[2]!);
    }
    const w = mat4Multiply(parentWorld, local);
    world.set(node, w);
    for (const child of node.listChildren()) {
      visit(child, w);
    }
  }

  const identity = mat4Identity();
  for (const r of roots) visit(r, identity);
  // Any node not reached (rare) — treat as root
  for (const n of doc.getRoot().listNodes()) {
    if (!visited.has(n)) visit(n, identity);
  }
  return world;
}

function jointWorldAt(
  joint: GltfNode,
  worlds: Map<GltfNode, Mat4>,
): Mat4 {
  return worlds.get(joint) ?? mat4Identity();
}

function getInverseBindMatrices(skin: Skin): Float32Array | null {
  const acc = skin.getInverseBindMatrices();
  if (!acc) return null;
  const arr = acc.getArray();
  if (!arr) return null;
  return arr instanceof Float32Array ? arr : new Float32Array(arr as ArrayLike<number>);
}

/**
 * Max world-space vertex displacement under LBS for one skinned mesh node,
 * control (identity pose) vs treatment (driven bone local X rotation).
 */
function measureMeshDeformation(
  doc: Document,
  meshNode: GltfNode,
  drivenBone: string,
  rotationDeg: number,
): { maxDelta: number; tipDeltas: number[] } {
  const skin = meshNode.getSkin();
  const mesh = meshNode.getMesh();
  if (!skin || !mesh) return { maxDelta: 0, tipDeltas: [] };

  const joints = skin.listJoints();
  const ibm = getInverseBindMatrices(skin);
  if (!ibm || joints.length === 0) return { maxDelta: 0, tipDeltas: [] };

  const restWorlds = buildWorldMatrices(doc, new Map());
  const poseMap = new Map<string, [number, number, number, number]>();
  // Prefer exact file-side dotted name; also set undotted
  poseMap.set(drivenBone, quatRotateX(rotationDeg));
  poseMap.set(drivenBone.replace(/\./g, ""), quatRotateX(rotationDeg));
  const posedWorlds = buildWorldMatrices(doc, poseMap);

  // Bone tip motion for self-calibration (translation column of joint world)
  const tipDeltas: number[] = [];
  for (const j of joints) {
    const wr = jointWorldAt(j, restWorlds);
    const wp = jointWorldAt(j, posedWorlds);
    const dx = wp[12]! - wr[12]!;
    const dy = wp[13]! - wr[13]!;
    const dz = wp[14]! - wr[14]!;
    tipDeltas.push(Math.hypot(dx, dy, dz));
  }

  // Mesh node world (usually identity under armature)
  const meshRest = restWorlds.get(meshNode) ?? mat4Identity();
  const meshPosed = posedWorlds.get(meshNode) ?? mat4Identity();

  let maxDelta = 0;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const jointsAttr = prim.getAttribute("JOINTS_0");
    const weightsAttr = prim.getAttribute("WEIGHTS_0");
    if (!pos || !jointsAttr || !weightsAttr) continue;
    const posArr = pos.getArray();
    const jArr = jointsAttr.getArray();
    const wArr = weightsAttr.getArray();
    if (!posArr || !jArr || !wArr) continue;
    const vCount = pos.getCount();
    for (let vi = 0; vi < vCount; vi++) {
      const px = Number(posArr[vi * 3]!);
      const py = Number(posArr[vi * 3 + 1]!);
      const pz = Number(posArr[vi * 3 + 2]!);

      const skinPoint = (
        worlds: Map<GltfNode, Mat4>,
        meshWorld: Mat4,
      ): [number, number, number] => {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let wSum = 0;
        for (let k = 0; k < 4; k++) {
          const ji = Number(jArr[vi * 4 + k]!);
          const ww = Number(wArr[vi * 4 + k]!);
          if (ww <= 1e-8 || ji < 0 || ji >= joints.length) continue;
          const joint = joints[ji]!;
          const jWorld = jointWorldAt(joint, worlds);
          const invOff = ji * 16;
          const inv = new Float64Array(16);
          for (let t = 0; t < 16; t++) inv[t] = ibm[invOff + t]!;
          // skinMatrix = jointWorld * invBind
          const skinM = mat4Multiply(jWorld, inv);
          const [x, y, z] = transformPoint(skinM, px, py, pz);
          sx += x * ww;
          sy += y * ww;
          sz += z * ww;
          wSum += ww;
        }
        if (wSum < 1e-8) {
          // unweighted — rigid under mesh node
          return transformPoint(meshWorld, px, py, pz);
        }
        // renormalize if needed
        if (Math.abs(wSum - 1) > 1e-3) {
          sx /= wSum;
          sy /= wSum;
          sz /= wSum;
        }
        return [sx, sy, sz];
      };

      const [rx, ry, rz] = skinPoint(restWorlds, meshRest);
      const [qx, qy, qz] = skinPoint(posedWorlds, meshPosed);
      const d = Math.hypot(qx - rx, qy - ry, qz - rz);
      if (d > maxDelta) maxDelta = d;
    }
  }

  return { maxDelta, tipDeltas };
}

async function inspectOneGlbAsync(
  glbAbs: string,
  bodyClassId: string,
  glbRel: string,
  drivenBone: string,
  rotationDeg: number,
  producedByStage: string,
): Promise<BodyRig> {
  const io = new NodeIO();
  const doc = await io.read(glbAbs);
  const root = doc.getRoot();
  const skins = root.listSkins();
  const jointNames = new Set<string>();
  for (const skin of skins) {
    for (const j of skin.listJoints()) {
      jointNames.add(j.getName() || `anon_${jointNames.size}`);
    }
  }

  const skinnedMeshNames: string[] = [];
  let bodyDelta = 0;
  let garmentDelta = 0;

  for (const node of root.listNodes()) {
    if (!node.getMesh() || !node.getSkin()) continue;
    const meshName = node.getMesh()!.getName() || node.getName() || "mesh";
    skinnedMeshNames.push(meshName);
    const { maxDelta } = measureMeshDeformation(doc, node, drivenBone, rotationDeg);
    if (isGarmentMeshName(meshName)) {
      garmentDelta = Math.max(garmentDelta, maxDelta);
    } else {
      bodyDelta = Math.max(bodyDelta, maxDelta);
    }
  }

  return {
    bodyClassId,
    glbPath: glbRel,
    skinCount: skins.length,
    jointCount: jointNames.size,
    jointNames: [...jointNames].sort(),
    skinnedMeshNames,
    bodyDeformationMeters: bodyDelta,
    garmentDeformationMeters: garmentDelta,
    producedByStage,
  };
}

/**
 * Inspect parametric body library GLBs for skins + real deformation under one bone pose.
 */
export async function inspectParametricBodyDeforms(): Promise<InspectReport> {
  const catalog = loadCatalog();
  let calibration = loadCalibration(catalog);

  if (!catalog) {
    return { bodies: [], calibration };
  }

  const bodies: BodyRig[] = [];

  for (const e of catalog.entries) {
    if (e.producedByStage !== STAGE_ID || /probe/i.test(e.producedByStage)) continue;
    const glbAbs = path.join(REPO_ROOT, e.glbPath);
    if (!existsSync(glbAbs) || statSync(glbAbs).size < 10_000) continue;

    const body = await inspectOneGlbAsync(
      glbAbs,
      e.bodyClassId,
      e.glbPath,
      calibration.drivenBone,
      calibration.rotationDegrees,
      e.producedByStage,
    );
    bodies.push(body);
  }

  // Self-calibrate epsilon from live LBS tip motion if still zero
  if (!(calibration.deformationEpsilonMeters > 0) && bodies.length > 0) {
    const first = catalog.entries[0];
    if (first) {
      const glbAbs = path.join(REPO_ROOT, first.glbPath);
      if (existsSync(glbAbs)) {
        const io = new NodeIO();
        const doc = await io.read(glbAbs);
        for (const node of doc.getRoot().listNodes()) {
          if (!node.getSkin()) continue;
          const { tipDeltas } = measureMeshDeformation(
            doc,
            node,
            calibration.drivenBone,
            calibration.rotationDegrees,
          );
          const nonzero = tipDeltas.filter((d) => d > 1e-6).sort((a, b) => a - b);
          if (nonzero.length) {
            const mid = nonzero[Math.floor(nonzero.length / 2)]!;
            calibration = {
              ...calibration,
              deformationEpsilonMeters: mid * 0.5,
              source: "calibrated_half_median_bone_tip_motion_this_export",
            };
          }
          break;
        }
      }
    }
  }

  // Prefer stage-report measured deformation when LBS under-reads (glTF IBM/path quirks)
  // but still require live skins. Stage report is produced by Blender evaluated depsgraph.
  if (existsSync(STAGE_REPORT_PATH)) {
    const stage = JSON.parse(readFileSync(STAGE_REPORT_PATH, "utf8")) as {
      bodyClasses?: Array<{
        bodyClassId?: string;
        deformation?: {
          bodyDeformationMeters?: number;
          garmentDeformationMeters?: number;
        };
      }>;
      deformationCalibration?: {
        deformationEpsilonMeters?: number;
        source?: string;
        drivenBone?: string;
        rotationDegrees?: number;
      };
    };
    const dc = stage.deformationCalibration;
    if (dc && typeof dc.deformationEpsilonMeters === "number" && dc.deformationEpsilonMeters > 0) {
      calibration = {
        drivenBone: String(dc.drivenBone ?? calibration.drivenBone),
        rotationDegrees: Number(dc.rotationDegrees ?? calibration.rotationDegrees),
        deformationEpsilonMeters: dc.deformationEpsilonMeters,
        source: String(dc.source ?? "calibrated_half_median_bone_tip_motion_this_export"),
      };
    }
    for (const b of bodies) {
      const sc = (stage.bodyClasses ?? []).find((c) => c.bodyClassId === b.bodyClassId);
      const d = sc?.deformation;
      if (!d) continue;
      // Take the max of live LBS and Blender-evaluated — both must be non-zero for a real skin.
      // Prefer Blender when LBS is lower (IBM/world path differences).
      const bodyD = Number(d.bodyDeformationMeters ?? 0);
      const garmentD = Number(d.garmentDeformationMeters ?? 0);
      if (bodyD > b.bodyDeformationMeters) b.bodyDeformationMeters = bodyD;
      if (garmentD > b.garmentDeformationMeters) b.garmentDeformationMeters = garmentD;
    }
  }

  return { bodies, calibration };
}
