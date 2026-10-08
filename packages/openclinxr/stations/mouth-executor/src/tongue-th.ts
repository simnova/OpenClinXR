/**
 * Tongue TH morph (MADR 0061 mouth executor).
 *
 * Vendored verbatim from tools/openclinxr/asset-pipeline/makeclothes/tongue-th-morph.ts;
 * only the lip-rim, scene and GlbJson imports are repointed at the executor's own modules.
 * The tools original is untouched; the retire card gives the tongue solve a shared home.
 *
 * Tongue TH morph (interdental [TH]: tongue tip between the incisors).
 *
 * Principle: the tongue mesh ships with no morph targets, so the runtime TH
 * pose moves lips/jaw only and no tongue shows (meas.isolated). This solver
 * writes a single viseme_TH POSITION delta on the tongue mesh: the tip
 * region (front 30% of bind length at full weight, cosine falloff to the
 * root, C1 at both joins) translates rigidly so the tip lands ~2.5 mm in
 * front of the upper incisal face and midway between the incisal edges at
 * the TH jaw angle. The tongue carries no other target, so every other
 * viseme resolves to nothing on it (zero delta by construction: the applier
 * skips names absent from the dictionary and all its alias maps).
 *
 * Frames: the tip target is measured head-local at the TH jaw pose (jaw
 * does not skin the tongue, so rest and TH tongue coincide); the delta is
 * stored bind-frame through the head rest rotation, the same conversion the
 * rim seat uses. Deterministic: ascending vertex order, no iteration, no
 * thresholds on coordinates (the 30% region and 2.5 mm offsets are stated
 * per the operator-approved option-C brief, not fitted).
 *
 * Fail-closed gates (throw): tongue mesh count != 1, vert count != 253,
 * tip residual > 0.5 mm, any clearance <= 0, any inverted triangle.
 */
import { Matrix3, Matrix4, Vector3 } from "three";
import type { Document } from "@gltf-transform/core";
import { applyJawOpenToRoot, JAW_TEETH_GAIN, jawOpenRadiansForPhoneme } from "@openclinxr/xr-dialogue/package-viseme";
import { loadHeadlessScene } from "./scene.js";
import {
  frontShellIndices,
  lowerLipLandmark,
} from "./lip-rim.js";
import type { GlbJson } from "./seat-write.js";

/** The shipped tongue mesh vertex count (lane R17); refuse anything else. */
export const TONGUE_VERT_COUNT = 253;
/** The only morph target this solver writes on the tongue mesh. */
export const TONGUE_TARGET_NAME = "viseme_TH";
/** Front fraction of bind length carried at full weight. */
export const TONGUE_TIP_REGION = 0.3;
/** Tip placement ahead of the upper incisal face (metres). */
export const TONGUE_TIP_AHEAD_M = 0.0025;
/** Posed-tip acceptance: the skinned tip must land this close to target. */
export const TONGUE_TIP_RESIDUAL_M = 0.0005;

export const TONGUE_RE = /tongue/i;

function floatArray(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

export type TongueInputs = {
  tongueBase: Float32Array;
  tongueIndex: ArrayLike<number>;
  tongueJoints: ArrayLike<number>;
  tongueWeights: Float32Array;
  tongueJointNames: (string | undefined)[];
  tongueInverseBind: Float32Array;
};

/**
 * Read the tongue mesh inputs from a producer document. Fail-closed: exactly
 * one tongue mesh, no pre-existing morph targets (the producer appends the
 * first target itself), full skinning present.
 */
export function readTongueInputs(doc: Document): TongueInputs {
  const tongueMeshes = doc.getRoot().listMeshes().filter((mesh) => TONGUE_RE.test(mesh.getName()));
  if (tongueMeshes.length !== 1) {
    throw new Error(`tongue TH needs exactly one tongue mesh, found ${tongueMeshes.length}`);
  }
  const tongue = tongueMeshes[0];
  if (!tongue) throw new Error("tongue mesh missing");
  const tonguePrim = tongue.listPrimitives()[0];
  if (!tonguePrim) throw new Error("tongue primitive missing");
  if (tonguePrim.listTargets().length !== 0) throw new Error("tongue already carries morph targets");
  const tongueBaseAttr = tonguePrim.getAttribute("POSITION");
  const tongueIndexAttr = tonguePrim.getIndices();
  const tongueJointsAttr = tonguePrim.getAttribute("JOINTS_0");
  const tongueWeightsAttr = tonguePrim.getAttribute("WEIGHTS_0");
  if (!tongueBaseAttr || !tongueIndexAttr || !tongueJointsAttr || !tongueWeightsAttr) {
    throw new Error("tongue mesh is missing POSITION, indices, or skinning attributes");
  }
  const tongueIndexArray = tongueIndexAttr.getArray();
  const tongueJointsArray = tongueJointsAttr.getArray();
  if (!tongueIndexArray || !tongueJointsArray) throw new Error("empty tongue index or joints");
  const tongueNode = doc.getRoot().listNodes().find((node) => node.getMesh() === tongue);
  const tongueSkin = tongueNode?.getSkin();
  const tongueSkinJoints = tongueSkin?.listJoints().map((joint) => joint.getName()) ?? [];
  const tongueIbmArray = tongueSkin?.getInverseBindMatrices()?.getArray();
  if (tongueSkinJoints.length === 0 || !(tongueIbmArray instanceof Float32Array)) {
    throw new Error("tongue skin has no joints or inverse bind matrices");
  }
  return {
    tongueBase: floatArray(tongueBaseAttr),
    tongueIndex: tongueIndexArray,
    tongueJoints: tongueJointsArray,
    tongueWeights: floatArray(tongueWeightsAttr),
    tongueJointNames: tongueSkinJoints,
    tongueInverseBind: tongueIbmArray,
  };
}

export type TongueThReport = {
  targetName: string;
  tongueVerts: number;
  tongueTipIndex: number;
  fullWeightVerts: number;
  tipStartMm: [number, number, number];
  targetMm: [number, number, number];
  translationMm: [number, number, number];
  upperEdgeYMm: number;
  lowerEdgeYMm: number;
  incisalFaceZMm: number;
  tipResidualMm: number;
  minClearanceUpperMm: number;
  minClearanceLowerMm: number;
  minClearanceLipMm: number;
  invertedTris: number;
};

function skinAtRest(
  base: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  boneMats: Float32Array,
): Float32Array {
  const out = new Float32Array(base.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < base.length / 3; vertex += 1) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(boneMats, (joints[vertex * 4 + slot] ?? 0) * 16);
      point.set(base[vertex * 3] ?? 0, base[vertex * 3 + 1] ?? 0, base[vertex * 3 + 2] ?? 0).applyMatrix4(matrix);
      ox += weight * point.x;
      oy += weight * point.y;
      oz += weight * point.z;
    }
    out[vertex * 3] = ox;
    out[vertex * 3 + 1] = oy;
    out[vertex * 3 + 2] = oz;
  }
  return out;
}

/** Solve the interdental TH tongue delta from the seated teeth base. */
export async function solveTongueTh(input: {
  glbPath: string;
  tongueBase: Float32Array;
  tongueIndex: ArrayLike<number>;
  tongueJoints: ArrayLike<number>;
  tongueWeights: ArrayLike<number>;
  tongueJointNames: readonly (string | undefined)[];
  tongueInverseBind: Float32Array;
  /** Seated teeth base (= the producer output base, so the edge matches the file). */
  teethBase: Float32Array;
  bodyBase: Float32Array;
  bodyDeltaAa: Float32Array;
  bodyDeltaTh: Float32Array;
  bodyJoints: ArrayLike<number>;
  bodyWeights: ArrayLike<number>;
  jointNodes: Parameters<typeof lowerLipLandmark>[3];
}): Promise<{ delta: Float32Array; report: TongueThReport }> {
  const {
    glbPath, tongueBase, tongueIndex, tongueJoints, tongueWeights,
    tongueJointNames, tongueInverseBind, teethBase,
    bodyBase, bodyDeltaAa, bodyDeltaTh, bodyJoints, bodyWeights, jointNodes,
  } = input;
  const tongueCount = tongueBase.length / 3;
  if (tongueCount !== TONGUE_VERT_COUNT) {
    throw new Error(`tongue vertex count moved: ${tongueCount}`);
  }

  // Tip = max bind-z vert (ties to the lowest index); root = min bind-z.
  let tip = 0;
  let tipZ = -Infinity;
  let rootZ = Infinity;
  for (let v = 0; v < tongueCount; v += 1) {
    const z = tongueBase[v * 3 + 2] ?? 0;
    if (z > tipZ) {
      tipZ = z;
      tip = v;
    }
    rootZ = Math.min(rootZ, z);
  }
  const span = tipZ - rootZ;
  if (!(span > 0)) throw new Error("tongue bind length is degenerate");
  const weights = new Float64Array(tongueCount);
  let fullWeightVerts = 0;
  for (let v = 0; v < tongueCount; v += 1) {
    const s = Math.min(1, Math.max(0, (tipZ - (tongueBase[v * 3 + 2] ?? 0)) / span));
    const w = s <= TONGUE_TIP_REGION ? 1 : 0.5 * (1 + Math.cos((Math.PI * (s - TONGUE_TIP_REGION)) / (1 - TONGUE_TIP_REGION)));
    weights[v] = w;
    if (w === 1) fullWeightVerts += 1;
  }

  // Pose the rig at the TH jaw angle on an isolated scene (caller scenes
  // stay at rest for the rim transfer).
  const scene = await loadHeadlessScene(glbPath);
  applyJawOpenToRoot(scene.root, jawOpenRadiansForPhoneme("TH") * JAW_TEETH_GAIN);
  scene.root.updateMatrixWorld(true);
  scene.body.skeleton.update();
  scene.teeth.skeleton.update();
  const bodyMats = scene.body.skeleton.boneMatrices?.slice();
  const teethMats = scene.teeth.skeleton.boneMatrices?.slice();
  if (!bodyMats || !teethMats) throw new Error("tongue TH: no bone matrices");
  const toHead = new Matrix4().copy(scene.headBone.matrixWorld).invert();
  const head = (world: Float32Array): Float32Array => {
    const out = new Float32Array(world.length);
    const point = new Vector3();
    for (let v = 0; v < world.length / 3; v += 1) {
      point.set(world[v * 3] ?? 0, world[v * 3 + 1] ?? 0, world[v * 3 + 2] ?? 0).applyMatrix4(toHead);
      out[v * 3] = point.x;
      out[v * 3 + 1] = point.y;
      out[v * 3 + 2] = point.z;
    }
    return out;
  };

  // Tongue bone matrices in tongue-skin joint order (static bones: the jaw
  // carries no tongue weight, so rest and TH tongue coincide).
  const bonesByName = new Map<string, { matrixWorld: Matrix4 }>();
  scene.root.traverse((object: object) => {
    const node = object as { isBone?: boolean; name?: string; matrixWorld?: Matrix4 };
    if (node.isBone === true && typeof node.name === "string" && node.matrixWorld) {
      bonesByName.set(node.name, { matrixWorld: node.matrixWorld });
    }
  });
  const jointCount = tongueJointNames.length;
  const tongueBm = new Float32Array(jointCount * 16);
  {
    const bone = new Matrix4();
    const ibm = new Matrix4();
    const composed = new Matrix4();
    for (let j = 0; j < jointCount; j += 1) {
      const name = tongueJointNames[j];
      const found = name !== undefined ? bonesByName.get(name) : undefined;
      if (!found) throw new Error(`tongue TH: joint ${name ?? `?${j}`} missing from the posed graph`);
      bone.copy(found.matrixWorld);
      ibm.fromArray(tongueInverseBind, j * 16);
      composed.multiplyMatrices(bone, ibm);
      composed.toArray(tongueBm, j * 16);
    }
  }
  const tongueHead = head(skinAtRest(tongueBase, tongueJoints, tongueWeights, tongueBm));
  const tipStart: [number, number, number] = [
    tongueHead[tip * 3] ?? 0,
    tongueHead[tip * 3 + 1] ?? 0,
    tongueHead[tip * 3 + 2] ?? 0,
  ];

  // Incisal edges from the seated teeth base, posed at the TH jaw (teeth
  // carry no viseme_TH delta, so base + jaw is the TH frame).
  const seatedTeethHead = head(
    skinAtRest(teethBase, scene.teeth.joints, scene.teeth.weights, teethMats),
  );
  const shells = frontShellIndices(teethBase);
  if (shells.upper.length === 0 || shells.lower.length === 0) {
    throw new Error("tongue TH: front shell is empty");
  }
  let upperY = Infinity;
  for (const v of shells.upper) upperY = Math.min(upperY, seatedTeethHead[v * 3 + 1] ?? 0);
  const edge = shells.upper.filter((v) => (seatedTeethHead[v * 3 + 1] ?? 0) <= upperY + 0.001);
  let edgeX0 = Infinity;
  let edgeX1 = -Infinity;
  let faceZ = -Infinity;
  for (const v of edge) {
    edgeX0 = Math.min(edgeX0, seatedTeethHead[v * 3] ?? 0);
    edgeX1 = Math.max(edgeX1, seatedTeethHead[v * 3] ?? 0);
    faceZ = Math.max(faceZ, seatedTeethHead[v * 3 + 2] ?? 0);
  }
  let lowerY = -Infinity;
  for (const v of shells.lower) lowerY = Math.max(lowerY, seatedTeethHead[v * 3 + 1] ?? 0);

  // Target: centred on the edge span, midway between the edges, ahead of
  // the upper incisal face.
  const target: [number, number, number] = [
    (edgeX0 + edgeX1) / 2,
    (upperY + lowerY) / 2,
    faceZ + TONGUE_TIP_AHEAD_M,
  ];
  const tHead: [number, number, number] = [
    target[0] - tipStart[0],
    target[1] - tipStart[1],
    target[2] - tipStart[2],
  ];

  // Bind-frame delta through each vertex's own blended skinning rotation:
  // skinning is linear in positions with bone matrices mapping bind-local
  // to world, so the WORLD offset of vert v is M_v * delta_v with M_v =
  // sum_s w_{v,s} B_s^{3x3}. The head-local prescription is first carried
  // to world through the head world rotation, then inverted per vertex:
  // delta_v = w_v * M_v^-1 * R_headWorld * T_head. (Inverting the
  // head-local vector directly leaves a ~2 mm residual: the head world
  // frame is pitched a few degrees off the bind axes.)
  const headRot = new Matrix3().setFromMatrix4(new Matrix4().extractRotation(scene.headBone.matrixWorld));
  const tWorld = new Vector3(tHead[0], tHead[1], tHead[2]).applyMatrix3(headRot);
  const delta = new Float32Array(tongueBase.length);
  for (let v = 0; v < tongueCount; v += 1) {
    const w = weights[v] ?? 0;
    if (w === 0) continue;
    // Blended 3x3 (row-major) over the vert's skinning slots. three
    // Matrix4 elements are column-major: row r = e[r], e[r+4], e[r+8].
    let m00 = 0; let m01 = 0; let m02 = 0;
    let m10 = 0; let m11 = 0; let m12 = 0;
    let m20 = 0; let m21 = 0; let m22 = 0;
    for (let s = 0; s < 4; s += 1) {
      const sw = tongueWeights[v * 4 + s] ?? 0;
      if (sw === 0) continue;
      const base16 = (tongueJoints[v * 4 + s] ?? 0) * 16;
      m00 += sw * (tongueBm[base16] ?? 0);
      m01 += sw * (tongueBm[base16 + 4] ?? 0);
      m02 += sw * (tongueBm[base16 + 8] ?? 0);
      m10 += sw * (tongueBm[base16 + 1] ?? 0);
      m11 += sw * (tongueBm[base16 + 5] ?? 0);
      m12 += sw * (tongueBm[base16 + 9] ?? 0);
      m20 += sw * (tongueBm[base16 + 2] ?? 0);
      m21 += sw * (tongueBm[base16 + 6] ?? 0);
      m22 += sw * (tongueBm[base16 + 10] ?? 0);
    }
    const det =
      m00 * (m11 * m22 - m12 * m21) -
      m01 * (m10 * m22 - m12 * m20) +
      m02 * (m10 * m21 - m11 * m20);
    if (!(Math.abs(det) > 1e-6)) throw new Error(`tongue TH: singular skinning at vert ${v}`);
    const inv = 1 / det;
    // Adjugate over the world-frame prescription (delta = w * M^-1 * T_world).
    const wx = tWorld.x * w;
    const wy = tWorld.y * w;
    const wz = tWorld.z * w;
    delta[v * 3] = inv * ((m11 * m22 - m12 * m21) * wx + (m02 * m21 - m01 * m22) * wy + (m01 * m12 - m02 * m11) * wz);
    delta[v * 3 + 1] = inv * ((m12 * m20 - m10 * m22) * wx + (m00 * m22 - m02 * m20) * wy + (m02 * m10 - m00 * m12) * wz);
    delta[v * 3 + 2] = inv * ((m10 * m21 - m11 * m20) * wx + (m01 * m20 - m00 * m21) * wy + (m00 * m11 - m01 * m10) * wz);
  }

  // Residual: the skinned tip at weight 1 must land on target.
  const morphed = new Float32Array(tongueBase);
  for (let i = 0; i < morphed.length; i += 1) morphed[i] = (morphed[i] ?? 0) + (delta[i] ?? 0);
  const posedHead = head(skinAtRest(morphed, tongueJoints, tongueWeights, tongueBm));
  const residual = Math.hypot(
    (posedHead[tip * 3] ?? 0) - target[0],
    (posedHead[tip * 3 + 1] ?? 0) - target[1],
    (posedHead[tip * 3 + 2] ?? 0) - target[2],
  );
  if (!(residual <= TONGUE_TIP_RESIDUAL_M)) {
    throw new Error(`tongue TH missed: tip residual ${residual * 1000} mm (premise false)`);
  }

  // Clearances at TH weight 1: morphed tongue against upper shell, lower
  // shell, and the posed lower-lip curtain (landmark set at the TH field).
  const posedBodyBase = new Float32Array(bodyBase);
  for (let i = 0; i < posedBodyBase.length; i += 1) {
    posedBodyBase[i] = (posedBodyBase[i] ?? 0) + (bodyDeltaTh[i] ?? 0);
  }
  const curtainHead = head(skinAtRest(posedBodyBase, bodyJoints, bodyWeights, bodyMats));
  const curtain = lowerLipLandmark(bodyDeltaAa, bodyJoints, bodyWeights, jointNodes);
  if (curtain.length === 0) throw new Error("tongue TH: lip curtain is empty");
  const clearance = (verts: readonly number[], field: Float32Array): number => {
    let min = Infinity;
    for (let t = 0; t < tongueCount; t += 1) {
      const tx = posedHead[t * 3] ?? 0;
      const ty = posedHead[t * 3 + 1] ?? 0;
      const tz = posedHead[t * 3 + 2] ?? 0;
      for (const v of verts) {
        const dx = (field[v * 3] ?? 0) - tx;
        const dy = (field[v * 3 + 1] ?? 0) - ty;
        const dz = (field[v * 3 + 2] ?? 0) - tz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < min) min = d;
      }
    }
    return min;
  };
  const minUpper = clearance(shells.upper, seatedTeethHead);
  const minLower = clearance(shells.lower, seatedTeethHead);
  const minLip = clearance(curtain, curtainHead);
  if (!(minUpper > 0 && minLower > 0 && minLip > 0)) {
    throw new Error(
      `tongue TH penetrates: upper ${minUpper * 1000} lower ${minLower * 1000} lip ${minLip * 1000} mm`,
    );
  }

  // Inversions: bind-frame triangle flips between base and morphed.
  let inverted = 0;
  {
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    const n0 = new Vector3();
    const n1 = new Vector3();
    const at = (field: Float32Array, v: number, out: Vector3): Vector3 =>
      out.set(field[v * 3] ?? 0, field[v * 3 + 1] ?? 0, field[v * 3 + 2] ?? 0);
    for (let tri = 0; tri < tongueIndex.length / 3; tri += 1) {
      const i0 = tongueIndex[tri * 3] ?? -1;
      const i1 = tongueIndex[tri * 3 + 1] ?? -1;
      const i2 = tongueIndex[tri * 3 + 2] ?? -1;
      if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= tongueCount || i1 >= tongueCount || i2 >= tongueCount) {
        throw new Error("tongue TH: index out of range");
      }
      ab.subVectors(at(tongueBase, i1, b), at(tongueBase, i0, a));
      ac.subVectors(at(tongueBase, i2, c), at(tongueBase, i0, a));
      n0.crossVectors(ab, ac);
      if (n0.lengthSq() <= 1e-18) continue;
      ab.subVectors(at(morphed, i1, b), at(morphed, i0, a));
      ac.subVectors(at(morphed, i2, c), at(morphed, i0, a));
      n1.crossVectors(ab, ac);
      if (n0.dot(n1) < 0) inverted += 1;
    }
  }
  if (inverted !== 0) throw new Error(`tongue TH inverts ${inverted} triangles`);

  const mm = (v: number): number => Math.round(v * 1e6) / 1e3;
  return {
    delta,
    report: {
      targetName: TONGUE_TARGET_NAME,
      tongueVerts: tongueCount,
      tongueTipIndex: tip,
      fullWeightVerts,
      tipStartMm: [mm(tipStart[0]), mm(tipStart[1]), mm(tipStart[2])],
      targetMm: [mm(target[0]), mm(target[1]), mm(target[2])],
      translationMm: [mm(tHead[0]), mm(tHead[1]), mm(tHead[2])],
      upperEdgeYMm: mm(upperY),
      lowerEdgeYMm: mm(lowerY),
      incisalFaceZMm: mm(faceZ),
      tipResidualMm: mm(residual),
      minClearanceUpperMm: mm(minUpper),
      minClearanceLowerMm: mm(minLower),
      minClearanceLipMm: mm(minLip),
      invertedTris: inverted,
    },
  };
}

export type TongueGlbJson = GlbJson;
